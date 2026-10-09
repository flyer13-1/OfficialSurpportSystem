import { Tables, response, queryAll } from "/opt/nodejs/dynamodb.js";
import { getAssignedEntries } from "/opt/nodejs/pitAssignmentAccess.js";
import { requireGeneralRace } from "/opt/nodejs/raceToken.js";

/**
 * GET /entries/init — 初期データ取得
 * IF設計書: doc/IF/enterAuto1.md / doc/aws-sam/admin/v2/03_race_data.md §3.6
 *
 * 担当者の作業エリアに紐づく車両・ドライバー情報と、start_driver の登録状況を返す。
 * raceId は X-Race-Id ヘッダーのトークンで受け取る（requireGeneralRace。01章 R10）。
 */
export const handler = async (event) => {
  try {
    const username = event.requestContext?.authorizer?.username;
    if (!username) return response(401, { msg: "認証が必要です" });

    const access = await requireGeneralRace(event);
    if (access.error) return access.error;
    const race_id = access.raceId;

    const entries = await getAssignedEntries(username, race_id);
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

    // ── start_driver の登録状況（§3.6。絞り込み済みの carNum だけを対象にする） ──
    const startDriverItems = await queryAll({
      TableName: Tables.startDriver,
      KeyConditionExpression: "race_id = :race_id",
      ExpressionAttributeValues: { ":race_id": race_id },
    });
    const startDriverByCarNum = new Map(
      startDriverItems.map((sd) => [sd.car_num, sd.driver]),
    );
    const startDriver = {};
    for (const n of carNum) {
      startDriver[String(n)] = startDriverByCarNum.get(n) ?? null;
    }

    return response(200, { msg: "", carNum, driver, startDriver });
  } catch (err) {
    console.error("init error:", err);
    return response(500, { msg: "サーバーエラーが発生しました" });
  }
};
