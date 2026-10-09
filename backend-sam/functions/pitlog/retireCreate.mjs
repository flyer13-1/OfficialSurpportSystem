import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, Tables, response } from "/opt/nodejs/dynamodb.js";
import { requireGeneralRace } from "/opt/nodejs/raceToken.js";

/**
 * POST /entries/retire — リタイア登録
 * IF設計書: doc/IF/enterRetire2.md
 *
 * raceId は X-Race-Id ヘッダーのトークンで受け取る（requireGeneralRace。01章 R10）。
 * 既にリタイア済みかは確認しない（同じ車番を送ると理由を上書きする。
 * 理由の訂正手段も兼ねている。リタイア取り消しは PUT /entries/update）。
 */
export const handler = async (event) => {
  try {
    const username = event.requestContext?.authorizer?.username;
    if (!username) return response(401, { msg: "認証が必要です" });

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
    await docClient.send(
      new PutCommand({
        TableName: Tables.retire,
        Item: {
          race_id,
          car_num,
          is_retired: true,
          reason:     String(reason).trim(),
        },
      })
    );

    return response(200, { msg: "" });
  } catch (err) {
    console.error("retireCreate error:", err);
    return response(500, { msg: "サーバーエラーが発生しました" });
  }
};
