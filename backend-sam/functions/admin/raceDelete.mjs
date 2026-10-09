import { QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import {
  docClient,
  Tables,
  response,
  getRaceIdHeader,
  MAX_TRANSACT_ITEMS,
} from "/opt/nodejs/dynamodb.js";
import { requireAdmin } from "/opt/nodejs/admin.js";
import { requireRace } from "/opt/nodejs/raceAccess.js";

/**
 * DELETE /admin/race — レース削除
 * IF設計書: doc/aws-sam/admin/v2/03_race_data.md §5、02_race.md §6
 *
 * raceId は X-Race-Id ヘッダーで受け取る（01章 R10。パスパラメータは使わない）。
 * 他サーキットのレースは 404（requireRace）。entry が1件でも紐付く場合は 409（§5.1）。
 * 削除に伴い、当該raceの pit_assignment も一緒に消す（§5.3。race が無くなれば意味を持たないため）。
 * pit_assignment と race は1つの TransactWriteItems で消す（2026-10-08変更）。
 */

// 上限（MAX_TRANSACT_ITEMS）は共通レイヤーの dynamodb.js に置いている。
// race 削除では race 本体の1件もこの上限に含めて数える。
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

    // ── pit_assignment と race を1つのトランザクションで消す ──
    // 以前は BatchWriteItem で pit_assignment を消してから race を消していたが、
    // BatchWriteItem は容量不足・スロットリング時に UnprocessedItems を正常応答として
    // 返すため、戻り値を見ていないと「race は消えたのに到達できない pit_assignment が
    // 残る」状態が起き得た（2026-10-08修正。一括登録と同じ問題）。
    // TransactWriteItems なら全件成功か全件失敗のどちらかになる。
    if (assignmentKeys.length + 1 > MAX_TRANSACT_ITEMS) {
      return response(409, {
        msg: "担当ピットの件数が多いため削除できません。先に担当ピットを減らしてください",
      });
    }

    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          ...assignmentKeys.map((Key) => ({
            Delete: { TableName: Tables.pitAssignment, Key },
          })),
          {
            Delete: {
              TableName:           Tables.race,
              Key:                 { id: raceId },
              ConditionExpression: "attribute_exists(id)",
            },
          },
        ],
      })
    );

    return response(200, { msg: "" });
  } catch (err) {
    console.error("race delete error:", err);
    return response(500, { msg: "サーバーエラーが発生しました" });
  }
};
