import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, Tables, response } from "/opt/nodejs/dynamodb.js";

/**
 * 管理者APIの認可（doc/aws-sam/admin/v2/01_permission.md §4）。
 * ログイン認証（Cognito）を通過した上で leader グループ所属を確認し、
 * UsersTable を cognito_sub で引いて実在確認と所属サーキットの取得を行う。
 *
 * 成功時: { username, sub, circuit }
 *   username: **UsersTable の担当者名**（2026-10-09変更。以前は authorizer.username を
 *             そのまま返していたが、あれは cognito:username ＝ メールアドレスで、
 *             担当者名ではない。記録に残すと担当者列にメールが並ぶ）
 *   circuit : users.organization_id（数値）
 * 失敗時: { error: <response object> }（401 未認証 / 403 admin でない・未登録。
 *          msg に加えて reason も返す。01章§6）
 *
 * 非adminの試行・未登録ユーザーの試行はログに残す（DBログ化は別タスク）。
 */
export async function requireAdmin(event) {
  const auth = event.requestContext?.authorizer;
  const sub = auth?.sub;
  const username = auth?.username;

  // §4-1: authorizer.sub が無ければ未ログイン扱い
  if (!sub) {
    return { error: response(401, { msg: "認証が必要です" }) };
  }

  // 管理者判定は Cognito の leader グループで行う（Authorizer が
  // cognito:groups から算出して context.isAdmin にセット。文字列で届く）。
  const isAdmin = auth?.isAdmin === "true" || auth?.isAdmin === true;
  if (!isAdmin) {
    console.warn(
      `[admin] forbidden (not_admin): sub=${sub} username=${username} path=${event.path}`
    );
    return {
      error: response(403, { msg: "管理者権限がありません", reason: "not_admin" }),
    };
  }

  // §4-3: UsersTable の PK は cognito_sub（username ではない）。
  const userResult = await docClient.send(
    new GetCommand({ TableName: Tables.users, Key: { cognito_sub: sub } })
  );
  if (!userResult.Item) {
    console.warn(
      `[admin] forbidden (user_not_found): sub=${sub} username=${username} path=${event.path}`
    );
    return {
      error: response(403, {
        msg:    "ユーザーが見つかりません",
        reason: "user_not_found",
      }),
    };
  }

  return {
    username: userResult.Item.username, // 担当者名（authorizer の username ではない）
    sub,
    circuit:  userResult.Item.organization_id,
  };
}
