import { QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, Tables, response, getRaceIdHeader } from "/opt/nodejs/dynamodb.js";
import { requireAdmin } from "/opt/nodejs/admin.js";
import { requireRace } from "/opt/nodejs/raceAccess.js";

/**
 * DELETE /admin/entry/{carNum} — エントリー削除
 * IF設計書: doc/aws-sam/admin/v2/03_race_data.md §2.5
 *
 * raceId はヘッダーで送る（carNum は車番であり秘匿する意味が無いためパスパラメータのまま）。
 * pit_log が1件でも紐付く場合は削除不可（409）。削除に伴い、当該車両の
 * start_driver も同時に削除する（§5.3。pit_assignment は人単位のため残置する）。
 */
export const handler = async (event) => {
  try {
    const auth = await requireAdmin(event);
    if (auth.error) return auth.error;

    const raceId = getRaceIdHeader(event);
    const { error } = await requireRace(raceId, auth.circuit, { write: true });
    if (error) return error;

    const carNum = Number(event.pathParameters?.carNum);
    if (!Number.isFinite(carNum)) {
      return response(400, { msg: "車番は必須です" });
    }

    // ── pit_log 紐付き確認（1件でもあれば削除不可） ──
    const pitLogs = await docClient.send(
      new QueryCommand({
        TableName:                 Tables.pitLog,
        KeyConditionExpression:    "race_id = :raceId",
        FilterExpression:          "car_num = :carNum",
        ExpressionAttributeValues: { ":raceId": raceId, ":carNum": carNum },
        ProjectionExpression:      "id",
        Limit:                     1,
      })
    );
    if ((pitLogs.Items || []).length > 0) {
      return response(409, { msg: "ピット記録が存在するため削除できません" });
    }

    // ── entry と start_driver（同じ車両分があれば）を同時に削除 ──
    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Delete: {
              TableName:           Tables.entry,
              Key:                 { race_id: raceId, car_num: carNum },
              ConditionExpression: "attribute_exists(car_num)",
            },
          },
          {
            Delete: {
              TableName: Tables.startDriver,
              Key:       { race_id: raceId, car_num: carNum },
            },
          },
        ],
      })
    );

    return response(200, { msg: "" });
  } catch (err) {
    if (err.name === "TransactionCanceledException") {
      return response(404, { msg: "対象のエントリーが存在しません" });
    }
    console.error("entry delete error:", err);
    return response(500, { msg: "サーバーエラーが発生しました" });
  }
};
