import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

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
 * Query を最後のページまで辿って、全アイテムを返す。
 *
 * DynamoDB の Query は1回で最大1MB分しか返さず、続きは LastEvaluatedKey で辿る。
 * 一般向けAPIは「1レース分は1ページに収まる」前提で書かれていたが、その前提は
 * どこにも書かれておらず、件数が増えると**黙って一部だけで処理する**。
 * 具体的には pit_num の最大値が巻き戻って回数が重複し、表やCSVから記録が落ちる。
 *
 * Limit は渡さない。Limit は「フィルタ前に評価する件数」の上限なので、
 * FilterExpression と併用すると取りこぼす（03章§2.5・§4.4 で踏んだ問題）。
 */
export async function queryAll(params) {
  const items = [];
  let lastKey;
  do {
    const page = await docClient.send(
      new QueryCommand({ ...params, ExclusiveStartKey: lastKey })
    );
    items.push(...(page.Items || []));
    lastKey = page.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

/**
 * TransactWriteItems の1トランザクションあたりの上限（DynamoDBの制限）。
 * 一括登録（entry / start_driver / pit_assignment）と race 削除で共有する
 * （doc/aws-sam/admin/v2/03_race_data.md §1.1・§5.4）。超える場合は各ハンドラが
 * 400（race削除は409）で弾く。これが無いと、件数超過が読みにくい例外になって500で返る。
 */
export const MAX_TRANSACT_ITEMS = 100;

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
