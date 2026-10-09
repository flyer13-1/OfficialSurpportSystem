import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, Tables, response } from "/opt/nodejs/dynamodb.js";
import { requireGeneralRace } from "/opt/nodejs/raceToken.js";
import {
  isValidDriverLetter,
  hasDriverSlot,
  isPositiveInt,
} from "/opt/nodejs/entryAccess.js";
import { findUnassignedCars } from "/opt/nodejs/pitAssignmentAccess.js";

/**
 * PUT /entries/start-driver — スタートドライバー変更（一般利用者向け）
 * 設計: 担当エリア内の車両に限り、登録済みのスタートドライバーの枠を変える。
 * 未登録なら404（登録は POST /entries/start-driver）。raceId は X-Race-Id（raceId トークン）。
 */
export const handler = async (event) => {
  try {
    const username = event.requestContext?.authorizer?.username;
    if (!username) return response(401, { msg: "認証が必要です" });

    const access = await requireGeneralRace(event);
    if (access.error) return access.error;
    const raceId = access.raceId;

    const body   = JSON.parse(event.body || "{}");
    const driver = body.driver;

    // 検証せずに Number() すると、未指定や "abc" が NaN になって
    // findUnassignedCars が「担当エリア外」と判定し、400 のはずが 403 で返っていた。
    if (!isPositiveInt(body.carNum)) {
      return response(400, { msg: "車番は正の整数で指定してください" });
    }
    const carNum = Number(body.carNum);

    if (!isValidDriverLetter(driver)) {
      return response(400, { msg: "ドライバ枠は A〜F で指定してください" });
    }
    if ((await findUnassignedCars(username, raceId, [carNum])).length > 0) {
      return response(403, { msg: "担当エリア外の車両です" });
    }

    const entry = await docClient.send(
      new GetCommand({ TableName: Tables.entry, Key: { race_id: raceId, car_num: carNum } })
    );
    if (!hasDriverSlot(entry.Item, driver)) {
      return response(400, { msg: "そのドライバ枠はエントリーに登録されていません" });
    }

    try {
      await docClient.send(
        new UpdateCommand({
          TableName:                 Tables.startDriver,
          Key:                       { race_id: raceId, car_num: carNum },
          UpdateExpression:          "SET driver = :driver",
          ConditionExpression:       "attribute_exists(car_num)",
          ExpressionAttributeValues: { ":driver": driver.toUpperCase() },
        })
      );
    } catch (err) {
      if (err.name === "ConditionalCheckFailedException") {
        return response(404, { msg: "スタートドライバーが未登録です" });
      }
      throw err;
    }

    return response(200, { msg: "" });
  } catch (err) {
    console.error("start_driver update (general) error:", err);
    return response(500, { msg: "サーバーエラーが発生しました" });
  }
};
