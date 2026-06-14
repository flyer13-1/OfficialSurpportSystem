import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, Tables, response } from "/opt/nodejs/dynamodb.js";

/**
 * POST /user/me — 大会ID照会
 * IF設計書: userMenu1.md
 * 成功時に raceId を返す（フロントエンドが保持して以降の API に渡す）
 */
export const handler = async (event) => {
  try {
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
    // raceId をレスポンスで返す（フロントエンドが以降のリクエストに含める）
    return response(200, { msg: "", raceId: race.id });
  } catch (err) {
    console.error("conform error:", err);
    return response(500, { msg: "サーバーエラーが発生しました" });
  }
};
