import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, Tables, response } from "/opt/nodejs/dynamodb.js";
import { issueRaceToken } from "/opt/nodejs/raceToken.js";

/**
 * POST /user/me — 大会ID照会
 * IF設計書: userMenu1.md / doc/IF/raceIdToken.md
 * 成功時に raceToken（署名付き）を返す（フロントエンドが保持して以降の API に
 * X-Race-Id ヘッダーで渡す）。raceId 自体はもう返さない（raceIdToken.md §4）。
 */

// finish_date を持たない古いレース（02章のレース登録実装前のテストデータ）向けの
// 暫定フォールバック。02章が実装されれば全レースに finish_date が入るため、
// この分岐はいずれ使われなくなる。
const FALLBACK_EXP_SECONDS = 24 * 60 * 60; // 24時間

/**
 * finish_date（"YYYY-MM-DD"、JSTの日付）の翌日 0:00（JST）の UNIX秒を返す。
 * 01章§1の「終了済み」の境界と同じ値（JSTはUTC+9固定でサマータイム無しのため、
 * 「当日15:00 UTC」＝「翌日0:00 JST」として直接計算できる）。
 */
function expFromFinishDate(finishDate) {
  const [y, m, d] = finishDate.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d, 15, 0, 0) / 1000);
}

export const handler = async (event) => {
  try {
    const sub = event.requestContext?.authorizer?.sub;
    if (!sub) {
      return response(401, { msg: "認証が必要です" });
    }

    const body = JSON.parse(event.body || "{}");
    const { todayId } = body;

    // ── バリデーション ──
    if (!todayId) {
      return response(400, { msg: "大会IDは必須です" });
    }
    if (!/^[A-Za-z0-9\-_!]{15,}$/.test(todayId)) {
      return response(400, { msg: "大会IDは半角英数字と記号(-_!)で15文字以上です" });
    }

    // ── RaceTable を Scan して todayId と照合 ──
    // TODO: 02章の TodayIdIndex（GSI）が追加されたら Query に置き換える
    const result = await docClient.send(
      new ScanCommand({
        TableName:                 Tables.race,
        FilterExpression:         "today_id = :todayId",
        ExpressionAttributeValues: { ":todayId": todayId },
      })
    );

    if (!result.Items || result.Items.length === 0) {
      return response(400, { msg: "大会IDが一致しません" });
    }

    const race = result.Items[0];

    // ── 終了済みレースの判定（01章§5.4・§1） ──
    const exp = race.finish_date
      ? expFromFinishDate(race.finish_date)
      : Math.floor(Date.now() / 1000) + FALLBACK_EXP_SECONDS;

    if (race.finish_date && Date.now() >= exp * 1000) {
      return response(403, { msg: "終了したレースです", reason: "race_finished" });
    }

    // ── raceId トークンを発行する（raceIdToken.md §3・§4） ──
    const raceToken = await issueRaceToken({ raceId: race.id, sub, exp });

    return response(200, { msg: "", raceToken });
  } catch (err) {
    console.error("conform error:", err);
    return response(500, { msg: "サーバーエラーが発生しました" });
  }
};
