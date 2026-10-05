// 投稿の設定（specs/005-auto-post research.md R1、contracts/api.md「GET・PUT /posting-schedule」）。
// 自動投稿は全プランで使えるので、grower機能は判定しない（FR-004）。
import { minutesToTime, type AutoPostState, type PostingSchedule } from "@threads-grower/shared";
import { eq } from "drizzle-orm";
import type { Db, TxDb } from "../db/client";
import { postingSchedules } from "../db/schema";
import type { AccountRow } from "./access";

/** posting_schedules の行。 */
export type PostingScheduleRow = typeof postingSchedules.$inferSelect;

/**
 * そのAccountの投稿の設定の行を読む。
 * @param db - データベース
 * @param accountId - accounts.id
 * @returns 行。最初の保存の前は null
 */
export async function readPostingSchedule(db: Db | TxDb, accountId: string): Promise<PostingScheduleRow | null> {
  const [row] = await db.select().from(postingSchedules).where(eq(postingSchedules.accountId, accountId)).limit(1);
  return row ?? null;
}

/**
 * 行を、レスポンスの PostingSchedule にする。行がなければ既定値（オフ・時刻なし・ずらす・version 0）。
 * @param row - posting_schedules の行
 * @returns PostingSchedule
 */
export function toPostingSchedule(row: PostingScheduleRow | null): PostingSchedule {
  if (!row) return { enabled: false, slotTimes: [], jitter: true, version: 0 };
  return { enabled: row.enabled, slotTimes: row.slotMinutes.map(minutesToTime), jitter: row.jitter, version: row.version };
}

/**
 * 自動投稿の状態（オン・オフ、時刻の数、止まっている理由）。
 * @param account - Account の行（接続の状態）
 * @param row - posting_schedules の行
 * @param now - 今の時刻
 * @returns AutoPostState
 */
export function toAutoPostState(account: Pick<AccountRow, "connectionStatus">, row: PostingScheduleRow | null, now: Date): AutoPostState {
  const enabled = row?.enabled ?? false;
  let stoppedReason: AutoPostState["stoppedReason"] = null;
  if (enabled && account.connectionStatus === "needs_reconnect") stoppedReason = "needs_reconnect";
  else if (enabled && row?.pausedUntil && row.pausedUntil.getTime() > now.getTime()) stoppedReason = "rate_limited";
  return { enabled, slotCount: row?.slotMinutes.length ?? 0, stoppedReason };
}
