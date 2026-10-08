import { QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, Tables, response, getRaceIdHeader } from "/opt/nodejs/dynamodb.js";
import { requireAdmin } from "/opt/nodejs/admin.js";
import { requireRace } from "/opt/nodejs/raceAccess.js";
import { isValidDriverLetter, hasDriverSlot } from "/opt/nodejs/entryAccess.js";

/**
 * POST /admin/start-driver/bulk — スタートドライバー一括登録
 * IF設計書: doc/aws-sam/admin/v2/03_race_data.md §3.2
 *
 * 書き込みは TransactWriteItems（2026-10-08変更。以前は BatchWriteItem だった）。
 * BatchWriteItem は容量不足・スロットリング時に UnprocessedItems を正常応答として返すため、
 * 戻り値を見ていないと「成功と返したのに一部入っていない」状態が起き得た（§3.2）。
 *
 * 車番の重複（リクエスト内・既存の両方）は、リクエスト全体を拒否せず
 * **その行だけ除外して残りを登録する**（2026-10-08決定。§3.2）。
 * 形式の違反（A〜F以外・entryに無い車両／枠）は従来どおりリクエスト全体を400で拒否する。
 */

// TransactWriteItems は1トランザクション100件まで。
const MAX_TRANSACT_ITEMS = 100;

export const handler = async (event) => {
  try {
    const auth = await requireAdmin(event);
    if (auth.error) return auth.error;

    const raceId = getRaceIdHeader(event);
    const { error } = await requireRace(raceId, auth.circuit, { write: true });
    if (error) return error;

    const body = JSON.parse(event.body || "{}");
    const startDrivers = body.startDrivers;

    if (!Array.isArray(startDrivers) || startDrivers.length === 0) {
      return response(400, { msg: "未入力の項目があります" });
    }
    if (startDrivers.some((sd) => !isValidDriverLetter(sd.driver))) {
      return response(400, { msg: "ドライバ枠は A〜F で指定してください" });
    }
    if (startDrivers.some((sd) => !Number.isInteger(Number(sd.carNum)) || Number(sd.carNum) <= 0)) {
      return response(400, { msg: "車番は正の整数で指定してください" });
    }

    // ── 対象車両が entry に存在するか・指定枠が非null かをまとめて検証 ──
    const entryResult = await docClient.send(
      new QueryCommand({
        TableName:                 Tables.entry,
        KeyConditionExpression:    "race_id = :raceId",
        ExpressionAttributeValues: { ":raceId": raceId },
      })
    );
    const entryByCarNum = new Map(
      (entryResult.Items || []).map((e) => [e.car_num, e])
    );

    for (const sd of startDrivers) {
      const entry = entryByCarNum.get(Number(sd.carNum));
      if (!entry) {
        return response(404, { msg: "対象の車両がエントリーに存在しません" });
      }
      if (!hasDriverSlot(entry, sd.driver)) {
        return response(400, { msg: "そのドライバ枠はエントリーに登録されていません" });
      }
    }

    // ── 既存の start_driver の車番を集める ──
    const existingResult = await docClient.send(
      new QueryCommand({
        TableName:                 Tables.startDriver,
        KeyConditionExpression:    "race_id = :raceId",
        ExpressionAttributeValues: { ":raceId": raceId },
        ProjectionExpression:      "car_num",
      })
    );
    const existingCarNums = new Set(
      (existingResult.Items || []).map((it) => it.car_num)
    );

    // ── 重複する行を除外する（リクエスト内の2件目以降・既存にあるもの） ──
    const accepted = [];
    const skipped  = [];
    const seen     = new Set();

    for (const sd of startDrivers) {
      const carNum = Number(sd.carNum);
      if (seen.has(carNum)) {
        skipped.push({ carNum, reason: "duplicate_in_request" });
        continue;
      }
      seen.add(carNum);
      if (existingCarNums.has(carNum)) {
        skipped.push({ carNum, reason: "already_registered" });
        continue;
      }
      accepted.push({ carNum, driver: sd.driver.toUpperCase() });
    }

    if (accepted.length > MAX_TRANSACT_ITEMS) {
      return response(400, {
        msg: `一度に登録できるのは${MAX_TRANSACT_ITEMS}件までです`,
      });
    }

    // 全部が重複だった場合も、エラーではなく結果として返す（count 0 ＋ skipped）。
    if (accepted.length > 0) {
      try {
        await docClient.send(
          new TransactWriteCommand({
            TransactItems: accepted.map((sd) => ({
              Put: {
                TableName: Tables.startDriver,
                Item: {
                  race_id: raceId,
                  car_num: sd.carNum,
                  driver:  sd.driver,
                },
                // 重複は上で除外済み。ここで条件を付けるのは、確認してから書き込むまでの
                // 間に別の登録が入った場合に上書きしないため。その場合は全件失敗して
                // エラーになるので、やり直せば重複として除外される。
                ConditionExpression: "attribute_not_exists(car_num)",
              },
            })),
          })
        );
      } catch (err) {
        if (err.name === "TransactionCanceledException") {
          return response(409, {
            msg: "登録中に他の操作が入りました。もう一度お試しください",
          });
        }
        throw err;
      }
    }

    return response(200, { msg: "", count: accepted.length, skipped });
  } catch (err) {
    console.error("start_driver bulk error:", err);
    return response(500, { msg: "サーバーエラーが発生しました" });
  }
};
