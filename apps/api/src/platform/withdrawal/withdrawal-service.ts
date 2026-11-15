// 退会（specs/013-billing FR-050〜FR-056、research.md R10）。
// 外部（Stripe・Clerk）とDBを1つのトランザクションにできないので、「受け付け → 契約を止める → データを消す → ログインの情報を消す」
// の順にし、どの段も2回目に走っても結果が同じになるようにする。途中で止まれば、画面のもう一度の操作か日次の処理で続きから終わる。
import { and, eq, inArray, isNotNull, isNull, lt, ne, sql } from "drizzle-orm";
import type { Env } from "../../kernel/env";
import { createDb, withTransaction, type Db, type TxDb } from "../../kernel/db/client";
import { lockUserRow } from "../../kernel/db/locks";
import { platformEventDeliveries, platformEvents, subscriptions, users, withdrawnUsers } from "../schema";
import { billingModeOf } from "../../kernel/config";
import { AppError } from "../../kernel/errors";
import { logger } from "../../kernel/logger";
import { createStripeClient, StripeError, type StripeClient } from "../../adapters/stripe";
import { deliverPendingEvents, emitEvent, rearmFailedDeliveries } from "../events/events";

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
 * @returns メールアドレス・契約中か
 */
export async function withdrawalPreview(db: Db, userId: string) {
  // アプリの中身（消えるアカウント・外れるチーム）は、各アプリの道筋（Threadsなら /api/threads/me/withdrawal-preview）。specs/meguru/029
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
  const [sub] = await db.select({ status: subscriptions.status }).from(subscriptions).where(eq(subscriptions.userId, userId));
  return {
    email: user?.email ?? "",
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
  const db = createDb(env.DATABASE_URL);
  let eventIds = await withdrawalEventIds(db, user.id);
  if (eventIds.length === 0) {
    // 2. 契約を止める。消した後に契約が残って請求が続くことを防ぐため、データより先に止める
    await stopBilling(env, user.id, stripe);
    // 3. 退会を記録し、出来事（user.withdrawn）を書く。アプリのデータは、アプリが受け取って片づける（specs/meguru/029 research.md R8）
    await withTransaction(env.DATABASE_URL, (tx) => recordWithdrawal(tx, user));
    eventIds = await withdrawalEventIds(db, user.id);
  } else {
    // もう記録して出来事を書いた人（日次の続き）：契約は止め終えている。失敗で止まった届けを、もう一度届ける状態に戻す
    const rearmed = await rearmFailedDeliveries(db, eventIds);
    if (rearmed > 0) logger.warn("withdrawal: retrying failed deliveries", { userId: user.id, rearmed });
  }
  // 4. その人の出来事だけをすぐ届け、アプリの片づけが済んでいれば users の行を消す。届かなければ、5分ごとの届けと日次の続きでやり直す
  await deliverPendingEvents(env, new Date(), { eventIds }).catch((err: unknown) =>
    logger.error("withdrawal: event delivery failed", { userId: user.id, err: String(err) }),
  );
  await deleteUserRowIfCleaned(env, user.id);
  // 5. ログインの情報を消す（失敗しても退会は成功。日次の処理で続ける）
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
 * その人の退会の出来事の番号（platform_events の部分索引 platform_events_withdrawn_user_idx を使う）。
 * @param db - データベース（トランザクションの中でもよい）
 * @param userId - users.id
 * @returns 出来事の番号
 */
async function withdrawalEventIds(db: Db | TxDb, userId: string): Promise<string[]> {
  const rows = await db
    .select({ id: platformEvents.id })
    .from(platformEvents)
    .where(and(eq(platformEvents.type, "user.withdrawn"), sql`(${platformEvents.payload}->>'userId') = ${userId}`));
  return rows.map((r) => r.id);
}

/**
 * 退会を記録し、出来事（user.withdrawn）を書く（1つのトランザクション）。2回目に走っても出来事は1回だけ書く
 * （その人の出来事がまだないときだけ）。users の行はここでは消さない：アプリが出来事を受け取って片づけ終わるまで、
 * 利用者の番号を引ける形で残す（029 tasks.md PR2 の頭。アプリの表への外部キーは PR3 で外した）。
 * @param tx - トランザクション
 * @param user - 退会する人
 */
async function recordWithdrawal(tx: TxDb, user: { id: string; clerkUserId: string }) {
  await lockUserRow(tx, user.id);
  const [exists] = await tx.select({ id: users.id }).from(users).where(eq(users.id, user.id));
  if (!exists) return;
  // ログインの情報を消した後に残るセッションで、users の行が作り直されないように記録する
  await tx.insert(withdrawnUsers).values({ clerkUserId: user.clerkUserId, withdrawnAt: new Date() }).onConflictDoNothing();
  if ((await withdrawalEventIds(tx, user.id)).length === 0) await emitEvent(tx, "user.withdrawn", { userId: user.id });
}

/**
 * その人の退会の出来事が、すべての届け先で済んでいれば、users の行を消す（共通の表の契約・利用の数などの行は
 * ON DELETE CASCADE で消える。アプリの行は、アプリが出来事を受け取って自分で片づけ済み）。済んでいなければ何もしない
 * （次の届けのあと、日次の続きでもう一度試す）。
 * @param env - Workers のバインディング
 * @param userId - users.id
 * @returns 消したなら true
 */
export async function deleteUserRowIfCleaned(env: Env, userId: string): Promise<boolean> {
  return withTransaction(env.DATABASE_URL, async (tx) => {
    await lockUserRow(tx, userId);
    const [row] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, userId), isNotNull(users.withdrawalRequestedAt)));
    if (!row) return false;
    const eventIds = await withdrawalEventIds(tx, userId);
    if (eventIds.length === 0) return false;
    const [pending] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(platformEventDeliveries)
      .where(and(inArray(platformEventDeliveries.eventId, eventIds), ne(platformEventDeliveries.status, "done")));
    if (Number(pending?.n ?? 0) > 0) return false;
    await tx.delete(users).where(eq(users.id, userId));
    return true;
  });
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
  // users の行がまだ残っている人（アプリの片づけを待っている人）の記録は残す（作り直しを防ぎ、出来事を1回だけ書くため）
  const purged = await db
    .delete(withdrawnUsers)
    .where(
      and(
        lt(withdrawnUsers.clerkDeletedAt, new Date(now.getTime() - WITHDRAWN_USER_RETENTION_HOURS * 3_600_000)),
        sql`NOT EXISTS (SELECT 1 FROM ${users} WHERE ${users.clerkUserId} = ${withdrawnUsers.clerkUserId})`,
      ),
    )
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
