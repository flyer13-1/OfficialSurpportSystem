import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, Tables, response } from "/opt/nodejs/dynamodb.js";

/**
 * GET /user/me — プロフィール取得
 * IF設計書: userMenu2.md
 */
export const handler = async (event) => {
  try {
    // username は Authorizer が Cognito ID トークンを検証した上で
    // requestContext.authorizer にセットする（authorizer.mjs 参照）。
    const username = event.requestContext?.authorizer?.username;
    if (!username) {
      return response(401, { msg: "認証が必要です", username: "", circuit: "" });
    }

    // ── UsersTable から GetItem ──
    const userResult = await docClient.send(
      new GetCommand({
        TableName: Tables.users,
        Key:       { username },
      })
    );

    if (!userResult.Item) {
      return response(400, { msg: "ユーザーが見つかりません", username: "", circuit: "" });
    }

    return response(200, {
      msg:      "",
      username: userResult.Item.username,
      circuit:  String(userResult.Item.organization_id),
      isAdmin:  userResult.Item.admin === true,
    });
  } catch (err) {
    console.error("profile error:", err);
    return response(500, { msg: "サーバーエラーが発生しました", username: "", circuit: "" });
  }
};
