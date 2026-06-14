import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";

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
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    },
    body: JSON.stringify(body),
  };
}

/**
 * JWT 署名/検証用の秘密鍵を SSM Parameter Store(SecureString) から取得する。
 * 環境変数 JWT_SECRET_PARAM にパラメータ名を渡す。
 * コールド起動間でキャッシュし、SSM 呼び出しは初回のみ。
 *
 * フォールバック: 環境変数 JWT_SECRET が直接設定されていればそれを使う
 * （ローカル開発・SSM 未設定時用）。
 */
const ssmClient = new SSMClient({
  region: process.env.AWS_REGION || "ap-northeast-1",
});
let cachedJwtSecret;

export async function getJwtSecret() {
  if (cachedJwtSecret) return cachedJwtSecret;

  // ローカル/フォールバック: 直接渡された値を優先
  if (process.env.JWT_SECRET) {
    cachedJwtSecret = process.env.JWT_SECRET;
    return cachedJwtSecret;
  }

  const name = process.env.JWT_SECRET_PARAM;
  if (!name) {
    throw new Error("JWT_SECRET_PARAM(または JWT_SECRET) が設定されていません");
  }

  const result = await ssmClient.send(
    new GetParameterCommand({ Name: name, WithDecryption: true })
  );
  cachedJwtSecret = result.Parameter.Value;
  return cachedJwtSecret;
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
