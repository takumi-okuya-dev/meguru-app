// 公開まで進める（specs/005-auto-post contracts/auto-post-job.md 手順4、research.md R6・R7）。
// 二重の公開を防ぐため、公開を送る前にコンテナーのIDと publish_requested_at を保存する。
// publish_requested_at があり結果がわからない間は、新しいコンテナーを作らない（1つのコンテナーは1回しか公開できない）。
import {
  AUTOPOST_FIND_PUBLISHED_HOURS,
  AUTOPOST_RETRY_DELAYS_MINUTES,
  AUTOPOST_RETRY_MAX,
  addDays,
  jstDateOf,
  jstMidnight,
} from "@threads-grower/shared";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { postDrafts, postingSchedules, publishAttempts } from "../db/schema";
import type { Env } from "../env";
import { logger } from "../lib/logger";
import {
  ThreadsApiError,
  ThreadsAuthError,
  ThreadsRateLimitError,
  ThreadsTransientError,
  type ThreadsClient,
} from "../lib/threads-client";
import {
  loadThreadsCredentials,
  markNeedsReconnect,
  type ThreadsCredentials,
} from "./threads-credentials";

type AttemptRow = typeof publishAttempts.$inferSelect;
type DraftRow = typeof postDrafts.$inferSelect;
type PublishError =
  "network" | "threads_server" | "invalid_request" | "container_error" | "unknown";

/** 公開まで進めた結果。 */
export type ExecuteOutcome =
  | { kind: "published"; slotAt: Date }
  | { kind: "waiting" }
  | { kind: "retry" }
  | { kind: "carried_over" }
  | { kind: "failed" }
  | { kind: "skipped"; reason: "needs_reconnect" | "rate_limited" };

/**
 * 一時的な失敗の理由を分類する。
 * @param err - 失敗
 * @returns 表示に使う理由のコード
 */
function transientError(err: unknown): PublishError {
  if (err instanceof ThreadsTransientError) return err.status === 0 ? "network" : "threads_server";
  return "unknown";
}

/**
 * Threadsの日時をDateにする。
 * @param ts - Threadsのtimestamp
 * @returns 投稿の日時
 */
