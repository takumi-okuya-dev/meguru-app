// Threadsの「自分」（specs/meguru/029-threads-pattern1 contracts/api-routes.md 2）。
// GET /api/threads/me と GET /api/threads/me/withdrawal-preview。中身は029の前の /api/me・/api/me/withdrawal-preview の
// Threadsの部分と同じ。PR5 までは、共通の /api/me にも同じ中身を足す（registerMeSection。前の画面のため）。
import { FEATURES, type Role } from "@meguru/shared";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { connectMethodsOf, testerInvitesEnabledOf } from "../../../kernel/config";
import { createDb, type Db } from "../../../kernel/db/client";
import { appUsageOf, featureOnSql, personName, reportUsage, type AppEnv } from "../../../platform";
import { users } from "../../../platform/schema";
import { toAccountSummary, type AccountRow } from "../access/access";
import { accountLimitFor } from "../accounts/account-service";
import { THREADS_APP } from "../registry";
import { accounts, memberships, teamMembers, teams } from "../schema";
import { chooseSuccessor, listMyTeams } from "../teams/team-service";

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
 * Threadsの「自分」の中身を作る。数えた利用の値が共通の記録と違えば、伝え直す（記録のずれをここでも直す。research.md R6）。
 * @param c - Hono の文脈（ログインしている人）
 * @returns 中身（threadsMeResponseSchema の形）
 */
export async function buildThreadsMe(c: Context<AppEnv>) {
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
  const [myTeams, accountLimit, recorded] = await Promise.all([
    teamOn ? listMyTeams(db, user.id) : Promise.resolve([]),
    accountLimitFor(db, user.id, user.billing, c.env, now),
    appUsageOf(db, user.id, THREADS_APP),
  ]);
  const { limits } = accountLimit;
  const ownedCount = rows.filter((r) => r.role === "owner").length;
  const using = visible.length > 0 || myTeams.length > 0;
  if (!recorded || recorded.quantity !== ownedCount || recorded.using !== using) {
    await reportUsage(db, user.id, THREADS_APP, { quantity: ownedCount, using, countedAt: now });
  }
  return {
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
    teams: myTeams,
    // 自分の使えるまとまり（サイドバーの「チーム」の出し分けに使う。specs/019 research.md R6）
    features: FEATURES.filter((f) => user.features.has(f)),
    // 自分のアカウントの1日の投稿数の上限（運営者は上限なし。specs/024 contracts/api.md）
    dailyPostLimit: limits.operator ? null : limits.dailyPostLimit,
    // 招待の管理がONか（つなぐ画面の申し込みの欄。specs/024 research.md R4）
    testerInvites: { enabled: testerInvitesEnabledOf(c.env) },
  };
}

/**
 * 退会の確かめに出す、Threadsの中身（消えるアカウント・外れるチーム。specs/013 contracts/api.md「退会の確認の内容」）。
 * @param db - データベース
 * @param userId - users.id
 * @returns 消えるアカウントと外れるチーム
 */
export async function threadsWithdrawalPreview(db: Db, userId: string) {
  const owned = await db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .innerJoin(memberships, and(eq(memberships.accountId, accounts.id), eq(memberships.role, "owner")))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(accounts.createdAt), asc(accounts.id));
  const myTeams = await db
    .select({ id: teams.id, name: teams.name, role: teamMembers.role })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(eq(teamMembers.userId, userId))
    .orderBy(asc(teamMembers.joinedAt), asc(teams.id));
  const teamRows = [];
  for (const t of myTeams) {
    if (t.role !== "admin") {
      teamRows.push({ id: t.id, name: t.name, isAdmin: false, outcome: "leave" as const, nextAdminName: null });
      continue;
    }
    // 引き継ぎ先は、アカウントの削除（011 FR-046）と同じ選び方
    const next = await chooseSuccessor(db, t.id, userId);
    const nextName = next
      ? await db
          .select({ displayName: users.displayName, email: users.email })
          .from(users)
          .where(eq(users.id, next.userId))
          .then((r) => (r[0] ? personName(r[0]) : null))
      : null;
    teamRows.push({
      id: t.id,
      name: t.name,
      isAdmin: true,
      outcome: next ? ("transfer" as const) : ("delete" as const),
      nextAdminName: nextName,
    });
  }
  return { ownedAccounts: owned, teams: teamRows };
}

/**
 * GET /api/threads/me・GET /api/threads/me/withdrawal-preview のルート。
 * @param authed - 認証のミドルウェア
 * @returns Hono のルート
 */
export function threadsMeRoutes(authed: MiddlewareHandler<AppEnv>) {
  return new Hono<AppEnv>()
    .get("/threads/me", authed, async (c) => {
      // Account切り替えメニューは開くたびに一覧を読み直すため、ブラウザに保存させない
      c.header("Cache-Control", "no-store");
      return c.json(await buildThreadsMe(c));
    })
    .get("/threads/me/withdrawal-preview", authed, async (c) => {
      c.header("Cache-Control", "no-store");
      return c.json(await threadsWithdrawalPreview(createDb(c.env.DATABASE_URL), c.get("user").id));
    });
}
