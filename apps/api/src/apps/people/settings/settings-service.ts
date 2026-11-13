// 作り手の設定と数字（specs/people/001-people-memo contracts/api.md 6、research.md R12・R17、tasks.md T078・T085）。
import { jstDate, type PeopleSettings, type PeopleStats } from "@meguru/shared/people";
import { and, asc, eq, gte, sql } from "drizzle-orm";
import type { Db } from "../../../kernel/db/client";
import { peopleEvents, peopleOwnerSettings } from "../schema";
import { personStatsSql } from "../persons/person-query";
import { toEvent } from "../events/event-service";

/**
 * 設定を読む（まだなければ両方 null）。
 * @param db - データベース
 * @param userId - 作り手
 * @returns 設定
 */
export async function getSettings(db: Db, userId: string): Promise<PeopleSettings> {
  const [row] = await db.select().from(peopleOwnerSettings).where(eq(peopleOwnerSettings.userId, userId));
  return { inviteTemplate: row?.inviteTemplate ?? null, repeaterGoal: row?.repeaterGoal ?? null };
}

/**
 * 設定を直す（渡した項目だけ）。
 * @param db - データベース
 * @param userId - 作り手
 * @param input - 誘いの文の型（null は初めの型）・リピーターの目標
 * @returns 直したあとの設定
 */
export async function updateSettings(db: Db, userId: string, input: { inviteTemplate?: string | null; repeaterGoal?: number | null }): Promise<PeopleSettings> {
  const set: Partial<typeof peopleOwnerSettings.$inferInsert> = { updatedAt: new Date() };
  if (input.inviteTemplate !== undefined) set.inviteTemplate = input.inviteTemplate;
  if (input.repeaterGoal !== undefined) set.repeaterGoal = input.repeaterGoal;
  await db
    .insert(peopleOwnerSettings)
    .values({ userId, ...set })
    .onConflictDoUpdate({ target: peopleOwnerSettings.userId, set });
  return getSettings(db, userId);
}

/**
 * ホームの上の段の数字：リピーター（自分の会に2回以上来た人）の数と目標、今日以降でいちばん近い自分の会（R12・R17）。
 * @param db - データベース
 * @param userId - 作り手
 * @param now - 今の時刻
 * @returns 数字
 */
export async function getStats(db: Db, userId: string, now = new Date()): Promise<PeopleStats> {
  const [repeaters, [next], settings] = await Promise.all([
    db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM (${personStatsSql(userId)}) s WHERE s.own_count >= 2`),
    db
      .select()
      .from(peopleEvents)
      .where(and(eq(peopleEvents.userId, userId), eq(peopleEvents.isOwn, true), gte(peopleEvents.heldOn, jstDate(now))))
      .orderBy(asc(peopleEvents.heldOn), asc(peopleEvents.createdAt))
      .limit(1),
    getSettings(db, userId),
  ]);
  return { repeaterCount: Number(repeaters.rows[0]?.n ?? 0), repeaterGoal: settings.repeaterGoal, nextOwnEvent: next ? toEvent(next) : null };
}
