import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, Tables, response } from "/opt/nodejs/dynamodb.js";
import { requireGeneralRace } from "/opt/nodejs/raceToken.js";

/**
 * POST /entries/retire — リタイア登録
 * IF設計書: doc/IF/enterRetire2.md
 *
 * raceId は X-Race-Id ヘッダーのトークンで受け取る（requireGeneralRace。01章 R10）。
 *
 * **既にリタイア登録されている車両は 409 で弾く**（2026-10-09変更）。
 * 以前は条件なしで PutItem していたため、同じ車番を送ると理由が黙って上書きされ、
 * 先に入れた内容が消えていた。理由の訂正と取り消しは変更モード
 * （PUT /entries/update の selection=2 / 3）で行う。
 *
 * 取り消し済み（is_retired=false）の車両は、もう一度リタイア登録できる。
 * そのため「行が無いこと」ではなく「リタイア中でないこと」を条件にする。
 */
export const handler = async (event) => {
  try {
    // ログイン確認だけ。担当者名は使わない（この操作は記録に名前を残さない）。
    // authorizer.username はメールアドレスなので、存在確認にも sub を使う。
    if (!event.requestContext?.authorizer?.sub) {
      return response(401, { msg: "認証が必要です" });
    }

    const access = await requireGeneralRace(event);
    if (access.error) return access.error;
    const race_id = access.raceId;

    const body = JSON.parse(event.body || "{}");
    const { carNum, reason } = body;

    // ── バリデーション ──
    if (carNum === undefined || carNum === null) {
      return response(400, { msg: "carNum は必須です" });
    }
    if (!reason || String(reason).trim() === "") {
      return response(400, { msg: "reason は必須です（空文字不可）" });
    }

    const car_num = Number(carNum);
    if (isNaN(car_num)) return response(400, { msg: "carNum が不正です" });

    // ── EntryTable に対象車両が存在するか確認 ──
    const entryResult = await docClient.send(
      new GetCommand({
        TableName: Tables.entry,
        Key:       { race_id, car_num },
      })
    );
    if (!entryResult.Item) {
      return response(400, { msg: "指定された車両がエントリーに存在しません" });
    }

    // ── RetireTable に PutItem（is_retired=true） ──
    // 既にリタイア中なら書き換えない。取り消し済み（false）の行は上書きしてよい
    try {
      await docClient.send(
        new PutCommand({
          TableName: Tables.retire,
          Item: {
            race_id,
            car_num,
            is_retired: true,
            reason:     String(reason).trim(),
          },
          ConditionExpression:
            "attribute_not_exists(car_num) OR is_retired = :false",
          ExpressionAttributeValues: { ":false": false },
        })
      );
    } catch (err) {
      if (err.name === "ConditionalCheckFailedException") {
        return response(409, {
          msg: "この車両は既にリタイア登録されています。理由の変更や取り消しは変更モードで行ってください",
        });
      }
      throw err;
    }

    return response(200, { msg: "" });
  } catch (err) {
    console.error("retireCreate error:", err);
    return response(500, { msg: "サーバーエラーが発生しました" });
  }
};
