import { QueryCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, Tables, response, generateId } from "/opt/nodejs/dynamodb.js";
import { requireGeneralRace } from "/opt/nodejs/raceToken.js";
import { findUnassignedCars } from "/opt/nodejs/pitAssignmentAccess.js";

/**
 * POST /entries/hand — 手入力送信
 * IF設計書: enterHand2.md
 * 1台分のピットデータを PutItem で保存
 * raceId は X-Race-Id（raceId トークン）で受け取る
 */
export const handler = async (event) => {
  try {
    const username = event.requestContext?.authorizer?.username;
    if (!username) return response(401, { msg: "認証が必要です" });

    const access = await requireGeneralRace(event);
    if (access.error) return access.error;
    const raceId = access.raceId;

    const body = JSON.parse(event.body || "{}");

    // body のキーは車番（1件のみ）
    const entries = Object.entries(body);
    if (entries.length !== 1) {
      return response(400, { msg: "リクエストボディは車番1件分のみ指定してください" });
    }

    const [carNumStr, data] = entries[0];
    const car_num = Number(carNumStr);
    if (isNaN(car_num)) {
      return response(400, { msg: "車番が不正です" });
    }
    if ((await findUnassignedCars(username, raceId, [car_num])).length > 0) {
      return response(403, { msg: "担当エリア外の車両です" });
    }

    // ── バリデーション ──
    if (!data.inTime && !data.outTime) {
      return response(400, { msg: "inTime / outTime のいずれかは必須です" });
    }
    if (data.inTime && data.outTime) {
      if (new Date(data.outTime) < new Date(data.inTime)) {
        return response(400, { msg: "出時刻は入時刻以降にしてください" });
      }
    }
    if (data.tire !== undefined && typeof data.tire !== "boolean") {
      return response(400, { msg: "tire は true / false で指定してください" });
    }
    if (data.oil !== undefined && typeof data.oil !== "boolean") {
      return response(400, { msg: "oil は true / false で指定してください" });
    }

    // ── 現在の最大 pit_num を取得 ──
    const existingResult = await docClient.send(
      new QueryCommand({
        TableName:                 Tables.pitLog,
        KeyConditionExpression:    "race_id = :race_id",
        FilterExpression:          "car_num = :car_num",
        ExpressionAttributeValues: { ":race_id": raceId, ":car_num": car_num },
        ProjectionExpression:      "pit_num",
      })
    );
    const maxPitNum = (existingResult.Items || []).reduce(
      (max, item) => Math.max(max, item.pit_num || 0),
      0
    );

    const now = new Date().toISOString();
    await docClient.send(
      new PutCommand({
        TableName: Tables.pitLog,
        Item: {
          race_id:        raceId,
          id:             generateId(),
          car_num,
          username,
          pit_num:        maxPitNum + 1,
          in_time:        data.inTime        || null,
          out_time:       data.outTime       || null,
          driver_out:     data.outDriver     || null,
          tire:           data.tire    === true,
          oil:            data.oil     === true,
          note:           data.note          || "",
          created_at:     now,
          updated_at:     now,
        },
      })
    );

    return response(200, { msg: "" });
  } catch (err) {
    console.error("handCreate error:", err);
    return response(500, { msg: "サーバーエラーが発生しました" });
  }
};
