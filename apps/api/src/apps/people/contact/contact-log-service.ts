// 連絡の記録と、次にやることを終える（specs/people/002-sales-list plan.md 3、FR-104・FR-106）。
import { jstDate, type ContactChannel, type ContactLog } from "@meguru/shared/people";
import { and, desc, eq } from "drizzle-orm";
import { withTransaction } from "../../../kernel/db/client";
import type { Env } from "../../../kernel/env";
import { AppError, itemNotFound } from "../../../kernel/errors";
import { isUuid } from "../../../kernel/validate";
import { loadOwnedPerson, lockActiveOwner, lockOwner, type PeopleDb } from "../access";
import { peopleContactLogs, peoplePersons } from "../schema";

/**
 * 記録の行を返りの形にする。
 * @param r - 行
 * @returns 連絡の記録
 */
function toLog(r: typeof peopleContactLogs.$inferSelect): ContactLog {
  return { id: r.id, contactedOn: r.contactedOn, channel: r.channel as ContactChannel, note: r.note, createdAt: r.createdAt.toISOString() };
}

/**
 * 人の連絡の記録（新しい順）。
 * @param db - データベース
 * @param userId - 作り手
 * @param personId - 人
 * @returns 記録
 */
export async function contactLogsOf(db: PeopleDb, userId: string, personId: string): Promise<ContactLog[]> {
  const rows = await db
    .select()
    .from(peopleContactLogs)
    .where(and(eq(peopleContactLogs.personId, personId), eq(peopleContactLogs.userId, userId)))
    .orderBy(desc(peopleContactLogs.contactedOn), desc(peopleContactLogs.createdAt), desc(peopleContactLogs.id));
  return rows.map(toLog);
}

/**
 * 記録を足す。
 * @param env - Workers のバインディング
 * @param userId - 作り手
 * @param personId - 人
 * @param input - 日付・何で・内容
 * @returns 記録
 */
export async function addContactLog(env: Env, userId: string, personId: string, input: { contactedOn: string; channel: ContactChannel; note: string }): Promise<ContactLog> {
  return withTransaction(env.DATABASE_URL, async (tx) => {
    await lockActiveOwner(tx, env, userId);
    const p = await loadOwnedPerson(tx, userId, personId);
    const [row] = await tx
      .insert(peopleContactLogs)
      .values({ userId, personId: p.id, ...input })
      .returning();
    return toLog(row!);
  });
}

/**
 * 作り手の記録を読む。ない・ほかの作り手のものなら 404。
 * @param db - データベース
 * @param userId - 作り手
 * @param logId - 記録
 * @returns 記録の行
 */
async function loadOwnedLog(db: PeopleDb, userId: string, logId: string) {
  if (!isUuid(logId)) throw itemNotFound();
  const [row] = await db
    .select()
    .from(peopleContactLogs)
    .where(and(eq(peopleContactLogs.id, logId), eq(peopleContactLogs.userId, userId)));
  if (!row) throw itemNotFound();
  return row;
}

/**
 * 記録を直す。
 * @param env - Workers のバインディング
 * @param userId - 作り手
 * @param logId - 記録
 * @param input - 直す項目
 * @returns 記録
 */
export async function updateContactLog(env: Env, userId: string, logId: string, input: { contactedOn?: string; channel?: ContactChannel; note?: string }): Promise<ContactLog> {
  return withTransaction(env.DATABASE_URL, async (tx) => {
    await lockOwner(tx, userId);
    const log = await loadOwnedLog(tx, userId, logId);
    const [row] = await tx
      .update(peopleContactLogs)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(peopleContactLogs.id, log.id))
      .returning();
    return toLog(row!);
  });
}

/**
 * 記録を消す。
 * @param env - Workers のバインディング
 * @param userId - 作り手
 * @param logId - 記録
 */
export async function deleteContactLog(env: Env, userId: string, logId: string): Promise<void> {
  await withTransaction(env.DATABASE_URL, async (tx) => {
    await lockOwner(tx, userId);
    const log = await loadOwnedLog(tx, userId, logId);
    await tx.delete(peopleContactLogs).where(eq(peopleContactLogs.id, log.id));
  });
}

/**
 * 次にやることを終える：消して、log なら連絡の記録に「やったこと」（channel: done・今日の日付）として写す。次にやることがなければ 400。
 * @param env - Workers のバインディング
 * @param userId - 作り手
 * @param personId - 人
 * @param log - 記録に写すか
 */
export async function finishNextAction(env: Env, userId: string, personId: string, log: boolean): Promise<void> {
  await withTransaction(env.DATABASE_URL, async (tx) => {
    await lockOwner(tx, userId);
    const p = await loadOwnedPerson(tx, userId, personId);
    if (!p.nextActionOn || !p.nextActionNote) throw new AppError("VALIDATION_FAILED", 400, "invalid request", undefined, ["nextAction"]);
    if (log) await tx.insert(peopleContactLogs).values({ userId, personId: p.id, contactedOn: jstDate(new Date()), channel: "done", note: p.nextActionNote });
    await tx
      .update(peoplePersons)
      .set({ nextActionOn: null, nextActionNote: null, updatedAt: new Date() })
      .where(and(eq(peoplePersons.id, p.id), eq(peoplePersons.userId, userId)));
  });
}
