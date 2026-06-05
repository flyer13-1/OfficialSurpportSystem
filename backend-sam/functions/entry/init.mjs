import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, Tables, response } from "/opt/nodejs/dynamodb.js";

/**
 * GET /entries/init — 初期データ取得
 * IF設計書: enterAuto1.md
 * 担当者の作業エリアに紐づく車両・ドライバー情報を返す
 * クエリパラメータ: race_id（conform で取得した値）
 */

/**
 * "5-10" → [5,6,7,8,9,10] に展開する関数
 * "7" のような単体数字の場合は [7] を返す
 */

const expandRange = (rangeStr) => {
  const parts = String(rangeStr).split("-");
  if (parts.length === 2) {
    const start = Number(parts[0]);
    const end = Number(parts[1]);
    if (!isNaN(start) && !isNaN(end)) {
      const result = [];
      for (let i = start; i <= end; i++) result.push(i);
      return result;
    }
  }
  // ハイフンなし or 数字変換失敗 → 単体でそのまま返す
  const single = Number(parts[0]);
  return isNaN(single) ? [] : [single];
};

export const handler = async (event) => {
  try {
    const username = event.requestContext?.authorizer?.username;
    if (!username) return response(401, { msg: "認証が必要です" });

    const race_id = event.queryStringParameters?.race_id;
    if (!race_id) return response(400, { msg: "race_id は必須です" });

    // ── PitAssignmentTable から担当エリア取得（UsernameIndex） ──
    const assignResult = await docClient.send(
      new QueryCommand({
        TableName: Tables.pitAssignment,
        IndexName: "UsernameIndex",
        KeyConditionExpression: "username = :username",
        FilterExpression: "race_id = :race_id",
        ExpressionAttributeValues: {
          ":username": username,
          ":race_id": race_id,
        },
      }),
    );

    const assignments = assignResult.Items || [];

    if (assignments.length === 0) {
      return response(200, { msg: "", carNum: [], driver: {} });
    }

    // 担当エリアの範囲を全部数字に展開する
    // 例: ["5-10", "15-20"] → [5,6,7,8,9,10,15,16,17,18,19,20]
    const assignedNums = [
      ...new Set(assignments.flatMap((a) => expandRange(a.maintenance_area))),
    ];

    // ── EntryTable から race_id 内の全車両を取得 ──
    const entryResult = await docClient.send(
      new QueryCommand({
        TableName: Tables.entry,
        KeyConditionExpression: "race_id = :race_id",
        ExpressionAttributeValues: { ":race_id": race_id },
      }),
    );

    // 担当エリアの範囲内の車両だけ絞り込む
    // entry.maintenance_area を数字に変換して assignedNums に含まれるか確認
    const entries = (entryResult.Items || []).filter((e) => {
      const entryNums = expandRange(e.maintenance_area);
      // entry側の範囲が担当範囲と1つでも重なればOK
      return entryNums.some((n) => assignedNums.includes(n));
    });

    const carNum = entries.map((e) => e.car_num);

    // ドライバーリスト生成（"A<br>名前" 形式）
    const driver = {};
    const driverKeys = [
      "driver_a",
      "driver_b",
      "driver_c",
      "driver_d",
      "driver_e",
      "driver_f",
    ];
    const driverLabels = ["A", "B", "C", "D", "E", "F"];
    for (const entry of entries) {
      driver[String(entry.car_num)] = driverKeys
        .map((key, i) =>
          entry[key] ? `${driverLabels[i]}<br>${entry[key]}` : null,
        )
        .filter(Boolean);
    }

    return response(200, { msg: "", carNum, driver });
  } catch (err) {
    console.error("init error:", err);
    return response(500, { msg: "サーバーエラーが発生しました" });
  }
};
