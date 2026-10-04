import { QueryCommand, UpdateCommand, PutCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, Tables, response, generateId } from "/opt/nodejs/dynamodb.js";
import { requireGeneralRace } from "/opt/nodejs/raceToken.js";
import { findUnassignedCars } from "/opt/nodejs/pitAssignmentAccess.js";

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

    const access = await requireGeneralRace(event);
    if (access.error) return access.error;
    const race_id = access.raceId;

    const body = JSON.parse(event.body || "{}");
    const { selection, carNum } = body;

    if (!selection) return response(400, { msg: "selection は必須です" });
    if (carNum === undefined || carNum === null) {
      return response(400, { msg: "carNum は必須です" });
    }
    const car_num = Number(carNum);
    if ((await findUnassignedCars(username, race_id, [car_num])).length > 0) {
      return response(403, { msg: "担当エリア外の車両です" });
    }

    // ── selection=1: ピット記録変更 ──
    if (String(selection) === "1") {
      const { when, inTime, outTime, outDriver, tire, oil, note } = body;
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

      // 送信されたフィールドだけ動的に UpdateExpression を組み立てる
      const exprParts = ["updated_at = :now"];
      const exprValues = { ":now": new Date().toISOString() };
      const changedNew = {};
      const changedOld = {};

      if (inTime !== undefined) {
        exprParts.push("in_time = :in_time");
        exprValues[":in_time"] = inTime || null;
        changedOld.in_time = targetLog.in_time;
        changedNew.inTime  = inTime || null;
      }
      if (outTime !== undefined) {
        exprParts.push("out_time = :out_time");
        exprValues[":out_time"] = outTime || null;
        changedOld.out_time = targetLog.out_time;
        changedNew.outTime  = outTime || null;
      }
      if (outDriver !== undefined) {
        exprParts.push("driver_out = :driver_out");
        exprValues[":driver_out"] = outDriver || null;
        changedOld.driver_out = targetLog.driver_out;
        changedNew.outDriver  = outDriver || null;
      }
      if (tire !== undefined) {
        exprParts.push("tire = :tire");
        exprValues[":tire"] = tire === true;
        changedOld.tire = targetLog.tire;
        changedNew.tire = tire === true;
      }
      if (oil !== undefined) {
        exprParts.push("oil = :oil");
        exprValues[":oil"] = oil === true;
        changedOld.oil = targetLog.oil;
        changedNew.oil = oil === true;
      }
      if (note !== undefined) {
        exprParts.push("note = :note");
        exprValues[":note"] = note || "";
        changedOld.note = targetLog.note;
        changedNew.note = note || "";
      }

      // updated_at だけなら変更フィールドなし
      if (exprParts.length === 1) {
        return response(400, { msg: "変更フィールドがありません" });
      }

      // 時刻順バリデーション（両方送られた場合のみ）
      const effectiveIn  = inTime  !== undefined ? inTime  : targetLog.in_time;
      const effectiveOut = outTime !== undefined ? outTime : targetLog.out_time;
      if (effectiveIn && effectiveOut && new Date(effectiveOut) < new Date(effectiveIn)) {
        return response(400, { msg: "出時刻は入時刻以降にしてください" });
      }

      await docClient.send(
        new UpdateCommand({
          TableName:                 Tables.pitLog,
          Key:                       { race_id, id: targetLog.id },
          UpdateExpression:          `SET ${exprParts.join(", ")}`,
          ExpressionAttributeValues: exprValues,
        })
      );

      // 変更履歴（変更したフィールドのみ記録）
      await docClient.send(
        new PutCommand({
          TableName: Tables.pitLogHistory,
          Item: {
            pit_log_id:  targetLog.id,
            id:          generateId(),
            action_type: "update",
            modified_by: username,
            modified_at: new Date().toISOString(),
            field_name:  Object.keys(changedNew).join(","),
            old_value:   JSON.stringify(changedOld),
            new_value:   JSON.stringify(changedNew),
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
