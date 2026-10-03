import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, Tables, response, getRaceIdHeader } from "/opt/nodejs/dynamodb.js";
import { requireAdmin } from "/opt/nodejs/admin.js";
import { todayJST, isValidDateStr, isRaceFinished } from "/opt/nodejs/raceStatus.js";
import { isValidTitle, hasDuplicateTitle } from "./raceShared.mjs";

/**
 * PUT /race — レース変更（title・finishDateのみ）
 * IF設計書: doc/aws-sam/admin/v2/02_race.md §4
 *
 * raceId は X-Race-Id ヘッダーで送る（ボディには含めない。01章R10）。
 * raceId・todayId・サーキットは変更不可。
 */
export const handler = async (event) => {
  try {
    const auth = await requireAdmin(event);
    if (auth.error) return auth.error;

    const raceId = getRaceIdHeader(event);
    if (!raceId) {
      return response(400, { msg: "レースIDは必須です" });
    }

    const body       = JSON.parse(event.body || "{}");
    const title      = (body.title || "").trim();
    const finishDate = body.finishDate;

    // ── 対象raceの照合（01章§5.1）：存在しない／他サーキット → 404 ──
    const target = await docClient.send(
      new GetCommand({ TableName: Tables.race, Key: { id: raceId } })
    );
    if (!target.Item || target.Item.organization_id !== auth.circuit) {
      return response(404, { msg: "対象のレースが存在しません" });
    }

    // ── 終了済みなら変更不可（01章R7） ──
    if (isRaceFinished(target.Item.finish_date)) {
      return response(403, { msg: "終了したレースです", reason: "race_finished" });
    }

    // ── バリデーション（登録と同じ） ──
    if (!isValidTitle(title)) {
      return response(400, { msg: "レースタイトルは1〜200文字で入力してください" });
    }
    if (!isValidDateStr(finishDate)) {
      return response(400, { msg: "終了日を正しい形式で入力してください" });
    }
    if (finishDate < todayJST()) {
      return response(400, { msg: "終了日は今日以降の日付を指定してください" });
    }

    // ── title 重複チェック（自分自身は除外） ──
    if (
      title !== target.Item.title &&
      (await hasDuplicateTitle(auth.circuit, title, raceId))
    ) {
      return response(409, { msg: "同名のレースが既に登録されています" });
    }

    await docClient.send(
      new UpdateCommand({
        TableName:                 Tables.race,
        Key:                       { id: raceId },
        UpdateExpression:          "SET title = :title, finish_date = :finishDate",
        ExpressionAttributeValues: { ":title": title, ":finishDate": finishDate },
      })
    );

    return response(200, { msg: "" });
  } catch (err) {
    console.error("race update error:", err);
    return response(500, { msg: "サーバーエラーが発生しました" });
  }
};
