// GET /api/me（FR-004・FR-005、research.md R10。specs/008 research.md R11 で役割つきに広げ、
// specs/011 research.md R5 で入っているチームを足した）
import type { Role } from "@threads-grower/shared";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../app";
import { connectMethodsOf } from "../lib/config";
import { createDb } from "../db/client";
import { accounts, memberships, users } from "../db/schema";
import { personName, toAccountSummary, type AccountRow } from "../services/access";
import { countOwnedAccountNeedsReview } from "../services/account-review-counts";
import { loadEntitlement, toMeBilling } from "../services/billing-service";
import { withdraw, withdrawalPreview, type ClerkUserDeleter } from "../services/withdrawal-service";
import type { Env } from "../env";
import { withdrawRequestSchema } from "@threads-grower/shared";
import { AppError } from "../lib/errors";
import { listMyTeams } from "../services/team-service";

/**
 * ログイン後の遷移先の Account を決める（FR-004、research.md R10。specs/008 FR-045）。
 * last_account_id（開けるAccountなら）→ オーナーのAccountで last_used_at が最新 → created_at が最新
 * → 担当しているAccountの最初 → null の順。
 * @param owned - ownerとして保有するAccount
 * @param lastAccountId - users.last_account_id
 * @param helped - 担当しているAccount（並びは /api/me の順）
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
 * @param deleteClerkUser - 退会でClerkのユーザーを消す関数を作る（specs/013）
 * @returns Hono のルート
 */
export function meRoutes(authed: MiddlewareHandler<AppEnv>, deleteClerkUser: (env: Env) => ClerkUserDeleter) {
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
      .where(and(eq(memberships.userId, user.id), inArray(memberships.role, ["owner", "editor"])))
      .orderBy(
        sql`CASE WHEN ${memberships.role} = 'owner' THEN 0 ELSE 1 END`,
        sql`${accounts.lastUsedAt} DESC NULLS LAST`,
        desc(accounts.createdAt),
      );
    const owned = rows.filter((r) => r.role === "owner").map((r) => r.account);
    const helped = rows.filter((r) => r.role !== "owner").map((r) => r.account);
    const now = new Date();
    const [teams, entitlement] = await Promise.all([listMyTeams(db, user.id), loadEntitlement(db, user.id, user.billing, now)]);
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
      // 上限は使える状態から（null は上限なし。specs/013 research.md R9）。未接続のアカウントも数える
      accountLimit: { max: entitlement!.accountLimit, used: owned.length },
      // Threads連携の公開範囲。Web はアカウント追加画面の案内の有無に使う（specs/002 FR-028）
      threadsAccessMode: c.env.THREADS_ACCESS_MODE ?? "testers",
      threadsConnectMethods: connectMethodsOf(c.env),
      teams,
      billing: toMeBilling(user.billing, entitlement!, now),
      withdrawalInProgress: user.withdrawalRequestedAt !== null,
    });
  }).get("/me/needs-review-counts", authed, async (c) => {
    const user = c.get("user");
    const counts = await countOwnedAccountNeedsReview(createDb(c.env.DATABASE_URL), user.id);
    c.header("Cache-Control", "no-store");
    return c.json({ counts });
  })
    // 退会（specs/013 contracts/api.md「自分」、research.md R10）
    .get("/me/withdrawal-preview", authed, async (c) => {
      c.header("Cache-Control", "no-store");
      return c.json(await withdrawalPreview(createDb(c.env.DATABASE_URL), c.get("user").id));
    })
    .post("/me/withdraw", authed, async (c) => {
      const parsed = withdrawRequestSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new AppError("VALIDATION_FAILED", 400, "invalid withdraw request", undefined, ["confirmEmail"]);
      const user = c.get("user");
      await withdraw(c.env, deleteClerkUser(c.env), user, parsed.data.confirmEmail);
      return c.body(null, 204);
    });
}
