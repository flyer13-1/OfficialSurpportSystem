import { QueryCommand, ScanCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, Tables, response, generateId } from "/opt/nodejs/dynamodb.js";

/**
 * GET /entries/show — 全ピット情報取得
 * IF設計書: showAll.md / output.md
 * クエリパラメータ: race_id, act（任意）
 * act=1 かつ race_id が指定されている場合は OutpostLogTable に記録
 */
export const handler = async (event) => {
  try {
    const username = event.requestContext?.authorizer?.username;
    if (!username) return response(401, { msg: "認証が必要です" });

    const race_id = event.queryStringParameters?.race_id;
    if (!race_id) return response(400, { msg: "race_id は必須です" });

    const act = event.queryStringParameters?.act;

    // ── 並列でデータ取得 ──
    const [pitResult, entryResult, retireResult, startDriverResult] = await Promise.all([
      docClient.send(
        new QueryCommand({
          TableName:                 Tables.pitLog,
          KeyConditionExpression:    "race_id = :race_id",
          ExpressionAttributeValues: { ":race_id": race_id },
        })
      ),
      docClient.send(
        new QueryCommand({
          TableName:                 Tables.entry,
          KeyConditionExpression:    "race_id = :race_id",
          ExpressionAttributeValues: { ":race_id": race_id },
        })
      ),
      docClient.send(
        new QueryCommand({
          TableName:                 Tables.retire,
          KeyConditionExpression:    "race_id = :race_id",
          ExpressionAttributeValues: { ":race_id": race_id },
        })
      ),
      docClient.send(
        new QueryCommand({
          TableName:                 Tables.startDriver,
          KeyConditionExpression:    "race_id = :race_id",
          ExpressionAttributeValues: { ":race_id": race_id },
        })
      ),
    ]);

    const pitLogs     = pitResult.Items        || [];
    const entries     = entryResult.Items      || [];
    const retires     = retireResult.Items     || [];
    const startDrivers = startDriverResult.Items || [];

    // ── ルックアップマップ ──
    const entryMap       = {};
    for (const e of entries)       entryMap[e.car_num]       = e;

    const retireMap      = {};
    for (const r of retires)       retireMap[r.car_num]      = r;

    const startDriverMap = {};
    for (const s of startDrivers) startDriverMap[s.car_num]  = s;

    // ── pit_num 昇順でソート ──
    pitLogs.sort((a, b) => {
      if (a.car_num !== b.car_num) return a.car_num - b.car_num;
      return (a.pit_num || 0) - (b.pit_num || 0);
    });

    // ── inDriver の算出 ──
    // pit_num=1 は StartDriverTable の driver
    // pit_num>=2 は前回ピットの driver_out
    const prevOutDriver = {}; // car_num → 前回の driver_out

    const result = { msg: "" };

    for (const log of pitLogs) {
      const carNum = log.car_num;

      let inDriver = null;
      if (log.pit_num === 1) {
        inDriver = startDriverMap[carNum]?.driver || null;
      } else {
        inDriver = prevOutDriver[carNum] || null;
      }

      // driver_out を次回の inDriver として保存
      if (log.driver_out) {
        prevOutDriver[carNum] = log.driver_out;
      }

      const entry   = entryMap[carNum]  || {};
      const retire  = retireMap[carNum] || {};
      const isRetired = retire.is_retired ?? false;

      // pitGap: garageInTime が null かつ inTime / outTime 両方あれば計算
      const pitGap =
        log.garage_in_time === null && log.in_time && log.out_time
          ? Math.round((new Date(log.out_time) - new Date(log.in_time)) / 1000)
          : null;

      result[String(log.pit_num === 1 && carNum in result
        ? log.id   // 同一 pit_num が重複した場合は id をキーにする
        : log.pit_num * 1000 + carNum  // 仮キー
      )] = null; // 一旦 null でキーを仮置き

      // 実際はテーブルの id（ULID）をキーにする（IF設計書に合わせる）
      result[log.id] = {
        managerId:    log.id,
        manager:      log.username,
        pitNum:       log.pit_num,
        carNum,
        className:    entry.class_name   || "",
        teamName:     entry.entrant_name || "",
        retire:       isRetired,
        inDriver,
        outDriver:    log.driver_out      || null,
        inTime:       log.in_time         || null,
        outTime:      log.out_time        || null,
        garageInTime: log.garage_in_time  || null,
        pitGap,
        tire:         log.tire  ?? false,
        oil:          log.oil   ?? false,
        note:         log.note  || "",
      };
    }

    // 仮キーを削除（数値キーは不要）
    for (const key of Object.keys(result)) {
      if (key !== "msg" && result[key] === null) delete result[key];
    }

    // ── act=1 のとき OutpostLogTable に記録 ──
    if (act === "1") {
      await docClient.send(
        new PutCommand({
          TableName: Tables.outpostLog,
          Item: {
            race_id,
            id:         generateId(),
            username,
            created_at: new Date().toISOString(),
          },
        })
      );
    }

    return response(200, result);
  } catch (err) {
    console.error("showAll error:", err);
    return response(500, { msg: "サーバーエラーが発生しました" });
  }
};
