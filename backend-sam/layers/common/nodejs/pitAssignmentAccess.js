import { Tables, queryAll } from "/opt/nodejs/dynamodb.js";

/**
 * 担当エリア（pit_assignment）に関する共通処理。
 * `GET /entries/init`（init.mjs）と一般向け start_driver 登録（§3.6）で共有する。
 */

/**
 * 担当エリアの範囲として受け付ける最大の広さ（2026-10-08追加）。
 * 桁の打ち間違い（"1-100000" など）をそのまま保存すると、以降 getAssignedEntries が
 * 一般利用者のAPI呼び出しごとに巨大な配列を展開することになるため、入口で弾く。
 */
const MAX_AREA_SPAN = 200;

/**
 * 担当エリアの指定が正しい形かどうか（2026-10-08追加）。
 * 受け付けるのは "5"（単体）と "5-10"（範囲）だけ。
 * 範囲は 開始 <= 終了 で、広さが MAX_AREA_SPAN 以内であること。
 *
 * expandRange は不正な入力に対して空配列を返すため、それだけでは
 * 「範囲が逆」と「エリアが存在しない」を区別できない。登録時の検証に使う。
 */
export function isValidAreaRange(rangeStr) {
  const s = String(rangeStr).trim();
  const m = s.match(/^(\d+)(?:-(\d+))?$/);
  if (!m) return false;

  const start = Number(m[1]);
  const end   = m[2] === undefined ? start : Number(m[2]);
  if (start <= 0 || end <= 0) return false;
  if (start > end) return false;
  return end - start + 1 <= MAX_AREA_SPAN;
}

/**
 * "5-10" → [5,6,7,8,9,10] に展開する。"7" のような単体数字はそのまま [7]。
 * 形の検証は isValidAreaRange が担う（ここは保存済みの値を読む用途も兼ねるため、
 * 不正な入力に対しては空配列を返すだけにしている）。
 */
export function expandRange(rangeStr) {
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
  const single = Number(parts[0]);
  return isNaN(single) ? [] : [single];
}

/**
 * 呼び出し元（username）が、当該raceで担当しているentry（車両）の一覧を返す。
 * サーバー側で都度計算する（クライアントの自己申告は信用しない）。
 *
 * @returns {Promise<object[]>} EntryTable のアイテム配列（担当エリア内の車両のみ）
 */
export async function getAssignedEntries(username, raceId) {
  const assignments = await queryAll({
    TableName:                 Tables.pitAssignment,
    IndexName:                 "UsernameIndex",
    KeyConditionExpression:    "username = :username",
    FilterExpression:          "race_id = :raceId",
    ExpressionAttributeValues: { ":username": username, ":raceId": raceId },
  });
  if (assignments.length === 0) return [];

  const assignedNums = [
    ...new Set(assignments.flatMap((a) => expandRange(a.maintenance_area))),
  ];

  // 全件辿る。途中で止めると担当エリア内の車両が漏れ、
  // その車両の操作が「担当エリア外です」(403) で弾かれてしまう
  const entryItems = await queryAll({
    TableName:                 Tables.entry,
    KeyConditionExpression:    "race_id = :raceId",
    ExpressionAttributeValues: { ":raceId": raceId },
  });

  return entryItems.filter((e) => {
    const entryNums = expandRange(e.maintenance_area);
    return entryNums.some((n) => assignedNums.includes(n));
  });
}

/**
 * 当該raceの entry が使っている maintenance_area を、展開済みの番号の集合として返す。
 * pit_assignment 登録時の「指定エリアが entry に存在するか」の確認（§4.2）で使う。
 * 複数件まとめて検証する場合に、entry を1回だけ取得して使い回せるようにしている。
 */
export async function getEntryAreaNumbers(raceId) {
  const entryItems = await queryAll({
    TableName:                 Tables.entry,
    KeyConditionExpression:    "race_id = :raceId",
    ExpressionAttributeValues: { ":raceId": raceId },
    ProjectionExpression:      "maintenance_area",
  });
  return new Set(entryItems.flatMap((e) => expandRange(e.maintenance_area)));
}

/**
 * maintenanceArea（担当範囲。例 "5-10"）が、entryAreaNumbers（getEntryAreaNumbers の結果）と
 * 1つでも重なるか。
 */
export function overlapsEntryAreas(maintenanceArea, entryAreaNumbers) {
  return expandRange(maintenanceArea).some((n) => entryAreaNumbers.has(n));
}

/** carNums のうち、呼び出し元の担当エリアに含まれないものを返す。 */
export async function findUnassignedCars(username, raceId, carNums) {
  const assigned = new Set((await getAssignedEntries(username, raceId)).map((e) => e.car_num));
  return carNums.filter((n) => !assigned.has(n));
}
