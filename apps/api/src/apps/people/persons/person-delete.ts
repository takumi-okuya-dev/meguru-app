// 参加者の求めで、その人の記録を全部消す（数は残す。specs/people/001-people-memo contracts/api.md 4、research.md R13、tasks.md T067）。
// 消した人の名前・LINE名・答えは、どの表にも残さない（erased_* はイベントの番号・取り込みの番号・ハッシュ・時刻だけ）。ログにも名前を出さない。
import { nameKey } from "@meguru/shared/people";
import { and, eq, sql } from "drizzle-orm";
import { createDb, withTransaction } from "../../../kernel/db/client";
import type { Env } from "../../../kernel/env";
import { AppError } from "../../../kernel/errors";
import { displayNameOf, loadOwnedPerson, lockOwner } from "../access";
import { peopleErasedAttendances, peopleErasedResponses, peopleImports, peopleManualAttendances, peoplePersons, peopleResponses } from "../schema";
import { reportPeopleUsage } from "../usage";

/**
 * 人を消す。confirmName が表示名と nameKey で違えば 400 CONFIRMATION_MISMATCH（何も消さない）。
 * @param env - Workers のバインディング
 * @param userId - 作り手
 * @param personId - 人
 * @param confirmName - 画面で入れた名前
 */
export async function deletePerson(env: Env, userId: string, personId: string, confirmName: string): Promise<void> {
  await withTransaction(env.DATABASE_URL, async (tx) => {
    await lockOwner(tx, userId);
    const p = await loadOwnedPerson(tx, userId, personId);
    if (nameKey(confirmName) !== nameKey(displayNameOf(p))) throw new AppError("CONFIRMATION_MISMATCH", 400, "confirmation does not match");
    // ① 来たイベントごとに1行（回答があれば、その会のいちばん古い取り込みの番号。手で足しただけなら空）
    await tx.execute(sql`INSERT INTO ${peopleErasedAttendances} (user_id, event_id, import_id)
      SELECT ${userId}::uuid, a.event_id, a.import_id FROM (
        SELECT DISTINCT ON (r.event_id) r.event_id, r.import_id
        FROM ${peopleResponses} r JOIN ${peopleImports} i ON i.id = r.import_id
        WHERE r.person_id = ${p.id} AND r.user_id = ${userId}
        ORDER BY r.event_id, i.created_at
      ) a
      UNION ALL
      SELECT ${userId}::uuid, m.event_id, NULL::uuid FROM ${peopleManualAttendances} m
      WHERE m.person_id = ${p.id} AND m.user_id = ${userId}
        AND NOT EXISTS (SELECT 1 FROM ${peopleResponses} r WHERE r.person_id = m.person_id AND r.event_id = m.event_id)`);
    // ② 回答の印（ハッシュだけ）を残す（同じCSVの上げ直しで戻さない）
    await tx.execute(sql`INSERT INTO ${peopleErasedResponses} (event_id, dedupe_hash, user_id)
      SELECT r.event_id, r.dedupe_hash, r.user_id FROM ${peopleResponses} r WHERE r.person_id = ${p.id} AND r.user_id = ${userId}
      ON CONFLICT DO NOTHING`);
    // ③ 人を消す（回答・手で足した会ったイベント・同意の記録・声かけは外部キーで一緒に消える）
    await tx.delete(peoplePersons).where(and(eq(peoplePersons.id, p.id), eq(peoplePersons.userId, userId)));
  });
  await reportPeopleUsage(createDb(env.DATABASE_URL), userId);
}
