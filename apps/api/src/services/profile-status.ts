// ホームの入力状況（specs/002-strategy-profile FR-017・FR-024b、research.md R11・R14）
import { isInTrial, jstToday, trialEndsAt } from "@threads-grower/shared";
import { sql } from "drizzle-orm";
import type { Db } from "../db/client";
import type { AccountRow } from "./access";
import { canEditProfile } from "./grower-access";
import { getStrategy } from "./strategy-service";

/**
 * 課題の入力済み項目数、宣伝内容・参考投稿・キーワードの件数、無料体験の状態をまとめて返す。
 * 件数は1回のクエリでまとめて数える。
 * @param db - データベース
 * @param account - Account の行（所有の確認は呼び出し側で済ませる）
 * @param user - Accountのオーナー（登録日時で無料体験を判定する。specs/008 research.md R3）
 * @param now - 現在時刻
 * @returns 入力状況
 */
export async function getProfileStatus(db: Db, account: AccountRow, user: { createdAt: Date }, now: Date = new Date()) {
  const today = jstToday(now);
  const [strategy, counts] = await Promise.all([
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
  ]);
  const row = counts.rows[0]!;
  return {
    strategy: { filledCount: strategy.filledCount, totalCount: strategy.totalCount },
    promotions: { targetableCount: Number(row.promo_targetable), totalCount: Number(row.promo_total) },
    research: { referencePostCount: Number(row.posts), keywordCount: Number(row.keywords) },
    access: {
      canEdit: canEditProfile(account, user, now),
      inTrial: isInTrial(user.createdAt, now),
      trialEndsAt: trialEndsAt(user.createdAt).toISOString(),
    },
  };
}
