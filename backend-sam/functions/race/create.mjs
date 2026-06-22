import { PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, Tables, response } from "/opt/nodejs/dynamodb.js";
import { requireAdmin } from "/opt/nodejs/admin.js";

/**
 * POST /race — レース登録（M-01・手入力）
 * IF設計書: doc/IF/admin/race.md
 *
 * todayId（大会ID）は入力させず、title から自動生成する。
 * ルール: title 中の文字を1文字以上含む / 15文字以上 / 他レースと非重複 /
 *         既存の大会ID仕様 /^[A-Za-z0-9\-_!]{15,}$/ に一致。
 */

const RACE_ID_RE = /^[A-Za-z0-9_-]+$/;
const TODAY_ID_CHARS =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

function randChar() {
  return TODAY_ID_CHARS[Math.floor(Math.random() * TODAY_ID_CHARS.length)];
}

/**
 * todayId 候補を生成。title 中の半角英数字を流用元とし、無ければ "R"。
 * 17文字（15以上の余裕）まで予測困難な英数字で埋める。
 */
function generateTodayId(title) {
  const fromTitle = title.match(/[A-Za-z0-9]/g) || [];
  let s = fromTitle.length ? fromTitle.join("").slice(0, 6) : "R";
  while (s.length < 17) s += randChar();
  return s;
}

async function isTodayIdTaken(todayId) {
  const r = await docClient.send(
    new ScanCommand({
      TableName:                 Tables.race,
      FilterExpression:          "today_id = :t",
      ExpressionAttributeValues: { ":t": todayId },
      ProjectionExpression:      "id",
    })
  );
  return (r.Items || []).length > 0;
}

export const handler = async (event) => {
  try {
    const auth = await requireAdmin(event);
    if (auth.error) return auth.error;

    const body   = JSON.parse(event.body || "{}");
    const raceId = (body.raceId || "").trim();
    const title  = (body.title  || "").trim();

    // ── バリデーション ──
    if (!raceId || !title) {
      return response(400, { msg: "レースID・レースタイトルは必須です" });
    }
    if (!RACE_ID_RE.test(raceId)) {
      return response(400, {
        msg: "レースIDは半角英数字・ハイフン・アンダースコアで入力してください",
      });
    }

    // ── title 重複チェック ──
    const dup = await docClient.send(
      new ScanCommand({
        TableName:                 Tables.race,
        FilterExpression:          "title = :title",
        ExpressionAttributeValues: { ":title": title },
        ProjectionExpression:      "id",
      })
    );
    if ((dup.Items || []).length > 0) {
      return response(409, { msg: "同名のレースが既に登録されています" });
    }

    // ── todayId 自動生成（重複回避）──
    let todayId;
    for (let i = 0; i < 10; i++) {
      const cand = generateTodayId(title);
      if (!(await isTodayIdTaken(cand))) {
        todayId = cand;
        break;
      }
    }
    if (!todayId) {
      return response(500, { msg: "大会IDの生成に失敗しました" });
    }

    // ── 登録（raceId 重複チェック付き）──
    try {
      await docClient.send(
        new PutCommand({
          TableName:           Tables.race,
          Item:                { id: raceId, title, today_id: todayId },
          ConditionExpression: "attribute_not_exists(id)",
        })
      );
    } catch (err) {
      if (err.name === "ConditionalCheckFailedException") {
        return response(409, { msg: "そのレースIDは既に使われています" });
      }
      throw err;
    }

    return response(200, { msg: "" });
  } catch (err) {
    console.error("race create error:", err);
    return response(500, { msg: "サーバーエラーが発生しました" });
  }
};
