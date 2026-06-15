import { GetCommand } from "@aws-sdk/lib-dynamodb";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { docClient, Tables, response, getJwtSecret } from "/opt/nodejs/dynamodb.js";

/**
 * POST /login — ログイン
 * IF設計書: index.md
 */
export const handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const { username, password } = body;

    // ── バリデーション ──
    if (!username || !password) {
      return response(400, { msg: "担当者名とパスワードは必須です", token: "" });
    }
    if (!/^[ぁ-んァ-ヶ一-鿿㐀-䶿]{4,20}$/.test(username)) {
      return response(400, { msg: "担当者名はひらがな・カタカナ・漢字で4〜20文字です", token: "" });
    }
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z0-9]{6,20}$/.test(password)) {
      return response(400, { msg: "パスワードは大文字・小文字・数字を含む半角英数字で6〜20文字です", token: "" });
    }

    // ── UsersTable からユーザー取得 ──
    const result = await docClient.send(
      new GetCommand({
        TableName: Tables.users,
        Key: { username },
      })
    );

    if (!result.Item) {
      return response(400, { msg: "担当者名またはパスワードが違います", token: "" });
    }

    // ── パスワード照合 ──
    const match = await bcrypt.compare(password, result.Item.password_hash);
    if (!match) {
      return response(400, { msg: "担当者名またはパスワードが違います", token: "" });
    }

    // ── JWT 発行（username + organization_id） ──
    const token = jwt.sign(
      {
        username:        result.Item.username,
        organization_id: result.Item.organization_id,
      },
      await getJwtSecret(),
      { expiresIn: "24h" }
    );

    return response(200, { msg: "", token });
  } catch (err) {
    console.error("login error:", err);
    return response(500, { msg: "サーバーエラーが発生しました", token: "" });
  }
};
