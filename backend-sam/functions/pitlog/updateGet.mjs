import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, Tables, response } from "/opt/nodejs/dynamodb.js";
import { requireGeneralRace } from "/opt/nodejs/raceToken.js";
import { requireGeneralUser } from "/opt/nodejs/usersAccess.js";
import { findUnassignedCars } from "/opt/nodejs/pitAssignmentAccess.js";
import { buildPitLogs } from "/opt/nodejs/pitLogs.js";

/**
 * GET /entries/update — 変更対象ピット記録取得
 * IF設計書: doc/IF/enterUpdate1.md
 *
 * raceId は X-Race-Id ヘッダーのトークンで受け取る（requireGeneralRace。01章 R10）。
 * 対象車両はクエリの carNum。呼び出し元の担当エリア内に限る。
 *
 * データの組み立ては共通処理 buildPitLogs()（04章§2.2）を使い、対象車両の行だけを
 * 取り出す（2026-10-09変更）。以前はこの中で独自に組み立てていたため、
 * inDriver（ピットに入った人）が常に null で、画面の「インドライバー」列が
 * 空のままだった。04章§2.3 のキュー方式は buildPitLogs にしかなく、
 * 二重に実装する理由が無い。
 */
export const handler = async (event) => {
  try {
    // 担当者名は UsersTable から引く（authorizer.username はメールアドレス）。
    // 担当エリアの判定も、記録に残す担当者も、使うのは担当者名（usersAccess.js）。
    const user = await requireGeneralUser(event);
    if (user.error) return user.error;
    const username = user.username;

    const access = await requireGeneralRace(event);
    if (access.error) return access.error;
    const raceId = access.raceId;

    const carNumStr = event.queryStringParameters?.carNum;
    if (!carNumStr) return response(400, { msg: "carNum は必須です" });

    const car_num = Number(carNumStr);
    if (!Number.isInteger(car_num) || car_num <= 0) {
      return response(400, { msg: "車番は正の整数で指定してください" });
    }
    if ((await findUnassignedCars(username, raceId, [car_num])).length > 0) {
      return response(403, { msg: "担当エリア外の車両です" });
    }

    // 対象車両の記録だけを取り出す。並びは buildPitLogs が時刻順にしているが、
    // 1台分では「時刻順＝ピット回数順」になるため、画面側の並べ替えと矛盾しない。
    const logs = (await buildPitLogs(raceId)).filter((row) => row.carNum === car_num);

    // リタイア理由は buildPitLogs が持たない（04章§4.3 の列に無いため）。
    // 更新画面は現在の理由を入力欄に出すので、ここで引いて別項目として返す。
    const retireResult = await docClient.send(
      new GetCommand({
        TableName: Tables.retire,
        Key:       { race_id: raceId, car_num },
      })
    );
    const reason = retireResult.Item?.reason ?? "";

    return response(200, { msg: "", reason, logs });
  } catch (err) {
    console.error("updateGet error:", err);
    return response(500, { msg: "サーバーエラーが発生しました" });
  }
};
