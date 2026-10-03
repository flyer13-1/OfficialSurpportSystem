import { DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, Tables, response, getRaceIdHeader } from "/opt/nodejs/dynamodb.js";
import { requireAdmin } from "/opt/nodejs/admin.js";
import { requireRace } from "/opt/nodejs/raceAccess.js";

/**
 * DELETE /admin/pit-assignment?username=&maintenanceArea= — 担当割り当て削除
 * IF設計書: doc/aws-sam/admin/v2/03_race_data.md §4.4
 */
export const handler = async (event) => {
  try {
    const auth = await requireAdmin(event);
    if (auth.error) return auth.error;

    const raceId = getRaceIdHeader(event);
    const { error } = await requireRace(raceId, auth.circuit, { write: true });
    if (error) return error;

    const username        = event.queryStringParameters?.username;
    const maintenanceArea  = event.queryStringParameters?.maintenanceArea;
    if (!username || !maintenanceArea) {
      return response(400, { msg: "未入力の項目があります" });
    }

    try {
      await docClient.send(
        new DeleteCommand({
          TableName: Tables.pitAssignment,
          Key: {
            race_id:                     raceId,
            "username#maintenance_area": `${username}#${maintenanceArea}`,
          },
          ConditionExpression:      "attribute_exists(#sk)",
          ExpressionAttributeNames: { "#sk": "username#maintenance_area" },
        })
      );
    } catch (err) {
      if (err.name === "ConditionalCheckFailedException") {
        return response(404, { msg: "対象の担当割当が存在しません" });
      }
      throw err;
    }

    return response(200, { msg: "" });
  } catch (err) {
    console.error("pit_assignment delete error:", err);
    return response(500, { msg: "サーバーエラーが発生しました" });
  }
};
