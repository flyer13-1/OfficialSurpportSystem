import { GetCommand, QueryCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, Tables, response } from "/opt/nodejs/dynamodb.js";
import { requireAdmin } from "/opt/nodejs/admin.js";

/**
 * DELETE /race/{id} — レース削除
 * IF設計書: doc/aws-sam/admin/v2/03_race_data.md §5
 *
 * エントリーが1件でも紐付く場合は削除不可（409）。
 */
export const handler = async (event) => {
  try {
    const auth = await requireAdmin(event);
    if (auth.error) return auth.error;

    // パスパラメータ（AWS）。ローカルは server.mjs が req.params を載せる。
    let raceId = event.pathParameters?.id;
    if (!raceId && event.path) {
      raceId = decodeURIComponent(event.path.split("/").pop());
    }
    raceId = (raceId || "").trim();
    if (!raceId) {
      return response(400, { msg: "レースIDが指定されていません" });
    }

    // ── 対象存在チェック ──
    const target = await docClient.send(
      new GetCommand({ TableName: Tables.race, Key: { id: raceId } })
    );
    if (!target.Item) {
      return response(404, { msg: "対象のレースが存在しません" });
    }

    // ── エントリー紐付きチェック ──
    const entries = await docClient.send(
      new QueryCommand({
        TableName:                 Tables.entry,
        KeyConditionExpression:    "race_id = :id",
        ExpressionAttributeValues: { ":id": raceId },
        Limit:                     1,
      })
    );
    if ((entries.Items || []).length > 0) {
      return response(409, { msg: "エントリーが登録されているため削除できません" });
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
