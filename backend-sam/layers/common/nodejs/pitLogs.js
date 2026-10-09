import { Tables, queryAll } from "/opt/nodejs/dynamodb.js";

/**
 * race のピット記録を、画面・出力で使う配列にまとめる。
 * 設計: doc/aws-sam/admin/v2/04_pitlog.md §2.2〜§2.4
 *
 * 車ごとに「スタートドライバー → 1回目の driver_out → 2回目の driver_out → …」の列として
 * inDriver / outDriver を決めてから、最後に時刻順（inTime ?? outTime → carNum）へ並べ替える。
 */

// 1レース分を全件取得する（queryAll が最後のページまで辿る。表やCSVから
// 記録が落ちないよう、件数に依存しないようにしている）
async function queryByRace(tableName, raceId) {
  return queryAll({
    TableName: tableName,
    KeyConditionExpression: "race_id = :race_id",
    ExpressionAttributeValues: { ":race_id": raceId },
  });
}

function driverName(entry, slot) {
  if (!slot) return null;
  return entry[`driver_${slot.toLowerCase()}`] ?? null;
}

function pitGapOf(log) {
  if (!log.in_time || !log.out_time) return null;
  return Math.round((new Date(log.out_time) - new Date(log.in_time)) / 1000);
}

function sortTimeOf(row) {
  const time = row.inTime ?? row.outTime;
  return time ? new Date(time).getTime() : Infinity;
}

export async function buildPitLogs(raceId) {
  const [pitLogs, entries, retires, startDrivers] = await Promise.all([
    queryByRace(Tables.pitLog, raceId),
    queryByRace(Tables.entry, raceId),
    queryByRace(Tables.retire, raceId),
    queryByRace(Tables.startDriver, raceId),
  ]);

  const entryByCar = new Map(entries.map((e) => [e.car_num, e]));
  const retiredByCar = new Map(retires.map((r) => [r.car_num, r.is_retired === true]));
  const startDriverByCar = new Map(startDrivers.map((s) => [s.car_num, s.driver]));

  const logsByCar = new Map();
  for (const log of pitLogs) {
    if (!logsByCar.has(log.car_num)) logsByCar.set(log.car_num, []);
    logsByCar.get(log.car_num).push(log);
  }

  const rows = [];
  for (const [carNum, logs] of logsByCar) {
    logs.sort((a, b) => a.pit_num - b.pit_num);
    const entry = entryByCar.get(carNum) || {};
    let inDriver = startDriverByCar.get(carNum) ?? null;

    for (const log of logs) {
      const outDriver = log.driver_out ?? null;
      rows.push({
        pitNum: log.pit_num,
        carNum,
        manager: log.username,
        retire: retiredByCar.get(carNum) ?? false,
        inDriver,
        inDriverName: driverName(entry, inDriver),
        outDriver,
        outDriverName: driverName(entry, outDriver),
        inTime: log.in_time ?? null,
        outTime: log.out_time ?? null,
        pitGap: pitGapOf(log),
        className: entry.class_name ?? "",
        teamName: entry.entrant_name ?? "",
        maintenanceArea: entry.maintenance_area ?? null,
        pitGarage: entry.pit_garage ?? null,
        tire: log.tire === true,
        oil: log.oil === true,
        note: log.note ?? "",
      });
      inDriver = outDriver;
    }
  }

  rows.sort((a, b) => {
    const ta = sortTimeOf(a);
    const tb = sortTimeOf(b);
    if (ta !== tb) return ta < tb ? -1 : 1;
    return a.carNum - b.carNum;
  });
  return rows;
}
