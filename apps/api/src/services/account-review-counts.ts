import { and, count, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { accounts, memberships, postDrafts } from "../db/schema";

/**
 * ログイン中のユーザーが関わる全Account（オーナーと担当。specs/011 T008）の要確認件数を1回で読む。
 * 見せてもらっているAccountは、切り替えメニューに出さないので含めない。
 * @param db - データベース
 * @param userId - 認証済み users.id
 * @returns Account IDと要確認件数。下書きがないAccountも0件で含む
 */
export async function countOwnedAccountNeedsReview(db: Db, userId: string) {
  return db
    .select({ accountId: accounts.id, needsReview: count(postDrafts.id) })
    .from(memberships)
    .innerJoin(accounts, eq(accounts.id, memberships.accountId))
    .leftJoin(
      postDrafts,
      and(eq(postDrafts.accountId, accounts.id), eq(postDrafts.status, "needs_review")),
    )
    .where(and(eq(memberships.userId, userId), inArray(memberships.role, ["owner", "editor"])))
    .groupBy(accounts.id);
}
