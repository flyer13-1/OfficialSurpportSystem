import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, Tables } from "/opt/nodejs/dynamodb.js";

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
