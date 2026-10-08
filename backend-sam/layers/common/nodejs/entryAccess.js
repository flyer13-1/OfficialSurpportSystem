/**
 * entry（車両エントリー）のドライバー枠に関する共通検証。
 * start_driver の登録・変更（管理者向け・一般向け）で共有する
 * （doc/aws-sam/admin/v2/03_race_data.md §3.2・§3.6）。
 */

const DRIVER_LETTERS = ["A", "B", "C", "D", "E", "F"];

/**
 * 車番・作業エリアが正の整数か（2026-10-08追加）。
 * 検証せずに Number() した値を書き込むと、`"abc"` が NaN になって
 * DynamoDB の書き込みで例外になり、400 のはずが 500 で返っていた。
 */
export function isPositiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0;
}

/** `driver` が A〜F の1文字かどうか。 */
export function isValidDriverLetter(driver) {
  return typeof driver === "string" && DRIVER_LETTERS.includes(driver.toUpperCase());
}

/**
 * 指定した entry アイテムに、その driver 枠が非null で存在するかどうか。
 * @param {object} entry  EntryTable のアイテム（driver_a〜driver_f を持つ）
 * @param {string} driver "A"〜"F"
 */
export function hasDriverSlot(entry, driver) {
  if (!entry || !isValidDriverLetter(driver)) return false;
  const key = `driver_${driver.toLowerCase()}`;
  return entry[key] != null;
}
