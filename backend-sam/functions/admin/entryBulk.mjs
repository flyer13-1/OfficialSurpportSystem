import { TransactWriteCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import {
  docClient,
  Tables,
  response,
  getRaceIdHeader,
  MAX_TRANSACT_ITEMS,
} from "/opt/nodejs/dynamodb.js";
import { requireAdmin } from "/opt/nodejs/admin.js";
import { requireRace } from "/opt/nodejs/raceAccess.js";
import { isPositiveInt } from "/opt/nodejs/entryAccess.js";

/**
 * POST /admin/entry/bulk — エントリー一括登録
 * IF設計書: doc/aws-sam/admin/v2/03_race_data.md §2.2
 *
 * 画面のフロー(手入力でも1件ずつ貯めて最後にまとめて送る／CSV一括)は §1.1 のとおり。
 * 単発登録用の別APIは作らない。
 */

const REQUIRED_FIELDS = [
  "carNum",
  "className",
  "entrantName",
  "vehicleName",
  "maintenanceArea",
  "pitGarage",
  "driverA",
];

function hasMissingField(e) {
  return REQUIRED_FIELDS.some(
    (f) => e[f] === undefined || e[f] === null || e[f] === ""
  );
}

export const handler = async (event) => {
  try {
    const auth = await requireAdmin(event);
    if (auth.error) return auth.error;

    const raceId = getRaceIdHeader(event);
    const { error } = await requireRace(raceId, auth.circuit, { write: true });
    if (error) return error;

    const body = JSON.parse(event.body || "{}");
    const entries = body.entries;

    if (!Array.isArray(entries) || entries.length === 0 || entries.some(hasMissingField)) {
      return response(400, { msg: "未入力の項目があります" });
    }

    // 件数の上限は DB を引く前に見る（§1.1・§2.2）。これが無いと、101件以上が
    // TransactWriteItems の ValidationException になって 400 のはずが 500 で返る。
    if (entries.length > MAX_TRANSACT_ITEMS) {
      return response(400, {
        msg: `一度に登録できるのは${MAX_TRANSACT_ITEMS}件までです`,
      });
    }

    if (entries.some((e) => !isPositiveInt(e.carNum))) {
      return response(400, { msg: "車番は正の整数で指定してください" });
    }
    if (entries.some((e) => !isPositiveInt(e.maintenanceArea))) {
      return response(400, { msg: "作業エリアは正の整数で指定してください" });
    }

    // ── リクエスト内の carNum 重複確認 ──
    const carNums = entries.map((e) => Number(e.carNum));
    if (new Set(carNums).size !== carNums.length) {
      return response(400, { msg: "ファイル内に重複する車番があります" });
    }

    // ── 既存 entry との carNum 重複確認 ──
    const existing = await docClient.send(
      new QueryCommand({
        TableName:                 Tables.entry,
        KeyConditionExpression:    "race_id = :raceId",
        ExpressionAttributeValues: { ":raceId": raceId },
        ProjectionExpression:      "car_num",
      })
    );
    const existingCarNums = new Set((existing.Items || []).map((it) => it.car_num));
    if (carNums.some((n) => existingCarNums.has(n))) {
      return response(409, { msg: "既に登録済みの車番が含まれています" });
    }

    // ── TransactWriteItems で登録（上限は MAX_TRANSACT_ITEMS。上で弾いている） ──
    await docClient.send(
      new TransactWriteCommand({
        TransactItems: entries.map((e) => ({
          Put: {
            TableName: Tables.entry,
            Item: {
              race_id:          raceId,
              car_num:          Number(e.carNum),
              class_name:       e.className,
              entrant_name:     e.entrantName,
              vehicle_name:     e.vehicleName,
              maintenance_area: Number(e.maintenanceArea),
              pit_garage:       String(e.pitGarage),
              driver_a:         e.driverA,
              driver_b:         e.driverB || null,
              driver_c:         e.driverC || null,
              driver_d:         e.driverD || null,
              driver_e:         e.driverE || null,
              driver_f:         e.driverF || null,
            },
            ConditionExpression: "attribute_not_exists(car_num)",
          },
        })),
      })
    );

    return response(200, { msg: "", count: entries.length });
  } catch (err) {
    console.error("entry bulk error:", err);
    return response(500, { msg: "サーバーエラーが発生しました" });
  }
};
