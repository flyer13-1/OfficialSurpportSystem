import { GetCommand } from "@aws-sdk/lib-dynamodb";
import jwt from "jsonwebtoken";
import { docClient, Tables, response, getJwtSecret } from "/opt/nodejs/dynamodb.js";

/**
 * GET /user/me — プロフィール取得
 * IF設計書: userMenu2.md
 */
export const handler = async (event) => {
  try {
    // ── username を取得 ──
    // 通常は Authorizer が requestContext.authorizer にセットする。
    // Authorizer が未アタッチ等で context が無い場合は、Authorization
    // ヘッダーの JWT を自前で検証して username を取り出す（フォールバック）。
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
          // 署名不正・期限切れなどは未認証として扱う
        }
      }
    }
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
      isAdmin:  userResult.Item.isAdmin ?? false,
    });
  } catch (err) {
    console.error("profile error:", err);
    return response(500, { msg: "サーバーエラーが発生しました", username: "", circuit: "" });
  }
};
