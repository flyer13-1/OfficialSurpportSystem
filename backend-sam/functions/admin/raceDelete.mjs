import { QueryCommand, DeleteCommand, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, Tables, response, getRaceIdHeader } from "/opt/nodejs/dynamodb.js";
import { requireAdmin } from "/opt/nodejs/admin.js";
import { requireRace } from "/opt/nodejs/raceAccess.js";

/**
 * DELETE /admin/race — レース削除
 * IF設計書: doc/aws-sam/admin/v2/03_race_data.md §5、02_race.md §6
 *
 * raceId は X-Race-Id ヘッダーで受け取る（01章 R10。パスパラメータは使わない）。
 * 他サーキットのレースは 404（requireRace）。entry が1件でも紐付く場合は 409（§5.1）。
 * 削除に伴い、当該raceの pit_assignment も一緒に消す（§5.3。race が無くなれば意味を持たないため）。
 */
export const handler = async (event) => {
  try {
    const auth = await requireAdmin(event);
    if (auth.error) return auth.error;

    const raceId = getRaceIdHeader(event);
    const { error } = await requireRace(raceId, auth.circuit, { write: true });
    if (error) return error;

    // ── entry 紐付き確認（1件でもあれば削除不可。§5.1） ──
    const entries = await docClient.send(
      new QueryCommand({
        TableName:                 Tables.entry,
        KeyConditionExpression:    "race_id = :raceId",
        ExpressionAttributeValues: { ":raceId": raceId },
        ProjectionExpression:      "car_num",
        Limit:                     1,
      })
    );
    if ((entries.Items || []).length > 0) {
      return response(409, { msg: "エントリーが登録されているため削除できません" });
    }

    // ── 紐づく pit_assignment を集める（§5.3） ──
    const assignmentKeys = [];
    let lastKey;
    do {
      const page = await docClient.send(
        new QueryCommand({
          TableName:                 Tables.pitAssignment,
          KeyConditionExpression:    "race_id = :raceId",
          ExpressionAttributeValues: { ":raceId": raceId },
          ProjectionExpression:      "#sk",
          ExpressionAttributeNames:  { "#sk": "username#maintenance_area" },
          ExclusiveStartKey:         lastKey,
        })
      );
      for (const item of page.Items || []) {
        assignmentKeys.push({
          race_id:                     raceId,
          "username#maintenance_area": item["username#maintenance_area"],
        });
      }
      lastKey = page.LastEvaluatedKey;
    } while (lastKey);

    // ── pit_assignment を消してから race を消す ──
    // この順にするのは、途中で失敗しても race が残り、やり直せるようにするため
    // （race を先に消すと、到達できない pit_assignment が残る）。
    for (let i = 0; i < assignmentKeys.length; i += 25) {
      const chunk = assignmentKeys.slice(i, i + 25); // BatchWriteItem は1リクエスト25件まで
      await docClient.send(
        new BatchWriteCommand({
          RequestItems: {
            [Tables.pitAssignment]: chunk.map((Key) => ({ DeleteRequest: { Key } })),
          },
        })
      );
    }

    await docClient.send(
      new DeleteCommand({ TableName: Tables.race, Key: { id: raceId } })
    );

    return response(200, { msg: "" });
  } catch (err) {
    console.error("race delete error:", err);
    return response(500, { msg: "サーバーエラーが発生しました" });
  }
};
