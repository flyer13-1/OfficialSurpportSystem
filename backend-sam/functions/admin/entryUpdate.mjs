import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, Tables, response, getRaceIdHeader } from "/opt/nodejs/dynamodb.js";
import { requireAdmin } from "/opt/nodejs/admin.js";
import { requireRace } from "/opt/nodejs/raceAccess.js";

/**
 * PUT /admin/entry — エントリー変更
 * IF設計書: doc/aws-sam/admin/v2/03_race_data.md §2.4
 *
 * raceId（ヘッダー）＋ carNum（ボディ）で対象を特定する。
 * raceId / carNum 自体は変更不可（車番を変えたい場合は削除＋新規登録）。
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

function hasMissingField(body) {
  return REQUIRED_FIELDS.some(
    (f) => body[f] === undefined || body[f] === null || body[f] === ""
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
    if (hasMissingField(body)) {
      return response(400, { msg: "未入力の項目があります" });
    }
    const carNum = Number(body.carNum);

    const target = await docClient.send(
      new GetCommand({ TableName: Tables.entry, Key: { race_id: raceId, car_num: carNum } })
    );
    if (!target.Item) {
      return response(404, { msg: "対象のエントリーが存在しません" });
    }

    await docClient.send(
      new UpdateCommand({
        TableName: Tables.entry,
        Key:       { race_id: raceId, car_num: carNum },
        UpdateExpression:
          "SET class_name = :className, entrant_name = :entrantName, " +
          "vehicle_name = :vehicleName, maintenance_area = :maintenanceArea, " +
          "pit_garage = :pitGarage, driver_a = :driverA, driver_b = :driverB, " +
          "driver_c = :driverC, driver_d = :driverD, driver_e = :driverE, driver_f = :driverF",
        ExpressionAttributeValues: {
          ":className":       body.className,
          ":entrantName":     body.entrantName,
          ":vehicleName":     body.vehicleName,
          ":maintenanceArea": Number(body.maintenanceArea),
          ":pitGarage":       String(body.pitGarage),
          ":driverA":         body.driverA,
          ":driverB":         body.driverB || null,
          ":driverC":         body.driverC || null,
          ":driverD":         body.driverD || null,
          ":driverE":         body.driverE || null,
          ":driverF":         body.driverF || null,
        },
      })
    );

    return response(200, { msg: "" });
  } catch (err) {
    console.error("entry update error:", err);
    return response(500, { msg: "サーバーエラーが発生しました" });
  }
};
