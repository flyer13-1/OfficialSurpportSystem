import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, Tables, response } from "/opt/nodejs/dynamodb.js";
import { issueRaceToken } from "/opt/nodejs/raceToken.js";
import { finishBoundaryEpochSec, isRaceFinished } from "/opt/nodejs/raceStatus.js";

/**
 * POST /user/me — 大会ID照会
 * IF設計書: userMenu1.md / doc/IF/raceIdToken.md
 * 成功時に raceToken（署名付き）を返す（フロントエンドが保持して以降の API に
 * X-Race-Id ヘッダーで渡す）。raceId 自体はもう返さない（raceIdToken.md §4）。
 */

// finish_date を持たない古いレース（02章のレース登録実装前のテストデータ）向けの
// 暫定フォールバック。02章の実装後に作られたレースは全て finish_date を持つため、
// この分岐はいずれ使われなくなる。
const FALLBACK_EXP_SECONDS = 24 * 60 * 60; // 24時間

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

    // ── RaceTable を TodayIdIndex で照合（02章§1。Scanから変更） ──
    const result = await docClient.send(
      new QueryCommand({
        TableName:                 Tables.race,
        IndexName:                 "TodayIdIndex",
        KeyConditionExpression:    "today_id = :todayId",
        ExpressionAttributeValues: { ":todayId": todayId },
      })
    );

    if (!result.Items || result.Items.length === 0) {
      return response(400, { msg: "大会IDが一致しません" });
    }

    const race = result.Items[0];

    // ── 終了済みレースの判定（01章§5.4・§1） ──
    if (race.finish_date && isRaceFinished(race.finish_date)) {
      return response(403, { msg: "終了したレースです", reason: "race_finished" });
    }

    const exp = race.finish_date
      ? finishBoundaryEpochSec(race.finish_date)
      : Math.floor(Date.now() / 1000) + FALLBACK_EXP_SECONDS;

    // ── raceId トークンを発行する（raceIdToken.md §3・§4） ──
    const raceToken = await issueRaceToken({ raceId: race.id, sub, exp });

    return response(200, { msg: "", raceToken });
  } catch (err) {
    console.error("conform error:", err);
    return response(500, { msg: "サーバーエラーが発生しました" });
  }
};
