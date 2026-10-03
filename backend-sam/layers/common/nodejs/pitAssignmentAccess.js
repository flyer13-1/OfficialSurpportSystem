import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, Tables } from "/opt/nodejs/dynamodb.js";

/**
 * 担当エリア（pit_assignment）に関する共通処理。
 * `GET /entries/init`（init.mjs）と一般向け start_driver 登録（§3.6）で共有する。
 */

/**
 * "5-10" → [5,6,7,8,9,10] に展開する。"7" のような単体数字はそのまま [7]。
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
  const assignResult = await docClient.send(
    new QueryCommand({
      TableName:                 Tables.pitAssignment,
      IndexName:                 "UsernameIndex",
      KeyConditionExpression:    "username = :username",
      FilterExpression:          "race_id = :raceId",
      ExpressionAttributeValues: { ":username": username, ":raceId": raceId },
    })
  );
  const assignments = assignResult.Items || [];
  if (assignments.length === 0) return [];

  const assignedNums = [
    ...new Set(assignments.flatMap((a) => expandRange(a.maintenance_area))),
  ];

  const entryResult = await docClient.send(
    new QueryCommand({
      TableName:                 Tables.entry,
      KeyConditionExpression:    "race_id = :raceId",
      ExpressionAttributeValues: { ":raceId": raceId },
    })
  );

  return (entryResult.Items || []).filter((e) => {
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
  const entryResult = await docClient.send(
    new QueryCommand({
      TableName:                 Tables.entry,
      KeyConditionExpression:    "race_id = :raceId",
      ExpressionAttributeValues: { ":raceId": raceId },
      ProjectionExpression:      "maintenance_area",
    })
  );
  return new Set(
    (entryResult.Items || []).flatMap((e) => expandRange(e.maintenance_area))
  );
}

/**
 * maintenanceArea（担当範囲。例 "5-10"）が、entryAreaNumbers（getEntryAreaNumbers の結果）と
 * 1つでも重なるか。
 */
export function overlapsEntryAreas(maintenanceArea, entryAreaNumbers) {
  return expandRange(maintenanceArea).some((n) => entryAreaNumbers.has(n));
}
