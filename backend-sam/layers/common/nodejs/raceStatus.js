/**
 * race の終了判定・日付計算の共通処理。
 * 設計: doc/aws-sam/admin/v2/01_permission.md §1・§5.3、02_race.md §2.3・§3、
 *       doc/IF/raceIdToken.md §7
 *
 * JST は UTC+9 固定（サマータイム無し）として扱う。
 */

/** JST（UTC+9）の「今日」を "YYYY-MM-DD" 文字列で返す。 */
export function todayJST() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * finish_date（"YYYY-MM-DD"、JSTの日付）の翌日 0:00（JST）の UNIX秒を返す。
 * 「終了済み」の境界（01章§1）。「当日15:00 UTC」＝「翌日0:00 JST」として直接計算する
 * （raceIdToken.md の `exp` にもそのまま使える）。
 */
export function finishBoundaryEpochSec(finishDate) {
  const [y, m, d] = finishDate.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d, 15, 0, 0) / 1000);
}

/** race が終了済みか（01章§5.3：今日 > finish_date）。 */
export function isRaceFinished(finishDate) {
  return Date.now() >= finishBoundaryEpochSec(finishDate) * 1000;
}

/** race の一覧表示用ステータス（02章§3）。 */
export function raceStatus(finishDate) {
  if (isRaceFinished(finishDate)) return "finished";
  return todayJST() === finishDate ? "lastDay" : "active";
}

/** "YYYY-MM-DD" 形式かつ実在する日付かを検証する（うるう年等もカレンダー計算で弾く）。 */
export function isValidDateStr(str) {
  if (typeof str !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const [y, m, d] = str.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
  );
}
