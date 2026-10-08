import { QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, Tables, response, getRaceIdHeader } from "/opt/nodejs/dynamodb.js";
import { requireAdmin } from "/opt/nodejs/admin.js";
import { requireRace } from "/opt/nodejs/raceAccess.js";
import { isRegisteredUsername } from "/opt/nodejs/usersAccess.js";
import { getEntryAreaNumbers, overlapsEntryAreas, isValidAreaRange } from "/opt/nodejs/pitAssignmentAccess.js";

/**
 * POST /admin/pit-assignment/bulk — 担当割り当て一括登録
 * IF設計書: doc/aws-sam/admin/v2/03_race_data.md §4.3
 *
 * 書き込みは TransactWriteItems（2026-10-08変更。以前は BatchWriteItem だった）。
 * BatchWriteItem は容量不足・スロットリング時に UnprocessedItems を正常応答として返すため、
 * 戻り値を見ていないと「成功と返したのに一部入っていない」状態が起き得た（§4.3）。
 *
 * 担当割当の重複（リクエスト内・既存の両方）は、リクエスト全体を拒否せず
 * **その行だけ除外して残りを登録する**（2026-10-08決定。§4.3）。
 * 重複の単位は**担当者名だけ**。1つのレースで1人が持てる担当エリアは1つなので、
 * 同じ人が2行目に出てきたら（エリアが違っても）重複として除外する（§4.1）。
 * 形式の違反（未登録の担当者・存在しないエリア）は従来どおりリクエスト全体を400で拒否する。
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
    const assignments = body.assignments;

    if (!Array.isArray(assignments) || assignments.length === 0) {
      return response(400, { msg: "未入力の項目があります" });
    }
    if (assignments.some((a) => !a.username || !a.maintenanceArea)) {
      return response(400, { msg: "未入力の項目があります" });
    }

    // ── 担当エリアの形（"5" / "5-10"。開始 <= 終了、範囲の広さに上限）を確認 ──
    if (assignments.some((a) => !isValidAreaRange(a.maintenanceArea))) {
      return response(400, { msg: "担当エリアの指定が正しくありません（例: 5 または 5-10）" });
    }

    // ── username が登録済み利用者か（重複を避けて一意分だけ確認） ──
    const uniqueUsernames = [...new Set(assignments.map((a) => a.username))];
    const registeredFlags = await Promise.all(
      uniqueUsernames.map((u) => isRegisteredUsername(u))
    );
    const registeredSet = new Set(
      uniqueUsernames.filter((_, i) => registeredFlags[i])
    );
    if (assignments.some((a) => !registeredSet.has(a.username))) {
      return response(400, { msg: "登録済みの監視員を指定してください" });
    }

    // ── maintenanceArea が当該raceのentryに存在するか ──
    const entryAreaNumbers = await getEntryAreaNumbers(raceId);
    if (assignments.some((a) => !overlapsEntryAreas(a.maintenanceArea, entryAreaNumbers))) {
      return response(400, { msg: "存在しないピット場所です" });
    }

    // ── 既存の担当者名を集める（1レース1人1エリアのため、担当者名で見る） ──
    const existingResult = await docClient.send(
      new QueryCommand({
        TableName:                 Tables.pitAssignment,
        KeyConditionExpression:    "race_id = :raceId",
        ExpressionAttributeValues: { ":raceId": raceId },
        ProjectionExpression:      "username",
      })
    );
    const existingUsernames = new Set(
      (existingResult.Items || []).map((it) => it.username)
    );

    // ── 重複する行を除外する（リクエスト内の2件目以降・既に担当を持っている人） ──
    const accepted = [];
    const skipped  = [];
    const seen     = new Set();

    for (const a of assignments) {
      const maintenanceArea = String(a.maintenanceArea);
      const row = { username: a.username, maintenanceArea };

      if (seen.has(a.username)) {
        skipped.push({ ...row, reason: "duplicate_in_request" });
        continue;
      }
      seen.add(a.username);
      if (existingUsernames.has(a.username)) {
        skipped.push({ ...row, reason: "already_registered" });
        continue;
      }
      accepted.push({ ...row, sk: `${a.username}#${maintenanceArea}` });
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
            TransactItems: accepted.map((a) => ({
              Put: {
                TableName: Tables.pitAssignment,
                Item: {
                  race_id:                     raceId,
                  "username#maintenance_area": a.sk,
                  username:                    a.username,
                  maintenance_area:            a.maintenanceArea,
                },
                // 重複は上で除外済み。確認してから書き込むまでの間に別の登録が
                // 入った場合に上書きしないための条件（start_driver と同じ考え方）。
                ConditionExpression:      "attribute_not_exists(#sk)",
                ExpressionAttributeNames: { "#sk": "username#maintenance_area" },
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
    console.error("pit_assignment bulk error:", err);
    return response(500, { msg: "サーバーエラーが発生しました" });
  }
};
