// GET /api/me（FR-004・FR-005、research.md R10。specs/008 research.md R11 で役割つきに広げ、
// specs/011 research.md R5 で入っているチームを足した）
import {
  FEATURES,
  type MeApps,
  type Role,
  lastAppRequestSchema,
  releasedApps,
  resolveLandingApp,
  withdrawRequestSchema,
} from "@meguru/shared";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "./auth";
import { connectMethodsOf, testerInvitesEnabledOf } from "../../kernel/config";
import { createDb } from "../../kernel/db/client";
import { accounts, memberships, users } from "../schema";
import { personName, toAccountSummary, type AccountRow } from "../access/access";
import { featureOnSql } from "../features/feature-sql";
import { toMeBilling } from "../billing/billing-service";
import { withdraw, withdrawalPreview, type ClerkUserDeleter } from "../withdrawal/withdrawal-service";
import type { Env } from "../../kernel/env";
import { AppError } from "../../kernel/errors";
import { listMyTeams } from "../teams/team-service";
import { accountLimitFor } from "../accounts/account-service";

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
 * /api/me の apps を決める（specs/028 contracts/api.md 1、research.md R6）。
 * Threadsを「使っている」のは、開けるアカウント（オーナーと担当）が1件以上あるとき。運用するアカウントの表は共通の持ち主（027）なので、
 * 共通の中で決める。2作目でアプリごとの利用権を足すときに、アプリごとの判定に置き換える。
 * @param visibleAccounts - 開けるアカウントの数
 * @param lastAppId - users.last_app_id
 * @returns apps
 */
export function resolveMeApps(visibleAccounts: number, lastAppId: string | null): MeApps {
  const available = releasedApps().map((a) => a.id);
  const using = available.filter((id) => id === "threads" && visibleAccounts > 0);
  const last = lastAppId && available.includes(lastAppId) ? lastAppId : null;
  return { available, using, last, landing: resolveLandingApp(using, last) };
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
      .select({
        account: accounts,
        role: memberships.role,
        ownerDisplayName: ownerU.displayName,
        ownerEmail: ownerU.email,
        // 担当しているAccountは、オーナーもチームを使えるときだけ出す（specs/019 FR-009）
        ownerTeamOn: featureOnSql(ownerU.id, "team"),
      })
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
    // チームを使えない人には、担当しているAccountとチームを出さない（specs/019 research.md R13）
    const teamOn = user.features.has("team");
    const visible = rows.filter((r) => r.role === "owner" || (teamOn && r.ownerTeamOn));
    const owned = visible.filter((r) => r.role === "owner").map((r) => r.account);
    const helped = visible.filter((r) => r.role !== "owner").map((r) => r.account);
    const now = new Date();
    // 使える状態・上限は accountLimitFor が1回で読む（同じ問い合わせを重ねない。PR #71 のセルフレビュー）
    const [teams, accountLimit] = await Promise.all([
      teamOn ? listMyTeams(db, user.id) : Promise.resolve([]),
      accountLimitFor(db, user.id, user.billing, c.env, now),
    ]);
    const { entitlement, limits } = accountLimit;
    // Account切り替えメニューは開くたびに一覧を読み直すため、ブラウザに保存させない。
    c.header("Cache-Control", "no-store");
    return c.json({
      user: { id: user.id, email: user.email, displayName: user.displayName },
      accounts: visible.map((r) =>
        toAccountSummary(
          r.account,
          r.role as Role,
          r.role === "owner" ? null : personName({ displayName: r.ownerDisplayName, email: r.ownerEmail }),
        ),
      ),
      landingAccountId: resolveLandingAccountId(owned, user.lastAccountId, helped),
      // 上限は使える状態と運営者が決める上限の小さい方（null は上限なし。specs/024 FR-018）。未接続のアカウントも数える
      accountLimit: { max: accountLimit.max, used: owned.length },
      // Threads連携の公開範囲。Web はアカウント追加画面の案内の有無に使う（specs/002 FR-028）
      threadsAccessMode: c.env.THREADS_ACCESS_MODE ?? "testers",
      threadsConnectMethods: connectMethodsOf(c.env),
      teams,
      billing: toMeBilling(user.billing, entitlement!, now),
      withdrawalInProgress: user.withdrawalRequestedAt !== null,
      // テスト用のグループ（specs/016 contracts/api.md「GET /api/me」）
      testGroups: { enabled: Boolean(user.billing.testGroups), ...user.testAccess },
      operator: user.operator,
      // 自分の使えるまとまり（サイドバーの「チーム」の出し分けに使う。specs/019 research.md R6）
      features: FEATURES.filter((f) => user.features.has(f)),
      // 自分のアカウントの1日の投稿数の上限（運営者は上限なし。specs/024 contracts/api.md）
      dailyPostLimit: limits.operator ? null : limits.dailyPostLimit,
      // 招待の管理がONか（つなぐ画面の申し込みの欄。specs/024 research.md R4）
      testerInvites: { enabled: testerInvitesEnabledOf(c.env) },
      // 出せるアプリ・使っているアプリ・最後に使ったアプリ・入口の行き先（specs/028 contracts/api.md 1）
      apps: resolveMeApps(visible.length, user.lastAppId),
    });
  })
    // 最後に使ったアプリを覚える（specs/028 contracts/api.md 2）。外枠が、アプリの画面を開いたときに呼ぶ
    .put("/me/last-app", authed, async (c) => {
      const parsed = lastAppRequestSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new AppError("VALIDATION_FAILED", 400, "invalid last app", undefined, ["app"]);
      const db = createDb(c.env.DATABASE_URL);
      await db.update(users).set({ lastAppId: parsed.data.app, updatedAt: new Date() }).where(eq(users.id, c.get("user").id));
      return c.body(null, 204);
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
