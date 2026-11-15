// Threads のイベントの候補を見せる・確かめる（specs/people/003-threads-event-candidates plan.md API、FR-004・FR-005）。
// 見せるのは、その宣伝内容のアカウントの持ち主（作り手）だけ。消された候補は見せない。
import { jstDate, type PeopleThreadsCandidate } from "@meguru/shared/people";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { AppError } from "../../../kernel/errors";
import type { PeopleDb } from "../access";
import { peopleEvents, peopleThreadsEventCandidates } from "../schema";

/**
 * 候補の並び：今日（日本時間）からのものを開始の早い順に、そのあとに過ぎたものを新しい順に。
 * @param list - 候補
 * @param now - 今
 * @returns 並べた候補
 */
export function sortByNearest<T extends { startsAt: string }>(list: T[], now: Date): T[] {
  const today = jstDate(now);
  const day = (c: T) => jstDate(new Date(c.startsAt));
  const time = (c: T) => new Date(c.startsAt).getTime();
  const upcoming = list.filter((c) => day(c) >= today).sort((a, b) => time(a) - time(b));
  const past = list.filter((c) => day(c) < today).sort((a, b) => time(b) - time(a));
  return [...upcoming, ...past];
}

/**
 * 作り手に見せる候補。この候補から作ったイベントがあれば、その番号を添える。
 * @param db - データベース
 * @param userId - 作り手
 * @param now - 今（並びの基準）
 * @returns 候補
 */
export async function listCandidates(db: PeopleDb, userId: string, now: Date): Promise<PeopleThreadsCandidate[]> {
  const rows = await db
    .select()
    .from(peopleThreadsEventCandidates)
    .where(and(eq(peopleThreadsEventCandidates.userId, userId), isNull(peopleThreadsEventCandidates.deletedAt)));
  const used =
    rows.length === 0
      ? []
      : await db
          .select({ id: peopleEvents.id, promotionId: peopleEvents.sourceThreadsPromotionId })
          .from(peopleEvents)
          .where(and(eq(peopleEvents.userId, userId), inArray(peopleEvents.sourceThreadsPromotionId, rows.map((r) => r.promotionId))));
  const eventOf = new Map(used.map((u) => [u.promotionId, u.id]));
  return sortByNearest(
    rows.map((r) => ({ promotionId: r.promotionId, name: r.name, startsAt: r.startsAt.toISOString(), usedByEventId: eventOf.get(r.promotionId) ?? null })),
    now,
  );
}

/**
 * イベントを作るときの元の宣伝内容が、その作り手の消されていない候補かを確かめる（ほかの人の番号を付けさせない）。
 * @param db - データベース（トランザクションの中でもよい）
 * @param userId - 作り手
 * @param promotionId - 元の宣伝内容の番号
 * @throws AppError VALIDATION_FAILED
 */
export async function assertOwnCandidate(db: PeopleDb, userId: string, promotionId: string): Promise<void> {
  const [row] = await db
    .select({ id: peopleThreadsEventCandidates.promotionId })
    .from(peopleThreadsEventCandidates)
    .where(
      and(
        eq(peopleThreadsEventCandidates.promotionId, promotionId),
        eq(peopleThreadsEventCandidates.userId, userId),
        isNull(peopleThreadsEventCandidates.deletedAt),
      ),
    )
    .limit(1);
  if (!row) throw new AppError("VALIDATION_FAILED", 400, "unknown threads promotion", undefined, ["sourceThreadsPromotionId"]);
}
