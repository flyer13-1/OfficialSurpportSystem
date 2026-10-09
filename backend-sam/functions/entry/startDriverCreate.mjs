import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, Tables, response } from "/opt/nodejs/dynamodb.js";
import { requireGeneralRace } from "/opt/nodejs/raceToken.js";
import { requireGeneralUser } from "/opt/nodejs/usersAccess.js";
import {
  isValidDriverLetter,
  hasDriverSlot,
  isPositiveInt,
} from "/opt/nodejs/entryAccess.js";
import { findUnassignedCars } from "/opt/nodejs/pitAssignmentAccess.js";

/**
 * POST /entries/start-driver — スタートドライバー登録（一般利用者向け）
 * IF設計書: doc/aws-sam/admin/v2/03_race_data.md §3.6
 *
 * 担当エリア内の車両に限り、未登録のスタートドライバーを登録する。
 * 既に登録済みなら409。変更は PUT /entries/start-driver（startDriverUpdate.mjs）。
 * raceId は X-Race-Id（raceId トークン）で受け取る。
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
        new PutCommand({
          TableName: Tables.startDriver,
          Item: {
            race_id: raceId,
            car_num: carNum,
            driver:  driver.toUpperCase(),
          },
          ConditionExpression: "attribute_not_exists(car_num)",
        })
      );
    } catch (err) {
      if (err.name === "ConditionalCheckFailedException") {
        return response(409, { msg: "スタートドライバーは既に登録されています" });
      }
      throw err;
    }

    return response(200, { msg: "" });
  } catch (err) {
    console.error("start_driver create (general) error:", err);
    return response(500, { msg: "サーバーエラーが発生しました" });
  }
};
