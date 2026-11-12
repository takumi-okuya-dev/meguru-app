// アルゴリズムの解析（specs/022-algorithm-analysis contracts/api.md、research.md R1・R2・R7〜R10）。
// 材料は006で取りためた確定した投稿だけ。計算は shared の analyzePosts で、読むたびに行い保存しない。
import {
  ANALYSIS_CLASSIFY_BATCH,
  ANALYSIS_PERIOD_DAYS,
  analyzePosts,
  jstToday,
  trendsForPrompt,
  type AnalysisPost,
  type AnalysisScope,
  type AnalysisSettings,
  type AnalysisSettingsRequest,
  type AnalysisTheme,
  type ClassificationsRequest,
  type OpeningType,
  type PostLengthSettings,
  type PromptTrend,
} from "@meguru/shared";
import { and, desc, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db, TxDb } from "../../../kernel/db/client";
import { analysisSettings, postClassifications, postDrafts, postMentions, postMetricSnapshots, postMetrics, promotions } from "../schema";
import { AppError } from "../../../kernel/errors";
import type { AccountAccess, AccountRow } from "../access/access";
import { recordActivity } from "../activity/activity-log";
import { readPostingSchedule, toPostingSchedule } from "../publish/posting-schedule-service";

const DAY_MS = 86_400_000;
const CLASSIFIED_LIST_LIMIT = 200;

/**
 * 解析の期間（日本時間の今日から89日前の0時以降。FR-001）。
 * @param now - 今
 * @returns 始めの日・終わりの日（YYYY-MM-DD）と、始めの日時
 */
export function analysisPeriod(now: Date) {
  const to = jstToday(now);
  const from = jstToday(new Date(new Date(`${to}T00:00:00+09:00`).getTime() - (ANALYSIS_PERIOD_DAYS - 1) * DAY_MS));
  return { from, to, since: new Date(`${from}T00:00:00+09:00`), days: ANALYSIS_PERIOD_DAYS };
}

// 期間の確定した投稿（遅れて確定・計測できないは使わない）
const confirmedInPeriod = (accountId: string, since: Date) =>
  and(
    eq(postDrafts.accountId, accountId),
    eq(postDrafts.status, "published"),
    gte(postDrafts.publishedAt, since),
    eq(postMetrics.state, "confirmed"),
  );

/**
 * 宣伝の投稿かを見分ける関数（research.md R9）。本文に宣伝内容のタイトルか専用URLがあれば宣伝の投稿。
 * @param db - データベース
 * @param accountId - accounts.id
 * @returns 本文を受け取って宣伝の投稿なら true を返す関数
 */
async function promoMatcher(db: Db | TxDb, accountId: string) {
  const rows = await db
    .select({ title: promotions.title, linkedUrl: promotions.linkedUrl })
    .from(promotions)
    .where(eq(promotions.accountId, accountId));
  const needles = rows.flatMap((r) => [r.title.trim(), r.linkedUrl?.trim() ?? ""]).filter((s) => s !== "");
  return (body: string) => needles.some((n) => body.includes(n));
}

/**
 * 解析の材料を1回で読む（research.md R2）。24時間の値・投稿時点のフォロワー数・分類を結合する。
 * @param db - データベース
 * @param accountId - accounts.id
 * @param now - 今
 * @returns 確定した投稿（投稿の新しい順）
 */