function parseThreadsTime(ts: string): Date {
  return new Date(ts.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
}

/**
 * 試みを1つ、公開まで進める（手順4）。呼ぶ側が試みの持ち時間（lease_until）を取ってあること。
 * @param env - Workers のバインディング
 * @param db - データベース
 * @param threads - Threads API のクライアント
 * @param attemptId - publish_attempts.id
 * @param now - 今の時刻（この回の基準の時刻）
 * @returns 結果
 */
export async function executeAttempt(
  env: Env,
  db: Db,
  threads: ThreadsClient,
  attemptId: string,
  now: Date,
): Promise<ExecuteOutcome> {
  const [row] = await db
    .select({ attempt: publishAttempts, draft: postDrafts })
    .from(publishAttempts)
    .leftJoin(postDrafts, eq(postDrafts.id, publishAttempts.draftId))
    .where(eq(publishAttempts.id, attemptId))
    .limit(1);
  if (!row || row.attempt.state !== "in_progress") return { kind: "waiting" };
  const { attempt, draft } = row;
  if (!draft || draft.status !== "publishing") {
    // 処理中の下書きは消せないので、通常は起きない
    logger.error("auto-post: attempt without a publishing draft", {
      attemptId,
      draftId: attempt.draftId,
    });
    await db
      .update(publishAttempts)
      .set({ state: "failed", lastError: "unknown", leaseUntil: null, updatedAt: now })
      .where(eq(publishAttempts.id, attemptId));
    return { kind: "failed" };
  }
  const ctx = new AttemptContext(env, db, threads, attempt, draft, now);
  const cred = await loadThreadsCredentials(env, db, attempt.accountId);
  if (!cred?.token) {
    // 接続がない・鍵の設定ミスで復号できない。結果がわからない途中なら待ち、そうでなければ一時的な失敗として数える
    if (attempt.publishRequestedAt || attempt.containerId) return ctx.release();
    return ctx.transientFailure("unknown");
  }
  return ctx.run(cred as ThreadsCredentials & { token: string });
}

/** 1つの試みを進める間の状態と操作。 */
class AttemptContext {
  constructor(
    private readonly env: Env,
    private readonly db: Db,
    private readonly threads: ThreadsClient,
    private readonly attempt: AttemptRow,
    private readonly draft: DraftRow,
    private readonly now: Date,
  ) {}

  private get ids() {
    return {
      attemptId: this.attempt.id,
      draftId: this.draft.id,
      accountId: this.attempt.accountId,
    };
  }

  private updateAttempt(values: Partial<typeof publishAttempts.$inferInsert>) {
    return this.db
      .update(publishAttempts)
      .set({ ...values, updatedAt: this.now })
      .where(eq(publishAttempts.id, this.attempt.id));
  }

  /**
   * 下書きをpublishingから変える。
   * @param values - 更新する列
   * @returns 処理中だけを対象にする更新
   */
  private updateDraft(values: Partial<typeof postDrafts.$inferInsert>) {
    return this.db
      .update(postDrafts)
      .set({ ...values, version: sql`${postDrafts.version} + 1`, updatedAt: this.now })
      .where(and(eq(postDrafts.id, this.draft.id), eq(postDrafts.status, "publishing")));
  }

  async run(cred: ThreadsCredentials & { token: string }): Promise<ExecuteOutcome> {
    try {
      if (this.attempt.publishRequestedAt)
        return await this.confirm(cred, this.attempt.publishRequestedAt);
      let containerId = this.attempt.containerId;
      if (containerId) {
        // 前の回で作ったコンテナー。公開の前に状態を確かめる（やり直し・処理の途中で止まった場合）
        let status;
        try {
          ({ status } = await this.threads.getContainerStatus(cred.token, containerId));
        } catch (err) {
          // 状態が分からない間は作り直さず、同じコンテナーの確認を待つ。
          if (err instanceof ThreadsAuthError)
            await markNeedsReconnect(this.db, this.attempt.accountId, cred.generation);
          logger.warn("auto-post: could not confirm container status", { ...this.ids, err });
          return this.release();
        }
        if (status === "IN_PROGRESS") return this.release();
        if (status === "ERROR") return this.definiteFailure("container_error");
        // 公開要求の記録が欠けていても、新しく公開しない。作成日時を基準に照合する
        if (status === "PUBLISHED") return await this.confirm(cred, this.attempt.createdAt);
        if (status === "EXPIRED") {
          await this.updateAttempt({ containerId: null });
          return this.transientFailure("threads_server");
        }
      }
      if (!containerId) {
        ({ containerId } = await this.threads.createTextContainer(
          cred.token,
          cred.threadsUserId,
          this.draft.body,
        ));
        // 公開を送る前に、コンテナーのIDを保存する（research.md R6）
        await this.updateAttempt({ containerId });
      }
      await this.updateAttempt({ publishRequestedAt: this.now });
      let mediaId: string;
      try {
        ({ mediaId } = await this.threads.publishContainer(
          cred.token,
          cred.threadsUserId,
          containerId,
        ));
      } catch (err) {
        if (err instanceof ThreadsTransientError) {
          // 通信の失敗・5xx：Threads側で公開まで済んでいる可能性がある。次の回に結果を確かめる（やり直しの回数は数えない）
          logger.warn("auto-post: publish result unknown", this.ids);
          return this.release();
        }
        // 確かな応答（4xx など）なら公開されていない
        await this.updateAttempt({ publishRequestedAt: null });
        throw err;
      }
      return await this.succeed(cred, mediaId, this.now);
    } catch (err) {
      return this.failure(err, cred);
    }
  }

  /**
   * 公開の結果がわからない試みを確かめる。
   * @param cred - 接続情報
   * @param requestedAt - 公開を要求した日時
   * @returns 確認の結果
   */
  private async confirm(
    cred: ThreadsCredentials & { token: string },
    requestedAt: Date,
  ): Promise<ExecuteOutcome> {
    const containerId = this.attempt.containerId;
    if (!containerId) {
      await this.updateAttempt({ publishRequestedAt: null });
      return this.transientFailure("unknown");
    }
    let status;
    try {
      ({ status } = await this.threads.getContainerStatus(cred.token, containerId));
    } catch (err) {
      // 確かめられない間は、下書きを publishing のまま止める（二重の公開を防ぐ）
      if (err instanceof ThreadsAuthError)
        await markNeedsReconnect(this.db, this.attempt.accountId, cred.generation);
      logger.warn("auto-post: could not confirm publish result", { ...this.ids, err });
      return this.release();
    }
    if (status === "IN_PROGRESS") return this.release();
    if (status === "ERROR") return this.definiteFailure("container_error");
    if (status === "FINISHED" || status === "EXPIRED") {
      // 公開されていない。FINISHED は同じコンテナーで、EXPIRED は作り直してやり直す
      await this.updateAttempt({
        publishRequestedAt: null,
        ...(status === "EXPIRED" ? { containerId: null } : {}),
      });
      logger.warn("auto-post: publish result resolved as not published", { ...this.ids, status });
      return this.transientFailure("threads_server");
    }
    // PUBLISHED：投稿の一覧から、本文が同じもっとも古い投稿を探す
    let found: { id: string; timestamp: string } | undefined;
    try {
      const recent = await this.threads.listRecentThreads(
        cred.token,
        cred.threadsUserId,
        new Date(requestedAt.getTime() - 5 * 60_000),
      );
      const body = this.draft.body.trim();
      found = recent
        .filter((p) => (p.text ?? "").trim() === body)
        .sort(
          (a, b) =>
            parseThreadsTime(a.timestamp).getTime() - parseThreadsTime(b.timestamp).getTime(),
        )[0];
    } catch (err) {
      if (err instanceof ThreadsAuthError)
        await markNeedsReconnect(this.db, this.attempt.accountId, cred.generation);
      logger.warn("auto-post: could not list recent threads", { ...this.ids, err });
      return this.release();
    }
    if (found) {
      logger.warn("auto-post: publish result resolved as published", this.ids);
      return this.succeed(cred, found.id, parseThreadsTime(found.timestamp));
    }
    if (this.now.getTime() - requestedAt.getTime() >= AUTOPOST_FIND_PUBLISHED_HOURS * 3600_000) {
      // 公開はできているが、投稿が見つからない（極めてまれ）。IDなしで投稿済みにする（SC-006 の例外。006で照合する）
      logger.error("auto-post: published but the post was not found", this.ids);
      return this.succeed(cred, null, requestedAt);
    }
    return this.release();
  }

  /**
   * 公開の成功を記録し、URLを取得する。
   * @param cred - 接続情報
   * @param mediaId - 公開した投稿のID（照合できない場合はnull）
   * @param publishedAt - 投稿日時
   * @returns 投稿済みの結果
   */
  private async succeed(
    cred: ThreadsCredentials & { token: string },
    mediaId: string | null,
    publishedAt: Date,
  ): Promise<ExecuteOutcome> {
    await this.db.batch([
      this.updateDraft({
        status: "published",
        publishedAt,
        threadsMediaId: mediaId,
        // 投稿済みでは、投稿の順の記録を持たない（data-model.md の CHECK制約。analyze I1）
        prioritizedAt: null,
        carryoverAttemptId: null,
      }),
      this.updateAttempt({ state: "succeeded", leaseUntil: null }),
    ]);
    if (mediaId) await fillPermalink(this.db, this.threads, cred.token, this.draft.id, mediaId);
    return { kind: "published", slotAt: this.attempt.slotAt };
  }

  /**
   * 持ち時間を返し、次の回に続ける。
   * @returns 待機の結果
   */
  async release(): Promise<ExecuteOutcome> {
    await this.updateAttempt({ leaseUntil: null });
    return { kind: "waiting" };
  }

  private async failure(err: unknown, cred: ThreadsCredentials): Promise<ExecuteOutcome> {
    // 上限・一時的な失敗も ThreadsApiError の一種なので、先に見る
    if (err instanceof ThreadsRateLimitError) return this.rateLimited();
    if (err instanceof ThreadsAuthError) {
      await markNeedsReconnect(this.db, this.attempt.accountId, cred.generation);
      return this.backToApproved("needs_reconnect");
    }
    if (err instanceof ThreadsTransientError) return this.transientFailure(transientError(err));
    if (err instanceof ThreadsApiError) {
      logger.warn("auto-post: threads rejected the post", { ...this.ids, err });
      return this.definiteFailure("invalid_request");
    }
    logger.error("auto-post: unexpected error while publishing", { ...this.ids, err });
    return this.transientFailure("unknown");
  }

  /**
   * 一時的な失敗を、再試行・持ち越し・失敗に進める。
   * @param lastError - 失敗の理由
   * @returns 再試行か終了の結果
   */
  async transientFailure(lastError: PublishError): Promise<ExecuteOutcome> {
    const retries = this.attempt.retryCount;
    if (retries < AUTOPOST_RETRY_MAX) {
      const delay = AUTOPOST_RETRY_DELAYS_MINUTES[retries] ?? AUTOPOST_RETRY_DELAYS_MINUTES.at(-1)!;
      await this.updateAttempt({
        state: "retry_wait",
        retryCount: retries + 1,
        nextRetryAt: new Date(this.now.getTime() + delay * 60_000),
        lastError,
        leaseUntil: null,
      });
      return { kind: "retry" };
    }
    if (!this.attempt.isCarryover) {
      // 次の時刻に、同じ下書きで1回だけもう一度試す（投稿の順の先頭に置く）
      await this.db.batch([
        this.updateDraft({ status: "approved", carryoverAttemptId: this.attempt.id }),
        this.updateAttempt({ state: "carried_over", lastError, leaseUntil: null }),
      ]);
      return { kind: "carried_over" };
    }
    return this.markFailed(lastError);
  }

  /**
   * 確かな失敗をすぐ投稿に失敗にする。
   * @param lastError - 失敗の理由
   * @returns 失敗の結果
   */
  private definiteFailure(lastError: PublishError): Promise<ExecuteOutcome> {
    return this.markFailed(lastError);
  }

  private async markFailed(lastError: PublishError): Promise<ExecuteOutcome> {
    await this.db.batch([
      this.updateDraft({
        status: "publish_failed",
        publishFailedAt: this.now,
        publishError: lastError,
        // 投稿に失敗では、投稿の順の記録を持たない（data-model.md の CHECK制約。analyze I1）
        prioritizedAt: null,
        carryoverAttemptId: null,
      }),
      this.updateAttempt({ state: "failed", lastError, leaseUntil: null }),
    ]);
    return { kind: "failed" };
  }

  /**
   * 認証の失敗・上限では承認済みに戻す。
   * @param reason - 停止の理由
   * @returns 飛ばした結果
   */
  private async backToApproved(
    reason: "needs_reconnect" | "rate_limited",
  ): Promise<ExecuteOutcome> {
    await this.db.batch([
      this.updateDraft({ status: "approved" }),
      this.updateAttempt({ state: "skipped", skipReason: reason, draftId: null, leaseUntil: null }),
    ]);
    return { kind: "skipped", reason };
  }

  /**
   * 上限では翌日の0時（日本時間）まで止める。
   * @returns 飛ばした結果
   */
  private async rateLimited(): Promise<ExecuteOutcome> {
    const pausedUntil = jstMidnight(addDays(jstDateOf(this.now), 1));
    await this.db
      .update(postingSchedules)
      .set({ pausedUntil })
      .where(eq(postingSchedules.accountId, this.attempt.accountId));
    logger.warn("auto-post: threads rate limit reached", { accountId: this.attempt.accountId });
    return this.backToApproved("rate_limited");
  }
}

/**
 * 投稿のURLを取って保存する（SC-006）。失敗しても投稿済みは変えない（次の回に取り直す）。
 * @param db - データベース
 * @param threads - Threads API のクライアント
 * @param token - アクセストークン
 * @param draftId - post_drafts.id
 * @param mediaId - Threads の投稿のID
 * @returns 取れたら true
 */
export async function fillPermalink(
  db: Db,
  threads: ThreadsClient,
  token: string,
  draftId: string,
  mediaId: string,
): Promise<boolean> {
  try {
    const media = await threads.getMedia(token, mediaId);
    if (!media.permalink) return false;
    await db
      .update(postDrafts)
      .set({ threadsPermalink: media.permalink })
      .where(eq(postDrafts.id, draftId));
    return true;
  } catch (err) {
    logger.warn("auto-post: could not fetch permalink", { draftId, err });
    return false;
  }
}
