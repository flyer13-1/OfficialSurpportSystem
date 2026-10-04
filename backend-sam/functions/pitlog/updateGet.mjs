import { QueryCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, Tables, response } from "/opt/nodejs/dynamodb.js";
import { requireGeneralRace } from "/opt/nodejs/raceToken.js";
import { findUnassignedCars } from "/opt/nodejs/pitAssignmentAccess.js";

/**
 * GET /entries/update — 変更対象ピット記録取得
 * IF設計書: enterUpdate1.md
 * raceId は X-Race-Id（raceId トークン）、クエリは carNum
 */
export const handler = async (event) => {
  try {
    const username = event.requestContext?.authorizer?.username;
    if (!username) return response(401, { msg: "認証が必要です" });

    const access = await requireGeneralRace(event);
    if (access.error) return access.error;
    const raceId = access.raceId;

    const carNumStr = event.queryStringParameters?.carNum;
    if (!carNumStr) return response(400, { msg: "carNum は必須です" });

    const car_num = Number(carNumStr);
    if (isNaN(car_num)) return response(400, { msg: "carNum が不正です" });
    if ((await findUnassignedCars(username, raceId, [car_num])).length > 0) {
      return response(403, { msg: "担当エリア外の車両です" });
    }

    // ── PitLogTable から race_id + car_num でフィルタ ──
    const pitResult = await docClient.send(
      new QueryCommand({
        TableName:                 Tables.pitLog,
        KeyConditionExpression:    "race_id = :race_id",
        FilterExpression:          "car_num = :car_num",
        ExpressionAttributeValues: { ":race_id": raceId, ":car_num": car_num },
      })
    );
    const pitLogs = pitResult.Items || [];

    // ── EntryTable から className / teamName を取得 ──
    const entryResult = await docClient.send(
      new GetCommand({
        TableName: Tables.entry,
        Key:       { race_id: raceId, car_num },
      })
    );
    const entry = entryResult.Item || {};

    // ── RetireTable から retire 状態を取得 ──
    const retireResult = await docClient.send(
      new GetCommand({
        TableName: Tables.retire,
        Key:       { race_id: raceId, car_num },
      })
    );
    const isRetired = retireResult.Item?.is_retired ?? false;

    // ── pit_num 昇順でソートしてレスポンス構築 ──
    pitLogs.sort((a, b) => (a.pit_num || 0) - (b.pit_num || 0));

    const result = { msg: "" };

    for (const log of pitLogs) {
      const pitGap =
        log.in_time && log.out_time
          ? Math.round((new Date(log.out_time) - new Date(log.in_time)) / 1000)
          : null;

      result[String(log.pit_num)] = {
        managerId:     log.id,
        manager:       log.username,
        pitNum:        log.pit_num,
        carNum:        log.car_num,
        className:     entry.class_name    || "",
        teamName:      entry.entrant_name  || "",
        retire:        isRetired,
        inDriver:      null,          // showAll でのみ算出（updateGet では省略）
        outDriver:     log.driver_out || null,
        inTime:        log.in_time         || null,
        outTime:       log.out_time        || null,
        pitGap,
        tire:          log.tire  ?? false,
        oil:           log.oil   ?? false,
        note:          log.note  || "",
      };
    }

    return response(200, result);
  } catch (err) {
    console.error("updateGet error:", err);
    return response(500, { msg: "サーバーエラーが発生しました" });
  }
};
