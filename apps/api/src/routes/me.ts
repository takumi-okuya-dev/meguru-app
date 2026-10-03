// GET /api/me（FR-004・FR-005、research.md R10）
import { limitForOwnedPlans } from "@threads-grower/shared";
import { and, desc, eq, sql } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../app";
import { createDb } from "../db/client";
import { accounts, memberships } from "../db/schema";
import { toAccountSummary, type AccountRow } from "../services/access";

/**
 * ログイン後の遷移先の Account を決める（FR-004、research.md R10）。
 * last_account_id → last_used_at が最新 → created_at が最新 → null の順。
 * @param owned - ownerとして保有するAccount
 * @param lastAccountId - users.last_account_id
 * @returns 遷移先の Account の ID。Accountが0件なら null
 */
export function resolveLandingAccountId(owned: AccountRow[], lastAccountId: string | null): string | null {
  if (lastAccountId && owned.some((a) => a.id === lastAccountId)) return lastAccountId;
  const byUsed = owned
    .filter((a) => a.lastUsedAt)
    .sort((a, b) => b.lastUsedAt!.getTime() - a.lastUsedAt!.getTime());
  if (byUsed[0]) return byUsed[0].id;
  const byCreated = [...owned].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return byCreated[0]?.id ?? null;
}

/**
 * GET /api/me のルート（FR-004・FR-005）。
 * @param authed - 認証のミドルウェア
 * @returns Hono のルート
 */
export function meRoutes(authed: MiddlewareHandler<AppEnv>) {
  return new Hono<AppEnv>().get("/me", authed, async (c) => {
    const user = c.get("user");
    const db = createDb(c.env.DATABASE_URL);
    const rows = await db
      .select({ account: accounts })
      .from(accounts)
      .innerJoin(memberships, eq(memberships.accountId, accounts.id))
      .where(and(eq(memberships.userId, user.id), eq(memberships.role, "owner")))
      .orderBy(sql`${accounts.lastUsedAt} DESC NULLS LAST`, desc(accounts.createdAt));
    const owned = rows.map((r) => r.account);
    return c.json({
      user: { id: user.id, email: user.email, displayName: user.displayName },
      accounts: owned.map(toAccountSummary),
      landingAccountId: resolveLandingAccountId(owned, user.lastAccountId),
      accountLimit: { max: limitForOwnedPlans(owned.map((a) => a.plan)), used: owned.length },
      // Threads連携の公開範囲。Web はアカウント追加画面の案内の有無に使う（specs/002 FR-028）
      threadsAccessMode: c.env.THREADS_ACCESS_MODE ?? "testers",
    });
  });
}
