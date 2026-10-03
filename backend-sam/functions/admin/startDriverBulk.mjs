import { QueryCommand, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, Tables, response, getRaceIdHeader } from "/opt/nodejs/dynamodb.js";
import { requireAdmin } from "/opt/nodejs/admin.js";
import { requireRace } from "/opt/nodejs/raceAccess.js";
import { isValidDriverLetter, hasDriverSlot } from "/opt/nodejs/entryAccess.js";

/**
 * POST /admin/start-driver/bulk — スタートドライバー一括登録
 * IF設計書: doc/aws-sam/admin/v2/03_race_data.md §3.2
 *
 * 同一車番の再送は上書きとして許容する（§3.2・§7 未決事項。重複を理由に拒否はしない）。
 */
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

    // ── BatchWriteItem は1リクエスト25件まで ──
    for (let i = 0; i < startDrivers.length; i += 25) {
      const chunk = startDrivers.slice(i, i + 25);
      await docClient.send(
        new BatchWriteCommand({
          RequestItems: {
            [Tables.startDriver]: chunk.map((sd) => ({
              PutRequest: {
                Item: {
                  race_id: raceId,
                  car_num: Number(sd.carNum),
                  driver:  sd.driver.toUpperCase(),
                },
              },
            })),
          },
        })
      );
    }

    return response(200, { msg: "", count: startDrivers.length });
  } catch (err) {
    console.error("start_driver bulk error:", err);
    return response(500, { msg: "サーバーエラーが発生しました" });
  }
};
