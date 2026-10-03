import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

// DynamoDB クライアント（シングルトン）
const clientConfig = {
  region: process.env.AWS_REGION || "ap-northeast-1",
};

// ローカル開発: DynamoDB Local を使う場合は AWS_ENDPOINT_URL を設定
if (process.env.AWS_ENDPOINT_URL) {
  clientConfig.endpoint = process.env.AWS_ENDPOINT_URL;
}

const client = new DynamoDBClient(clientConfig);

export const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: {
    removeUndefinedValues: true,
    convertEmptyValues: false,
  },
});

// テーブル名マップ（環境変数から取得）
export const Tables = {
  users:          process.env.USERS_TABLE,
  organizations:  process.env.ORGANIZATIONS_TABLE,
  race:           process.env.RACE_TABLE,
  entry:          process.env.ENTRY_TABLE,
  startDriver:    process.env.START_DRIVER_TABLE,
  pitAssignment:  process.env.PIT_ASSIGNMENT_TABLE,
  pitLog:         process.env.PIT_LOG_TABLE,
  pitLogHistory:  process.env.PIT_LOG_HISTORY_TABLE,
  retire:         process.env.RETIRE_TABLE,
  outpostLog:     process.env.OUTPOST_LOG_TABLE,
};

/**
 * Lambda レスポンス生成ヘルパー
 * @param {number} statusCode
 * @param {object} body
 */
export function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Race-Id",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    },
    body: JSON.stringify(body),
  };
}

/**
 * X-Race-Id ヘッダーの値を取得する（大文字小文字を区別しない）。
 * raceId はクエリ・パス・ボディに載せず、常にこのヘッダーで送る
 * （doc/aws-sam/admin/v2/01_permission.md R10）。無ければ null。
 */
export function getRaceIdHeader(event) {
  const headers = event.headers || {};
  const key = Object.keys(headers).find((k) => k.toLowerCase() === "x-race-id");
  return key ? headers[key] : null;
}

/**
 * 簡易 ULID 生成（依存なしバージョン）
 * ulid パッケージが使えない場合のフォールバック
 */
export function generateId() {
  const now = Date.now();
  const timeStr = now.toString(32).toUpperCase().padStart(10, "0");
  const chars = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const randomStr = Array.from({ length: 16 }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join("");
  return timeStr + randomStr;
}
