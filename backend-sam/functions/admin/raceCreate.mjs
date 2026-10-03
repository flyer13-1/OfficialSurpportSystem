import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, Tables, response, generateId } from "/opt/nodejs/dynamodb.js";
import { requireAdmin } from "/opt/nodejs/admin.js";
import { todayJST, isValidDateStr } from "/opt/nodejs/raceStatus.js";
import { generateTodayId, isValidTitle, hasDuplicateTitle } from "./raceShared.mjs";

/**
 * POST /race — レース登録
 * IF設計書: doc/aws-sam/admin/v2/02_race.md §2
 *
 * raceId（id）・todayId・organizationId はリクエストbodyの値を無視し、
 * サーバーが生成・付与する（01章§5.1、02章§1）。
 */

const MAX_TODAY_ID_RETRY = 10;
const MAX_RACE_ID_RETRY  = 3;

export const handler = async (event) => {
  try {
    const auth = await requireAdmin(event);
    if (auth.error) return auth.error;

    const body       = JSON.parse(event.body || "{}");
    const title      = (body.title || "").trim();
    const finishDate = body.finishDate;

    // ── バリデーション ──
    if (!isValidTitle(title)) {
      return response(400, { msg: "レースタイトルは1〜200文字で入力してください" });
    }
    if (!isValidDateStr(finishDate)) {
      return response(400, { msg: "終了日を正しい形式で入力してください" });
    }
    if (finishDate < todayJST()) {
      return response(400, { msg: "終了日は今日以降の日付を指定してください" });
    }

    // ── title 重複チェック（同じサーキットの中だけ。R8） ──
    if (await hasDuplicateTitle(auth.circuit, title)) {
      return response(409, { msg: "同名のレースが既に登録されています" });
    }

    // ── todayId を作る（重複したら作り直し。最大10回） ──
    let todayId = null;
    for (let i = 0; i < MAX_TODAY_ID_RETRY; i++) {
      const candidate = generateTodayId();
      const dup = await docClient.send(
        new QueryCommand({
          TableName:                 Tables.race,
          IndexName:                 "TodayIdIndex",
          KeyConditionExpression:    "today_id = :todayId",
          ExpressionAttributeValues: { ":todayId": candidate },
          ProjectionExpression:      "id",
        })
      );
      if (!dup.Items || dup.Items.length === 0) {
        todayId = candidate;
        break;
      }
    }
    if (!todayId) {
      return response(500, { msg: "サーバーエラーが発生しました" });
    }

    // ── raceId を作り、条件付き書き込みで保存する（重複したら作り直し。最大3回） ──
    const now = new Date().toISOString();
    let saved = false;
    for (let i = 0; i < MAX_RACE_ID_RETRY; i++) {
      const raceId = generateId();
      try {
        await docClient.send(
          new PutCommand({
            TableName: Tables.race,
            Item: {
              id:              raceId,
              title,
              today_id:        todayId,
              organization_id: auth.circuit,
              finish_date:     finishDate,
              created_at:      now,
              created_by:      auth.sub,
            },
            ConditionExpression: "attribute_not_exists(id)",
          })
        );
        saved = true;
        break;
      } catch (err) {
        if (err.name !== "ConditionalCheckFailedException") throw err;
        // raceId衝突。作り直して次のループへ
      }
    }
    if (!saved) {
      return response(500, { msg: "サーバーエラーが発生しました" });
    }

    // raceId は返さない。登録後、画面は GET /race を呼び直して取得する（02章§2.2）。
    return response(200, { msg: "", todayId });
  } catch (err) {
    console.error("race create error:", err);
    return response(500, { msg: "サーバーエラーが発生しました" });
  }
};
