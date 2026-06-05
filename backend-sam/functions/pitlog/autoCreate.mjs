import { QueryCommand, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, Tables, response, generateId } from "/opt/nodejs/dynamodb.js";

/**
 * POST /entries/auto — 自動入力送信
 * IF設計書: enterAuto2.md
 * current + unsent のデータを BatchWriteItem で PitLogTable に保存
 * クエリパラメータ: race_id
 */
export const handler = async (event) => {
  try {
    const username = event.requestContext?.authorizer?.username;
    if (!username) return response(401, { msg: "認証が必要です" });

    const race_id = event.queryStringParameters?.race_id;
    if (!race_id) return response(400, { msg: "race_id は必須です" });

    const body = JSON.parse(event.body || "{}");
    const { current, unsent } = body;

    if (!current || typeof current !== "object") {
      return response(400, { msg: "current は必須です" });
    }

    // current + unsent をマージ（同一車番は current 優先）
    const merged = { ...unsent, ...current };

    // ── 各車番の次の pit_num を取得してアイテムを生成 ──
    const putItems = [];

    for (const [carNumStr, data] of Object.entries(merged)) {
      const car_num = Number(carNumStr);
      if (isNaN(car_num)) continue;

      // バリデーション: inTime / outTime / garageInTime の最低1つが必要
      if (!data.inTime && !data.outTime && !data.garageInTime) {
        return response(400, {
          msg: `車番 ${car_num}: inTime / outTime / garageInTime のいずれかは必須です`,
        });
      }
      // outTime が inTime より前のチェック
      if (data.inTime && data.outTime) {
        if (new Date(data.outTime) < new Date(data.inTime)) {
          return response(400, { msg: `車番 ${car_num}: 出時刻は入時刻以降にしてください` });
        }
      }

      // 現在の最大 pit_num を取得
      const existingResult = await docClient.send(
        new QueryCommand({
          TableName:                 Tables.pitLog,
          KeyConditionExpression:    "race_id = :race_id",
          FilterExpression:          "car_num = :car_num",
          ExpressionAttributeValues: { ":race_id": race_id, ":car_num": car_num },
          ProjectionExpression:      "pit_num",
        })
      );
      const maxPitNum = (existingResult.Items || []).reduce(
        (max, item) => Math.max(max, item.pit_num || 0),
        0
      );

      const now = new Date().toISOString();
      putItems.push({
        PutRequest: {
          Item: {
            race_id,
            id:             generateId(),
            car_num,
            username,
            pit_num:        maxPitNum + 1,
            in_time:        data.inTime        || null,
            out_time:       data.outTime       || null,
            garage_in_time: data.garageInTime  || null,
            driver_out:     data.outDriver     || null,
            tire:           data.tire    === true,
            oil:            data.oil     === true,
            note:           data.note          || "",
            created_at:     now,
            updated_at:     now,
          },
        },
      });
    }

    if (putItems.length === 0) {
      return response(200, { msg: "" });
    }

    // ── BatchWriteItem（25件ずつ） ──
    for (let i = 0; i < putItems.length; i += 25) {
      const chunk = putItems.slice(i, i + 25);
      await docClient.send(
        new BatchWriteCommand({
          RequestItems: { [Tables.pitLog]: chunk },
        })
      );
    }

    return response(200, { msg: "" });
  } catch (err) {
    console.error("autoCreate error:", err);
    return response(500, { msg: "サーバーエラーが発生しました" });
  }
};
