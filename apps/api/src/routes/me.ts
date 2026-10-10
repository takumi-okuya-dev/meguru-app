// GET /api/me（FR-004・FR-005、research.md R10。specs/008 research.md R11 で役割つきに広げた）
import { limitForOwnedPlans, type Role } from "@threads-grower/shared";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../app";
import { createDb } from "../db/client";
import { accounts, memberships, users } from "../db/schema";
import { personName, toAccountSummary, type AccountRow } from "../services/access";
import { countOwnedAccountNeedsReview } from "../services/account-review-counts";
import { getMeTeamInfo } from "../services/team-service";

/**
 * ログイン後の遷移先の Account を決める（FR-004、research.md R10。specs/008 FR-045）。
 * last_account_id（開けるAccountなら）→ オーナーのAccountで last_used_at が最新 → created_at が最新
 * → 手伝っているAccountの最初 → null の順。
 * @param owned - ownerとして保有するAccount
 * @param lastAccountId - users.last_account_id
 * @param helped - 手伝っているAccount（並びは /api/me の順）
 * @returns 遷移先の Account の ID。開けるAccountが0件なら null
 */
export function resolveLandingAccountId(
  owned: AccountRow[],
  lastAccountId: string | null,
  helped: AccountRow[] = [],
): string | null {
  if (lastAccountId && [...owned, ...helped].some((a) => a.id === lastAccountId)) return lastAccountId;
  const byUsed = owned
    .filter((a) => a.lastUsedAt)
    .sort((a, b) => b.lastUsedAt!.getTime() - a.lastUsedAt!.getTime());
  if (byUsed[0]) return byUsed[0].id;
  const byCreated = [...owned].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return byCreated[0]?.id ?? helped[0]?.id ?? null;
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
    const ownerM = alias(memberships, "owner_m");
    const ownerU = alias(users, "owner_u");
    const rows = await db
      .select({ account: accounts, role: memberships.role, ownerDisplayName: ownerU.displayName, ownerEmail: ownerU.email })
      .from(accounts)
      .innerJoin(memberships, eq(memberships.accountId, accounts.id))
      .innerJoin(ownerM, and(eq(ownerM.accountId, accounts.id), eq(ownerM.role, "owner")))
      .innerJoin(ownerU, eq(ownerU.id, ownerM.userId))
      .where(and(eq(memberships.userId, user.id), inArray(memberships.role, ["owner", "partner", "editor"])))
      .orderBy(
        sql`CASE WHEN ${memberships.role} = 'owner' THEN 0 ELSE 1 END`,
        sql`${accounts.lastUsedAt} DESC NULLS LAST`,
        desc(accounts.createdAt),
      );
    const owned = rows.filter((r) => r.role === "owner").map((r) => r.account);
    const helped = rows.filter((r) => r.role !== "owner").map((r) => r.account);
    const team = await getMeTeamInfo(db, user.id, rows.length > 0);
    // Account切り替えメニューは開くたびに一覧を読み直すため、ブラウザに保存させない。
    c.header("Cache-Control", "no-store");
    return c.json({
      user: { id: user.id, email: user.email, displayName: user.displayName },
      accounts: rows.map((r) =>
        toAccountSummary(
          r.account,
          r.role as Role,
          r.role === "owner" ? null : personName({ displayName: r.ownerDisplayName, email: r.ownerEmail }),
        ),
      ),
      landingAccountId: resolveLandingAccountId(owned, user.lastAccountId, helped),
      accountLimit: { max: limitForOwnedPlans(owned.map((a) => a.plan)), used: owned.length },
      // Threads連携の公開範囲。Web はアカウント追加画面の案内の有無に使う（specs/002 FR-028）
      threadsAccessMode: c.env.THREADS_ACCESS_MODE ?? "testers",
      partnerTeam: team.partnerTeam,
      editorWaiting: team.editorWaiting,
    });
  }).get("/me/needs-review-counts", authed, async (c) => {
    const user = c.get("user");
    const counts = await countOwnedAccountNeedsReview(createDb(c.env.DATABASE_URL), user.id);
    c.header("Cache-Control", "no-store");
    return c.json({ counts });
  });
}
