import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, Tables, response, getRaceIdHeader } from "/opt/nodejs/dynamodb.js";
import { requireAdmin } from "/opt/nodejs/admin.js";
import { requireRace } from "/opt/nodejs/raceAccess.js";
import { isValidDriverLetter, hasDriverSlot } from "/opt/nodejs/entryAccess.js";

/**
 * PUT /admin/start-driver — スタートドライバー変更
 * IF設計書: doc/aws-sam/admin/v2/03_race_data.md §3.4
 *
 * raceId（ヘッダー）＋ carNum（ボディ）で対象を特定し、driver を変更する。
 * 検証内容は登録（§3.2）と同じ。
 */
export const handler = async (event) => {
  try {
    const auth = await requireAdmin(event);
    if (auth.error) return auth.error;

    const raceId = getRaceIdHeader(event);
    const { error } = await requireRace(raceId, auth.circuit, { write: true });
    if (error) return error;

    const body   = JSON.parse(event.body || "{}");
    const carNum = Number(body.carNum);
    const driver = body.driver;

    const target = await docClient.send(
      new GetCommand({ TableName: Tables.startDriver, Key: { race_id: raceId, car_num: carNum } })
    );
    if (!target.Item) {
      return response(404, { msg: "対象のスタートドライバーが存在しません" });
    }

    if (!isValidDriverLetter(driver)) {
      return response(400, { msg: "ドライバ枠は A〜F で指定してください" });
    }

    const entry = await docClient.send(
      new GetCommand({ TableName: Tables.entry, Key: { race_id: raceId, car_num: carNum } })
    );
    if (!hasDriverSlot(entry.Item, driver)) {
      return response(400, { msg: "そのドライバ枠はエントリーに登録されていません" });
    }

    await docClient.send(
      new UpdateCommand({
        TableName:                 Tables.startDriver,
        Key:                       { race_id: raceId, car_num: carNum },
        UpdateExpression:          "SET driver = :driver",
        ExpressionAttributeValues: { ":driver": driver.toUpperCase() },
      })
    );

    return response(200, { msg: "" });
  } catch (err) {
    console.error("start_driver update error:", err);
    return response(500, { msg: "サーバーエラーが発生しました" });
  }
};
