// ホームの入力状況（specs/002-strategy-profile FR-017・FR-024b、research.md R11・R14）。
// 無料体験の状態はオーナーの使える状態から出す（specs/013 research.md R12）。
import { jstToday, trialDaysLeft } from "@meguru/shared";
import { sql } from "drizzle-orm";
import type { Db } from "../../../kernel/db/client";
import type { BillingMode } from "../../../kernel/config";
import type { AccountAccess } from "../../../platform";
import { loadEntitlement } from "../../../platform";
import { getStrategy } from "./strategy-service";

/**
 * 課題の入力済み項目数、宣伝内容・参考投稿・キーワードの件数、無料体験の状態をまとめて返す。
 * 件数は1回のクエリでまとめて数える。
 * @param db - データベース
 * @param access - authorizeAccount の結果（編集できるかは権限 content で決まる）
 * @param mode - 決済のモード（無料体験はオーナーの使える状態で判定する。specs/008 research.md R3）
 * @param now - 現在時刻
 * @returns 入力状況
 */
export async function getProfileStatus(db: Db, access: AccountAccess, mode: BillingMode, now: Date = new Date()) {
  const account = access.account;
  const today = jstToday(now);
  const [strategy, counts, owner] = await Promise.all([
    getStrategy(db, account.id),
    db.execute<{ promo_total: number; promo_targetable: number; posts: number; keywords: number }>(sql`
      SELECT
        (SELECT count(*)::int FROM promotions WHERE account_id = ${account.id}) AS promo_total,
        (SELECT count(*)::int FROM promotions
          WHERE account_id = ${account.id} AND status = 'active'
            AND (valid_until IS NULL OR valid_until >= ${today}::date)) AS promo_targetable,
        (SELECT count(*)::int FROM reference_posts WHERE account_id = ${account.id}) AS posts,
        (SELECT count(*)::int FROM research_keywords WHERE account_id = ${account.id}) AS keywords
    `),
    loadEntitlement(db, access.owner.id, mode, now),
  ]);
  const inTrial = owner?.state === "trial" || owner?.state === "subscribed_trial";
  const row = counts.rows[0]!;
  return {
    strategy: { filledCount: strategy.filledCount, totalCount: strategy.totalCount },
    promotions: { targetableCount: Number(row.promo_targetable), totalCount: Number(row.promo_total) },
    research: { referencePostCount: Number(row.posts), keywordCount: Number(row.keywords) },
    access: {
      canEdit: access.permissions.has("content"),
      inTrial,
      trialEndsAt: owner ? owner.trialEndsAt.toISOString() : null,
      trialDaysLeft: inTrial && owner ? trialDaysLeft(owner.trialEndsAt, now) : null,
    },
  };
}
