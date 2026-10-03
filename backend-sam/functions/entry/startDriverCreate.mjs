import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, Tables, response } from "/opt/nodejs/dynamodb.js";
import { isRaceFinished } from "/opt/nodejs/raceStatus.js";
import { isValidDriverLetter, hasDriverSlot } from "/opt/nodejs/entryAccess.js";
import { getAssignedEntries } from "/opt/nodejs/pitAssignmentAccess.js";

/**
 * POST /entries/start-driver — スタートドライバー登録（一般利用者向け）
 * IF設計書: doc/aws-sam/admin/v2/03_race_data.md §3.6
 *
 * 担当エリア内の車両に限り、未登録のスタートドライバーを1件だけ登録できる。
 * 登録後の変更・削除は提供しない（管理者向けの §3.4・§3.5 を使う）。
 *
 * raceId は他の一般向けAPIと同じく race_id クエリパラメータで受け取る
 * （raceIdトークンの検証はまだ未実装。pitlog系7本・init と合わせて
 * 一括で移行する予定。doc/IF/raceIdToken.md §8）。
 */
export const handler = async (event) => {
  try {
    const username = event.requestContext?.authorizer?.username;
    if (!username) return response(401, { msg: "認証が必要です" });

    const raceId = event.queryStringParameters?.race_id;
    if (!raceId) return response(400, { msg: "race_id は必須です" });

    const body   = JSON.parse(event.body || "{}");
    const carNum = Number(body.carNum);
    const driver = body.driver;

    // ── race の存在・終了判定（01章§5.4。サーキットでは制限しない） ──
    const raceResult = await docClient.send(
      new GetCommand({ TableName: Tables.race, Key: { id: raceId } })
    );
    if (!raceResult.Item) {
      return response(404, { msg: "対象のレースが存在しません" });
    }
    if (isRaceFinished(raceResult.Item.finish_date)) {
      return response(403, { msg: "終了したレースです", reason: "race_finished" });
    }

    // ── 対象車両が、呼び出し元の担当エリアに含まれるか（サーバー側で都度算出） ──
    const assignedEntries = await getAssignedEntries(username, raceId);
    const entry = assignedEntries.find((e) => e.car_num === carNum);
    if (!entry) {
      // 担当エリア外か、そもそも entry に存在しないかは区別せず、
      // 存在確認を先に行う（他車両の有無を知られないようにする必要はないため、
      // まず entry 自体の有無を確認する）。
      const entryResult = await docClient.send(
        new GetCommand({ TableName: Tables.entry, Key: { race_id: raceId, car_num: carNum } })
      );
      if (!entryResult.Item) {
        return response(404, { msg: "対象の車両がエントリーに存在しません" });
      }
      return response(403, { msg: "担当エリア外の車両です" });
    }

    // ── driver が A〜F か、かつ entry の非null 枠か ──
    if (!hasDriverSlot(entry, driver)) {
      return response(400, { msg: "そのドライバ枠はエントリーに登録されていません" });
    }

    // ── 既に登録済みなら拒否（登録のみ。上書きは提供しない） ──
    try {
      await docClient.send(
        new PutCommand({
          TableName: Tables.startDriver,
          Item: {
            race_id: raceId,
            car_num: carNum,
            driver:  driver.toUpperCase(),
          },
          ConditionExpression: "attribute_not_exists(car_num)",
        })
      );
    } catch (err) {
      if (err.name === "ConditionalCheckFailedException") {
        return response(409, { msg: "スタートドライバーは既に登録されています" });
      }
      throw err;
    }

    return response(200, { msg: "" });
  } catch (err) {
    console.error("start_driver create (general) error:", err);
    return response(500, { msg: "サーバーエラーが発生しました" });
  }
};
