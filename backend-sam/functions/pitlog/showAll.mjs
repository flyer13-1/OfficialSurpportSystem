import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import {
  docClient,
  Tables,
  response,
  generateId,
  getRaceIdHeader,
} from "/opt/nodejs/dynamodb.js";
import { requireGeneralRace } from "/opt/nodejs/raceToken.js";
import { requireAdmin } from "/opt/nodejs/admin.js";
import { requireRace } from "/opt/nodejs/raceAccess.js";
import { buildPitLogs } from "/opt/nodejs/pitLogs.js";

/**
 * GET /entries/show — 全ピット情報取得（確認画面・出力画面・管理者ポップアップ 共通）
 * 設計: doc/aws-sam/admin/v2/04_pitlog.md §3.3・§3.4・§6
 *
 * **ハンドラは1本で、呼び出し元が leader かどうかで認可だけを変える**（§3.3）。
 * 返すデータと形式はどちらも同じ。「終了済みを見られるかは、どの画面から呼んだかでは
 * なく、その人が leader かどうかで決まる」という考え方に揃えている。
 *
 * | 呼び出し元 | X-Race-Id | 照合 | 終了済み |
 * | --- | --- | --- | --- |
 * | leader（管理者画面のポップアップ） | **平文の raceId** | requireAdmin ＋ requireRace（サーキット照合。他サーキットは404） | **参照できる** |
 * | 一般利用者（確認・出力画面） | 署名付きトークン | requireGeneralRace | 403 race_finished |
 *
 * 管理者APIは raceId トークンの対象外のため、leader は平文の raceId を送る
 * （raceToken.js の冒頭コメント、01章 R10）。分岐はトークン検証より前に行う。
 *
 * act=1 のとき OutpostLog に記録する（§6。leader かどうかも残す）。
 */
export const handler = async (event) => {
  try {
    const auth = event.requestContext?.authorizer;
    const username = auth?.username;
    if (!username) return response(401, { msg: "認証が必要です" });

    const isLeader = auth?.isAdmin === "true";

    // ── 認可（§3.3 の手順3） ──
    let raceId;
    let raceTitle;
    if (isLeader) {
      const admin = await requireAdmin(event);
      if (admin.error) return admin.error;

      // write を指定しない＝参照系。終了済みでも許可する（01章 R7・§5.1）
      const { race, error } = await requireRace(
        getRaceIdHeader(event),
        admin.circuit
      );
      if (error) return error;

      raceId = race.id;
      raceTitle = race.title ?? "";
    } else {
      const access = await requireGeneralRace(event);
      if (access.error) return access.error;
      raceId = access.raceId;

      const race = await docClient.send(
        new GetCommand({ TableName: Tables.race, Key: { id: raceId } })
      );
      raceTitle = race.Item?.title ?? "";
    }

    const logs = await buildPitLogs(raceId);

    if (event.queryStringParameters?.act === "1") {
      await docClient.send(
        new PutCommand({
          TableName: Tables.outpostLog,
          Item: {
            race_id:    raceId,
            id:         generateId(),
            username,
            is_leader:  isLeader,
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
