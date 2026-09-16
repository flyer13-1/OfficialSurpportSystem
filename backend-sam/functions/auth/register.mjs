import { PutCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, Tables, response } from "/opt/nodejs/dynamodb.js";

/**
 * POST /user — ユーザー登録
 * IF設計書: regist.md
 *
 * 認証・パスワード管理は Cognito 側で完結する（フロントが signUp →
 * confirmRegistration まで済ませた後に呼ぶ）。ここでは確認済みユーザーの
 * sub と所属サーキットをアプリ側の UsersTable に記録するのみ。
 */
export const handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const { username, sub, circuit } = body;

    // ── バリデーション ──
    if (
      !username ||
      !sub ||
      circuit === undefined ||
      circuit === null ||
      circuit === ""
    ) {
      return response(400, { msg: "担当者名・sub・サーキットは必須です" });
    }
    if (!/^[ぁ-んァ-ヶ一-鿿㐀-䶿]{4,20}$/.test(username)) {
      return response(400, {
        msg: "担当者名はひらがな・カタカナ・漢字で4〜20文字です",
      });
    }
    const circuitNum = Number(circuit);
    if (!Number.isInteger(circuitNum) || circuitNum < 1 || circuitNum > 7) {
      return response(400, { msg: "サーキットは1〜7の数字を指定してください" });
    }

    // ── OrganizationsTable で circuit 存在確認 ──
    const orgResult = await docClient.send(
      new GetCommand({
        TableName: Tables.organizations,
        Key: { circuit: circuitNum },
      }),
    );
    if (!orgResult.Item) {
      return response(400, { msg: "指定されたサーキットが存在しません" });
    }

    const now = new Date().toISOString();

    // ── UsersTable に PutItem（重複チェック付き）──
    try {
      await docClient.send(
        new PutCommand({
          TableName: Tables.users,
          Item: {
            username,
            sub, // Cognito の userSub（ユーザー識別子）
            organization_id: circuitNum,
            created_at: now,
          },
          ConditionExpression: "attribute_not_exists(username)",
        }),
      );
    } catch (err) {
      if (err.name === "ConditionalCheckFailedException") {
        return response(400, { msg: "この担当者名は既に使用されています" });
      }
      throw err;
    }

    return response(200, { msg: "" });
  } catch (err) {
    console.error("register error:", err);
    return response(500, { msg: "サーバーエラーが発生しました" });
  }
};
