// 反応数の段階（specs/006-performance-feedback contracts/metrics-job.md 6-0〜6-6、research.md R2〜R5・R10・R11）。
// 005の自動投稿の定期処理（runAutoPost）の最後に呼ぶ。Threadsへの呼び出しの数を、その回の公開の数から決め（R3）、
// DBの読み書きはまとめて行う（対象の読み込み1回、フォロワー数の対象1回、書き込み1回、判定1回）。
import {
  FOLLOWER_ACTIVE_DAYS,
  METRICS_CALLS_PER_PUBLISH,
  METRICS_CATCHUP_HOUR_JST,
  METRICS_LATE_AFTER_HOURS,
  METRICS_MAX_CALLS_PER_TICK,
  METRICS_MILESTONE_HOURS,
  METRICS_WINDOW_MINUTES,
  PERFORMANCE_BASELINE_SAMPLE,
  PERFORMANCE_GOOD_RATIO,
  PERFORMANCE_MIN_JUDGEABLE,
  PERFORMANCE_POOR_RATIO,
  addDays,
  catchUpKind,
  elapsedMinutes,
  jstDateOf,
  jstMidnight,
  milestoneForElapsed,
  type MetricsKindValue,
  type MetricsMilestone,
} from "@threads-grower/shared";
import { and, asc, eq, gte, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { Db } from "../../../kernel/db/client";
import { followerSnapshots, postDrafts, postMetricSnapshots, postMetrics, threadsConnections } from "../schema";
import {
  accounts,
  memberships,
  subscriptions,
  users,
  entitlementFromFacts,
  fullAccessSql,
  featureOnSql,
  billingExemptSql,
} from "../../../platform";
import type { Env } from "../../../kernel/env";
import { billingModeOf, type BillingMode } from "../../../kernel/config";
import { createTokenCipher } from "../../../kernel/crypto";
import { logger } from "../../../kernel/logger";
import {
  ThreadsAuthError,
  ThreadsNotFoundError,
  ThreadsPermissionError,
  ThreadsRateLimitError,
  type ThreadsClient,
  type ThreadsMediaInsights,
} from "../../../adapters/threads-api";
import { markNeedsReconnect } from "../connection/threads-credentials";

/** 反応数の段階の結果。 */
export type MetricsStageResult = {
  /** 次の回にすぐ続けたい（時点の幅の中の残り、補いの残り） */
  remaining: boolean;
  /** その日の補いを終えた（KVの metrics:catchup を書く） */
  catchupFinished: boolean;
  /** ログ用の数 */
  counts: {
    fetched: number;
    unmeasurable: number;
    followers: number;
    deferred: number;
    denied: number;
    judgedAccounts: number;
  };
};

/** 6-1 の対象の1件。 */
type Candidate = {
  id: string;
  accountId: string;
  publishedAt: Date;
  mediaId: string | null;
  state: "updating" | null;
  taken: MetricsMilestone[];
  threadsUserId: string;
  generation: number;
  ownerCreatedAt: Date;
  ownerLegacyTrial: boolean;
  ownerBillingExempt: boolean;
  subStatus: string | null;
  subCancelAtPeriodEnd: boolean | null;
  ciphertext: Uint8Array | null;
  iv: Uint8Array | null;
  keyVersion: number | null;
};

/** 取り込む1件（6-2）。 */
type Work = { c: Candidate; kind: MetricsKindValue | "no_media"; method: "slot" | "daily"; elapsed: number };

const HOUR = 3600_000;
const WINDOW_MS = METRICS_WINDOW_MINUTES * 60_000;

/**
 * 日本時間の今日の3:00（補いを始める時刻）。
 * @param now - 今
 * @returns 今日の3:00（日本時間）
 */
export function catchupStartOf(now: Date): Date {
  return new Date(jstMidnight(jstDateOf(now)).getTime() + METRICS_CATCHUP_HOUR_JST * HOUR);
}

/**
 * 関所の候補にする「次の補いの時刻」（contracts/metrics-job.md 手順7）。その日の補いが済んでいなければ今日の3:00、済んでいれば明日の3:00。
 * @param now - 今
 * @param catchupDate - その日の補いを終えた日（KVの metrics:catchup）
 * @returns 次の補いの時刻
 */
export function nextCatchupAt(now: Date, catchupDate: string | null): Date {
  const today = jstDateOf(now);
  const todayStart = catchupStartOf(now);
  if (catchupDate !== today && now.getTime() < todayStart.getTime()) return todayStart;
  return new Date(jstMidnight(addDays(today, 1)).getTime() + METRICS_CATCHUP_HOUR_JST * HOUR);
}

/**
 * 反応数の段階を1回行う（contracts/metrics-job.md）。Threadsの失敗は1件・1つのAccountの中で受け止める。
 * @param env - Workers のバインディング
 * @param db - データベース
 * @param threads - Threads API のクライアント
 * @param opts - now：今、publishedThisTick：この回に進めた公開の試みの数、catchupDate：その日の補いを終えた日
 * @returns 結果
 */
export async function runMetricsStage(
  env: Env,
  db: Db,
  threads: ThreadsClient,
  opts: { now: Date; publishedThisTick: number; catchupDate: string | null },
): Promise<MetricsStageResult> {
  const { now } = opts;
  const result: MetricsStageResult = {
    remaining: false,
    catchupFinished: false,
    counts: { fetched: 0, unmeasurable: 0, followers: 0, deferred: 0, denied: 0, judgedAccounts: 0 },
  };
  // 6-0. 使える回数
  let calls = METRICS_MAX_CALLS_PER_TICK - METRICS_CALLS_PER_PUBLISH * opts.publishedThisTick;
  if (calls <= 0) {
    result.remaining = true;
    return result;
  }
  const today = jstDateOf(now);
  const catchup = opts.catchupDate !== today && now.getTime() >= catchupStartOf(now).getTime();
  const todayStart = jstMidnight(today);

  // 6-1. 対象を読む
  const limit = calls + 40;
  const mode = billingModeOf(env);
  const candidates = await loadCandidates(db, mode, now, catchup, todayStart, limit);
  // オーナーが読むだけのアカウントは取らない（specs/013 research.md R8）。テスト版に入れないオーナー（specs/016）は、
  // 候補を読むSQL（fullAccessSql）で外れているので、ここでは決済の状態だけを見直す
  const ownerFull = (t: {
    ownerCreatedAt: Date;
    ownerLegacyTrial: boolean;
    ownerBillingExempt: boolean;
    subStatus: string | null;
    subCancelAtPeriodEnd: boolean | null;
  }) =>
    entitlementFromFacts(
      mode,
      {
        createdAt: t.ownerCreatedAt,
        legacyTrial: t.ownerLegacyTrial,
        billingExempt: t.ownerBillingExempt,
        status: t.subStatus,
        cancelAtPeriodEnd: t.subCancelAtPeriodEnd,
      },
      now,
    ).fullAccess;
  let catchupRemaining = catchup && candidates.length >= limit;

  // 6-2. 何を取るかを決める
  const works: Work[] = [];
  for (const c of candidates) {
    if (!ownerFull(c)) continue;
    const elapsed = elapsedMinutes(c.publishedAt, now);
    const taken = new Set(c.taken);
    const milestone = milestoneForElapsed(elapsed);
    if (milestone && !taken.has(milestone)) {
      if (c.mediaId) works.push({ c, kind: milestone, method: "slot", elapsed });
      continue;
    }
    if (!catchup) continue;
    if (!c.mediaId) {
      works.push({ c, kind: "no_media", method: "daily", elapsed });
      continue;
    }
    const kind = catchUpKind(elapsed, taken);
    if (kind) works.push({ c, kind, method: "daily", elapsed });
  }

  // 6-3. Threadsに問い合わせる
  const cipher = createTokenCipher(env.TOKEN_ENCRYPTION_KEYS, env.TOKEN_ENCRYPTION_KEY_VERSION);
  const tokens = new Map<string, string | null>();
  const tokenFor = async (c: {
    accountId: string;
    ciphertext: Uint8Array | null;
    iv: Uint8Array | null;
    keyVersion: number | null;
  }): Promise<string | null> => {
    if (tokens.has(c.accountId)) return tokens.get(c.accountId)!;
    let token: string | null = null;
    if (c.ciphertext && c.iv && c.keyVersion !== null) {
      try {
        token = await cipher.decrypt({ ciphertext: c.ciphertext, iv: c.iv, keyVersion: c.keyVersion }, c.accountId);
      } catch (err) {
        logger.error("metrics: failed to decrypt threads token", { accountId: c.accountId, err });
      }
    }
    tokens.set(c.accountId, token);
    return token;
  };
  const skipAccounts = new Set<string>();
  const denied = new Set<string>();
  const reconnect = new Map<string, number>();
  const fetched: { w: Work; m: ThreadsMediaInsights }[] = [];
  const notFound: Work[] = [];
  const noMedia: Work[] = [];
  let stopped = false;

  for (const w of works) {
    if (w.kind === "no_media") {
      noMedia.push(w);
      continue;
    }
    if (stopped || calls <= 0) {
      if (w.method === "slot") result.counts.deferred += 1;
      else catchupRemaining = true;
      continue;
    }
    if (skipAccounts.has(w.c.accountId)) continue;
    const token = await tokenFor(w.c);
    if (!token) {
      skipAccounts.add(w.c.accountId);
      continue;
    }
    calls -= 1;
    try {
      fetched.push({ w, m: await threads.getMediaInsights(token, w.c.mediaId!) });
    } catch (err) {
      if (err instanceof ThreadsNotFoundError) notFound.push(w);
      else if (err instanceof ThreadsPermissionError) {
        denied.add(w.c.accountId);
        skipAccounts.add(w.c.accountId);
      } else if (err instanceof ThreadsAuthError) {
        reconnect.set(w.c.accountId, w.c.generation);
        skipAccounts.add(w.c.accountId);
      } else if (err instanceof ThreadsRateLimitError) {
        stopped = true;
        if (w.method === "slot") result.counts.deferred += 1;
        else catchupRemaining = true;
      } else {
        // 一時的な失敗・そのほか：記録しない（時点の幅の中なら次の回、過ぎたら3:00の補い）
        logger.warn("metrics: fetch failed", { accountId: w.c.accountId, err });
      }
    }
  }
  if (stopped) catchupRemaining = catchup || catchupRemaining;

  // 6-4. フォロワー数（補いのときだけ）
  const followers: { accountId: string; count: number }[] = [];
  if (catchup && !stopped) {
    const targets = await loadFollowerTargets(db, mode, now, today, todayStart);
    for (const t of targets) {
      if (skipAccounts.has(t.accountId) || denied.has(t.accountId)) continue;
      if (!ownerFull(t)) continue;
      if (calls <= 0) {
        catchupRemaining = true;
        break;
      }
      const token = await tokenFor(t);
      if (!token) continue;
      calls -= 1;
      try {
        followers.push({ accountId: t.accountId, count: await threads.getFollowersCount(token, t.threadsUserId) });
      } catch (err) {
        if (err instanceof ThreadsPermissionError) denied.add(t.accountId);
        else if (err instanceof ThreadsAuthError) reconnect.set(t.accountId, t.generation);
        else if (err instanceof ThreadsRateLimitError) {
          catchupRemaining = true;
          break;
        } else logger.warn("metrics: followers fetch failed", { accountId: t.accountId, err });
      }
    }
  }

  // 6-5. 書き込む（まとめて1回）
  const writes = buildWrites(db, now, today, fetched, notFound, noMedia, followers, denied);
  if (writes.length > 0) await db.batch(writes as [BatchItem<"pg">, ...BatchItem<"pg">[]]);
  for (const [accountId, generation] of reconnect) await markNeedsReconnect(db, accountId, generation);

  const confirmedAccounts = [
    ...new Set(fetched.filter(({ w }) => isConfirming(w)).map(({ w }) => w.c.accountId)),
  ];
  if (confirmedAccounts.length > 0) await judgeAccounts(db, now, confirmedAccounts);

  result.counts.fetched = fetched.length;
  result.counts.unmeasurable = notFound.length + noMedia.length;
  result.counts.followers = followers.length;
  result.counts.denied = denied.size;
  result.counts.judgedAccounts = confirmedAccounts.length;
  result.remaining = result.counts.deferred > 0 || catchupRemaining;
  result.catchupFinished = catchup && !catchupRemaining;

  logger.info("metrics: run", { ...result.counts, catchup, remaining: result.remaining });
  if (result.counts.deferred > 0) logger.warn("metrics: deferred", { deferred: result.counts.deferred });
  if (denied.size > 0) logger.warn("metrics: insights denied", { accounts: denied.size });
  if (result.catchupFinished) logger.info("metrics: catch-up done", { date: today });
  return result;
}

/**
 * 7日の値・遅れて確定の取り込みか（確定にするか）。
 * @param w - 取り込む1件
 * @returns 確定にするなら true
 */
function isConfirming(w: Work): boolean {
  return w.kind === "d7" || w.kind === "late";
}

/**
 * 6-1 の対象を読む。時点の幅の中を先に、次に投稿IDのない投稿、最後に補いの投稿を古い順に。
 * @param db - データベース
 * @param mode - 決済のモード（オーナーが読むだけの行を外すのに使う）
 * @param now - 今
 * @param catchup - 補いをするか
 * @param todayStart - 今日の0時（日本時間）。権限のない印がこれより前なら対象にする
 * @param limit - 読む上限
 * @returns 対象
 */
async function loadCandidates(
  db: Db,
  mode: BillingMode,
  now: Date,
  catchup: boolean,
  todayStart: Date,
  limit: number,
): Promise<Candidate[]> {
  const windows = (["h24", "d3", "d7"] as const).map((m) => {
    const center = now.getTime() - METRICS_MILESTONE_HOURS[m] * HOUR;
    return and(
      gte(postDrafts.publishedAt, new Date(center - WINDOW_MS - 60_000)),
      lt(postDrafts.publishedAt, new Date(center + WINDOW_MS + 60_000)),
    )!;
  });
  const inWindow = or(...windows)!;
  const due: SQL = catchup ? lt(postDrafts.publishedAt, new Date(now.getTime() - 23 * HOUR))! : inWindow;
  const priority = sql<number>`CASE WHEN ${inWindow} THEN 0 WHEN ${postDrafts.threadsMediaId} IS NULL THEN 1 ELSE 2 END`;
  const rows = await db
    .select({
      id: postDrafts.id,
      accountId: postDrafts.accountId,
      publishedAt: postDrafts.publishedAt,
      mediaId: postDrafts.threadsMediaId,
      state: postMetrics.state,
      taken: sql<string[]>`coalesce(array_agg(${postMetricSnapshots.kind}::text) FILTER (WHERE ${postMetricSnapshots.kind} IS NOT NULL), '{}')`,
      threadsUserId: accounts.threadsUserId,
      generation: accounts.connectionGeneration,
      ownerCreatedAt: users.createdAt,
      ownerLegacyTrial: users.legacyTrial,
      ownerBillingExempt: billingExemptSql(users, mode),
      subStatus: subscriptions.status,
      subCancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
      ciphertext: threadsConnections.accessTokenCiphertext,
      iv: threadsConnections.accessTokenIv,
      keyVersion: threadsConnections.keyVersion,
    })
    .from(postDrafts)
    .innerJoin(accounts, eq(accounts.id, postDrafts.accountId))
    .innerJoin(memberships, and(eq(memberships.accountId, accounts.id), eq(memberships.role, "owner")))
    .innerJoin(users, eq(users.id, memberships.userId))
    .leftJoin(subscriptions, eq(subscriptions.userId, users.id))
    .leftJoin(threadsConnections, eq(threadsConnections.accountId, accounts.id))
    .leftJoin(postMetrics, eq(postMetrics.draftId, postDrafts.id))
    .leftJoin(postMetricSnapshots, eq(postMetricSnapshots.draftId, postDrafts.id))
    .where(
      and(
        eq(postDrafts.status, "published"),
        eq(accounts.connectionStatus, "connected"),
        or(isNull(accounts.insightsDeniedAt), lt(accounts.insightsDeniedAt, todayStart)),
        or(isNull(postMetrics.state), eq(postMetrics.state, "updating")),
        // オーナーが読むだけの行は、件数の上限の前に外す（PR #16 のCodexレビュー）
        fullAccessSql(mode, now),
        // オーナーが自動投稿を使えないアカウントも、反応を取り込まない（specs/019 FR-008。決済の判定には混ぜない）
        featureOnSql(users.id, "autopost"),
        due,
      ),
    )
    .groupBy(postDrafts.id, accounts.id, users.id, subscriptions.userId, threadsConnections.accountId, postMetrics.draftId)
    .orderBy(priority, asc(postDrafts.publishedAt), asc(postDrafts.id))
    .limit(limit);
  // connected で絞っているので threads_user_id は必ずある（specs/012 の CHECK 制約）。型のために NULL を落とす
  return rows.flatMap(({ threadsUserId, ...r }) =>
    threadsUserId
      ? [
          {
            ...r,
            threadsUserId,
            publishedAt: r.publishedAt!,
            state: r.state as "updating" | null,
            taken: (r.taken ?? []).filter((k): k is MetricsMilestone => k === "h24" || k === "d3" || k === "d7"),
          },
        ]
      : [],
  );
}

/**
 * 6-4 のフォロワー数の対象：今日の記録がなく、直近30日に投稿済みがあるAccount。
 * @param db - データベース
 * @param mode - 決済のモード（オーナーが読むだけの行を外すのに使う）
 * @param now - 今
 * @param today - 今日（日本時間）
 * @param todayStart - 今日の0時（日本時間）
 * @returns 対象
 */
async function loadFollowerTargets(db: Db, mode: BillingMode, now: Date, today: string, todayStart: Date) {
  const rows = await db
    .select({
      accountId: accounts.id,
      threadsUserId: accounts.threadsUserId,
      generation: accounts.connectionGeneration,
      ownerCreatedAt: users.createdAt,
      ownerLegacyTrial: users.legacyTrial,
      ownerBillingExempt: billingExemptSql(users, mode),
      subStatus: subscriptions.status,
      subCancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
      ciphertext: threadsConnections.accessTokenCiphertext,
      iv: threadsConnections.accessTokenIv,
      keyVersion: threadsConnections.keyVersion,
    })
    .from(accounts)
    .innerJoin(memberships, and(eq(memberships.accountId, accounts.id), eq(memberships.role, "owner")))
    .innerJoin(users, eq(users.id, memberships.userId))
    .leftJoin(subscriptions, eq(subscriptions.userId, users.id))
    .leftJoin(threadsConnections, eq(threadsConnections.accountId, accounts.id))
    .where(
      and(
        eq(accounts.connectionStatus, "connected"),
        or(isNull(accounts.insightsDeniedAt), lt(accounts.insightsDeniedAt, todayStart)),
        // オーナーが読むだけの行は、件数の上限の前に外す（PR #16 のCodexレビュー）
        fullAccessSql(mode, now),
        // オーナーが自動投稿を使えないアカウントも、反応を取り込まない（specs/019 FR-008。決済の判定には混ぜない）
        featureOnSql(users.id, "autopost"),
        sql`EXISTS (SELECT 1 FROM ${postDrafts} d WHERE d.account_id = ${accounts.id} AND d.status = 'published'
          AND d.published_at >= ${new Date(now.getTime() - FOLLOWER_ACTIVE_DAYS * 24 * HOUR).toISOString()})`,
        sql`NOT EXISTS (SELECT 1 FROM ${followerSnapshots} f WHERE f.account_id = ${accounts.id} AND f.snapshot_date = ${today}::date)`,
      ),
    )
    .orderBy(asc(accounts.id));
  // connected で絞っているので threads_user_id は必ずある（specs/012 の CHECK 制約）
  return rows.flatMap(({ threadsUserId, ...r }) => (threadsUserId ? [{ ...r, threadsUserId }] : []));
}

/**
 * 6-5 の書き込みを組み立てる（db.batch で1回にまとめる）。
 * @param db - データベース
 * @param now - 今
 * @param today - 今日（日本時間）
 * @param fetched - 取り込めた投稿と反応数
 * @param notFound - 投稿が見つからなかった投稿
 * @param noMedia - 投稿IDのない投稿
 * @param followers - 読めたフォロワー数
 * @param denied - 権限がなかったAccount
 * @returns 書き込みのクエリ
 */
function buildWrites(
  db: Db,
  now: Date,
  today: string,
  fetched: { w: Work; m: ThreadsMediaInsights }[],
  notFound: Work[],
  noMedia: Work[],
  followers: { accountId: string; count: number }[],
  denied: Set<string>,
) {
  const writes: unknown[] = [];
  if (fetched.length > 0) {
    writes.push(
      db
        .insert(postMetricSnapshots)
        .values(
          fetched.map(({ w, m }) => ({
            draftId: w.c.id,
            accountId: w.c.accountId,
            kind: w.kind as MetricsKindValue,
            method: w.method,
            fetchedAt: now,
            elapsedMinutes: w.elapsed,
            ...m,
          })),
        )
        .onConflictDoNothing({ target: [postMetricSnapshots.draftId, postMetricSnapshots.kind] }),
    );
  }
  for (const { w, m } of fetched) {
    const kind = w.kind as MetricsKindValue;
    const late = kind === "late" || (kind === "d7" && w.elapsed > METRICS_LATE_AFTER_HOURS * 60);
    const state = kind === "h24" || kind === "d3" ? "updating" : late ? "late_confirmed" : "confirmed";
    const values = {
      ...m,
      state,
      lastFetchedAt: now,
      lastElapsedMinutes: w.elapsed,
      lastKind: kind,
      confirmedAt: state === "updating" ? null : now,
      updatedAt: now,
    } as const;
    writes.push(
      db
        .insert(postMetrics)
        .values({ draftId: w.c.id, accountId: w.c.accountId, ...values })
        .onConflictDoUpdate({
          target: postMetrics.draftId,
          set: values,
          // 確定・計測できないの行は変えない（重なった処理が確定の値を上書きしない）
          setWhere: eq(postMetrics.state, "updating"),
        }),
    );
  }
  for (const [w, reason] of [
    ...notFound.map((w) => [w, "not_found"] as const),
    ...noMedia.map((w) => [w, "no_media_id"] as const),
  ]) {
    writes.push(
      db
        .insert(postMetrics)
        .values({ draftId: w.c.id, accountId: w.c.accountId, state: "unmeasurable", unmeasurableReason: reason, updatedAt: now })
        .onConflictDoUpdate({
          target: postMetrics.draftId,
          set: { state: "unmeasurable", unmeasurableReason: reason, updatedAt: now },
          setWhere: eq(postMetrics.state, "updating"),
        }),
    );
  }
  if (followers.length > 0) {
    writes.push(
      db
        .insert(followerSnapshots)
        .values(followers.map((f) => ({ accountId: f.accountId, snapshotDate: today, followersCount: f.count, capturedAt: now })))
        .onConflictDoNothing(),
    );
  }
  if (denied.size > 0) {
    writes.push(db.update(accounts).set({ insightsDeniedAt: now }).where(inArray(accounts.id, [...denied])));
  }
  return writes;
}

/**
 * 確定した投稿があったAccountで、判定がまだの確定の投稿をまとめて判定する（research.md R5、contracts/metrics-job.md 6-5 の5）。
 * 基準値は「確定」（遅れて確定を除く）で閲覧数のある、投稿の新しい30件の中央値。5件未満・基準値0なら判定しない。
 * @param db - データベース
 * @param now - 今
 * @param accountIds - 対象のAccount
 */
async function judgeAccounts(db: Db, now: Date, accountIds: string[]) {
  const ids = sql.join(accountIds.map((id) => sql`${id}::uuid`), sql`, `);
  await db.execute(sql`
    WITH ranked AS (
      SELECT pm.account_id, pm.views,
        row_number() OVER (PARTITION BY pm.account_id ORDER BY d.published_at DESC, d.id) AS rn
      FROM post_metrics pm JOIN post_drafts d ON d.id = pm.draft_id
      WHERE pm.account_id IN (${ids}) AND pm.state = 'confirmed' AND pm.views IS NOT NULL
    ), b AS (
      SELECT account_id, count(*) AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY views) AS median
      FROM ranked WHERE rn <= ${PERFORMANCE_BASELINE_SAMPLE} GROUP BY account_id
    )
    UPDATE post_metrics pm SET
      judgment = (CASE
        WHEN pm.views::float8 / b.median >= ${PERFORMANCE_GOOD_RATIO} THEN 'good'
        WHEN pm.views::float8 / b.median <= ${PERFORMANCE_POOR_RATIO} THEN 'poor'
        ELSE 'normal' END)::judgment,
      judgment_ratio = pm.views::float8 / b.median,
      judgment_baseline = b.median,
      judged_at = ${now.toISOString()},
      updated_at = ${now.toISOString()}
    FROM b
    WHERE pm.account_id = b.account_id AND pm.state IN ('confirmed', 'late_confirmed')
      AND pm.judgment IS NULL AND pm.views IS NOT NULL
      AND b.n >= ${PERFORMANCE_MIN_JUDGEABLE} AND b.median > 0
  `);
}
