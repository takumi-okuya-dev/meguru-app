// Threads のイベントの候補を見せる（specs/collect/001-event-day-collection contracts/api.md 7、FR-061・FR-062・FR-064、research.md R15、tasks.md T077）。
// 見せるのは、そのThreadsのアカウントの持ち主（owner_user_id）だけ。消された候補は見せない。
import type { CollectMedia, ThreadsCandidate } from "@meguru/shared";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Db, TxDb } from "../../../kernel/db/client";
import { AppError } from "../../../kernel/errors";
import { sortByNearest } from "../events/event-service";
import { collectEvents, collectThreadsEventCandidates } from "../schema";

/**
 * 主催者に見せる候補（開催日時の近い順。過ぎたものは後ろ）。この候補から作ったイベントがあれば、その番号を添える。
 * @param db - データベース
 * @param ownerUserId - 主催者
 * @param now - 今（並びの基準）
 * @returns 候補
 */
export async function listCandidates(db: Db, ownerUserId: string, now: Date): Promise<ThreadsCandidate[]> {
  const rows = await db
    .select()
    .from(collectThreadsEventCandidates)
    .where(and(eq(collectThreadsEventCandidates.ownerUserId, ownerUserId), isNull(collectThreadsEventCandidates.deletedAt)));
  const used =
    rows.length === 0
      ? []
      : await db
          .select({ id: collectEvents.id, promotionId: collectEvents.sourceThreadsPromotionId })
          .from(collectEvents)
          .where(and(eq(collectEvents.ownerUserId, ownerUserId), inArray(collectEvents.sourceThreadsPromotionId, rows.map((r) => r.promotionId))));
  const eventOf = new Map(used.map((u) => [u.promotionId, u.id]));
  return sortByNearest(
    rows.map((r) => ({
      promotionId: r.promotionId,
      name: r.name,
      startsAt: r.startsAt.toISOString(),
      endsAt: r.endsAt?.toISOString() ?? null,
      venue: r.venue,
      capacity: r.capacity,
      feeAmount: r.feeAmount,
      feeNote: r.feeNote,
      postedMedia: r.postedMedia as CollectMedia[],
      usedByEventId: eventOf.get(r.promotionId) ?? null,
    })),
    now,
  );
}

/**
 * イベントを作るときの元の宣伝内容が、その主催者に見せている候補かを確かめる（ほかの人の宣伝内容の番号を付けさせない）。
 * @param db - データベース（トランザクションの中でもよい）
 * @param ownerUserId - 主催者
 * @param promotionId - 元の宣伝内容の番号
 * @throws AppError VALIDATION_FAILED
 */
export async function assertOwnCandidate(db: Db | TxDb, ownerUserId: string, promotionId: string): Promise<void> {
  const [row] = await db
    .select({ id: collectThreadsEventCandidates.promotionId })
    .from(collectThreadsEventCandidates)
    .where(and(eq(collectThreadsEventCandidates.promotionId, promotionId), eq(collectThreadsEventCandidates.ownerUserId, ownerUserId)))
    .limit(1);
  if (!row) throw new AppError("VALIDATION_FAILED", 400, "unknown threads promotion", undefined, ["sourceThreadsPromotionId"]);
}

/**
 * Threads から作ったイベントの、元の宣伝内容で掲載済みの媒体（FR-064）。
 * @param db - データベース
 * @param promotionId - 元の宣伝内容の番号
 * @returns 掲載済みの媒体（候補がなければ空）
 */
export async function postedMediaOf(db: Db, promotionId: string): Promise<CollectMedia[]> {
  const [row] = await db
    .select({ postedMedia: collectThreadsEventCandidates.postedMedia })
    .from(collectThreadsEventCandidates)
    .where(eq(collectThreadsEventCandidates.promotionId, promotionId))
    .limit(1);
  return (row?.postedMedia ?? []) as CollectMedia[];
}
