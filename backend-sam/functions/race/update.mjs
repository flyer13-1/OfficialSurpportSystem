import { GetCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, Tables, response } from "/opt/nodejs/dynamodb.js";
import { requireAdmin } from "/opt/nodejs/admin.js";

/**
 * PUT /race — レース変更（title のみ）
 * IF設計書: doc/IF/admin/race.md
 *
 * raceId（=id）は変更不可。todayId は登録時の自動生成値を維持する。
 */
export const handler = async (event) => {
  try {
    const auth = await requireAdmin(event);
    if (auth.error) return auth.error;

    const body   = JSON.parse(event.body || "{}");
    const raceId = (body.raceId || "").trim();
    const title  = (body.title  || "").trim();

    if (!raceId || !title) {
      return response(400, { msg: "レースID・レースタイトルは必須です" });
    }

    // ── 対象存在チェック ──
    const target = await docClient.send(
      new GetCommand({ TableName: Tables.race, Key: { id: raceId } })
    );
    if (!target.Item) {
      return response(404, { msg: "対象のレースが存在しません" });
    }

    // ── title 重複チェック（自分自身は除外）──
    if (title !== target.Item.title) {
      const dup = await docClient.send(
        new ScanCommand({
          TableName:                 Tables.race,
          FilterExpression:          "title = :title AND id <> :id",
          ExpressionAttributeValues: { ":title": title, ":id": raceId },
          ProjectionExpression:      "id",
        })
      );
      if ((dup.Items || []).length > 0) {
        return response(409, { msg: "同名のレースが既に登録されています" });
      }
    }

    await docClient.send(
      new UpdateCommand({
        TableName:                 Tables.race,
        Key:                       { id: raceId },
        UpdateExpression:          "SET title = :title",
        ExpressionAttributeValues: { ":title": title },
      })
    );

    return response(200, { msg: "" });
  } catch (err) {
    console.error("race update error:", err);
    return response(500, { msg: "サーバーエラーが発生しました" });
  }
};
