// 退会（specs/013-billing FR-050〜FR-056、research.md R10）。
// 外部（Stripe・Clerk）とDBを1つのトランザクションにできないので、「受け付け → 契約を止める → データを消す → ログインの情報を消す」
// の順にし、どの段も2回目に走っても結果が同じになるようにする。途中で止まれば、画面のもう一度の操作か日次の処理で続きから終わる。
import { personName } from "./access";
import { and, asc, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import type { Env } from "../env";
import { createDb, withTransaction, type Db, type TxDb } from "../db/client";
import { lockUserRow } from "../db/locks";
import {
  accounts,
  activityLogs,
  memberships,
  subscriptions,
  teamMembers,
  teams,
  threadsDeletionRequests,
  users,
  withdrawnUsers,
} from "../db/schema";
import { billingModeOf } from "../lib/config";
import { AppError } from "../lib/errors";
import { logger } from "../lib/logger";
import { createStripeClient, StripeError, type StripeClient } from "../lib/stripe-client";
import { beforeAccountDeleted, chooseSuccessor } from "./team-service";
import { purgeForWithdrawal } from "./tester-application-service";

/** 退会した人を記録に出すときの名前（FR-053）。 */
export const WITHDRAWN_ACTOR_NAME = "退会した人";
/** 受け付けから、日次の処理が続きを行うまでの時間（分）。 */
export const WITHDRAWAL_RESUME_AFTER_MINUTES = 60;
/** Clerkのユーザーを消してから、withdrawn_users の行を残す時間（時間）。 */
export const WITHDRAWN_USER_RETENTION_HOURS = 25;

/** Clerkのユーザーを消す（差し込める依存。テストでは偽を使う）。見つからないは成功とみなす。 */
export type ClerkUserDeleter = (clerkUserId: string) => Promise<void>;

/** 契約が終わっていない状態（退会で止める）。 */
const LIVE_STATUSES = ["trialing", "active", "past_due", "unpaid", "paused", "incomplete"];

/**
 * 退会の確認の画面に出す内容（contracts/api.md「退会の確認の内容」）。
 * @param db - データベース
 * @param userId - users.id
 * @returns メールアドレス・消えるアカウント・外れるチーム・契約中か
 */
export async function withdrawalPreview(db: Db, userId: string) {
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
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
  const [sub] = await db.select({ status: subscriptions.status }).from(subscriptions).where(eq(subscriptions.userId, userId));
  return {
    email: user?.email ?? "",
    ownedAccounts: owned,
    teams: teamRows,
    hasActiveSubscription: Boolean(sub?.status && LIVE_STATUSES.includes(sub.status)),
  };
}

/**
 * メールアドレスを比べる（前後の空白を除き、大文字・小文字を区別しない）。
 * @param a - 入力
 * @param b - 登録済み
 * @returns 同じなら true
 */
function sameEmail(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * 退会する（research.md R10 の1〜4）。2回目の呼び出しは続きから行う。
 * @param env - Workers のバインディング
 * @param deleteClerkUser - Clerkのユーザーを消す
 * @param user - 退会する人（users の行の一部）
 * @param confirmEmail - 確認のために入れたメールアドレス
 * @param stripe - Stripeのクライアント
 * @throws AppError CONFIRMATION_MISMATCH（メールアドレスが違う）、BILLING_UNAVAILABLE（契約を止められない。何も消していない）
 */
export async function withdraw(
  env: Env,
  deleteClerkUser: ClerkUserDeleter,
  user: { id: string; email: string; clerkUserId: string },
  confirmEmail: string,
  stripe: StripeClient = createStripeClient(env),
) {
  if (!confirmEmail.trim() || !sameEmail(confirmEmail, user.email)) {
    throw new AppError("CONFIRMATION_MISMATCH", 422, "confirmation does not match");
  }
  // 1. 受け付け（すでにあれば変えない）
  await withTransaction(env.DATABASE_URL, async (tx) => {
    await lockUserRow(tx, user.id);
    await tx
      .update(users)
      .set({ withdrawalRequestedAt: sql`coalesce(${users.withdrawalRequestedAt}, now())`, updatedAt: new Date() })
      .where(eq(users.id, user.id));
  });
  await finishWithdrawal(env, deleteClerkUser, user, stripe);
}

/**
 * 受け付けの後の2〜4を行う（画面の退会と、日次の続き）。
 * @param env - Workers のバインディング
 * @param deleteClerkUser - Clerkのユーザーを消す
 * @param user - 退会する人
 * @param stripe - Stripeのクライアント
 * @throws AppError BILLING_UNAVAILABLE
 */
async function finishWithdrawal(
  env: Env,
  deleteClerkUser: ClerkUserDeleter,
  user: { id: string; clerkUserId: string },
  stripe: StripeClient,
) {
  // 2. 契約を止める。消した後に契約が残って請求が続くことを防ぐため、データより先に止める
  await stopBilling(env, user.id, stripe);
  // 3. データを消す
  await withTransaction(env.DATABASE_URL, (tx) => deleteUserData(tx, user));
  // 4. ログインの情報を消す（失敗しても退会は成功。日次の処理で続ける）
  await deleteClerk(env, deleteClerkUser, user.clerkUserId);
}

/**
 * 契約を今すぐ止め、開いているCheckoutのセッションも期限切れにする（退会の後に契約ができないように）。
 * 止まっている・見つからないは成功とみなす。決済OFFの環境でも、契約の記録があれば止める（ONからOFFに切り替えた
 * 環境で、退会の後も請求が続かないように。PR #16 のCodexレビュー）。止められない（鍵がない・Stripeにつながらない）
 * ときは失敗にして、データと契約の記録を残す（もう一度の操作か日次の処理でやり直す）。
 * @param env - Workers のバインディング
 * @param userId - users.id
 * @param stripe - Stripeのクライアント
 * @throws AppError BILLING_UNAVAILABLE
 */
async function stopBilling(env: Env, userId: string, stripe: StripeClient) {
  const [row] = await createDb(env.DATABASE_URL).select().from(subscriptions).where(eq(subscriptions.userId, userId));
  if (!row) return;
  // 決済OFFで、記録の上で止める契約も開いたセッションもなければ、Stripeを呼ばない（鍵のない環境でも退会できる）
  const live = row.status !== null && !["canceled", "incomplete_expired"].includes(row.status);
  if (!billingModeOf(env).enabled && !live && !row.pendingCheckoutSessionId) return;
  if (!env.STRIPE_SECRET_KEY) {
    logger.error("withdrawal: cannot stop billing without stripe key", { userId });
    throw new AppError("BILLING_UNAVAILABLE", 503, "billing unavailable");
  }
  const ignorable = (err: unknown) => err instanceof StripeError && (err.status === 400 || err.status === 404);
  try {
    if (row.pendingCheckoutSessionId) {
      await stripe.expireCheckoutSession(row.pendingCheckoutSessionId).catch((err: unknown) => {
        if (!ignorable(err)) throw err;
      });
    }
    // 終わっていない契約は、記録の有無にかかわらずStripeから読んで止める（記録が古くても取りこぼさない）
    for (const sub of await stripe.listSubscriptions(row.stripeCustomerId)) {
      if (sub.status === "canceled" || sub.status === "incomplete_expired") continue;
      await stripe.cancelSubscription(sub.id).catch((err: unknown) => {
        if (!ignorable(err)) throw err;
      });
    }
  } catch (err) {
    logger.error("withdrawal: could not stop billing", {
      userId,
      err: err instanceof StripeError ? { status: err.status, code: err.code } : String(err),
    });
    throw new AppError("BILLING_UNAVAILABLE", 503, "billing unavailable");
  }
}

/**
 * 利用者のデータを消す（1つのトランザクション）。アカウントはアカウントの削除（001 FR-022）と同じく消し、チームは
 * 011 FR-046 と同じく抜ける（管理者なら引き継ぐか、チームを消す）。ほかの人のアカウントの記録の名前は「退会した人」にする。
 * @param tx - トランザクション
 * @param user - 退会する人
 */
async function deleteUserData(tx: TxDb, user: { id: string; clerkUserId: string }) {
  await lockUserRow(tx, user.id);
  const [exists] = await tx.select({ id: users.id }).from(users).where(eq(users.id, user.id));
  const now = new Date();
  if (exists) {
    // 招待の申し込みを片づける（枠を使っていない行は消し、使っている行はユーザー名だけを残す。specs/024 research.md R15）
    await purgeForWithdrawal(tx, user.id);
    const owned = await tx
      .select({ id: accounts.id, threadsUserId: accounts.threadsUserId })
      .from(accounts)
      .innerJoin(memberships, and(eq(memberships.accountId, accounts.id), eq(memberships.role, "owner")))
      .where(eq(memberships.userId, user.id))
      .orderBy(asc(accounts.id));
    for (const a of owned) {
      await beforeAccountDeleted(tx, a.id, user.id);
      await tx.delete(accounts).where(eq(accounts.id, a.id));
    }
    // Threads側からのデータ削除の求めが処理中なら、退会で消したので完了にする（spec Edge Cases）
    const threadsIds = owned.flatMap((a) => (a.threadsUserId ? [a.threadsUserId] : []));
    if (threadsIds.length > 0) {
      await tx
        .update(threadsDeletionRequests)
        .set({ status: "completed", completedAt: now, threadsUserId: null })
        .where(
          and(
            inArray(threadsDeletionRequests.threadsUserId, threadsIds),
            inArray(threadsDeletionRequests.status, ["pending", "failed"]),
          ),
        );
    }
    // 念のため、まだ管理者のチームがあれば同じく引き継ぐ（teams.admin_user_id は ON DELETE RESTRICT）
    const adminOf = await tx.select({ id: teams.id }).from(teams).where(eq(teams.adminUserId, user.id)).for("update");
    for (const t of adminOf) {
      const next = await chooseSuccessor(tx, t.id, user.id, { lock: true });
      if (!next) {
        await tx.delete(teams).where(eq(teams.id, t.id));
        continue;
      }
      await tx.update(teamMembers).set({ role: "member" }).where(and(eq(teamMembers.teamId, t.id), eq(teamMembers.userId, user.id)));
      await tx.update(teamMembers).set({ role: "admin" }).where(and(eq(teamMembers.teamId, t.id), eq(teamMembers.userId, next.userId)));
      await tx.update(teams).set({ adminUserId: next.userId, updatedAt: now }).where(eq(teams.id, t.id));
    }
    // ほかの人のアカウントの操作の記録は残し、名前を「退会した人」にする（FR-053）
    await tx.update(activityLogs).set({ actorName: WITHDRAWN_ACTOR_NAME }).where(eq(activityLogs.actorUserId, user.id));
    // ログインの情報を消した後に残るセッションで、users の行が作り直されないように記録する
    await tx.insert(withdrawnUsers).values({ clerkUserId: user.clerkUserId, withdrawnAt: now }).onConflictDoNothing();
    // 担当・チームの人・契約の行は ON DELETE CASCADE で消える
    await tx.delete(users).where(eq(users.id, user.id));
  }
}

/**
 * Clerkのユーザーを消し、消した時刻を記録する。失敗はログに残して返す（日次の処理で続ける）。
 * @param env - Workers のバインディング
 * @param deleteClerkUser - Clerkのユーザーを消す
 * @param clerkUserId - ClerkのユーザーID
 * @returns 消せたら true
 */
async function deleteClerk(env: Env, deleteClerkUser: ClerkUserDeleter, clerkUserId: string): Promise<boolean> {
  try {
    await deleteClerkUser(clerkUserId);
  } catch (err) {
    logger.error("withdrawal: could not delete clerk user", { err: String(err) });
    return false;
  }
  await createDb(env.DATABASE_URL)
    .update(withdrawnUsers)
    .set({ clerkDeletedAt: new Date() })
    .where(eq(withdrawnUsers.clerkUserId, clerkUserId));
  return true;
}

/**
 * 日次の退会の続き（research.md R10）。受け付けから1時間を過ぎた人の退会を終え、残ったClerkのユーザーを消し、
 * Clerkを消してから25時間を過ぎた withdrawn_users の行を消す。1件の失敗で全体を止めない。
 * @param env - Workers のバインディング
 * @param deleteClerkUser - Clerkのユーザーを消す
 * @param now - 今の時刻
 * @param stripe - Stripeのクライアント
 * @returns 終えた数・失敗の数・消した記録の数
 */
export async function resumeWithdrawals(
  env: Env,
  deleteClerkUser: ClerkUserDeleter,
  now: Date = new Date(),
  stripe: StripeClient = createStripeClient(env),
) {
  const db = createDb(env.DATABASE_URL);
  const stuck = await db
    .select({ id: users.id, clerkUserId: users.clerkUserId })
    .from(users)
    .where(and(isNotNull(users.withdrawalRequestedAt), lt(users.withdrawalRequestedAt, new Date(now.getTime() - WITHDRAWAL_RESUME_AFTER_MINUTES * 60_000))));
  let finished = 0;
  let failed = 0;
  for (const u of stuck) {
    try {
      await finishWithdrawal(env, deleteClerkUser, u, stripe);
      finished += 1;
    } catch (err) {
      failed += 1;
      logger.error("withdrawal: resume failed", { userId: u.id, err: String(err) });
    }
  }
  const pendingClerk = await db.select({ clerkUserId: withdrawnUsers.clerkUserId }).from(withdrawnUsers).where(isNull(withdrawnUsers.clerkDeletedAt));
  for (const p of pendingClerk) if (!(await deleteClerk(env, deleteClerkUser, p.clerkUserId))) failed += 1;
  const purged = await db
    .delete(withdrawnUsers)
    .where(lt(withdrawnUsers.clerkDeletedAt, new Date(now.getTime() - WITHDRAWN_USER_RETENTION_HOURS * 3_600_000)))
    .returning({ id: withdrawnUsers.clerkUserId });
  return { finished, failed, purged: purged.length };
}

/**
 * 本物のClerkのユーザーを消す関数を作る（見つからないは成功とみなす）。
 * @param env - Workers のバインディング
 * @returns ClerkUserDeleter
 */
export function clerkUserDeleter(env: Pick<Env, "CLERK_SECRET_KEY">): ClerkUserDeleter {
  return async (clerkUserId) => {
    const { createClerkClient } = await import("@clerk/backend");
    try {
      await createClerkClient({ secretKey: env.CLERK_SECRET_KEY }).users.deleteUser(clerkUserId);
    } catch (err) {
      if ((err as { status?: number }).status === 404) return;
      throw err;
    }
  };
}
