import { QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, Tables, response, getRaceIdHeader } from "/opt/nodejs/dynamodb.js";
import { requireAdmin } from "/opt/nodejs/admin.js";
import { requireRace } from "/opt/nodejs/raceAccess.js";
import { isRegisteredUsername } from "/opt/nodejs/usersAccess.js";
import { getEntryAreaNumbers, overlapsEntryAreas, isValidAreaRange } from "/opt/nodejs/pitAssignmentAccess.js";

/**
 * PUT /admin/pit-assignment — 担当割り当て変更
 * IF設計書: doc/aws-sam/admin/v2/03_race_data.md §4.4
 *
 * SK（username#maintenance_area）が変わるため、削除＋作成として扱う
 * （oldUsername/oldMaintenanceArea → username/maintenanceArea）。
 */
export const handler = async (event) => {
  try {
    const auth = await requireAdmin(event);
    if (auth.error) return auth.error;

    const raceId = getRaceIdHeader(event);
    const { error } = await requireRace(raceId, auth.circuit, { write: true });
    if (error) return error;

    const body             = JSON.parse(event.body || "{}");
    const oldUsername       = body.oldUsername;
    const oldMaintenanceArea = body.oldMaintenanceArea;
    const username          = body.username;
    const maintenanceArea   = body.maintenanceArea;

    if (!oldUsername || !oldMaintenanceArea || !username || !maintenanceArea) {
      return response(400, { msg: "未入力の項目があります" });
    }

    // 担当エリアの形（開始 <= 終了、範囲の広さに上限）を確認する
    if (!isValidAreaRange(maintenanceArea)) {
      return response(400, { msg: "担当エリアの指定が正しくありません（例: 5 または 5-10）" });
    }

    if (!(await isRegisteredUsername(username))) {
      return response(400, { msg: "登録済みの監視員を指定してください" });
    }

    const entryAreaNumbers = await getEntryAreaNumbers(raceId);
    if (!overlapsEntryAreas(maintenanceArea, entryAreaNumbers)) {
      return response(400, { msg: "存在しないピット場所です" });
    }

    // ── 担当者を別の人に変える場合、その人が既に担当を持っていないか確認する ──
    // 1つのレースで1人が持てる担当エリアは1つ（§4.1）。
    // SK が `username#maintenance_area` なので、キー条件の begins_with で引く。
    // FilterExpression + Limit:1 は使えない（Limit はフィルタ前に評価する件数の上限で、
    // パーティションの先頭1件が別人だと「担当なし」に見えてしまう）。
    if (username !== oldUsername) {
      const existing = await docClient.send(
        new QueryCommand({
          TableName:                 Tables.pitAssignment,
          KeyConditionExpression:    "race_id = :raceId AND begins_with(#sk, :prefix)",
          ExpressionAttributeNames:  { "#sk": "username#maintenance_area" },
          ExpressionAttributeValues: { ":raceId": raceId, ":prefix": `${username}#` },
          Limit:                     1,
        })
      );
      if ((existing.Items || []).length > 0) {
        return response(409, {
          msg: "その担当者は既にこのレースで担当エリアを持っています",
        });
      }
    }

    const oldSk = `${oldUsername}#${oldMaintenanceArea}`;
    const newSk = `${username}#${maintenanceArea}`;

    try {
      await docClient.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Delete: {
                TableName:           Tables.pitAssignment,
                Key:                 { race_id: raceId, "username#maintenance_area": oldSk },
                ConditionExpression: 'attribute_exists(#sk)',
                ExpressionAttributeNames: { "#sk": "username#maintenance_area" },
              },
            },
            {
              Put: {
                TableName: Tables.pitAssignment,
                Item: {
                  race_id:                     raceId,
                  "username#maintenance_area": newSk,
                  username,
                  maintenance_area:            String(maintenanceArea),
                },
              },
            },
          ],
        })
      );
    } catch (err) {
      if (err.name === "TransactionCanceledException") {
        return response(404, { msg: "対象の担当割当が存在しません" });
      }
      throw err;
    }

    return response(200, { msg: "" });
  } catch (err) {
    console.error("pit_assignment update error:", err);
    return response(500, { msg: "サーバーエラーが発生しました" });
  }
};
