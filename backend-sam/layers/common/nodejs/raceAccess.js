import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, Tables, response } from "/opt/nodejs/dynamodb.js";
import { isRaceFinished } from "/opt/nodejs/raceStatus.js";

/**
 * 管理者APIで対象raceを取得し、01章§5.1の照合を行う共通処理。
 * race に属するデータ（entry / start_driver / pit_assignment / pitlog）を
 * 扱う全ての管理者向けLambdaが、requireAdmin の直後に呼ぶ。
 *
 * @param {string} raceId        X-Race-Id ヘッダーの値（getRaceIdHeader で取得したもの）
 * @param {number} circuit       呼び出し元のサーキット（requireAdmin が返す auth.circuit）
 * @param {{ write?: boolean }} opts
 *   write: true の場合、終了済みなら403で弾く（書き込み系）。
 *   既定(false)は参照系として終了済みでも許可する（01章 R7 と同じ考え方）。
 *
 * 成功時: { race }  race は RaceTable の生アイテム（id, title, organization_id, finish_date, ...）
 * 失敗時: { error: <response object> }
 */
export async function requireRace(raceId, circuit, opts = {}) {
  if (!raceId) {
    return { error: response(400, { msg: "レースIDは必須です" }) };
  }

  const result = await docClient.send(
    new GetCommand({ TableName: Tables.race, Key: { id: raceId } })
  );

  // 存在しない／他サーキット → どちらも同じ404（他サーキットのraceの存在を知られないため。01章§5.1）
  if (!result.Item || result.Item.organization_id !== circuit) {
    return { error: response(404, { msg: "対象のレースが存在しません" }) };
  }

  if (opts.write && isRaceFinished(result.Item.finish_date)) {
    return {
      error: response(403, { msg: "終了したレースです", reason: "race_finished" }),
    };
  }

  return { race: result.Item };
}
