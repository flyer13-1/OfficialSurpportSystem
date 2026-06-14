import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import bcrypt from "bcryptjs";
import { docClient, Tables, response } from "/opt/nodejs/dynamodb.js";

/**
 * POST /user/password — パスワード変更
 * IF設計書: forgetPass.md
 */
export const handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const { username, password, newpassword } = body;

    // ── バリデーション ──
    if (!username || !password || !newpassword) {
      return response(400, { msg: "担当者名・現在のパスワード・新しいパスワードは必須です" });
    }
    if (!/^[ぁ-んァ-ヶー一-鿿㐀-䶿]{4,20}$/.test(username)) {
      return response(400, { msg: "担当者名の形式が不正です" });
    }
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z0-9]{6,20}$/.test(newpassword)) {
      return response(400, { msg: "新しいパスワードは大文字・小文字・数字を含む半角英数字で6〜20文字です" });
    }
    if (password === newpassword) {
      return response(400, { msg: "新しいパスワードは現在のパスワードと異なる必要があります" });
    }

    // ── UsersTable から GetItem ──
    const result = await docClient.send(
      new GetCommand({
        TableName: Tables.users,
        Key:       { username },
      })
    );

    if (!result.Item) {
      return response(400, { msg: "担当者名またはパスワードが違います" });
    }

    // ── 現在パスワード照合 ──
    const currentMatch = await bcrypt.compare(password, result.Item.password_hash);
    if (!currentMatch) {
      return response(400, { msg: "現在のパスワードが違います" });
    }

    // ── 新パスワード ≠ 現在パスワード チェック（ハッシュ比較）──
    const sameAsNew = await bcrypt.compare(newpassword, result.Item.password_hash);
    if (sameAsNew) {
      return response(400, { msg: "新しいパスワードは現在のパスワードと異なる必要があります" });
    }

    // ── 新パスワードをハッシュ化して UpdateItem ──
    const newHash = await bcrypt.hash(newpassword, 10);
    await docClient.send(
      new UpdateCommand({
        TableName:                 Tables.users,
        Key:                       { username },
        UpdateExpression:          "SET password_hash = :hash, updated_at = :now",
        ExpressionAttributeValues: {
          ":hash": newHash,
          ":now":  new Date().toISOString(),
        },
      })
    );

    return response(200, { msg: "" });
  } catch (err) {
    console.error("changePassword error:", err);
    return response(500, { msg: "サーバーエラーが発生しました" });
  }
};
