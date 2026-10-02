// Accountへのアクセス制御（data-model.md の memberships）。
// 必ず「リクエストしたユーザーのMembershipがあるか」で絞り込み、なければ ACCOUNT_NOT_FOUND（存在の有無を漏らさない）。
import { and, eq } from "drizzle-orm";
import type { Db, TxDb } from "../db/client";
import { accounts, memberships } from "../db/schema";
import { notFound } from "../lib/errors";

/** accounts の行。 */
export type AccountRow = typeof accounts.$inferSelect;

/**
 * ユーザーが owner として持つ Account を取得する（data-model.md の memberships）。
 * Membership がなければ、Account が存在しても見つからない扱いにする（存在の有無を漏らさない）。
 * @param db - データベース（トランザクションの中でもよい）
 * @param userId - users.id
 * @param accountId - accounts.id
 * @returns Account の行
 * @throws AppError ACCOUNT_NOT_FOUND（ID の形が違う・存在しない・自分のものではない）
 */
export async function findOwnedAccount(db: Db | TxDb, userId: string, accountId: string): Promise<AccountRow> {
  // UUID でない値はそのまま「見つからない」にする（DBのエラーにしない）
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(accountId)) throw notFound();
  const [row] = await db
    .select({ account: accounts })
    .from(accounts)
    .innerJoin(memberships, eq(memberships.accountId, accounts.id))
    .where(and(eq(accounts.id, accountId), eq(memberships.userId, userId), eq(memberships.role, "owner")))
    .limit(1);
  if (!row) throw notFound();
  return row.account;
}

/**
 * Account の行を、画面に出す AccountSummary にする。
 * @param a - Account の行
 * @returns AccountSummary
 */
export function toAccountSummary(a: AccountRow) {
  return {
    id: a.id,
    username: a.username,
    displayName: a.displayName,
    profilePictureUrl: a.profilePictureUrl,
    plan: a.plan,
    connectionStatus: a.connectionStatus,
    lastUsedAt: a.lastUsedAt ? a.lastUsedAt.toISOString() : null,
  };
}
