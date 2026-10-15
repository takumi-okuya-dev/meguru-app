// 公開まで進める（specs/005-auto-post contracts/auto-post-job.md 手順4、research.md R6・R7）。
// 二重の公開を防ぐため、公開を送る前にコンテナーのIDと publish_requested_at を保存する。
// publish_requested_at があり結果がわからない間は、新しいコンテナーを作らない（1つのコンテナーは1回しか公開できない）。
import {
  AUTOPOST_FIND_PUBLISHED_HOURS,
  AUTOPOST_RECHECK_MAX_MINUTES,
  AUTOPOST_RECHECK_MIN_MINUTES,
  AUTOPOST_RECONCILE_SKEW_SECONDS,
  AUTOPOST_RETRY_DELAYS_MINUTES,
  AUTOPOST_RETRY_MAX,
  addDays,
  jstDateOf,
  jstMidnight,
} from "@threads-grower/shared";
import { and, eq, sql } from "drizzle-orm";
import { withTransaction, type Db } from "../db/client";
import {
  accounts,
  postDrafts,
  postingSchedules,
  publishAttempts,
} from "../db/schema";
import type { Env } from "../env";
import { billingModeOf } from "../lib/config";
import { loadOwnerEntitlement } from "./billing-service";
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
  | {
      kind: "published";
      slotAt: Date;
      draftId: string;
      /** 投稿のIDはあるが、URLを取れなかった（次の回に取り直す） */
      needsPermalink: boolean;
    }
  | { kind: "waiting" }
  | { kind: "retry" }
  | { kind: "carried_over" }
  | { kind: "failed" }
  | { kind: "skipped"; reason: "needs_reconnect" | "rate_limited" | "billing_inactive" };

/** 持ち時間を別の処理に取られた（再接続の片付けを含む）。この処理では、それ以上何も書かず、公開もしない。 */
class LeaseLostError extends Error {
  constructor() {
    super("publish attempt lease lost");
    this.name = "LeaseLostError";
  }
}

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
 * 試みを1つ、公開まで進める（手順4）。呼ぶ側が試みの持ち時間（lease_until）と持ち主の札（lease_token）を取ってあること。
 * 試みの更新は、すべて「処理中で、札が同じ」ことを条件にする。持ち時間が切れてほかの処理に取られた古い処理は、
 * 何も書かず、公開も送らずに終える（PR #6 のCodexレビュー）。
 * @param env - Workers のバインディング
 * @param db - データベース
 * @param threads - Threads API のクライアント
 * @param attemptId - publish_attempts.id
 * @param leaseToken - 持ち時間を取ったときの札（publish_attempts.lease_token）
 * @param now - 今の時刻（この回の基準の時刻）
 * @param clock - 実際の時刻（公開を送った・応答を受けた時刻の記録に使う。テストで差し替えられる）
 * @returns 結果
 */
export async function executeAttempt(
  env: Env,
  db: Db,
  threads: ThreadsClient,
  attemptId: string,
  leaseToken: string,
  now: Date,
  clock: () => Date = () => new Date(),
): Promise<ExecuteOutcome> {
  try {
    return await executeOwned(env, db, threads, attemptId, leaseToken, now, clock);
  } catch (err) {
    if (!(err instanceof LeaseLostError)) throw err;
    logger.warn("auto-post: lease lost, stopped without writing", { attemptId });
    return { kind: "waiting" };
  }
}

async function executeOwned(
  env: Env,
  db: Db,
  threads: ThreadsClient,
  attemptId: string,
  leaseToken: string,
  now: Date,
  clock: () => Date,
): Promise<ExecuteOutcome> {
  const [row] = await db
    .select({ attempt: publishAttempts, draft: postDrafts })
    .from(publishAttempts)
    .leftJoin(postDrafts, eq(postDrafts.id, publishAttempts.draftId))
    .where(eq(publishAttempts.id, attemptId))
    .limit(1);
  if (!row || row.attempt.state !== "in_progress" || row.attempt.leaseToken !== leaseToken)
    return { kind: "waiting" };
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
      .where(and(eq(publishAttempts.id, attemptId), eq(publishAttempts.leaseToken, leaseToken)));
    return { kind: "failed" };
  }
  const ctx = new AttemptContext(env, db, threads, attempt, draft, leaseToken, now, clock);
  const cred = await loadThreadsCredentials(env, db, attempt.accountId);
  if (cred && cred.connectionStatus !== "connected" && !attempt.publishRequestedAt) {
    // 要再接続：トークンの有無によらず、新しく公開しない（連携の取り消しで接続の行が消えても、ここで止める）。
    // 公開の結果がわからない途中だけは、確かめる処理（公開しない）を続ける
    return ctx.backToApproved("needs_reconnect");
  }
  // オーナーが読むだけなら、新しく公開しない（やり直し待ちも含む）。公開の結果がわからない途中だけは確かめる（specs/013 R8）
  if (!attempt.publishRequestedAt) {
    const owner = await loadOwnerEntitlement(db, attempt.accountId, billingModeOf(env), now);
    if (owner && !owner.fullAccess) return ctx.backToApproved("billing_inactive");
  }
  if (!cred?.token || cred.threadsUserId === null) {
    // 接続がない・鍵の設定ミスで復号できない。結果がわからない途中なら待ち、そうでなければ一時的な失敗として数える
    if (attempt.publishRequestedAt || attempt.containerId) return ctx.release();
    return ctx.transientFailure("unknown");
  }
  return ctx.run({ ...cred, token: cred.token });
}

