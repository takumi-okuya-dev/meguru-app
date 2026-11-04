// プロンプトの材料を集めて組み立てる（specs/003-prompt-bulk-register research.md R1、contracts/prompt-template.md「入力」）。
import {
  PROMPT_POOR_POSTS,
  PROMPT_RECENT_DRAFTS,
  PROMPT_REFERENCE_POSTS,
  PROMPT_REJECTED_DRAFTS,
  PROMPT_SPLIT_THRESHOLD,
  HINTED_KEYS,
  buildPrompt,
  checkStrategy,
  emptyStrategyValues,
  countChars,
  freshnessOf,
  isBlank,
  isTargetable,
  jstToday,
  rejectReasonLabel,
  sortForPrompt,
  type Feature,
  type PostLengthSettings,
  type PostedDateMode,
  type PromptMaterials,
  type PromptPromotion,
  type ReferenceMetrics,
  type ReferencePlatform,
  type RejectReasonCode,
  type StrategyValues,
} from "@threads-grower/shared";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { draftBatches, postDrafts, postMetrics, promotions, referencePosts } from "../db/schema";
import type { AccountRow } from "./access";
import { listReviewedRows } from "./draft-service";
import { poorForPrompt } from "./performance-service";
import { listNgWords } from "./posting-rules-service";
import { readPostingSchedule } from "./posting-schedule-service";
import { getStrategy } from "./strategy-service";

type PromotionRow = typeof promotions.$inferSelect;

/**
 * アカウントの1投稿の文字数の目標と、短文・中文・長文の文字数と割合（specs/014 research.md R11）。
 * @param a - Account の行
 * @returns 文字数と割合
 */
export function lengthSettingsOf(a: AccountRow): PostLengthSettings {
  return {
    target: a.postLengthTarget,
    shortLength: a.shortLength,
    mediumLength: a.mediumLength,
    longLength: a.longLength,
    shortRatio: a.shortRatio,
    mediumRatio: a.mediumRatio,
    longRatio: a.longRatio,
  };
}

/**
 * 参考投稿の行の数字（specs/014 FR-095）。
 * @param row - reference_posts の行
 * @returns 数字（わからないものは null）
 */
export function referenceMetricsOf(row: typeof referencePosts.$inferSelect): ReferenceMetrics {
  return {
    likes: row.metricLikes,
    replies: row.metricReplies,
    views: row.metricViews,
    saves: row.metricSaves,
    reposts: row.metricReposts,
    followers: row.metricFollowers,
  };
}


/**
 * 宣伝の対象を、掲載期限の近い順（期限なしは最後）、同じなら優先度の高い順に並べる。
 * @param rows - 宣伝内容の行
 * @param now - 現在時刻
 * @returns 宣伝の対象だけを並べた新しい配列
 */
function targetPromotions(rows: PromotionRow[], now: Date): PromotionRow[] {
  return rows
    .filter((r) => isTargetable(r.status, r.validUntil, now))
    .sort((a, b) => {
      if (a.validUntil !== b.validUntil) {
        if (a.validUntil === null) return 1;
        if (b.validUntil === null) return -1;
        return a.validUntil.localeCompare(b.validUntil);
      }
      if (a.priority !== b.priority) return b.priority - a.priority;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });
}

function toPromptPromotion(r: PromotionRow): PromptPromotion {
  return {
    title: r.title,
    validUntil: r.validUntil,
    content: r.content,
    targetLocation: r.targetLocation ?? "",
    targetPersona: r.targetPersona ?? "",
    targetAgeRange: r.targetAgeRange ?? "",
    cta: r.cta ?? "",
    linkedUrl: r.linkedUrl,
    // イベントの情報（specs/021 FR-001a）。あるときだけプロンプトに1行が入る
    event: r.event ?? null,
  };
}

/**
 * 重複防止で比べる直近の下書き（要確認と承認済み。004 FR-024）。登録のまとまりの新しい順 → 貼り付けた順。
 * @param db - データベース
 * @param accountId - accounts.id
 * @returns 本文（最大 PROMPT_RECENT_DRAFTS 件）
 */
async function recentDraftBodies(db: Db, accountId: string): Promise<string[]> {
  const rows = await db
    .select({ body: postDrafts.body })
    .from(postDrafts)
    .innerJoin(draftBatches, eq(draftBatches.id, postDrafts.batchId))
    .where(
      and(
        eq(postDrafts.accountId, accountId),
        inArray(postDrafts.status, ["needs_review", "approved"]),
      ),
    )
    .orderBy(desc(draftBatches.createdAt), desc(draftBatches.id), asc(postDrafts.position))
    .limit(PROMPT_RECENT_DRAFTS);
  return rows.map((r) => r.body);
}

/**
 * 投稿ルールの空でない行（004 FR-022）。
 * @param text - accounts.core_rules
 * @returns 前後の空白を除いて空でない行
 */
function coreRuleLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
}

/**
 * 「プロンプトに入っている情報」（specs/014 FR-121・FR-123、research.md R9）。プロンプトを作るときの数え方のまま数える。
 * @param strategy - 課題の値
 * @param included - プロンプトに入る宣伝内容（宣伝の節がなければ空）
 * @param posts - 参考投稿の全件
 * @param includedPosts - プロンプトに入る参考投稿の件数
 * @returns 情報の一覧
 */
