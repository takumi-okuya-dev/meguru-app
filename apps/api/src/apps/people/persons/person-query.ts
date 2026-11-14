// 人の問い合わせの部品（specs/people/001-people-memo research.md R10・R12・R22、tasks.md T051）。
// 来た記録・最後に会った日・自分の会の回数・いちばん新しい回答を1か所で決め、人の一覧・誘う候補（PR3）・数字（PR3）で使い回す。
import { sql, type SQL } from "drizzle-orm";
import { peopleEvents, peopleManualAttendances, peopleResponses } from "../schema";

/**
 * 来た記録（人とイベントの組。回答 ∪ 手で足した会ったイベント。重なりは1つ。R12）。列は person_id・event_id。
 * @param userId - 作り手
 * @returns 副問い合わせ
 */
export function attendanceSql(userId: string): SQL {
  return sql`SELECT r.person_id, r.event_id FROM ${peopleResponses} r WHERE r.user_id = ${userId}
    UNION SELECT m.person_id, m.event_id FROM ${peopleManualAttendances} m WHERE m.user_id = ${userId}`;
}

/**
 * 人ごとの最後に会った日・初めて会った日・自分の会の回数（R12）。列は person_id・last_met_on・first_met_on・own_count。
 * @param userId - 作り手
 * @param attendance - もう組んだ来た記録の CTE の名前（省くと、ここで組む）
 * @returns 副問い合わせ
 */
export function personStatsSql(userId: string, attendance?: SQL): SQL {
  const from = attendance ?? sql`(${attendanceSql(userId)})`;
  return sql`SELECT a.person_id, max(e.held_on) AS last_met_on, min(e.held_on) AS first_met_on, (count(*) FILTER (WHERE e.is_own))::int AS own_count
    FROM ${from} a JOIN ${peopleEvents} e ON e.id = a.event_id GROUP BY a.person_id`;
}

/**
 * 人ごとのいちばん新しい回答（開催日 → 回答の時刻（ないものは古い）→ 取り込んだ時刻 → 番号の順。person-derive.ts の newerResponse と同じ順。R10）。
 * 列は person_id・next_attendance・wanted_connections・career_interests。
 * @param userId - 作り手
 * @returns 副問い合わせ
 */
export function latestResponseSql(userId: string): SQL {
  return sql`SELECT DISTINCT ON (r.person_id) r.person_id, r.next_attendance, r.wanted_connections, r.career_interests
    FROM ${peopleResponses} r JOIN ${peopleEvents} e ON e.id = r.event_id
    WHERE r.user_id = ${userId}
    ORDER BY r.person_id, e.held_on DESC, r.submitted_at DESC NULLS LAST, r.created_at DESC, r.id DESC`;
}

/**
 * LIKE の部分一致の形にする（`%`・`_`・`\` を逃がす。R22）。
 * @param s - 探す言葉
 * @returns `%…%`
 */
export function likePattern(s: string): string {
  return `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
