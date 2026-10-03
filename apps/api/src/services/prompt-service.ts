// プロンプトの材料を集めて組み立てる（specs/003-prompt-bulk-register research.md R1、contracts/prompt-template.md「入力」）。
import {
  PROMPT_RECENT_DRAFTS,
  PROMPT_REFERENCE_POSTS,
  buildPrompt,
  isTargetable,
  type PromptPromotion,
} from "@threads-grower/shared";
import { desc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { promotions, referencePosts } from "../db/schema";
import type { AccountRow } from "./access";
import { listDraftRows } from "./draft-service";
import { getStrategy } from "./strategy-service";

type PromotionRow = typeof promotions.$inferSelect;

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
    content: r.content,
    targetLocation: r.targetLocation ?? "",
    targetPersona: r.targetPersona ?? "",
    targetAgeRange: r.targetAgeRange ?? "",
    cta: r.cta ?? "",
    linkedUrl: r.linkedUrl,
  };
}

/**
 * 最新の材料からプロンプトを組み立てる（FR-002・FR-007）。材料の取得は並べて行う。
 * @param db - データベース
 * @param account - Account の行
 * @param count - 作る件数
 * @returns 全文・件数・要約
 */
export async function getPrompt(db: Db, account: AccountRow, count: number) {
  const now = new Date();
  const [strategy, promotionRows, postRows, draftRows] = await Promise.all([
    getStrategy(db, account.id),
    db.select().from(promotions).where(eq(promotions.accountId, account.id)),
    db
      .select()
      .from(referencePosts)
      .where(eq(referencePosts.accountId, account.id))
      .orderBy(desc(referencePosts.createdAt), desc(referencePosts.id))
      .limit(PROMPT_REFERENCE_POSTS),
    listDraftRows(db, account.id, PROMPT_RECENT_DRAFTS),
  ]);
  const { prompt, summary } = buildPrompt({
    count,
    displayName: account.displayName ?? `@${account.username}`,
    strategy,
    promotions: targetPromotions(promotionRows, now).map(toPromptPromotion),
    promotionRatioPercent: account.promotionRatioPercent,
    referencePosts: postRows.map((p) => ({ body: p.body, keyword: p.keyword ?? "", whyGood: p.whyGood ?? "" })),
    recentDrafts: draftRows.map((d) => d.body),
  });
  return { prompt, count, summary };
}
