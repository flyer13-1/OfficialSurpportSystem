import { BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, Tables, response, getRaceIdHeader } from "/opt/nodejs/dynamodb.js";
import { requireAdmin } from "/opt/nodejs/admin.js";
import { requireRace } from "/opt/nodejs/raceAccess.js";
import { isRegisteredUsername } from "/opt/nodejs/usersAccess.js";
import { getEntryAreaNumbers, overlapsEntryAreas } from "/opt/nodejs/pitAssignmentAccess.js";

/**
 * POST /admin/pit-assignment/bulk — 担当割り当て一括登録
 * IF設計書: doc/aws-sam/admin/v2/03_race_data.md §4.3
 * 現状はAPIが全く無かったため新設（旧 admin.js は api: null のまま）。
 */
export const handler = async (event) => {
  try {
    const auth = await requireAdmin(event);
    if (auth.error) return auth.error;

    const raceId = getRaceIdHeader(event);
    const { error } = await requireRace(raceId, auth.circuit, { write: true });
    if (error) return error;

    const body = JSON.parse(event.body || "{}");
    const assignments = body.assignments;

    if (!Array.isArray(assignments) || assignments.length === 0) {
      return response(400, { msg: "未入力の項目があります" });
    }

    // ── リクエスト内の username#maintenanceArea 重複確認 ──
    const skValues = assignments.map((a) => `${a.username}#${a.maintenanceArea}`);
    if (new Set(skValues).size !== skValues.length) {
      return response(400, { msg: "ファイル内に重複する担当割当があります" });
    }

    // ── username が登録済み利用者か（重複を避けて一意分だけ確認） ──
    const uniqueUsernames = [...new Set(assignments.map((a) => a.username))];
    const registeredFlags = await Promise.all(
      uniqueUsernames.map((u) => isRegisteredUsername(u))
    );
    const registeredSet = new Set(
      uniqueUsernames.filter((_, i) => registeredFlags[i])
    );
    if (assignments.some((a) => !registeredSet.has(a.username))) {
      return response(400, { msg: "登録済みの監視員を指定してください" });
    }

    // ── maintenanceArea が当該raceのentryに存在するか ──
    const entryAreaNumbers = await getEntryAreaNumbers(raceId);
    if (assignments.some((a) => !overlapsEntryAreas(a.maintenanceArea, entryAreaNumbers))) {
      return response(400, { msg: "存在しないピット場所です" });
    }

    // ── BatchWriteItem は1リクエスト25件まで ──
    for (let i = 0; i < assignments.length; i += 25) {
      const chunk = assignments.slice(i, i + 25);
      await docClient.send(
        new BatchWriteCommand({
          RequestItems: {
            [Tables.pitAssignment]: chunk.map((a) => ({
              PutRequest: {
                Item: {
                  race_id:                     raceId,
                  "username#maintenance_area": `${a.username}#${a.maintenanceArea}`,
                  username:                    a.username,
                  maintenance_area:            String(a.maintenanceArea),
                },
              },
            })),
          },
        })
      );
    }

    return response(200, { msg: "", count: assignments.length });
  } catch (err) {
    console.error("pit_assignment bulk error:", err);
    return response(500, { msg: "サーバーエラーが発生しました" });
  }
};
