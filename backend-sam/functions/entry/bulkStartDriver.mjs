import { BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, Tables, response } from "/opt/nodejs/dynamodb.js";

/**
 * POST /entry/start-driver/bulk — スタートドライバー一括登録
 * admin 画面の CSV / 手入力から複数スタートドライバーを StartDriverTable に登録する
 * リクエストボディ: { raceId, entries: [{ carNum, driver }] }
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
            race_id:      raceId,
            car_num:      Number(e.carNum),
            start_driver: e.driver || null,
          },
        },
      }));

      await docClient.send(
        new BatchWriteCommand({ RequestItems: { [Tables.startDriver]: requests } })
      );
    }

    return response(200, { msg: "", count: entries.length });
  } catch (err) {
    console.error("bulkStartDriver error:", err);
    return response(500, { msg: "サーバーエラーが発生しました" });
  }
};
