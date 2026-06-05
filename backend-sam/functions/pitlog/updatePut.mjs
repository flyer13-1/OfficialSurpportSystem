import { QueryCommand, UpdateCommand, PutCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, Tables, response, generateId } from "/opt/nodejs/dynamodb.js";

/**
 * PUT /entries/update — 記録変更 / リタイア情報更新 / リタイア取り消し
 * IF設計書: enterUpdate2.md
 * selection=1: ピット記録変更
 * selection=2: リタイア情報更新（reason）
 * selection=3: リタイア取り消し（is_retired → false）
 * クエリパラメータ: race_id
 */
export const handler = async (event) => {
  try {
    const username = event.requestContext?.authorizer?.username;
    if (!username) return response(401, { msg: "認証が必要です" });

    const race_id = event.queryStringParameters?.race_id;
    if (!race_id) return response(400, { msg: "race_id は必須です" });

    const body = JSON.parse(event.body || "{}");
    const { selection, carNum } = body;

    if (!selection) return response(400, { msg: "selection は必須です" });
    if (carNum === undefined || carNum === null) {
      return response(400, { msg: "carNum は必須です" });
    }
    const car_num = Number(carNum);

    // ── selection=1: ピット記録変更 ──
    if (String(selection) === "1") {
      const { when, inTime, outTime, garageInTime, outDriver, tire, oil, note } = body;
      if (!when) return response(400, { msg: "when（ピット回数）は必須です" });

      const pitNum = Number(when);

      // pit_num で対象レコードを検索
      const pitResult = await docClient.send(
        new QueryCommand({
          TableName:                 Tables.pitLog,
          KeyConditionExpression:    "race_id = :race_id",
          FilterExpression:          "car_num = :car_num AND pit_num = :pit_num",
          ExpressionAttributeValues: {
            ":race_id":  race_id,
            ":car_num":  car_num,
            ":pit_num":  pitNum,
          },
        })
      );

      if (!pitResult.Items || pitResult.Items.length === 0) {
        return response(400, { msg: "対象のピット記録が見つかりません" });
      }

      const targetLog = pitResult.Items[0];

      // バリデーション
      if (inTime && outTime && new Date(outTime) < new Date(inTime)) {
        return response(400, { msg: "出時刻は入時刻以降にしてください" });
      }

      // UpdateItem
      await docClient.send(
        new UpdateCommand({
          TableName:        Tables.pitLog,
          Key:              { race_id, id: targetLog.id },
          UpdateExpression: "SET in_time = :in_time, out_time = :out_time, garage_in_time = :garage_in_time, driver_out = :driver_out, tire = :tire, oil = :oil, note = :note, updated_at = :now",
          ExpressionAttributeValues: {
            ":in_time":        inTime        || null,
            ":out_time":       outTime       || null,
            ":garage_in_time": garageInTime  || null,
            ":driver_out":     outDriver     || null,
            ":tire":           tire === true,
            ":oil":            oil  === true,
            ":note":           note || "",
            ":now":            new Date().toISOString(),
          },
        })
      );

      // 変更履歴を PitLogHistoryTable に記録
      await docClient.send(
        new PutCommand({
          TableName: Tables.pitLogHistory,
          Item: {
            pit_log_id:  targetLog.id,
            id:          generateId(),
            action_type: "update",
            modified_by: username,
            modified_at: new Date().toISOString(),
            field_name:  "multiple",
            old_value:   JSON.stringify({
              in_time:        targetLog.in_time,
              out_time:       targetLog.out_time,
              garage_in_time: targetLog.garage_in_time,
              driver_out:     targetLog.driver_out,
              tire:           targetLog.tire,
              oil:            targetLog.oil,
              note:           targetLog.note,
            }),
            new_value: JSON.stringify({ inTime, outTime, garageInTime, outDriver, tire, oil, note }),
          },
        })
      );

      return response(200, { msg: "" });
    }

    // ── selection=2: リタイア情報更新 ──
    if (String(selection) === "2") {
      const { reason } = body;
      if (reason === undefined || reason === null || reason === "") {
        return response(400, { msg: "reason は必須です" });
      }

      // RetireTable に upsert
      await docClient.send(
        new UpdateCommand({
          TableName:        Tables.retire,
          Key:              { race_id, car_num },
          UpdateExpression: "SET reason = :reason",
          ExpressionAttributeValues: { ":reason": reason },
        })
      );

      return response(200, { msg: "" });
    }

    // ── selection=3: リタイア取り消し ──
    if (String(selection) === "3") {
      const retireResult = await docClient.send(
        new GetCommand({
          TableName: Tables.retire,
          Key:       { race_id, car_num },
        })
      );
      if (!retireResult.Item) {
        return response(400, { msg: "対象のリタイア記録が存在しません" });
      }

      await docClient.send(
        new UpdateCommand({
          TableName:        Tables.retire,
          Key:              { race_id, car_num },
          UpdateExpression: "SET is_retired = :false",
          ExpressionAttributeValues: { ":false": false },
        })
      );

      return response(200, { msg: "" });
    }

    return response(400, { msg: "selection は 1 / 2 / 3 のいずれかを指定してください" });
  } catch (err) {
    console.error("updatePut error:", err);
    return response(500, { msg: "サーバーエラーが発生しました" });
  }
};