/** 投稿に使える接続（つないでいて、トークンを復号できた。specs/012 で未接続を足した）。 */
type UsableCredentials = Extract<ThreadsCredentials, { threadsUserId: string }> & { token: string };

/** 1つの試みを進める間の状態と操作。 */
class AttemptContext {
  constructor(
    private readonly env: Env,
    private readonly db: Db,
    private readonly threads: ThreadsClient,
    private readonly attempt: AttemptRow,
    private readonly draft: DraftRow,
    private readonly leaseToken: string,
    private readonly now: Date,
    private readonly clock: () => Date,
  ) {}

  private get ids() {
    return {
      attemptId: this.attempt.id,
      draftId: this.draft.id,
      accountId: this.attempt.accountId,
    };
  }

  /**
   * 試みの更新（処理中で、札が同じときだけ）。
   * @param values - 更新する列
   * @returns 更新できた行のID（持ち主でなければ空）
   */
  private attemptUpdate(values: Partial<typeof publishAttempts.$inferInsert>) {
    return this.db
      .update(publishAttempts)
      .set({ ...values, updatedAt: this.now })
      .where(
        and(
          eq(publishAttempts.id, this.attempt.id),
          eq(publishAttempts.state, "in_progress"),
          eq(publishAttempts.leaseToken, this.leaseToken),
        ),
      )
      .returning({ id: publishAttempts.id });
  }

  /**
   * 試みを更新する。持ち主でなくなっていれば LeaseLostError（公開を送る前の記録では、公開を送らずに終える）。
   * @param values - 更新する列
   */
  private async setAttempt(values: Partial<typeof publishAttempts.$inferInsert>) {
    if ((await this.attemptUpdate(values)).length === 0) throw new LeaseLostError();
  }

  /**
   * 下書きをpublishingから変える。同じトランザクションで、先に試みを更新してあること（札がまだ同じことを確かめる）。
   * @param values - 更新する列
   * @returns 処理中だけを対象にする更新
   */
  private updateDraft(values: Partial<typeof postDrafts.$inferInsert>) {
    return this.db
      .update(postDrafts)
      .set({ ...values, version: sql`${postDrafts.version} + 1`, updatedAt: this.now })
      .where(
        and(
          eq(postDrafts.id, this.draft.id),
          eq(postDrafts.status, "publishing"),
          sql`EXISTS (SELECT 1 FROM publish_attempts pa WHERE pa.id = ${this.attempt.id} AND pa.lease_token = ${this.leaseToken})`,
        ),
      );
  }

  /**
   * 試みと下書きを1つのトランザクションで更新する。試みを先に更新して行をロックし、持ち主でなければ下書きも変えない。
   * @param attemptValues - 試みの列
   * @param draftValues - 下書きの列
   */
  private async commit(
    attemptValues: Partial<typeof publishAttempts.$inferInsert>,
    draftValues: Partial<typeof postDrafts.$inferInsert>,
  ) {
    const [updated] = await this.db.batch([
      this.attemptUpdate(attemptValues),
      this.updateDraft(draftValues),
    ]);
    if (updated.length === 0) throw new LeaseLostError();
  }

