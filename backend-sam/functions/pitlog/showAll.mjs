import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, Tables, response, generateId } from "/opt/nodejs/dynamodb.js";
import { requireGeneralRace } from "/opt/nodejs/raceToken.js";
import { buildPitLogs } from "/opt/nodejs/pitLogs.js";

/**
 * GET /entries/show — 全ピット情報取得（一般向け確認・出力画面）
 * 設計: doc/aws-sam/admin/v2/04_pitlog.md §3.3・§6
 *
 * raceId は X-Race-Id（raceId トークン）で受け取る。act=1 のとき OutpostLog に記録する。
 * 管理者ポップアップ（leader の raceId 直指定）は、そのUIを作る時点で分岐を足す。
 */
export const handler = async (event) => {
  try {
    const username = event.requestContext?.authorizer?.username;
    if (!username) return response(401, { msg: "認証が必要です" });

    const access = await requireGeneralRace(event);
    if (access.error) return access.error;
    const raceId = access.raceId;

    const race = await docClient.send(
      new GetCommand({ TableName: Tables.race, Key: { id: raceId } })
    );
    const raceTitle = race.Item?.title ?? "";
    const logs = await buildPitLogs(raceId);

    if (event.queryStringParameters?.act === "1") {
      await docClient.send(
        new PutCommand({
          TableName: Tables.outpostLog,
          Item: {
            race_id:    raceId,
            id:         generateId(),
            username,
            is_leader:  event.requestContext?.authorizer?.isAdmin === "true",
            created_at: new Date().toISOString(),
          },
        })
      );
    }

    return response(200, { msg: "", raceTitle, logs });
  } catch (err) {
    console.error("showAll error:", err);
    return response(500, { msg: "サーバーエラーが発生しました" });
  }
};
