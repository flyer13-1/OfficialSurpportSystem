import { QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, Tables, response, getRaceIdHeader } from "/opt/nodejs/dynamodb.js";
import { requireAdmin } from "/opt/nodejs/admin.js";
import { requireRace } from "/opt/nodejs/raceAccess.js";

/**
 * GET /admin/race/data — entry / start_driver / pit_assignment / users 統合一覧
 * IF設計書: doc/aws-sam/admin/v2/03_race_data.md §1.2
 *
 * 個別に3本（entry / start_driver / pit_assignment）の一覧APIを持つ代わりに、
 * 1本にまとめて返す。requireAdmin + race照合は1回だけで済む。
 * 参照系のため、終了済みの race でも許可する（write指定なし＝§1のR7と同じ考え方）。
 */
export const handler = async (event) => {
  try {
    const auth = await requireAdmin(event);
    if (auth.error) return auth.error;

    const raceId = getRaceIdHeader(event);
    const { error } = await requireRace(raceId, auth.circuit);
    if (error) return error;

    const [entryResult, startDriverResult, pitAssignmentResult, usersResult] =
      await Promise.all([
        docClient.send(
          new QueryCommand({
            TableName:                 Tables.entry,
            KeyConditionExpression:    "race_id = :raceId",
            ExpressionAttributeValues: { ":raceId": raceId },
          })
        ),
        docClient.send(
          new QueryCommand({
            TableName:                 Tables.startDriver,
            KeyConditionExpression:    "race_id = :raceId",
            ExpressionAttributeValues: { ":raceId": raceId },
          })
        ),
        docClient.send(
          new QueryCommand({
            TableName:                 Tables.pitAssignment,
            KeyConditionExpression:    "race_id = :raceId",
            ExpressionAttributeValues: { ":raceId": raceId },
          })
        ),
        // users は自分のサーキットに限らず全件（他サーキットからの応援があるため。§1.2）
        docClient.send(new ScanCommand({ TableName: Tables.users })),
      ]);

    const entries = (entryResult.Items || []).map((e) => ({
      carNum:          e.car_num,
      className:       e.class_name,
      entrantName:     e.entrant_name,
      vehicleName:     e.vehicle_name,
      maintenanceArea: e.maintenance_area,
      pitGarage:       e.pit_garage,
      driverA:         e.driver_a,
      driverB:         e.driver_b ?? null,
      driverC:         e.driver_c ?? null,
      driverD:         e.driver_d ?? null,
      driverE:         e.driver_e ?? null,
      driverF:         e.driver_f ?? null,
    }));

    const startDrivers = (startDriverResult.Items || []).map((sd) => ({
      carNum: sd.car_num,
      driver: sd.driver,
    }));

    const pitAssignments = (pitAssignmentResult.Items || []).map((pa) => ({
      username:        pa.username,
      maintenanceArea: pa.maintenance_area,
    }));

    const users = (usersResult.Items || []).map((u) => ({
      username:       u.username,
      organizationId: u.organization_id,
    }));

    return response(200, { msg: "", entries, startDrivers, pitAssignments, users });
  } catch (err) {
    console.error("race data error:", err);
    return response(500, { msg: "サーバーエラーが発生しました" });
  }
};
