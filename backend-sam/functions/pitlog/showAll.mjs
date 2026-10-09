import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import {
  docClient,
  Tables,
  response,
  generateId,
  getRaceIdHeader,
} from "/opt/nodejs/dynamodb.js";
import { verifyRaceToken } from "/opt/nodejs/raceToken.js";
import { requireGeneralUser } from "/opt/nodejs/usersAccess.js";
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
 * | 管理者画面のポップアップ | **平文の raceId** | requireAdmin ＋ requireRace（サーキット照合。他サーキットは404） | **参照できる** |
 * | 確認・出力画面（一般） | 署名付きトークン | トークン検証 | 403 race_finished |
 *
 * 管理者APIは raceId トークンの対象外のため、ポップアップは平文の raceId を送る
 * （raceToken.js の冒頭コメント、01章 R10）。
 *
 * **分岐は「呼び出し元が leader か」ではなく「ヘッダーに何が入っているか」で行う**
 * （2026-10-09修正）。leader であっても一般の確認画面から開けばトークンが送られて
 * くるため、leader かどうかで分けると、そのトークンを平文の raceId として探しに行き
 * 404「対象のレースが存在しません」になっていた。
 *
 * act=1 のとき OutpostLog に記録する（§6。leader かどうかも残す）。
 */
export const handler = async (event) => {
  try {
    const auth = event.requestContext?.authorizer;
    if (!auth?.sub) return response(401, { msg: "認証が必要です" });

    const isLeader = auth.isAdmin === "true";

    // ── 認可（§3.3） ──
    // username は OutpostLog に残す担当者名（§6）。authorizer.username は
    // メールアドレスなので使わず、どちらの経路でも UsersTable から引いた値にする。
    let username;
    let raceId;
    let raceTitle;

    const verified = await verifyRaceToken(getRaceIdHeader(event), auth.sub);

    if (verified.raceId) {
      // ── 一般の確認・出力画面（署名付きトークン） ──
      // leader がこの画面を使った場合もここに入る。トークンが有効な間だけ見られる。
      const user = await requireGeneralUser(event);
      if (user.error) return user.error;
      username = user.username;
      raceId = verified.raceId;

      const race = await docClient.send(
        new GetCommand({ TableName: Tables.race, Key: { id: raceId } })
      );
      raceTitle = race.Item?.title ?? "";
    } else if (verified.error === "expired") {
      // トークンの期限切れ＝終了済み（01章§5.4）。管理者が終了済みを見たい場合は
      // 管理者画面のポップアップ（平文の raceId）から開く。
      return response(403, { msg: "終了したレースです", reason: "race_finished" });
    } else if (isLeader) {
      // ── 管理者画面のポップアップ（平文の raceId） ──
      const admin = await requireAdmin(event);
      if (admin.error) return admin.error;
      username = admin.username;

      // write を指定しない＝参照系。終了済みでも許可する（01章 R7・§5.1）
      const { race, error } = await requireRace(
        getRaceIdHeader(event),
        admin.circuit
      );
      if (error) return error;

      raceId = race.id;
      raceTitle = race.title ?? "";
    } else {
      // トークンが不正で、leader でもない（理由は返さない。raceIdToken.md §5）
      return response(403, {
        msg: "大会IDを確認できません。入室し直してください",
      });
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