export async function loadAnalysisPosts(db: Db | TxDb, accountId: string, now: Date): Promise<AnalysisPost[]> {
  const { since } = analysisPeriod(now);
  const s24 = alias(postMetricSnapshots, "s24");
  const [rows, isPromo] = await Promise.all([
    db
      .select({
        id: postDrafts.id,
        body: postDrafts.body,
        publishedAt: postDrafts.publishedAt,
        views: postMetrics.views,
        likes: postMetrics.likes,
        replies: postMetrics.replies,
        reposts: postMetrics.reposts,
        quotes: postMetrics.quotes,
        // 投稿した日時より前で最も新しいフォロワー数（006 FR-002c。パフォーマンスのCSVと同じ）
        followersAtPost: sql<number | null>`(SELECT f.followers_count FROM follower_snapshots f
          WHERE f.account_id = ${postDrafts.accountId} AND f.captured_at <= ${postDrafts.publishedAt}
          ORDER BY f.captured_at DESC LIMIT 1)`,
        h24Views: s24.views,
        openingType: postClassifications.openingType,
        themeId: postClassifications.themeId,
        // 時間差のメンションの返信（自分の返信）が、反応数の取り込みより前に出ていれば1（specs/023 research.md R7）
        ownReply: sql<number>`CASE WHEN ${postMentions.sentAt} IS NOT NULL AND ${postMentions.sentAt} <= ${postMetrics.lastFetchedAt} THEN 1 ELSE 0 END`,
      })
      .from(postDrafts)
      .innerJoin(postMetrics, eq(postMetrics.draftId, postDrafts.id))
      .leftJoin(s24, and(eq(s24.draftId, postDrafts.id), eq(s24.kind, "h24")))
      .leftJoin(postClassifications, eq(postClassifications.draftId, postDrafts.id))
      .leftJoin(postMentions, and(eq(postMentions.draftId, postDrafts.id), eq(postMentions.state, "sent")))
      .where(confirmedInPeriod(accountId, since))
      .orderBy(desc(postDrafts.publishedAt)),
    promoMatcher(db, accountId),
  ]);
  return rows.map((r) => ({
    id: r.id,
    body: r.body,
    publishedAt: r.publishedAt!.toISOString(),
    views: r.views ?? 0,
    likes: r.likes ?? 0,
    replies: Math.max(0, (r.replies ?? 0) - Number(r.ownReply)),
    reposts: r.reposts ?? 0,
    quotes: r.quotes ?? 0,
    followersAtPost: r.followersAtPost === null ? null : Number(r.followersAtPost),
    h24Views: r.h24Views,
    openingType: r.openingType as OpeningType | null,
    themeId: r.themeId,
    promo: isPromo(r.body),
  }));
}

/**
 * 解析の設定を読む。行がなければ初めの値（version は null）。
 * @param db - データベース
 * @param accountId - accounts.id
 * @returns 設定
 */
export async function readAnalysisSettings(db: Db | TxDb, accountId: string): Promise<AnalysisSettings> {
  const [row] = await db.select().from(analysisSettings).where(eq(analysisSettings.accountId, accountId));
  return row
    ? { trendsInPrompt: row.trendsInPrompt, themes: row.themes, version: row.version }
    : { trendsInPrompt: true, themes: [], version: null };
}

/**
 * 解析の画面のデータ（GET …/analysis）。
 * @param db - データベース
 * @param access - authorizeAccount の結果（view）
 * @param scope - すべて・ふだんの投稿
 * @param lengthSettings - Accountの文字数の設定
 * @param now - 今
 * @returns contracts/api.md の応答
 */
export async function getAnalysis(
  db: Db,
  access: AccountAccess,
  scope: AnalysisScope,
  lengthSettings: PostLengthSettings,
  now: Date,
) {
  const accountId = access.account.id;
  const [posts, settings, schedule] = await Promise.all([
    loadAnalysisPosts(db, accountId, now),
    readAnalysisSettings(db, accountId),
    readPostingSchedule(db, accountId),
  ]);
  const used = scope === "regular" ? posts.filter((p) => !p.promo) : posts;
  const result = analyzePosts(used, { lengthSettings, themes: settings.themes });
  const { from, to, days } = analysisPeriod(now);
  return {
    period: { from, to, days },
    scope,
    ...result,
    // 宣伝の投稿の数は、選んだ範囲によらず期間の全体で数える
    totals: { ...result.totals, promo: posts.filter((p) => p.promo).length },
    schedule: { slotTimes: toPostingSchedule(schedule).slotTimes },
    settings,
    canEdit: access.permissions.has("content"),
  };
}

