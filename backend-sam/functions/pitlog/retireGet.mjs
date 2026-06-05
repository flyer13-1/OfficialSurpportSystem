import { QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, Tables, response } from "/opt/nodejs/dynamodb.js";

/**
 * GET /entries/retire — リタイア登録 初期データ取得
 * IF設計書: enterRetire.md
 * 全エントリーを maintenance_area 昇順、car_num 昇順で返す
 * クエリパラメータ: race_id
 */
export const handler = async (event) => {
  try {
    const username = event.requestContext?.authorizer?.username;
    if (!username) return response(401, { msg: "認証が必要です" });

    const race_id = event.queryStringParameters?.race_id;
    if (!race_id) return response(400, { msg: "race_id は必須です" });

    // ── EntryTable から全エントリー取得 ──
    const entryResult = await docClient.send(
      new QueryCommand({
        TableName:                 Tables.entry,
        KeyConditionExpression:    "race_id = :race_id",
        ExpressionAttributeValues: { ":race_id": race_id },
      })
    );
    const entries = entryResult.Items || [];

    // ── RetireTable から全リタイア記録取得 ──
    const retireResult = await docClient.send(
      new QueryCommand({
        TableName:                 Tables.retire,
        KeyConditionExpression:    "race_id = :race_id",
        ExpressionAttributeValues: { ":race_id": race_id },
      })
    );
    const retireMap = {};
    for (const r of retireResult.Items || []) {
      retireMap[r.car_num] = r;
    }

    // ── maintenance_area 昇順、car_num 昇順でソート ──
    entries.sort((a, b) => {
      const areaA = String(a.maintenance_area || "");
      const areaB = String(b.maintenance_area || "");
      if (areaA !== areaB) return areaA.localeCompare(areaB, "ja");
      return (a.car_num || 0) - (b.car_num || 0);
    });

    const result = entries.map((entry) => {
      const retire = retireMap[entry.car_num];
      return {
        carNum:          entry.car_num,
        maintenanceArea: entry.maintenance_area || "",
        isRetired:       retire?.is_retired ?? false,
        reason:          retire?.reason     ?? "",
      };
    });

    return response(200, { msg: "", entries: result });
  } catch (err) {
    console.error("retireGet error:", err);
    return response(500, { msg: "サーバーエラーが発生しました" });
  }
};
