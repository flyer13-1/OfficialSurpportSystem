import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, Tables, response } from "/opt/nodejs/dynamodb.js";

/**
 * 一般向けAPIの入口で、**担当者名**を取得する（2026-10-09追加）。
 *
 * `username` という名前の値が3種類あるので注意する。
 *
 * | どこの username | 中身 |
 * | --- | --- |
 * | `authorizer.username`（`cognito:username`） | **メールアドレス**。サインアップでメールをCognitoのユーザー名にしているため |
 * | `UsersTable.username` | **担当者名**（ひらがな・カタカナ・漢字 3〜20文字） |
 * | `pit_assignment.username` | **担当者名**（UsersTable と同じ値） |
 *
 * 担当エリアの判定（`getAssignedEntries` / `findUnassignedCars`）も、記録に残す
 * 「担当者」も、使うのは**担当者名**。`authorizer.username` をそのまま渡すと
 * メールアドレスで担当者名を検索することになり、1件も一致しない
 * （車両が出ない・全車が「担当エリア外」で403・記録にメールが残る）。
 *
 * `UsersTable` の PK は `cognito_sub` なので、`authorizer.sub` で引く
 * （`profile.mjs` や管理者向けの `requireAdmin` と同じやり方）。
 *
 * 成功時: `{ username: 担当者名, sub }`
 * 失敗時: `{ error: <response object> }`（401 未認証 / 403 未登録）
 */
export async function requireGeneralUser(event) {
  const sub = event.requestContext?.authorizer?.sub;
  if (!sub) {
    return { error: response(401, { msg: "認証が必要です" }) };
  }

  const result = await docClient.send(
    new GetCommand({ TableName: Tables.users, Key: { cognito_sub: sub } })
  );
  if (!result.Item) {
    return {
      error: response(403, {
        msg:    "ユーザーが見つかりません",
        reason: "user_not_found",
      }),
    };
  }

  return { username: result.Item.username, sub };
}

/**
 * username（担当者名）が UsersTable に登録済みかどうかを確認する。
 * UsersTable の PK は cognito_sub のため、username で引くには
 * UsernameIndex（GSI）を使う（doc/aws-sam/admin/v2/03_race_data.md §4.2）。
 */
export async function isRegisteredUsername(username) {
  const result = await docClient.send(
    new QueryCommand({
      TableName:                 Tables.users,
      IndexName:                 "UsernameIndex",
      KeyConditionExpression:    "username = :username",
      ExpressionAttributeValues: { ":username": username },
      Limit:                     1,
    })
  );
  return (result.Items || []).length > 0;
}
