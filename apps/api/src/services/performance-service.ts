// パフォーマンスの画面のデータ（specs/006-performance-feedback contracts/api.md、research.md R5・R6）。
// 基準値・タブの件数は1つの集計クエリで、一覧は005の投稿済みの一覧と同じカーソルで読む。本文以外の大きな列は返さない。
import {
  PERFORMANCE_BASELINE_SAMPLE,
  PERFORMANCE_EXPORT_PAGE_SIZE,
  PERFORMANCE_MIN_JUDGEABLE,
  PROMPT_POOR_POSTS,
  confirmAtOf,
  nextFetchAtOf,
  type FeedbackRequest,
  type Judgment,
  type MetricsState,
  type PerformanceItem,
  type PerformanceSummary,
  type PerformanceTab,
  type PostExportRow,
  type SnapshotExportRow,
} from "@threads-grower/shared";
import { alias } from "drizzle-orm/pg-core";
import { and, asc, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { Db, TxDb } from "../kernel/db/client";
import { draftBatches, postDrafts, postMetricSnapshots, postMetrics } from "../db/schema";
import { AppError, itemNotFound } from "../kernel/errors";
import type { AccountAccess, AccountRow } from "../platform";
import { recordActivity, updatedByOf } from "../platform";
import { decodeCursor, encodeCursor } from "./draft-service";
import { assertItemId } from "./item-service";

type Row = {
  id: string;
  body: string;
  publishedAt: Date | null;
  permalink: string | null;
  state: "updating" | "confirmed" | "late_confirmed" | "unmeasurable" | null;
  views: number | null;
  likes: number | null;
  replies: number | null;
  reposts: number | null;
  quotes: number | null;
  shares: number | null;
  lastFetchedAt: Date | null;
  lastElapsedMinutes: number | null;
  judgment: Judgment | null;
  ratio: number | null;
  unmeasurableReason: string | null;
  memo: string | null;
  includeInPrompt: boolean | null;
  feedbackVersion: number | null;
};

/**
 * 画面の上の集計を求める（FR-003・FR-009・FR-012・FR-015）。
 * @param db - データベース
 * @param account - Account の行
 * @returns 集計
 */
export async function getPerformanceSummary(db: Db, account: AccountRow): Promise<PerformanceSummary> {
  const res = await db.execute<{
    n: number;
    median: number | null;
    last_fetched_at: string | null;
    all: number;
    good: number;
    normal: number;
    poor: number;
    pending: number;
  }>(sql`
    WITH base AS (
      SELECT pm.views FROM post_metrics pm JOIN post_drafts d ON d.id = pm.draft_id
      WHERE pm.account_id = ${account.id} AND pm.state = 'confirmed' AND pm.views IS NOT NULL
      ORDER BY d.published_at DESC, d.id LIMIT ${PERFORMANCE_BASELINE_SAMPLE}
    )
    SELECT
      (SELECT count(*)::int FROM base) AS n,
      (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY views) FROM base) AS median,
      (SELECT max(last_fetched_at) FROM post_metrics WHERE account_id = ${account.id}) AS last_fetched_at,
      count(*)::int AS all,
      count(*) FILTER (WHERE pm.judgment = 'good')::int AS good,
      count(*) FILTER (WHERE pm.judgment = 'normal')::int AS normal,
      count(*) FILTER (WHERE pm.judgment = 'poor')::int AS poor,
      count(*) FILTER (WHERE pm.draft_id IS NULL OR pm.state = 'updating')::int AS pending
    FROM post_drafts d LEFT JOIN post_metrics pm ON pm.draft_id = d.id
    WHERE d.account_id = ${account.id} AND d.status = 'published'
  `);
  const r = res.rows[0]!;
  const n = Number(r.n);
  const median = r.median === null ? null : Number(r.median);
  const enough = n >= PERFORMANCE_MIN_JUDGEABLE;
  return {
    baseline: enough ? median : null,
    baselineSampleCount: n,
    judgeableCount: n,
    baselineIsZero: enough && median === 0,
    lastFetchedAt: r.last_fetched_at ? new Date(r.last_fetched_at).toISOString() : null,
    insightsDenied: account.insightsDeniedAt !== null,
    needsReconnect: account.connectionStatus === "needs_reconnect",
    notConnected: account.connectionStatus === "not_connected",
    counts: {
      all: Number(r.all),
      good: Number(r.good),
      normal: Number(r.normal),
      poor: Number(r.poor),
      pending: Number(r.pending),
    },
  };
}

/**
 * 次のプロンプトに入る低調の投稿（FR-022・FR-026）。プロンプトの材料（prompt-service）と同じ条件。
 * @param db - データベース
 * @param accountId - accounts.id
 * @returns 下書きのID（投稿した日時の新しい順、最大5件）
 */
export async function nextPromptIds(db: Db | TxDb, accountId: string): Promise<string[]> {
  const rows = await db
    .select({ id: postDrafts.id })
    .from(postMetrics)
    .innerJoin(postDrafts, eq(postDrafts.id, postMetrics.draftId))
    .where(poorForPrompt(accountId))
    .orderBy(desc(postDrafts.publishedAt), asc(postDrafts.id))
    .limit(PROMPT_POOR_POSTS);
  return rows.map((r) => r.id);
}

/**
 * プロンプトに入れる低調の投稿の条件（research.md R8）。
 * @param accountId - accounts.id
 * @returns 条件
 */
export function poorForPrompt(accountId: string): SQL {
  return and(
    eq(postMetrics.accountId, accountId),
    eq(postMetrics.judgment, "poor"),
    eq(postMetrics.includeInPrompt, true),
    inArray(postMetrics.state, ["confirmed", "late_confirmed"]),
    eq(postDrafts.status, "published"),
  )!;
}

/**
 * タブの絞り込みの条件。
 * @param tab - タブ
 * @returns 条件（all は undefined）
 */
function tabFilter(tab: PerformanceTab): SQL | undefined {
  if (tab === "all") return undefined;
  if (tab === "pending") return or(isNull(postMetrics.draftId), eq(postMetrics.state, "updating"));
  return eq(postMetrics.judgment, tab);
}

/**
 * 一覧の1ページを読む（FR-016〜FR-019）。投稿した日時の新しい順、同じ日時は id の順。
 * @param db - データベース
 * @param accountId - accounts.id
 * @param opts - tab・before（前のページの nextCursor）・limit
 * @returns 項目と、続きを読むときの nextCursor
 */
export async function listPerformancePage(
  db: Db,
  accountId: string,
  opts: { tab: PerformanceTab; before?: string; limit: number },
): Promise<{ items: PerformanceItem[]; nextCursor: string | null }> {
  const cursor = opts.before ? decodeCursor(opts.before) : null;
  if (opts.before && !cursor) throw new AppError("VALIDATION_FAILED", 400, "invalid cursor", undefined, ["before"]);
  const [rows, promptIds] = await Promise.all([
    selectItems(db)
      .where(
        and(
          eq(postDrafts.accountId, accountId),
          eq(postDrafts.status, "published"),
          tabFilter(opts.tab),
          cursor
            ? sql`(${postDrafts.publishedAt} < ${cursor.publishedAt.toISOString()}
                OR (${postDrafts.publishedAt} = ${cursor.publishedAt.toISOString()} AND ${postDrafts.id} > ${cursor.id}))`
            : undefined,
        ),
      )
      .orderBy(desc(postDrafts.publishedAt), asc(postDrafts.id))
      .limit(opts.limit + 1),
    opts.tab === "all" || opts.tab === "poor" ? nextPromptIds(db, accountId) : Promise.resolve([] as string[]),
  ]);
  const page = rows.slice(0, opts.limit);
  const last = page.at(-1);
  const inPrompt = new Set(promptIds);
  return {
    items: page.map((r) => toItem(r as Row, inPrompt)),
    nextCursor: rows.length > opts.limit && last ? encodeCursor(last.publishedAt!, last.id) : null,
  };
}

/**
 * 一覧の項目の列を選ぶ（下書きと反応数の記録を結合する）。
 * @param db - データベース
 * @returns where・orderBy をつなげるクエリ
 */
function selectItems(db: Db | TxDb) {
  return db
      .select({
        id: postDrafts.id,
        body: postDrafts.body,
        publishedAt: postDrafts.publishedAt,
        permalink: postDrafts.threadsPermalink,
        state: postMetrics.state,
        views: postMetrics.views,
        likes: postMetrics.likes,
        replies: postMetrics.replies,
        reposts: postMetrics.reposts,
        quotes: postMetrics.quotes,
        shares: postMetrics.shares,
        lastFetchedAt: postMetrics.lastFetchedAt,
        lastElapsedMinutes: postMetrics.lastElapsedMinutes,
        judgment: postMetrics.judgment,
        ratio: postMetrics.judgmentRatio,
        unmeasurableReason: postMetrics.unmeasurableReason,
        memo: postMetrics.feedbackMemo,
        includeInPrompt: postMetrics.includeInPrompt,
        feedbackVersion: postMetrics.feedbackVersion,
      })
      .from(postDrafts)
      .leftJoin(postMetrics, eq(postMetrics.draftId, postDrafts.id));
}

/**
 * 低調の投稿の傾向メモと「プロンプトに入れる」を保存する（FR-021・FR-024）。後から保存したもので上書きする。
 * @param db - データベース
 * @param accountId - accounts.id
 * @param draftId - post_drafts.id
 * @param req - memo・includeInPrompt（検証済み）
 * @param now - 今
 * @param access - 保存した人（記録と、保存の衝突の名前に使う。specs/008）
 * @returns 更新後の項目と、次のプロンプトに入る投稿
 * @throws AppError ITEM_NOT_FOUND（そのAccountの低調の投稿でない）
 */
export async function updateFeedback(
  db: Db | TxDb,
  accountId: string,
  draftId: string,
  req: FeedbackRequest,
  now: Date = new Date(),
  access?: AccountAccess,
): Promise<{ item: PerformanceItem; promptIds: string[] }> {
  assertItemId(draftId);
  const target = and(
    eq(postMetrics.draftId, draftId),
    eq(postMetrics.accountId, accountId),
    eq(postMetrics.judgment, "poor"),
    inArray(postMetrics.state, ["confirmed", "late_confirmed"]),
  );
  const updated = await db
    .update(postMetrics)
    .set({
      ...(req.memo !== undefined ? { feedbackMemo: req.memo } : {}),
      ...(req.includeInPrompt !== undefined ? { includeInPrompt: req.includeInPrompt } : {}),
      feedbackVersion: sql`${postMetrics.feedbackVersion} + 1`,
      ...(access ? { feedbackUpdatedByUserId: access.actor.id } : {}),
      feedbackUpdatedAt: now,
      updatedAt: now,
    })
    .where(req.expectedVersion === undefined ? target : and(target, eq(postMetrics.feedbackVersion, req.expectedVersion)))
    .returning();
  if (updated.length === 0) {
    // 版が違う（他の人が先に保存した）なら 409、そもそも対象でなければ 404（specs/008 FR-007）
    const [current] = await db
      .select({ by: postMetrics.feedbackUpdatedByUserId })
      .from(postMetrics)
      .where(target)
      .limit(1);
    if (!current) throw itemNotFound();
    throw new AppError("STALE_UPDATE", 409, "updated elsewhere", undefined, undefined, {
      updatedBy: await updatedByOf(db, current.by),
    });
  }
  if (access) {
    await recordActivity(db, access, {
      kind: "content",
      action: "feedback_saved",
      summary: feedbackSummary(req),
    });
  }
  const [[row], promptIds] = await Promise.all([
    selectItems(db).where(eq(postDrafts.id, draftId)).limit(1),
    nextPromptIds(db, accountId),
  ]);
  return { item: toItem(row as Row, new Set(promptIds)), promptIds };
}

/**
 * 改善メモの保存の記録に出す要約。
 * @param req - 保存した内容
 * @returns 要約
 */
function feedbackSummary(req: FeedbackRequest): string {
  if (req.memo !== undefined) return req.memo ?? "（メモを消した）";
  return req.includeInPrompt ? "プロンプトに入れる" : "プロンプトから外す";
}

/**
 * 一覧の行を画面の項目にする。
 * @param r - 行
 * @param inPrompt - 次のプロンプトに入る下書きのID
 * @returns 項目
 */
export function toItem(r: Row, inPrompt: Set<string>): PerformanceItem {
  const publishedAt = r.publishedAt!;
  const state: MetricsState = r.state ?? "pending";
  const hasMetrics = r.lastFetchedAt !== null;
  const confirmed = state === "confirmed" || state === "late_confirmed";
  return {
    id: r.id,
    body: r.body,
    publishedAt: publishedAt.toISOString(),
    threadsPermalink: r.permalink,
    state,
    metrics: hasMetrics
      ? { views: r.views, likes: r.likes, replies: r.replies, reposts: r.reposts, quotes: r.quotes, shares: r.shares }
      : null,
    lastFetchedAt: r.lastFetchedAt ? r.lastFetchedAt.toISOString() : null,
    lastElapsedHours: r.lastElapsedMinutes === null ? null : Math.floor(r.lastElapsedMinutes / 60),
    nextFetchAt: state === "pending" ? nextFetchAtOf(publishedAt).toISOString() : null,
    confirmAt: state === "pending" || state === "updating" ? confirmAtOf(publishedAt).toISOString() : null,
    judgment: confirmed ? r.judgment : null,
    ratio: confirmed && r.judgment ? r.ratio : null,
    unmeasurableReason: (r.unmeasurableReason as PerformanceItem["unmeasurableReason"]) ?? null,
    feedback:
      confirmed && r.judgment === "poor"
        ? {
            memo: r.memo,
            includeInPrompt: r.includeInPrompt ?? true,
            inNextPrompt: inPrompt.has(r.id),
            version: r.feedbackVersion ?? 1,
          }
        : null,
  };
}

/**
 * 6つの数の列をまとめる。取り込んでいなければ null。
 * @param r - 数の列
 * @param fetched - 取り込んだか
 * @returns 数
 */
function metricsOf(
  r: { views: number | null; likes: number | null; replies: number | null; reposts: number | null; quotes: number | null; shares: number | null },
  fetched: boolean,
) {
  return fetched
    ? { views: r.views, likes: r.likes, replies: r.replies, reposts: r.reposts, quotes: r.quotes, shares: r.shares }
    : null;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/**
 * 書き出しの行を200件ずつ読む（FR-028・FR-028a・FR-029、contracts/csv.md）。CSVの整形はWebで行う（research.md R7）。
 * @param db - データベース
 * @param accountId - accounts.id
 * @param kind - posts（投稿ごと）か snapshots（取り込みごと）
 * @param before - 前のページの nextCursor
 * @returns 行と、続きを読むときの nextCursor
 */
export async function listExportRows(
  db: Db,
  accountId: string,
  kind: "posts" | "snapshots",
  before?: string,
): Promise<{ rows: PostExportRow[] | SnapshotExportRow[]; nextCursor: string | null }> {
  const cursor = before ? decodeCursor(before) : null;
  if (before && !cursor) throw new AppError("VALIDATION_FAILED", 400, "invalid cursor", undefined, ["before"]);
  const limit = PERFORMANCE_EXPORT_PAGE_SIZE;
  if (kind === "snapshots") {
    const rows = await db
      .select({
        snapshotId: postMetricSnapshots.id,
        id: postMetricSnapshots.draftId,
        publishedAt: postDrafts.publishedAt,
        fetchedAt: postMetricSnapshots.fetchedAt,
        elapsedMinutes: postMetricSnapshots.elapsedMinutes,
        kind: postMetricSnapshots.kind,
        method: postMetricSnapshots.method,
        views: postMetricSnapshots.views,
        likes: postMetricSnapshots.likes,
        replies: postMetricSnapshots.replies,
        reposts: postMetricSnapshots.reposts,
        quotes: postMetricSnapshots.quotes,
        shares: postMetricSnapshots.shares,
        // 取り込んだ日（日本時間）のフォロワー数
        followersOnDay: sql<number | null>`(SELECT f.followers_count FROM follower_snapshots f
          WHERE f.account_id = ${postMetricSnapshots.accountId}
            AND f.snapshot_date = (${postMetricSnapshots.fetchedAt} AT TIME ZONE 'Asia/Tokyo')::date)`,
      })
      .from(postMetricSnapshots)
      .innerJoin(postDrafts, eq(postDrafts.id, postMetricSnapshots.draftId))
      .where(
        and(
          eq(postMetricSnapshots.accountId, accountId),
          cursor
            ? sql`(${postMetricSnapshots.fetchedAt} < ${cursor.publishedAt.toISOString()}
                OR (${postMetricSnapshots.fetchedAt} = ${cursor.publishedAt.toISOString()} AND ${postMetricSnapshots.id} > ${cursor.id}))`
            : undefined,
        ),
      )
      .orderBy(desc(postMetricSnapshots.fetchedAt), asc(postMetricSnapshots.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      rows: page.map((r) => ({
        id: r.id,
        publishedAt: r.publishedAt!.toISOString(),
        fetchedAt: r.fetchedAt.toISOString(),
        elapsedMinutes: r.elapsedMinutes,
        kind: r.kind,
        method: r.method as "slot" | "daily",
        metrics: metricsOf(r, true)!,
        followersOnDay: r.followersOnDay === null ? null : Number(r.followersOnDay),
      })),
      nextCursor: rows.length > limit && last ? encodeCursor(last.fetchedAt, last.snapshotId) : null,
    };
  }

  const s24 = alias(postMetricSnapshots, "s24");
  const rows = await db
    .select({
      id: postDrafts.id,
      publishedAt: postDrafts.publishedAt,
      body: postDrafts.body,
      permalink: postDrafts.threadsPermalink,
      state: postMetrics.state,
      views: postMetrics.views,
      likes: postMetrics.likes,
      replies: postMetrics.replies,
      reposts: postMetrics.reposts,
      quotes: postMetrics.quotes,
      shares: postMetrics.shares,
      ratio: postMetrics.judgmentRatio,
      judgment: postMetrics.judgment,
      lastFetchedAt: postMetrics.lastFetchedAt,
      lastElapsedMinutes: postMetrics.lastElapsedMinutes,
      // 投稿した日時より前で最も新しいフォロワー数（FR-002c）
      followersAtPost: sql<number | null>`(SELECT f.followers_count FROM follower_snapshots f
        WHERE f.account_id = ${postDrafts.accountId} AND f.captured_at <= ${postDrafts.publishedAt}
        ORDER BY f.captured_at DESC LIMIT 1)`,
      h24Fetched: s24.id,
      h24Views: s24.views,
      h24Likes: s24.likes,
      h24Replies: s24.replies,
      h24Reposts: s24.reposts,
      h24Quotes: s24.quotes,
      h24Shares: s24.shares,
      batchId: postDrafts.batchId,
      batchPosition: postDrafts.position,
      batchCreatedAt: draftBatches.createdAt,
      approvedAt: postDrafts.reviewedAt,
      prioritized: postDrafts.publishedPrioritized,
      carryover: postDrafts.publishedCarryover,
      editTracked: postDrafts.bodyEditTracked,
      editedAt: postDrafts.bodyEditedAt,
      slotMinute: postDrafts.publishedSlotMinute,
      strategyUpdatedAt: draftBatches.strategyUpdatedAt,
      promotionsChangedAt: draftBatches.promotionsChangedAt,
      researchChangedAt: draftBatches.researchChangedAt,
      coreRulesChangedAt: draftBatches.coreRulesChangedAt,
    })
    .from(postDrafts)
    .innerJoin(draftBatches, eq(draftBatches.id, postDrafts.batchId))
    .leftJoin(postMetrics, eq(postMetrics.draftId, postDrafts.id))
    .leftJoin(s24, and(eq(s24.draftId, postDrafts.id), eq(s24.kind, "h24")))
    .where(
      and(
        eq(postDrafts.accountId, accountId),
        eq(postDrafts.status, "published"),
        cursor
          ? sql`(${postDrafts.publishedAt} < ${cursor.publishedAt.toISOString()}
              OR (${postDrafts.publishedAt} = ${cursor.publishedAt.toISOString()} AND ${postDrafts.id} > ${cursor.id}))`
          : undefined,
      ),
    )
    .orderBy(desc(postDrafts.publishedAt), asc(postDrafts.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    rows: page.map((r) => ({
      id: r.id,
      publishedAt: r.publishedAt!.toISOString(),
      body: r.body,
      metrics: metricsOf(r, r.lastFetchedAt !== null),
      ratio: r.judgment ? r.ratio : null,
      state: (r.state ?? "pending") as MetricsState,
      judgment: r.judgment,
      permalink: r.permalink,
      lastFetchedAt: iso(r.lastFetchedAt),
      lastElapsedMinutes: r.lastElapsedMinutes,
      followersAtPost: r.followersAtPost === null ? null : Number(r.followersAtPost),
      h24:
        r.h24Fetched === null
          ? null
          : {
              views: r.h24Views,
              likes: r.h24Likes,
              replies: r.h24Replies,
              reposts: r.h24Reposts,
              quotes: r.h24Quotes,
              shares: r.h24Shares,
            },
      batchId: r.batchId,
      batchPosition: r.batchPosition,
      batchCreatedAt: r.batchCreatedAt.toISOString(),
      approvedAt: iso(r.approvedAt),
      prioritized: r.prioritized,
      carryover: r.carryover,
      bodyEdited: r.editTracked ? r.editedAt !== null : null,
      slotMinute: r.slotMinute,
      strategyUpdatedAt: iso(r.strategyUpdatedAt),
      promotionsChangedAt: iso(r.promotionsChangedAt),
      researchChangedAt: iso(r.researchChangedAt),
      coreRulesChangedAt: iso(r.coreRulesChangedAt),
    })),
    nextCursor: rows.length > limit && last ? encodeCursor(last.publishedAt!, last.id) : null,
  };
}
