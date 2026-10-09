import { QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, Tables, response, getRaceIdHeader } from "/opt/nodejs/dynamodb.js";
import { requireAdmin } from "/opt/nodejs/admin.js";
import { requireRace } from "/opt/nodejs/raceAccess.js";

/**
 * DELETE /admin/entry/{carNum} — エントリー削除
 * IF設計書: doc/aws-sam/admin/v2/03_race_data.md §2.5
 *
 * raceId はヘッダーで送る（carNum は車番であり秘匿する意味が無いためパスパラメータのまま）。
 * pit_log が1件でも紐付く場合は削除不可（409）。削除に伴い、当該車両の
 * start_driver も同時に削除する（§5.3。pit_assignment は人単位のため残置する）。
 */

/**
 * 当該車両の pit_log が1件でもあるか（§2.5）。
 *
 * PitLogTable は PK race_id / SK id(ULID) で car_num の索引が無いため、
 * race_id で Query して car_num を FilterExpression で絞り込む。
 * **Limit は使えない。** Limit は「フィルタ前に評価する件数」の上限なので、
 * Limit:1 だとパーティションの先頭1件しか見ず、その1件が別の車両なら
 * 記録があっても0件に見えてしまう（記録付きの車両が消せてしまう）。
 * 1ページに収まらない場合に取りこぼさないよう、見つかるまでページを辿る。
 * Select: COUNT なので項目本体は運ばない。
 */
async function hasPitLog(raceId, carNum) {
  let lastKey;
  do {
    const page = await docClient.send(
      new QueryCommand({
        TableName:                 Tables.pitLog,
        KeyConditionExpression:    "race_id = :raceId",
        FilterExpression:          "car_num = :carNum",
        ExpressionAttributeValues: { ":raceId": raceId, ":carNum": carNum },
        Select:                    "COUNT",
        ExclusiveStartKey:         lastKey,
      })
    );
    if (page.Count > 0) return true;
    lastKey = page.LastEvaluatedKey;
  } while (lastKey);
  return false;
}

export const handler = async (event) => {
  try {
    const auth = await requireAdmin(event);
    if (auth.error) return auth.error;

    const raceId = getRaceIdHeader(event);
    const { error } = await requireRace(raceId, auth.circuit, { write: true });
    if (error) return error;

    const carNum = Number(event.pathParameters?.carNum);
    if (!Number.isFinite(carNum)) {
      return response(400, { msg: "車番は必須です" });
    }

    // ── pit_log 紐付き確認（1件でもあれば削除不可） ──
    if (await hasPitLog(raceId, carNum)) {
      return response(409, { msg: "ピット記録が存在するため削除できません" });
    }

    // ── entry と start_driver（同じ車両分があれば）を同時に削除 ──
    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Delete: {
              TableName:           Tables.entry,
              Key:                 { race_id: raceId, car_num: carNum },
              ConditionExpression: "attribute_exists(car_num)",
            },
          },
          {
            Delete: {
              TableName: Tables.startDriver,
              Key:       { race_id: raceId, car_num: carNum },
            },
          },
        ],
      })
    );

    return response(200, { msg: "" });
  } catch (err) {
    if (err.name === "TransactionCanceledException") {
      return response(404, { msg: "対象のエントリーが存在しません" });
    }
    console.error("entry delete error:", err);
    return response(500, { msg: "サーバーエラーが発生しました" });
  }
};
