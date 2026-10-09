import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import {
  docClient,
  Tables,
  response,
  generateId,
  queryAll,
  MAX_TRANSACT_ITEMS,
} from "/opt/nodejs/dynamodb.js";
import { requireGeneralRace } from "/opt/nodejs/raceToken.js";
import { findUnassignedCars } from "/opt/nodejs/pitAssignmentAccess.js";

/**
 * POST /entries/auto — 自動入力送信
 * IF設計書: doc/IF/enterAuto2.md
 *
 * current + unsent のデータを **TransactWriteItems** で PitLogTable に保存する
 * （2026-10-09変更。以前は BatchWriteItem を25件ずつ送り、戻り値を見ていなかった）。
 *
 * BatchWriteItem は容量不足・スロットリング時に、処理できなかった項目を
 * UnprocessedItems に入れた「正常応答」を返す。例外ではないので try/catch では捕まらず、
 * 戻り値を見ていないと「200 を返したのに一部が入っていない」状態になる。
 * この画面はレース中ずっと使われ、しかもフロントは送信が成功すると端末の未送信データ
 * （localStorage の unsentData）を消すため、取りこぼした記録は復旧できない。
 * TransactWriteItems なら全件成功か全件失敗のどちらかで、失敗時は例外になるので
 * 画面が未送信データを保持したままやり直せる（管理者側の一括登録と同じ扱い。03章§1.1）。
 *
 * raceId は X-Race-Id（raceId トークン）で受け取る
 */
export const handler = async (event) => {
  try {
    const username = event.requestContext?.authorizer?.username;
    if (!username) return response(401, { msg: "認証が必要です" });

    const access = await requireGeneralRace(event);
    if (access.error) return access.error;
    const raceId = access.raceId;

    const body = JSON.parse(event.body || "{}");
    const { current, unsent } = body;

    if (!current || typeof current !== "object") {
      return response(400, { msg: "current は必須です" });
    }

    // current + unsent をマージ（同一車番は current 優先）
    const merged = { ...unsent, ...current };

    const carNums = Object.keys(merged).map(Number).filter((n) => !isNaN(n));
    if ((await findUnassignedCars(username, raceId, carNums)).length > 0) {
      return response(403, { msg: "担当エリア外の車両が含まれています" });
    }

    // ── 各車番の次の pit_num を取得してアイテムを生成 ──
    const transactItems = [];

    for (const [carNumStr, data] of Object.entries(merged)) {
      const car_num = Number(carNumStr);
      if (isNaN(car_num)) continue;

      // バリデーション: inTime / outTime の最低1つが必要
      if (!data.inTime && !data.outTime) {
        return response(400, {
          msg: `車番 ${car_num}: inTime / outTime のいずれかは必須です`,
        });
      }
      // outTime が inTime より前のチェック
      if (data.inTime && data.outTime) {
        if (new Date(data.outTime) < new Date(data.inTime)) {
          return response(400, { msg: `車番 ${car_num}: 出時刻は入時刻以降にしてください` });
        }
      }

      // 現在の最大 pit_num を取得
      // 全ページ辿る。1ページで止めると最大値が巻き戻り、pit_num が重複する
      const existingItems = await queryAll({
        TableName:                 Tables.pitLog,
        KeyConditionExpression:    "race_id = :race_id",
        FilterExpression:          "car_num = :car_num",
        ExpressionAttributeValues: { ":race_id": raceId, ":car_num": car_num },
        ProjectionExpression:      "pit_num",
      });
      const maxPitNum = existingItems.reduce(
        (max, item) => Math.max(max, item.pit_num || 0),
        0
      );

      const now = new Date().toISOString();
      transactItems.push({
        Put: {
          TableName: Tables.pitLog,
          Item: {
            race_id:        raceId,
            id:             generateId(),
            car_num,
            username,
            pit_num:        maxPitNum + 1,
            in_time:        data.inTime        || null,
            out_time:       data.outTime       || null,
            driver_out:     data.outDriver     || null,
            tire:           data.tire    === true,
            oil:            data.oil     === true,
            note:           data.note          || "",
            created_at:     now,
            updated_at:     now,
          },
        },
      });
    }

    if (transactItems.length === 0) {
      return response(200, { msg: "" });
    }

    // 1トランザクション100件まで。マージ後の件数は車番ごとに1件なので、
    // 担当エリアの台数分（多くて十数台）に収まる。念のため入口で弾く。
    if (transactItems.length > MAX_TRANSACT_ITEMS) {
      return response(400, {
        msg: `一度に送信できるのは${MAX_TRANSACT_ITEMS}件までです`,
      });
    }

    // ── TransactWriteItems（全件成功か全件失敗） ──
    // id は送信ごとに新しい ULID のため、条件（attribute_not_exists）は付けない。
    await docClient.send(new TransactWriteCommand({ TransactItems: transactItems }));

    return response(200, { msg: "" });
  } catch (err) {
    // 全件失敗して何も書き込まれていない。画面は未送信データを持ったままなので、
    // やり直せることを伝える（握りつぶして200を返すと記録が消える）。
    if (err.name === "TransactionCanceledException") {
      console.error("autoCreate transaction canceled:", err);
      return response(500, {
        msg: "送信できませんでした。もう一度お試しください",
      });
    }
    console.error("autoCreate error:", err);
    return response(500, { msg: "サーバーエラーが発生しました" });
  }
};
