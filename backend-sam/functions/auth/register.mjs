import { PutCommand, GetCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, Tables, response } from "/opt/nodejs/dynamodb.js";

/**
 * POST /user — ユーザー登録
 * IF設計書: regist.md
 *
 * 認証・パスワード管理は Cognito 側で完結する（フロントが signUp →
 * confirmRegistration まで済ませた後に呼ぶ）。ここでは確認済みユーザーの
 * sub と所属サーキットをアプリ側の UsersTable に記録するのみ。
 *
 * UsersTable の PK は cognito_sub（担当者名ではない）。そのため PutItem の
 * ConditionExpression だけでは担当者名の重複を検出できず（sub は毎回新規な
 * ので常に条件を満たしてしまう）、事前に Scan で重複確認している。フロント
 * は signUp 前に GET /user/check（checkUsername.mjs）で確認済みだが、そこ
 * から本APIが呼ばれるまでの間に別ユーザーが同名で登録する可能性が残るため、
 * ここが最終防御となる。
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
    // 3〜20文字。checkUsername.mjs と regist.html の3箇所を必ず揃える（regist.md）。
    if (!/^[ぁ-んァ-ヶ一-鿿㐀-䶿]{3,20}$/.test(username)) {
      return response(400, {
        msg: "担当者名はひらがな・カタカナ・漢字で3〜20文字です",
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

    // ── 担当者名の重複チェック（Scan。理由は上部コメント参照）──
    const existing = await docClient.send(
      new ScanCommand({
        TableName: Tables.users,
        FilterExpression: "username = :username",
        ExpressionAttributeValues: { ":username": username },
      }),
    );
    if (existing.Items && existing.Items.length > 0) {
      return response(400, { msg: "この担当者名は既に使用されています" });
    }

    const now = new Date().toISOString();

    // ── UsersTable に PutItem（cognito_subがPK。二重送信対策の条件付き）──
    try {
      await docClient.send(
        new PutCommand({
          TableName: Tables.users,
          Item: {
            cognito_sub: sub, // Cognito の userSub（UsersTableのPK）
            username,
            organization_id: circuitNum,
            created_at: now,
          },
          ConditionExpression: "attribute_not_exists(cognito_sub)",
        }),
      );
    } catch (err) {
      if (err.name === "ConditionalCheckFailedException") {
        return response(400, { msg: "このユーザーは既に登録されています" });
      }
      throw err;
    }

    return response(200, { msg: "" });
  } catch (err) {
    console.error("register error:", err);
    return response(500, { msg: "サーバーエラーが発生しました" });
  }
};
