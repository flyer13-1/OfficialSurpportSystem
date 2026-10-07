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

// finish_date が無いレースへの安全策（2026-10-07決定。doc/IF/raceIdToken.md §7）。
// 02章§2 で finishDate は必須のため本来起こらないが、データの欠損・改ざんで
// 消えた場合に期限の無いトークンを出さないようにする。
// 2時間だけ有効にし、超過後は exp 切れ＝終了済み（403 race_finished）として扱われる。
// あわせてレスポンスに warning を付け、画面で管理者への連絡を促す。
const MISSING_FINISH_DATE_EXP_SECONDS = 2 * 60 * 60; // 2時間

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
    if (!/^[A-Za-z0-9]{15,}$/.test(todayId)) {
      return response(400, { msg: "大会IDは半角英数字で15文字以上です" });
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

    const hasFinishDate = Boolean(race.finish_date);

    // ── 終了済みレースの判定（01章§5.4・§1） ──
    if (hasFinishDate && isRaceFinished(race.finish_date)) {
      return response(403, { msg: "終了したレースです", reason: "race_finished" });
    }

    if (!hasFinishDate) {
      // 本来あり得ない状態なので、調査できるようログに残す。
      console.warn(
        `[conform] finish_date missing: raceId=${race.id} todayId=${todayId}`
      );
    }

    const exp = hasFinishDate
      ? finishBoundaryEpochSec(race.finish_date)
      : Math.floor(Date.now() / 1000) + MISSING_FINISH_DATE_EXP_SECONDS;

    // ── raceId トークンを発行する（raceIdToken.md §3・§4） ──
    const raceToken = await issueRaceToken({ raceId: race.id, sub, exp });

    // msg は空のまま返す（フロントの handleApiError が非空の msg をエラー扱いするため）。
    // 終了日が無い異常時だけ warning を足し、画面側で管理者への連絡を促させる。
    return response(200, {
      msg: "",
      raceToken,
      ...(hasFinishDate ? {} : { warning: "finish_date_missing" }),
    });
  } catch (err) {
    console.error("conform error:", err);
    return response(500, { msg: "サーバーエラーが発生しました" });
  }
};
