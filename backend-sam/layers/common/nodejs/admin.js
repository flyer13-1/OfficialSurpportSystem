import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, Tables, response } from "/opt/nodejs/dynamodb.js";

/**
 * 検証済みリクエストから username を解決する。
 * Authorizer が Cognito ID トークンを検証した上で requestContext.authorizer
 * にセットする（authorizer.mjs 参照）。
 */
export function resolveUsername(event) {
  return event.requestContext?.authorizer?.username || null;
}

/**
 * 管理者APIの認可。ログイン認証（Cognito）を通過した上で leader グループ所属を確認する。
 * 所属サーキット(organization_id)も併せて返す（管理者APIでのスコープ絞り込み用）。
 * 成功時: { username, organizationId }
 * 失敗時: { error: <response object> }（401 未認証 / 403 admin でない）
 *
 * 非adminの試行はログに残す（DBログ化は別タスク）。
 */
export async function requireAdmin(event) {
  const username = resolveUsername(event);
  if (!username) {
    return { error: response(401, { msg: "認証が必要です" }) };
  }

  // 管理者判定は Cognito の leader グループで行う（Authorizer が
  // cognito:groups から算出して context.isAdmin にセット。文字列で届く）。
  const auth = event.requestContext?.authorizer;
  const isAdmin = auth?.isAdmin === "true" || auth?.isAdmin === true;
  if (!isAdmin) {
    console.warn(`[admin] forbidden access attempt by username=${username}`);
    return { error: response(403, { msg: "管理者権限がありません" }) };
  }

  // 所属サーキット(organization_id)は引き続き UsersTable から取得する。
  const userResult = await docClient.send(
    new GetCommand({ TableName: Tables.users, Key: { username } })
  );
  if (!userResult.Item) {
    return { error: response(403, { msg: "ユーザーが見つかりません" }) };
  }

  return { username, organizationId: userResult.Item.organization_id };
}