function promptMaterials(
  strategy: StrategyValues,
  included: PromptPromotion[],
  posts: { whyGood: string | null }[],
  includedPosts: number,
): PromptMaterials {
  const check = checkStrategy(strategy);
  const item = (key: (typeof HINTED_KEYS)[number]) => ({ key, ...check.items[key] });
  // 目的の5問 → 活動の軸（判定しない）→ 16項目の順（contracts/api.md）
  const axisChars = isBlank(strategy.activityAxis) ? 0 : countChars(strategy.activityAxis.trim());
  const items = [
    ...HINTED_KEYS.slice(0, 5).map(item),
    { key: "activityAxis", status: null, chars: axisChars },
    ...HINTED_KEYS.slice(5).map(item),
  ];
  const explained = posts.filter((p) => !isBlank(p.whyGood ?? "")).length;
  return {
    strategy: { items, done: check.done, review: check.review, purposeDone: check.purposeDone },
    drafts: {
      profileBio: !isBlank(strategy.profileBioDraft),
      pinned: [strategy.pinnedPostDraft1, strategy.pinnedPostDraft2, strategy.pinnedPostDraft3].map((d) => !isBlank(d)),
    },
    promotions: { included: included.length, missingCta: included.filter((p) => isBlank(p.cta)).length },
    research: { total: posts.length, included: includedPosts, explained, pending: posts.length - explained },
  };
}

/**
 * 最新の材料からプロンプトを組み立てる（FR-002・FR-007）。材料の取得は並べて行う。
 * オーナーが戦略を使えなければ、課題・宣伝内容・参考投稿を読まない（specs/019 research.md R4）。
 * 空の材料の節は buildPrompt が入れないので、プロンプトの組み立ては変えない。
 * @param db - データベース
 * @param account - Account の行
 * @param count - 作る件数
 * @param features - オーナーの使えるまとまり（authorizeAccount の結果）
 * @returns 全文・件数・要約。戦略がOFFなら materials は null
 */
export async function getPrompt(db: Db, account: AccountRow, count: number, features: ReadonlySet<Feature>) {
  const now = new Date();
  const useStrategy = features.has("strategy");
  const [strategy, promotionRows, postRows, draftBodies, ngWordRows, rejectedRows, schedule, poorRows] =
    await Promise.all([
      useStrategy ? getStrategy(db, account.id) : Promise.resolve(emptyStrategyValues()),
      useStrategy ? db.select().from(promotions).where(eq(promotions.accountId, account.id)) : Promise.resolve([]),
      // 鮮度の順に並べるため、全件（上限200件）を読んでから選ぶ（specs/014 FR-099、research.md R6）
      useStrategy
        ? db
            .select()
            .from(referencePosts)
            .where(eq(referencePosts.accountId, account.id))
            .orderBy(desc(referencePosts.createdAt), desc(referencePosts.id))
        : Promise.resolve([]),
      recentDraftBodies(db, account.id),
      listNgWords(db, account.id),
      listReviewedRows(db, account.id, "rejected", PROMPT_REJECTED_DRAFTS),
      readPostingSchedule(db, account.id),
      // 反応が低かった投稿（006 research.md R8）。投稿の新しい順に5件
      db
        .select({ body: postDrafts.body, memo: postMetrics.feedbackMemo })
        .from(postMetrics)
        .innerJoin(postDrafts, eq(postDrafts.id, postMetrics.draftId))
        .where(poorForPrompt(account.id))
        .orderBy(desc(postDrafts.publishedAt), asc(postDrafts.id))
        .limit(PROMPT_POOR_POSTS),
    ]);
  const today = jstToday(now);
  const targetable = targetPromotions(promotionRows, now).map(toPromptPromotion);
  const { prompt, parts, summary, length } = buildPrompt({
    count,
    today,
    // 文字数と長さの割合はアカウントの設定（specs/014 FR-140・FR-171）
    lengthSettings: lengthSettingsOf(account),
    dailyPostCount: schedule?.slotMinutes.length ?? 0,
    // 話者はアカウントの名前（つなぐ前後でプロンプトを変えない。specs/012 FR-037）
    displayName: account.name,
    strategy,
    promotions: targetable,
    promotionRatioPercent: account.promotionRatioPercent,
    referencePosts: sortForPrompt(
      postRows.map((p) => ({ ...p, postedDateMode: p.postedDateMode as PostedDateMode })),
      today,
    )
      .slice(0, PROMPT_REFERENCE_POSTS)
      .map((p) => ({
        body: p.body,
        keyword: p.keyword ?? "",
        whyGood: p.whyGood ?? "",
        platform: p.platform as ReferencePlatform,
        metrics: referenceMetricsOf(p),
        freshness: freshnessOf(p, today),
      })),
    recentDrafts: draftBodies,
    coreRules: coreRuleLines(account.coreRules),
    ngWords: ngWordRows.map((w) => w.word),
    rejectedDrafts: rejectedRows.map((r) => ({
      body: r.body,
      reasonLabels: ((r.rejectReasons ?? []) as RejectReasonCode[]).map(rejectReasonLabel),
      note: r.rejectNote,
    })),
    poorPosts: poorRows,
  });
  // 宣伝の節が入らない（割合0%）なら、宣伝内容は入らない
  const includedPromotions = summary.promotionCount > 0 ? targetable : [];
  return {
    prompt,
    // 2つに分けて送るときの1つ目と2つ目（specs/014 FR-152）。長いときは分けるのをすすめる（FR-150、research.md R12）
    parts,
    count,
    summary,
    length,
    splitRecommended: length > PROMPT_SPLIT_THRESHOLD,
    // 作る件数と文字数・割合（specs/014 research.md R11）
    settings: { postCount: account.promptPostCount, length: lengthSettingsOf(account), version: account.promptPostCountVersion },
    // 戦略がOFFなら「プロンプトに入っている情報」を出さない（specs/019 FR-007）
    materials: useStrategy ? promptMaterials(strategy, includedPromotions, postRows, summary.referencePostCount) : null,
  };
}