/**
 * 投稿のプロンプトに入れる傾向（research.md R7）。設定がONのとき、「ふだんの投稿」で求める。
 * @param db - データベース
 * @param account - Account の行
 * @param lengthSettings - Accountの文字数の設定
 * @param coreRules - CORE RULESの空でない行
 * @param ngWords - NGワード
 * @param now - 今
 * @returns 入れる傾向（なければ []）
 */
export async function trendsForAccountPrompt(
  db: Db,
  account: AccountRow,
  lengthSettings: PostLengthSettings,
  coreRules: readonly string[],
  ngWords: readonly string[],
  now: Date,
): Promise<PromptTrend[]> {
  const settings = await readAnalysisSettings(db, account.id);
  if (!settings.trendsInPrompt) return [];
  const posts = (await loadAnalysisPosts(db, account.id, now)).filter((p) => !p.promo);
  const { trends } = analyzePosts(posts, { lengthSettings, themes: settings.themes });
  return trendsForPrompt(trends, coreRules, ngWords).map((t) => ({ text: t.text, count: t.count, ratio: t.ratio }));
}

/**
 * 新しいテーマのid（`t`＋英数字8文字まで）。
 * @param used - 使っているid
 * @returns id
 */
function newThemeId(used: ReadonlySet<string>): string {
  for (;;) {
    const id = `t${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
    if (!used.has(id)) return id;
  }
}

/**
 * 解析の設定を保存する（PATCH …/analysis/settings）。消したテーマの分類は、同じトランザクションでテーマなしにする。
 * @param tx - トランザクション
 * @param access - authorizeAccount の結果（content）
 * @param req - 入力
 * @returns 保存した設定
 * @throws AppError STALE_UPDATE（ほかで先に保存された）
 */
export async function updateAnalysisSettings(tx: TxDb, access: AccountAccess, req: AnalysisSettingsRequest) {
  const accountId = access.account.id;
  const current = await readAnalysisSettings(tx, accountId);
  const stale = () => {
    throw new AppError("STALE_UPDATE", 409, "updated elsewhere", current, undefined);
  };
  if (current.version !== req.expectedVersion) return stale();
  let themes: AnalysisTheme[] = current.themes;
  if (req.themes) {
    const known = new Set(current.themes.map((t) => t.id));
    const used = new Set<string>();
    themes = req.themes.map((t) => {
      const id = t.id && known.has(t.id) && !used.has(t.id) ? t.id : newThemeId(new Set([...known, ...used]));
      used.add(id);
      return { id, name: t.name };
    });
    const removed = current.themes.map((t) => t.id).filter((id) => !used.has(id));
    if (removed.length > 0) {
      await tx
        .update(postClassifications)
        .set({ themeId: null })
        .where(and(eq(postClassifications.accountId, accountId), inArray(postClassifications.themeId, removed)));
    }
  }
  const trendsInPrompt = req.trendsInPrompt ?? current.trendsInPrompt;
  const values = { trendsInPrompt, themes, updatedByUserId: access.actor.id, updatedAt: new Date() };
  const [row] =
    req.expectedVersion === null
      ? await tx.insert(analysisSettings).values({ accountId, ...values }).onConflictDoNothing().returning()
      : await tx
          .update(analysisSettings)
          .set({ ...values, version: sql`${analysisSettings.version} + 1` })
          .where(and(eq(analysisSettings.accountId, accountId), eq(analysisSettings.version, req.expectedVersion)))
          .returning();
  if (!row) return stale();
  await recordActivity(tx, access, {
    kind: "content",
    action: "analysis_settings_updated",
    summary: req.themes
      ? `解析のテーマ（${themes.length}個）`
      : `伸びた傾向をプロンプトに${trendsInPrompt ? "入れる" : "入れない"}`,
  });
  return { settings: { trendsInPrompt: row.trendsInPrompt, themes: row.themes, version: row.version } };
}

/**
 * 分類する・直す投稿（GET …/analysis/classifications）。
 * @param db - データベース
 * @param accountId - accounts.id
 * @param mode - まだの投稿・分類済み
 * @param now - 今
 * @returns 投稿・残りの件数・テーマ
 */
export async function listClassificationTargets(db: Db, accountId: string, mode: "unclassified" | "classified", now: Date) {
  const { since } = analysisPeriod(now);
  const where = and(
    confirmedInPeriod(accountId, since),
    mode === "unclassified" ? isNull(postClassifications.draftId) : isNotNull(postClassifications.draftId),
  );
  const limit = mode === "unclassified" ? ANALYSIS_CLASSIFY_BATCH : CLASSIFIED_LIST_LIMIT;
  const [rows, [count], settings] = await Promise.all([
    db
      .select({
        draftId: postDrafts.id,
        body: postDrafts.body,
        publishedAt: postDrafts.publishedAt,
        openingType: postClassifications.openingType,
        themeId: postClassifications.themeId,
      })
      .from(postDrafts)
      .innerJoin(postMetrics, eq(postMetrics.draftId, postDrafts.id))
      .leftJoin(postClassifications, eq(postClassifications.draftId, postDrafts.id))
      .where(where)
      .orderBy(desc(postDrafts.publishedAt), desc(postDrafts.id))
      .limit(limit),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(postDrafts)
      .innerJoin(postMetrics, eq(postMetrics.draftId, postDrafts.id))
      .leftJoin(postClassifications, eq(postClassifications.draftId, postDrafts.id))
      .where(where),
    readAnalysisSettings(db, accountId),
  ]);
  return {
    posts: rows.map((r) => ({
      draftId: r.draftId,
      body: r.body,
      publishedAt: r.publishedAt!.toISOString(),
      openingType: r.openingType as OpeningType | null,
      themeId: r.themeId,
    })),
    remaining: Math.max(0, Number(count?.n ?? 0) - rows.length),
    themes: settings.themes,
  };
}

/**
 * 分類を保存する（PUT …/analysis/classifications）。そのAccountの期間の確定した投稿でないもの・知らないテーマは保存しない。
 * @param tx - トランザクション
 * @param access - authorizeAccount の結果（content）
 * @param req - 入力
 * @param now - 今
 * @returns 保存した件数と、保存しなかった draftId
 */
export async function saveClassifications(tx: TxDb, access: AccountAccess, req: ClassificationsRequest, now: Date) {
  const accountId = access.account.id;
  const { since } = analysisPeriod(now);
  const ids = [...new Set(req.items.map((i) => i.draftId))];
  const [targets, settings] = await Promise.all([
    tx
      .select({ id: postDrafts.id })
      .from(postDrafts)
      .innerJoin(postMetrics, eq(postMetrics.draftId, postDrafts.id))
      .where(and(confirmedInPeriod(accountId, since), inArray(postDrafts.id, ids))),
    readAnalysisSettings(tx, accountId),
  ]);
  const ok = new Set(targets.map((t) => t.id));
  const themeIds = new Set(settings.themes.map((t) => t.id));
  const skipped: string[] = [];
  const rows = new Map<string, (typeof req.items)[number]>();
  for (const item of req.items) {
    if (!ok.has(item.draftId) || (item.themeId !== null && !themeIds.has(item.themeId))) skipped.push(item.draftId);
    else rows.set(item.draftId, item);
  }
  if (rows.size > 0) {
    const updatedAt = new Date();
    await tx
      .insert(postClassifications)
      .values(
        [...rows.values()].map((i) => ({
          draftId: i.draftId,
          accountId,
          openingType: i.openingType,
          themeId: i.themeId,
          source: req.source,
          updatedByUserId: access.actor.id,
          updatedAt,
        })),
      )
      .onConflictDoUpdate({
        target: postClassifications.draftId,
        set: {
          openingType: sql`excluded.opening_type`,
          themeId: sql`excluded.theme_id`,
          source: sql`excluded.source`,
          updatedByUserId: sql`excluded.updated_by_user_id`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
    await recordActivity(tx, access, {
      kind: "content",
      action: "posts_classified",
      summary: `投稿の内容の分類（${rows.size}件）`,
    });
  }
  return { saved: rows.size, skipped: [...new Set(skipped)] };
}
