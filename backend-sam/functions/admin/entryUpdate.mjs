import { GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, Tables, response, getRaceIdHeader } from "/opt/nodejs/dynamodb.js";
import { requireAdmin } from "/opt/nodejs/admin.js";
import { requireRace } from "/opt/nodejs/raceAccess.js";
import { isPositiveInt } from "/opt/nodejs/entryAccess.js";

/**
 * PUT /admin/entry — エントリー変更
 * IF設計書: doc/aws-sam/admin/v2/03_race_data.md §2.4
 *
 * raceId（ヘッダー）＋ carNum（ボディ）で対象を特定する。
 * raceId / carNum 自体は変更不可（車番を変えたい場合は削除＋新規登録）。
 *
 * 変更でドライバー枠を空にした場合、その枠を使っている start_driver は
 * 一緒に削除する（2026-10-08決定。§2.4）。残すと「entry に無い枠を指す start_driver」
 * という状態になり、§3.1 の「非null のドライバ枠であること」を満たさなくなるため。
 * 削除したことは応答の removedStartDriver で返し、画面で知らせる。
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
    if (!isPositiveInt(body.carNum)) {
      return response(400, { msg: "車番は正の整数で指定してください" });
    }
    if (!isPositiveInt(body.maintenanceArea)) {
      return response(400, { msg: "作業エリアは正の整数で指定してください" });
    }
    const carNum = Number(body.carNum);

    const target = await docClient.send(
      new GetCommand({ TableName: Tables.entry, Key: { race_id: raceId, car_num: carNum } })
    );
    if (!target.Item) {
      return response(404, { msg: "対象のエントリーが存在しません" });
    }

    const drivers = {
      driver_a: body.driverA,
      driver_b: body.driverB || null,
      driver_c: body.driverC || null,
      driver_d: body.driverD || null,
      driver_e: body.driverE || null,
      driver_f: body.driverF || null,
    };

    // ── 変更後に空になる枠を、start_driver が使っていないか確認する ──
    const startDriverResult = await docClient.send(
      new GetCommand({
        TableName: Tables.startDriver,
        Key:       { race_id: raceId, car_num: carNum },
      })
    );
    const startDriver = startDriverResult.Item;
    const losesSlot =
      startDriver && drivers[`driver_${String(startDriver.driver).toLowerCase()}`] == null;

    const items = [
      {
        Update: {
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
            ":driverA":         drivers.driver_a,
            ":driverB":         drivers.driver_b,
            ":driverC":         drivers.driver_c,
            ":driverD":         drivers.driver_d,
            ":driverE":         drivers.driver_e,
            ":driverF":         drivers.driver_f,
          },
        },
      },
    ];

    if (losesSlot) {
      items.push({
        Delete: {
          TableName: Tables.startDriver,
          Key:       { race_id: raceId, car_num: carNum },
        },
      });
    }

    // entry の更新と start_driver の削除は同じトランザクションで行う。
    // 片方だけ通って不整合が残るのを避けるため。
    await docClient.send(new TransactWriteCommand({ TransactItems: items }));

    return response(200, {
      msg: "",
      ...(losesSlot
        ? { removedStartDriver: { carNum, driver: startDriver.driver } }
        : {}),
    });
  } catch (err) {
    console.error("entry update error:", err);
    return response(500, { msg: "サーバーエラーが発生しました" });
  }
};
