import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, Tables, response } from "/opt/nodejs/dynamodb.js";

/**
 * GET /user/me — プロフィール取得
 * IF設計書: userMenu2.md
 */
export const handler = async (event) => {
  try {
    // sub（Cognitoのcognito_sub）は Authorizer が Cognito ID トークンを検証した上で
    // requestContext.authorizer にセットする（authorizer.mjs 参照）。
    // UsersTable の PK は cognito_sub のため、これで引く（authorizer.username は
    // Cognitoのサインイン設定変更によりメールアドレスになっており担当者名ではない）。
    const sub = event.requestContext?.authorizer?.sub;
    if (!sub) {
      return response(401, {
        msg: "認証が必要です",
        username: "",
        circuit: "",
      });
    }

    // ── UsersTable から GetItem ──
    const userResult = await docClient.send(
      new GetCommand({
        TableName: Tables.users,
        Key: { cognito_sub: sub },
      }),
    );

    // users に登録が無い利用者は 403 ＋ reason: user_not_found
    // （01章§6 の403の表。管理者向けの requireAdmin と同じ扱いに揃える）。
    if (!userResult.Item) {
      return response(403, {
        msg: "ユーザーが見つかりません",
        reason: "user_not_found",
        username: "",
        circuit: "",
      });
    }

    return response(200, {
      msg: "",
      username: userResult.Item.username,
      circuit: String(userResult.Item.organization_id),
      // 管理者判定は Cognito の leader グループ由来（Authorizer が context に
      // isAdmin をセット。文字列で届く）。conform.js / userMenu2.md が参照。
      isAdmin: event.requestContext?.authorizer?.isAdmin === "true",
    });
  } catch (err) {
    console.error("profile error:", err);
    return response(500, {
      msg: "サーバーエラーが発生しました",
      username: "",
      circuit: "",
    });
  }
};
