import { randomInt } from "node:crypto";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, Tables } from "/opt/nodejs/dynamodb.js";

/**
 * race の登録・一覧・変更（02章）で共通して使う処理。
 * raceId 自体の生成は generateId()（/opt/nodejs/dynamodb.js、ULID）をそのまま使う
 * （raceIdToken.md §10 の決定により、予測不可能性は不要になったため）。
 */

// todayId に使う文字。紛らわしい文字（0/O、1/l/I）を除く（02章§2.3）。
const TODAY_ID_CHARS =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
const TODAY_ID_LENGTH = 17;

/** todayId候補を1つ作る（暗号論的な乱数。Math.random は使わない。02章§2.3）。 */
export function generateTodayId() {
  let s = "";
  for (let i = 0; i < TODAY_ID_LENGTH; i++) {
    s += TODAY_ID_CHARS[randomInt(TODAY_ID_CHARS.length)];
  }
  return s;
}

/** title が 1〜200文字か（前後の空白を除いた上で）検証する（02章§1 R8）。 */
export function isValidTitle(title) {
  return typeof title === "string" && title.length >= 1 && title.length <= 200;
}

/**
 * 同じサーキット内に、同名（title）の race が既にあるか確認する（02章§2.2・§4.3）。
 * `excludeRaceId` を指定すると、そのraceId自身は重複判定から除外する（変更時に使う）。
 */
export async function hasDuplicateTitle(circuit, title, excludeRaceId = null) {
  const result = await docClient.send(
    new QueryCommand({
      TableName:                 Tables.race,
      IndexName:                 "OrganizationIndex",
      KeyConditionExpression:    "organization_id = :circuit",
      FilterExpression:          "title = :title",
      ExpressionAttributeValues: {
        ":circuit": circuit,
        ":title":   title,
      },
      ProjectionExpression: "id",
    })
  );
  const items = result.Items || [];
  return items.some((it) => it.id !== excludeRaceId);
}
