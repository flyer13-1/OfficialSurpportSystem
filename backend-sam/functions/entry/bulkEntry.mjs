import { BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, Tables, response } from "/opt/nodejs/dynamodb.js";

/**
 * POST /entry/bulk — エントリー一括登録
 * admin 画面の CSV / 手入力から複数エントリーを EntryTable に登録する
 * リクエストボディ: { raceId, entries: [{ carNum, className, entrantName, vehicleName,
 *                    maintenanceArea, pitGarage, driverA, driverB?, ... driverF? }] }
 */
export const handler = async (event) => {
  try {
    const username = event.requestContext?.authorizer?.username;
    if (!username) return response(401, { msg: "認証が必要です" });

    const body = JSON.parse(event.body || "{}");
    const { raceId, entries } = body;

    if (!raceId) return response(400, { msg: "raceId は必須です" });
    if (!Array.isArray(entries) || entries.length === 0) {
      return response(400, { msg: "entries は1件以上必要です" });
    }

    // BatchWriteItem は1リクエスト25件まで
    for (let i = 0; i < entries.length; i += 25) {
      const chunk = entries.slice(i, i + 25);
      const requests = chunk.map((e) => ({
        PutRequest: {
          Item: {
            race_id:          raceId,
            car_num:          Number(e.carNum),
            class_name:       e.className       || null,
            entrant_name:     e.entrantName     || null,
            vehicle_name:     e.vehicleName     || null,
            maintenance_area: e.maintenanceArea || null,
            pit_garage:       e.pitGarage != null ? Number(e.pitGarage) : null,
            driver_a:         e.driverA         || null,
            driver_b:         e.driverB         || null,
            driver_c:         e.driverC         || null,
            driver_d:         e.driverD         || null,
            driver_e:         e.driverE         || null,
            driver_f:         e.driverF         || null,
            start_driver:     null,
          },
        },
      }));

      await docClient.send(
        new BatchWriteCommand({ RequestItems: { [Tables.entry]: requests } })
      );
    }

    return response(200, { msg: "", count: entries.length });
  } catch (err) {
    console.error("bulkEntry error:", err);
    return response(500, { msg: "サーバーエラーが発生しました" });
  }
};