  async run(cred: UsableCredentials): Promise<ExecuteOutcome> {
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
          await this.setAttempt({ containerId: null });
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
        await this.setAttempt({ containerId });
      }
      // 照合（confirm）では、この時刻より前の投稿を候補にしないので、Cron の予定時刻ではなく実際の時刻を残す
      await this.setAttempt({ publishRequestedAt: this.clock() });
      let mediaId: string;
      try {
        const sent = await this.publishFenced(cred, containerId);
        // 記録の後に再接続された（または要再接続になった）：公開は送らず、同じトランザクションで承認済みに戻した
        if (sent.kind === "stale") return { kind: "skipped", reason: "needs_reconnect" };
        ({ mediaId } = sent);
      } catch (err) {
        if (err instanceof LeaseLostError) throw err;
        if (
          err instanceof ThreadsAuthError ||
          (err instanceof ThreadsApiError && !(err instanceof ThreadsTransientError))
        ) {
          // 確かな応答（4xx など）なら公開されていない
          await this.setAttempt({ publishRequestedAt: null });
          throw err;
        }
        // 通信の失敗・5xx・DBの失敗（送った後のコミットの失敗を含む）：Threads側で公開まで済んでいる可能性がある。
        // 次の回に結果を確かめる（やり直しの回数は数えない）
        logger.warn("auto-post: publish result unknown", { ...this.ids, err });
        return this.release();
      }
      // 投稿日時は応答を受けた時刻（Cron の予定時刻ではない。日付・24時間の件数の数え方に使う）
      return await this.succeed(cred, mediaId, this.clock());
    } catch (err) {
      return this.failure(err, cred);
    }
  }

  /**
   * 公開を送る（手順4「公開」の2）。Account の行（共有ロック）と試みの行（排他ロック）をこの順にロックした
   * トランザクションの中で送る。再接続（Account の行を更新し、続けて試みを片付ける）・ほかの処理の引き継ぎ
   * （試みの行を更新する）は、送り終わるまで待つので、公開と再接続の順番が必ずどちらかに決まる（PR #6 のCodexレビュー）。
   * ロックの順は再接続と同じ（Account → 試み）にして、デッドロックを避ける。
   * @param cred - 接続情報
   * @param containerId - 公開するコンテナー
   * @returns 送った結果。要再接続・接続の世代番号が読んだときと違う（その間に再接続された）なら stale。
   *   stale では送らず、ロックを持ったまま同じトランザクションで、記録を消して試みを skipped（needs_reconnect）にし、
   *   下書きを approved に戻す（別のトランザクションに分けると、その間にほかの処理が引き継いで公開しうる）
   */
  private publishFenced(
    cred: UsableCredentials,
    containerId: string,
  ): Promise<{ kind: "sent"; mediaId: string } | { kind: "stale" }> {
    return withTransaction(this.env.DATABASE_URL, async (tx) => {
      const [account] = await tx
        .select({
          status: accounts.connectionStatus,
          generation: accounts.connectionGeneration,
        })
        .from(accounts)
        .where(eq(accounts.id, this.attempt.accountId))
        .for("share");
      const [owned] = await tx
        .select({ id: publishAttempts.id })
        .from(publishAttempts)
        .where(
          and(
            eq(publishAttempts.id, this.attempt.id),
            eq(publishAttempts.state, "in_progress"),
            eq(publishAttempts.leaseToken, this.leaseToken),
          ),
        )
        .for("update");
      if (!owned) throw new LeaseLostError();
      // 世代番号は再接続のコミットで増える（authorized_at は callback に入った時刻なので使わない）。
      // トークンの更新でも増えるが、その場合も送らずに戻す（まれで、下書きは次の時刻に投稿される）
      if (account?.status !== "connected" || account.generation !== cred.generation) {
        await tx
          .update(publishAttempts)
          .set({
            state: "skipped",
            skipReason: "needs_reconnect",
            draftId: null,
            publishRequestedAt: null,
            leaseUntil: null,
            updatedAt: this.now,
          })
          .where(eq(publishAttempts.id, this.attempt.id));
        await tx
          .update(postDrafts)
          .set({
            ...this.backToApprovedDraft(),
            version: sql`${postDrafts.version} + 1`,
            updatedAt: this.now,
          })
          .where(and(eq(postDrafts.id, this.draft.id), eq(postDrafts.status, "publishing")));
        return { kind: "stale" } as const;
      }
      const { mediaId } = await this.threads.publishContainer(
        cred.token,
        cred.threadsUserId,
        containerId,
      );
      return { kind: "sent", mediaId } as const;
    });
  }

  /**
   * 公開の結果がわからない試みを確かめる。
   * @param cred - 接続情報
   * @param requestedAt - 公開を要求した日時
   * @returns 確認の結果
   */
  private async confirm(
    cred: UsableCredentials,
    requestedAt: Date,
  ): Promise<ExecuteOutcome> {
    const containerId = this.attempt.containerId;
    if (!containerId) {
      await this.setAttempt({ publishRequestedAt: null });
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
      await this.setAttempt({
        publishRequestedAt: null,
        ...(status === "EXPIRED" ? { containerId: null } : {}),
      });
      logger.warn("auto-post: publish result resolved as not published", { ...this.ids, status });
      return this.transientFailure("threads_server");
    }
    // PUBLISHED：投稿の一覧から、公開を送った後（時計のずれの分だけ前まで）で本文が同じ、もっとも古い投稿を探す。
    // それより前の同じ本文の投稿（直前の手動の投稿など）は、この試みの投稿ではない
    let found: { id: string; timestamp: string } | undefined;
    const earliest = requestedAt.getTime() - AUTOPOST_RECONCILE_SKEW_SECONDS * 1000;
    try {
      const recent = await this.threads.listRecentThreads(
        cred.token,
        cred.threadsUserId,
        new Date(requestedAt.getTime() - 5 * 60_000),
      );
      const body = this.draft.body.trim();
      found = recent
        .filter(
          (p) =>
            (p.text ?? "").trim() === body && parseThreadsTime(p.timestamp).getTime() >= earliest,
        )
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
    cred: UsableCredentials,
    mediaId: string | null,
    publishedAt: Date,
  ): Promise<ExecuteOutcome> {
    await this.commit({ state: "succeeded", leaseUntil: null }, {
        status: "published",
        publishedAt,
        threadsMediaId: mediaId,
        // 分析のための公開の時点の情報（specs/006 FR-002f）。publish_attempts は保存期間を過ぎると消えるので写す
        publishedSlotMinute: this.attempt.slotMinute,
        publishedCarryover: this.attempt.isCarryover,
        publishedPrioritized: this.draft.prioritizedAt !== null,
        // 投稿済みでは、投稿の順の記録を持たない（data-model.md の CHECK制約。analyze I1）
        prioritizedAt: null,
        carryoverAttemptId: null,
      });
    const saved = mediaId
      ? await fillPermalink(this.db, this.threads, cred.token, this.draft.id, mediaId)
      : false;
    return {
      kind: "published",
      slotAt: this.attempt.slotAt,
      draftId: this.draft.id,
      needsPermalink: mediaId !== null && !saved,
    };
  }

  /**
   * 持ち時間を返し、後の回に続ける。lease_until を「次に確かめる時刻」にして、それまでは続きの処理で選ばない。
   * 解決しない試みが、毎回の上限（AUTOPOST_MAX_PER_TICK）を使い切らないようにするため（PR #6 のCodexレビュー）。
   * @returns 待機の結果
   */
  async release(): Promise<ExecuteOutcome> {
    const ageMinutes = (this.now.getTime() - this.attempt.createdAt.getTime()) / 60_000;
    const delay = Math.min(
      AUTOPOST_RECHECK_MAX_MINUTES,
      Math.max(AUTOPOST_RECHECK_MIN_MINUTES, ageMinutes / 4),
    );
    await this.setAttempt({ leaseUntil: new Date(this.now.getTime() + delay * 60_000) });
    return { kind: "waiting" };
  }

  private async failure(err: unknown, cred: ThreadsCredentials): Promise<ExecuteOutcome> {
    if (err instanceof LeaseLostError) throw err;
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
      await this.setAttempt({
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
      await this.commit({ state: "carried_over", lastError, leaseUntil: null }, { status: "approved", carryoverAttemptId: this.attempt.id });
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
    await this.commit({ state: "failed", lastError, leaseUntil: null }, {
        status: "publish_failed",
        publishFailedAt: this.now,
        publishError: lastError,
        // 投稿に失敗では、投稿の順の記録を持たない（data-model.md の CHECK制約。analyze I1）
        prioritizedAt: null,
        carryoverAttemptId: null,
      });
    return { kind: "failed" };
  }

  /**
   * 認証の失敗・上限では承認済みに戻す。
   * @param reason - 停止の理由
   * @returns 飛ばした結果
   */
  async backToApproved(
    reason: "needs_reconnect" | "rate_limited" | "billing_inactive",
  ): Promise<ExecuteOutcome> {
    await this.commit(
      { state: "skipped", skipReason: reason, draftId: null, leaseUntil: null },
      this.backToApprovedDraft(),
    );
    return { kind: "skipped", reason };
  }

  /**
   * 承認済みに戻すときの下書きの列。持ち越しの試みなら、持ち越しの印（carryover_attempt_id）をこの試みにして付け直す。
   * 取り出しで印を消しているので、付け直さないと次の時刻の優先と「持ち越しは1回だけ」が失われる（PR #6 のCodexレビュー）。
   * @returns 下書きの列
   */
  private backToApprovedDraft(): Partial<typeof postDrafts.$inferInsert> {
    return {
      status: "approved",
      ...(this.attempt.isCarryover ? { carryoverAttemptId: this.attempt.id } : {}),
    };
  }

  /**
   * 上限では、上限の応答を受けた日の翌日の0時（日本時間）まで止める。
   * Cron の予定時刻で求めると、0時の直前の回が遅れて0時を過ぎたとき、止める期限がすでに過ぎている。
   * @returns 飛ばした結果
   */
  private async rateLimited(): Promise<ExecuteOutcome> {
    const pausedUntil = jstMidnight(addDays(jstDateOf(this.clock()), 1));
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
