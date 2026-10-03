import { DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, Tables, response, getRaceIdHeader } from "/opt/nodejs/dynamodb.js";
import { requireAdmin } from "/opt/nodejs/admin.js";
import { requireRace } from "/opt/nodejs/raceAccess.js";

/**
 * DELETE /admin/start-driver/{carNum} — スタートドライバー削除
 * IF設計書: doc/aws-sam/admin/v2/03_race_data.md §3.5
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

    try {
      await docClient.send(
        new DeleteCommand({
          TableName:           Tables.startDriver,
          Key:                 { race_id: raceId, car_num: carNum },
          ConditionExpression: "attribute_exists(car_num)",
        })
      );
    } catch (err) {
      if (err.name === "ConditionalCheckFailedException") {
        return response(404, { msg: "対象のスタートドライバーが存在しません" });
      }
      throw err;
    }

    return response(200, { msg: "" });
  } catch (err) {
    console.error("start_driver delete error:", err);
    return response(500, { msg: "サーバーエラーが発生しました" });
  }
};
