import { QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { docClient, Tables, response } from "/opt/nodejs/dynamodb.js";
import { requireAdmin } from "/opt/nodejs/admin.js";
import { raceStatus } from "/opt/nodejs/raceStatus.js";

/**
 * GET /race — レース一覧取得（管理者画面）
 * IF設計書: doc/aws-sam/admin/v2/02_race.md §3
 *
 * 自分のサーキットの race を、終了済みも含めて返す（01章§5.1）。
 * `status` はDBに保存せず、呼ばれるたびにその場で計算する（02章§3）。
 */
export const handler = async (event) => {
  try {
    const auth = await requireAdmin(event);
    if (auth.error) return auth.error;

    // OrganizationIndex: HASH organization_id / RANGE finish_date。
    // ScanIndexForward: false で終了日の新しい順に返す（02章§3の並び順）。
    const result = await docClient.send(
      new QueryCommand({
        TableName:                 Tables.race,
        IndexName:                 "OrganizationIndex",
        KeyConditionExpression:    "organization_id = :circuit",
        ExpressionAttributeValues: { ":circuit": auth.circuit },
        ScanIndexForward:          false,
      })
    );

    const races = (result.Items || []).map((it) => {
      const status = raceStatus(it.finish_date);
      return {
        raceId:     it.id,
        title:      it.title,
        finishDate: it.finish_date,
        status,
        // 終了済みは大会IDを返さない（02章§3）
        ...(status === "finished" ? {} : { todayId: it.today_id }),
      };
    });

    // 登録時の担当者候補（pit_assignment の担当者名）。全サーキット分を返し、絞り込みは画面側で行う
    const usersResult = await docClient.send(new ScanCommand({ TableName: Tables.users }));
    const users = (usersResult.Items || []).map((u) => ({
      username:       u.username,
      organizationId: u.organization_id,
    }));

    return response(200, { msg: "", races, users });
  } catch (err) {
    console.error("race list error:", err);
    return response(500, { msg: "サーバーエラーが発生しました" });
  }
};
