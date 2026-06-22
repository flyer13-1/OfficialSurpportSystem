import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, Tables, response } from "/opt/nodejs/dynamodb.js";
import { requireAdmin } from "/opt/nodejs/admin.js";

/**
 * GET /race — レース一覧取得（管理者画面）
 * IF設計書: doc/IF/admin/race.md
 */
export const handler = async (event) => {
  try {
    const auth = await requireAdmin(event);
    if (auth.error) return auth.error;

    const result = await docClient.send(
      new ScanCommand({ TableName: Tables.race })
    );

    const races = (result.Items || [])
      .map((it) => ({
        raceId:  it.id,
        title:   it.title,
        todayId: it.today_id,
      }))
      .sort((a, b) => String(a.raceId).localeCompare(String(b.raceId)));

    return response(200, { msg: "", races });
  } catch (err) {
    console.error("race list error:", err);
    return response(500, { msg: "サーバーエラーが発生しました" });
  }
};
