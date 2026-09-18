import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, Tables, response } from "/opt/nodejs/dynamodb.js";

/**
 * GET /user/check — 担当者名の空き確認
 * IF設計書: checkUsername.md
 *
 * Cognito の signUp を呼ぶ前にフロントから叩く想定。ここで重複を弾いておくことで、
 * 「Cognitoには確認済みユーザーが存在するが UsersTable には登録できない」孤児
 * アカウントの発生を防ぐ（register.mjs 側の重複チェックだけでは Cognito 登録後に
 * しか弾けないため）。
 */
export const handler = async (event) => {
  try {
    const username = event.queryStringParameters?.username;

    // ── バリデーション（register.mjs と同一ルール）──
    if (!username) {
      return response(400, { msg: "担当者名は必須です" });
    }
    if (!/^[ぁ-んァ-ヶ一-鿿㐀-䶿]{6,20}$/.test(username)) {
      return response(400, {
        msg: "担当者名はひらがな・カタカナ・漢字で6〜20文字です",
      });
    }

    // ── UsersTable を Scan して username と照合 ──
    const result = await docClient.send(
      new ScanCommand({
        TableName: Tables.users,
        FilterExpression: "username = :username",
        ExpressionAttributeValues: { ":username": username },
      }),
    );

    const exists = !!(result.Items && result.Items.length > 0);
    return response(200, { msg: "", exists });
  } catch (err) {
    console.error("checkUsername error:", err);
    return response(500, { msg: "サーバーエラーが発生しました" });
  }
};
