import { GetCommand } from "@aws-sdk/lib-dynamodb";
import jwt from "jsonwebtoken";
import { docClient, Tables, response, getJwtSecret } from "/opt/nodejs/dynamodb.js";

/**
 * 検証済みリクエストから username を解決する。
 * 通常は Authorizer が requestContext.authorizer にセットするが、
 * context が届かない場合は Authorization ヘッダーの JWT を自前検証する
 * （profile.mjs と同じフォールバック）。
 */
export async function resolveUsername(event) {
  let username = event.requestContext?.authorizer?.username;
  if (!username) {
    const authHeader =
      event.headers?.Authorization || event.headers?.authorization || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (token) {
      try {
        const decoded = jwt.verify(token, await getJwtSecret());
        username = decoded.username;
      } catch {
        // 署名不正・期限切れは未認証として扱う
      }
    }
  }
  return username || null;
}

/**
 * 管理者APIの認可。ログイン認証（JWT）を通過した上で admin=true を確認する。
 * 成功時: { username }
 * 失敗時: { error: <response object> }（401 未認証 / 403 admin でない）
 *
 * 非adminの試行はログに残す（DBログ化は別タスク）。
 */
export async function requireAdmin(event) {
  const username = await resolveUsername(event);
  if (!username) {
    return { error: response(401, { msg: "認証が必要です" }) };
  }

  const userResult = await docClient.send(
    new GetCommand({ TableName: Tables.users, Key: { username } })
  );

  if (!userResult.Item || userResult.Item.admin !== true) {
    console.warn(`[admin] forbidden access attempt by username=${username}`);
    return { error: response(403, { msg: "管理者権限がありません" }) };
  }

  return { username };
}
