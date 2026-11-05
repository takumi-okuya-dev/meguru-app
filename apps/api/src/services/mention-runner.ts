// メンションの返信の段階（specs/023-delayed-mention contracts/mention-job.md 7-1〜7-4、research.md R2〜R6）。
// 005の runAutoPost の最後に呼ぶ。承認した返信の文は書き換えずに出し、出せないときは出さない（原則II）。
// 二重に出さないため、005の公開と同じく、公開を送る前にコンテナーのIDと publish_requested_at を保存する。
import {
  MENTION_EXPIRE_HOURS,
  MENTION_MAX_ATTEMPTS,
  MENTION_MAX_PER_TICK,
  MENTION_SAME_PERSON_HOURS,
  findNgWords,
  type MentionFailureReason,
} from "@threads-grower/shared";
import { and, eq, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { accounts, postDrafts, postMentions } from "../db/schema";
import type { Env } from "../env";
import { billingModeOf } from "../lib/config";
import { logger } from "../lib/logger";
import {
  ThreadsApiError,
  ThreadsAuthError,
  ThreadsPermissionError,
  ThreadsRateLimitError,
  ThreadsTransientError,
  type ThreadsClient,
} from "../lib/threads-client";
import { loadOwnerEntitlement } from "./billing-service";
import { ownerAutopostOn } from "./feature-sql";
import { listNgWords } from "./posting-rules-service";
import { loadThreadsCredentials, markNeedsReconnect } from "./threads-credentials";

const HOUR_MS = 3_600_000;
const LEASE_MS = 5 * 60_000;
const RETRY_STEP_MS = 5 * 60_000;

/** この段階の結果。 */
export type MentionStageResult = { sent: number; failed: number; waiting: number; remaining: boolean };

type Target = {
  m: typeof postMentions.$inferSelect;
  draft: { status: string; threadsMediaId: string | null; publishedAt: Date | null };
  repliesDeniedAt: Date | null;
};

// 返信の時刻（research.md R3）。投稿済みに付けたものは押した時刻、ほかは投稿の時刻＋時間差
const dueAtSql = sql`COALESCE(${postMentions.sendAfter}, ${postDrafts.publishedAt} + make_interval(mins => ${postMentions.delayMinutes}))`;

/**
 * メンションの返信の段階を1回行う。1件の失敗で全体を止めない。
 * @param env - Workers のバインディング
 * @param db - データベース
 * @param threads - Threads API のクライアント
 * @param opts - now：この回の時刻
 * @returns 出した・出せなかった・待った件数と、残りがあるか
 */
export async function runMentionStage(env: Env, db: Db, threads: ThreadsClient, opts: { now: Date }): Promise<MentionStageResult> {
  const { now } = opts;
  const result: MentionStageResult = { sent: 0, failed: 0, waiting: 0, remaining: false };
  const leaseToken = crypto.randomUUID();
  // 7-1. 対象を読み、借りる（同じ行を2つの回で同時に扱わない）
  const due = await db
    .select({ draftId: postMentions.draftId })
    .from(postMentions)
    .innerJoin(postDrafts, eq(postDrafts.id, postMentions.draftId))
    .where(
      and(
        eq(postMentions.state, "pending"),
        or(isNull(postMentions.leaseUntil), lt(postMentions.leaseUntil, now)),
        or(isNull(postMentions.nextAttemptAt), lt(postMentions.nextAttemptAt, now)),
        // 投稿の前（要確認・承認済み）は投稿の時刻がNULLなので、時刻も決まらず対象にならない
        sql`${dueAtSql} <= ${now.toISOString()}`,
      ),
    )
    .orderBy(dueAtSql)
    .limit(MENTION_MAX_PER_TICK + 1);
  result.remaining = due.length > MENTION_MAX_PER_TICK;
  for (const { draftId } of due.slice(0, MENTION_MAX_PER_TICK)) {
    const [leased] = await db
      .update(postMentions)
      .set({ leaseToken, leaseUntil: new Date(now.getTime() + LEASE_MS) })
      .where(
        and(
          eq(postMentions.draftId, draftId),
          eq(postMentions.state, "pending"),
          or(isNull(postMentions.leaseUntil), lt(postMentions.leaseUntil, now)),
        ),
      )
      .returning();
    if (!leased) continue;
    try {
      const outcome = await handleOne(env, db, threads, leased, leaseToken, now);
      result[outcome] += 1;
    } catch (err) {
      logger.error("mention: reply failed", { err });
      await release(db, draftId, leaseToken);
    }
  }
  if (result.sent > 0) logger.info("mention: sent", { count: result.sent });
  if (result.failed > 0) logger.info("mention: failed", { count: result.failed });
  return result;
}

/**
 * 借りを返す（待つ）。
 * @param db - データベース
 * @param draftId - post_mentions.draft_id
 * @param leaseToken - この回の借り
 */
async function release(db: Db, draftId: string, leaseToken: string) {
  await db
    .update(postMentions)
    .set({ leaseToken: null, leaseUntil: null })
    .where(and(eq(postMentions.draftId, draftId), eq(postMentions.leaseToken, leaseToken)));
}

/**
 * 出せなかったことにする。
 * @param db - データベース
 * @param draftId - post_mentions.draft_id
 * @param leaseToken - この回の借り
 * @param reason - 理由
 * @param now - 今
 * @returns "failed"
 */
async function fail(db: Db, draftId: string, leaseToken: string, reason: MentionFailureReason, now: Date) {
  await db
    .update(postMentions)
    .set({ state: "failed", failureReason: reason, leaseToken: null, leaseUntil: null, updatedAt: now })
    .where(and(eq(postMentions.draftId, draftId), eq(postMentions.leaseToken, leaseToken)));
  return "failed" as const;
}

/**
 * 1件を扱う（7-2・7-3）。
 * @param env - Workers のバインディング
 * @param db - データベース
 * @param threads - Threads API のクライアント
 * @param m - 借りた行
 * @param leaseToken - この回の借り
 * @param now - 今
 * @returns 結果
 */
async function handleOne(
  env: Env,
  db: Db,
  threads: ThreadsClient,
  m: typeof postMentions.$inferSelect,
  leaseToken: string,
  now: Date,
): Promise<"sent" | "failed" | "waiting"> {
  const [row] = await db
    .select({ status: postDrafts.status, threadsMediaId: postDrafts.threadsMediaId, publishedAt: postDrafts.publishedAt, repliesDeniedAt: accounts.repliesDeniedAt })
    .from(postDrafts)
    .innerJoin(accounts, eq(accounts.id, postDrafts.accountId))
    .where(eq(postDrafts.id, m.draftId));
  if (!row) return fail(db, m.draftId, leaseToken, "post_failed", now);
  const t: Target = { m, draft: row, repliesDeniedAt: row.repliesDeniedAt };

  // 7-2. 出す前の判定
  if (t.draft.status !== "published" || !t.draft.threadsMediaId) return fail(db, m.draftId, leaseToken, "post_failed", now);
  const start = m.sendAfter ?? t.draft.publishedAt!;
  // 結果の分からない公開の途中なら、時間を過ぎても確かめる（二重に出さない）
  if (!m.publishRequestedAt && now.getTime() - start.getTime() > MENTION_EXPIRE_HOURS * HOUR_MS)
    return fail(db, m.draftId, leaseToken, "expired", now);
  if (t.repliesDeniedAt && !m.publishRequestedAt) return fail(db, m.draftId, leaseToken, "no_permission", now);
  const cred = await loadThreadsCredentials(env, db, m.accountId);
  if (!cred || cred.connectionStatus !== "connected" || !cred.token || cred.threadsUserId === null) {
    await release(db, m.draftId, leaseToken);
    return "waiting";
  }
  if (!m.publishRequestedAt) {
    const owner = await loadOwnerEntitlement(db, m.accountId, billingModeOf(env), now);
    if ((owner && !owner.fullAccess) || !(await ownerAutopostOn(db, m.accountId))) {
      await release(db, m.draftId, leaseToken);
      return "waiting";
    }
    // 出す直前のNGワード（原則I）
    if (findNgWords(m.text, await listNgWords(db, m.accountId)).length > 0) return fail(db, m.draftId, leaseToken, "ng_word", now);
    // 同じ人の24時間（research.md R6）。当たれば文を書き換えずに出さない（原則II）
    const since = new Date(now.getTime() - MENTION_SAME_PERSON_HOURS * HOUR_MS);
    const [recent] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(postMentions)
      .where(
        and(
          eq(postMentions.accountId, m.accountId),
          ne(postMentions.draftId, m.draftId),
          eq(postMentions.state, "sent"),
          sql`${postMentions.sentAt} > ${since.toISOString()}`,
          sql`${postMentions.usernames} && ${sql.param(m.usernames)}::text[]`,
        ),
      );
    if ((recent?.n ?? 0) > 0) return fail(db, m.draftId, leaseToken, "limit", now);
  }

  // 7-3. 出す
  const token = cred.token;
  const userId = cred.threadsUserId;
  try {
    let containerId = m.containerId;
    if (m.publishRequestedAt && containerId) {
      // 前の回で公開を送ったが、結果が分からない。状態を確かめる
      const { status } = await threads.getContainerStatus(token, containerId);
      if (status === "PUBLISHED") return markSent(db, m.draftId, leaseToken, null, now);
      if (status === "ERROR" || status === "EXPIRED") {
        await db
          .update(postMentions)
          .set({ containerId: null, publishRequestedAt: null })
          .where(and(eq(postMentions.draftId, m.draftId), eq(postMentions.leaseToken, leaseToken)));
        containerId = null;
      }
      if (status === "IN_PROGRESS") {
        await release(db, m.draftId, leaseToken);
        return "waiting";
      }
    }
    if (!containerId) {
      ({ containerId } = await threads.createTextContainer(token, userId, m.text, { replyToId: t.draft.threadsMediaId }));
      await db
        .update(postMentions)
        .set({ containerId })
        .where(and(eq(postMentions.draftId, m.draftId), eq(postMentions.leaseToken, leaseToken)));
    }
    await db
      .update(postMentions)
      .set({ publishRequestedAt: now })
      .where(and(eq(postMentions.draftId, m.draftId), eq(postMentions.leaseToken, leaseToken)));
    const { mediaId } = await threads.publishContainer(token, userId, containerId);
    return markSent(db, m.draftId, leaseToken, mediaId, now);
  } catch (err) {
    if (err instanceof ThreadsAuthError) {
      await markNeedsReconnect(db, m.accountId, cred.generation);
      await release(db, m.draftId, leaseToken);
      return "waiting";
    }
    if (err instanceof ThreadsPermissionError) {
      await db.update(accounts).set({ repliesDeniedAt: now }).where(eq(accounts.id, m.accountId));
      return fail(db, m.draftId, leaseToken, "no_permission", now);
    }
    if (err instanceof ThreadsTransientError || err instanceof ThreadsRateLimitError || !(err instanceof ThreadsApiError)) {
      // 一時的な失敗。公開を送ったあとなら、次の回に確かめる（やり直しの回数に数えない）
      const [cur] = await db.select().from(postMentions).where(eq(postMentions.draftId, m.draftId));
      if (cur?.publishRequestedAt) {
        await release(db, m.draftId, leaseToken);
        return "waiting";
      }
      const attempts = m.attempts + 1;
      if (attempts >= MENTION_MAX_ATTEMPTS) return fail(db, m.draftId, leaseToken, "error", now);
      await db
        .update(postMentions)
        .set({ attempts, nextAttemptAt: new Date(now.getTime() + RETRY_STEP_MS * attempts), leaseToken: null, leaseUntil: null })
        .where(and(eq(postMentions.draftId, m.draftId), eq(postMentions.leaseToken, leaseToken)));
      return "waiting";
    }
    // 確かな失敗（4xx）。返信先の投稿が見つからない・受け付けられない
    return fail(db, m.draftId, leaseToken, m.containerId ? "error" : "not_found", now);
  }
}

/**
 * 出したことにする。
 * @param db - データベース
 * @param draftId - post_mentions.draft_id
 * @param leaseToken - この回の借り
 * @param mediaId - 返信のid（分からなければ null）
 * @param now - 今
 * @returns "sent"
 */
async function markSent(db: Db, draftId: string, leaseToken: string, mediaId: string | null, now: Date) {
  await db
    .update(postMentions)
    .set({ state: "sent", sentAt: now, replyMediaId: mediaId, leaseToken: null, leaseUntil: null, updatedAt: now })
    .where(and(eq(postMentions.draftId, draftId), eq(postMentions.leaseToken, leaseToken)));
  return "sent" as const;
}
