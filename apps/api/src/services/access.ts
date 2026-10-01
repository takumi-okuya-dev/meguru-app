// Accountへのアクセス制御（data-model.md の memberships）。
// 必ず「リクエストしたユーザーのMembershipがあるか」で絞り込み、なければ ACCOUNT_NOT_FOUND（存在の有無を漏らさない）。
import { and, eq } from "drizzle-orm";
import type { Db, TxDb } from "../db/client";
import { accounts, memberships } from "../db/schema";
import { notFound } from "../lib/errors";

export type AccountRow = typeof accounts.$inferSelect;

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
