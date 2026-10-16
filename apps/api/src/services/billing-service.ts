// 契約と支払い（specs/013-billing research.md R1・R4〜R7）。Stripeとのやり取りは、このファイルと lib/stripe-client.ts の外に書かない。
import {
  BILLING_BASE_PRICE_JPY,
  BILLING_EXTRA_PRICE_JPY,
  SUBSCRIPTION_STATUSES,
  billingQuantity,
  checkoutTrialFor,
  entitlementOf,
  nextInvoiceAmount,
  trialDaysLeft,
  type BillingSummary,
  type Entitlement,
  type MeBilling,
  type SubscriptionStatus,
} from "@threads-grower/shared";
import { and, eq, inArray, isNull, lt, notInArray, or, sql, type SQL } from "drizzle-orm";
import type { Env } from "../env";
import { createDb, withTransaction, type Db, type TxDb } from "../db/client";
import { lockUserRow } from "../db/locks";
import { memberships, subscriptions, users } from "../db/schema";
import { billingModeOf, type BillingMode } from "../lib/config";
import { AppError } from "../lib/errors";
import { logger } from "../lib/logger";
import { createStripeClient, periodEndOf, StripeError, type StripeClient } from "../lib/stripe-client";

/** 判定に使う、利用者と契約の値（users・subscriptions の行の一部）。 */
export type BillingFacts = {
  createdAt: Date;
  billingExempt: boolean;
  status: string | null;
  cancelAtPeriodEnd: boolean | null;
};

/**
 * 利用者と契約の値から、使える状態を求める（research.md R1）。
 * @param mode - 決済のモード
 * @param facts - 登録日時・料金なしの印・契約の状態
 * @param now - 今の時刻
 * @returns 使える状態
 */
export function entitlementFromFacts(mode: BillingMode, facts: BillingFacts, now: Date = new Date()): Entitlement {
  return entitlementOf({
    billingEnabled: mode.enabled,
    exempt: facts.billingExempt,
    userCreatedAt: facts.createdAt,
    subscription:
      facts.status === null && facts.cancelAtPeriodEnd === null
        ? null
        : { status: (facts.status as SubscriptionStatus | null) ?? null, cancelAtPeriodEnd: facts.cancelAtPeriodEnd ?? false },
    now,
  });
}

/**
 * 「オーナーがすべて使える」のSQLの条件（users・subscriptions を結合した問い合わせで使う）。entitlementOf と同じ条件で、
 * 定期処理が件数の上限の前に読むだけの行を外すために使う（上限を読むだけの行が埋めて、ほかが進まないことを防ぐ。
 * PR #16 のCodexレビュー）。entitlementOf と同じ結果になることは billing-sql-parity.test.ts で確かめる。決済OFFなら条件なし。
 * 無料体験の終わりは、日本時間の暦で1か月後（月末は丸める。Postgres の interval '1 month' も同じ丸め）。
 * @param mode - 決済のモード
 * @param now - 今の時刻
 * @returns 条件
 */
export function fullAccessSql(mode: BillingMode, now: Date): SQL | undefined {
  if (!mode.enabled) return undefined;
  const trialEnd = sql`((${users.createdAt} AT TIME ZONE 'Asia/Tokyo') + interval '1 month') AT TIME ZONE 'Asia/Tokyo'`;
  return or(
    eq(users.billingExempt, true),
    inArray(subscriptions.status, ["trialing", "active"]),
    and(
      or(isNull(subscriptions.status), notInArray(subscriptions.status, ["past_due", "unpaid", "paused"])),
      sql`${trialEnd} > ${now.toISOString()}::timestamptz`,
    ),
  );
}

/**
 * 利用者の使える状態を読む（users と subscriptions を読んで entitlementOf する）。
 * @param db - データベース（トランザクションの中でもよい）
 * @param userId - users.id
 * @param mode - 決済のモード
 * @param now - 今の時刻
 * @returns 使える状態。利用者がいなければ null
 */
export async function loadEntitlement(db: Db | TxDb, userId: string, mode: BillingMode, now: Date = new Date()) {
  const [row] = await db
    .select({
      createdAt: users.createdAt,
      billingExempt: users.billingExempt,
      status: subscriptions.status,
      cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
    })
    .from(users)
    .leftJoin(subscriptions, eq(subscriptions.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) return null;
  return entitlementFromFacts(mode, row, now);
}

/**
 * 使える状態を、画面（/api/me の billing）に出す形にする。
 * @param mode - 決済のモード
 * @param e - 使える状態
 * @param now - 今の時刻
 * @returns /api/me の billing
 */
export function toMeBilling(mode: BillingMode, e: Entitlement, now: Date = new Date()): MeBilling {
  return {
    mode: mode.enabled ? "enabled" : "disabled",
    state: e.state,
    readOnlyReason: e.readOnlyReason,
    trialEndsAt: e.trialEndsAt.toISOString(),
    trialDaysLeft: e.state === "trial" || e.state === "subscribed_trial" ? trialDaysLeft(e.trialEndsAt, now) : null,
  };
}

// ---- 「契約と支払い」の内容（GET /api/billing。contracts/api.md「BillingSummary」） ----

/** 契約が終わっている状態（数の合わせ直し・読み直しの対象にしない）。 */
const ENDED_STATUSES = ["canceled", "incomplete_expired"] as const;
/** 次の請求がある状態。 */
const BILLED_STATUSES = ["trialing", "active", "past_due", "unpaid"];

/**
 * 「契約と支払い」の内容を作る。
 * @param db - データベース
 * @param user - 利用者（決済のモードを含む）
 * @param now - 今の時刻
 * @returns BillingSummary
 */
export async function billingSummary(db: Db, user: { id: string; billing: BillingMode }, now: Date = new Date()): Promise<BillingSummary> {
  const prices = { base: BILLING_BASE_PRICE_JPY, extra: BILLING_EXTRA_PRICE_JPY };
  if (!user.billing.enabled) {
    return {
      mode: "disabled",
      state: "billing_disabled",
      readOnlyReason: null,
      trialEndsAt: null,
      trialDaysLeft: null,
      ownedAccountCount: null,
      subscription: null,
      prices,
    };
  }
  const [entitlement, row, owned] = await Promise.all([
    loadEntitlement(db, user.id, user.billing, now),
    db.select().from(subscriptions).where(eq(subscriptions.userId, user.id)).limit(1),
    countOwned(db, user.id),
  ]);
  const e = entitlement!;
  const sub = row[0];
  const billed = sub?.status ? BILLED_STATUSES.includes(sub.status) && !sub.cancelAtPeriodEnd : false;
  return {
    mode: "enabled",
    state: e.state,
    readOnlyReason: e.readOnlyReason,
    trialEndsAt: e.trialEndsAt.toISOString(),
    trialDaysLeft: e.state === "trial" || e.state === "subscribed_trial" ? trialDaysLeft(e.trialEndsAt, now) : null,
    ownedAccountCount: owned,
    subscription: sub?.status
      ? {
          status: sub.status,
          currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
          nextInvoiceAt: billed ? (sub.currentPeriodEnd?.toISOString() ?? null) : null,
          nextInvoiceAmount: billed ? nextInvoiceAmount(owned) : null,
        }
      : null,
    prices,
  };
}

/**
 * オーナーのアカウントの数（未接続のものも数える。FR-013）。
 * @param db - データベース（トランザクションの中でもよい）
 * @param userId - users.id
 * @returns 数
 */
async function countOwned(db: Db | TxDb, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.role, "owner")));
  return Number(row?.n ?? 0);
}

// ---- 契約する（research.md R4） ----

/**
 * Stripeの失敗を BILLING_UNAVAILABLE にする（鍵・本文は出さない）。
 * @param err - 捕まえたエラー
 * @returns AppError
 */
function unavailable(err: unknown): AppError {
  logger.error("billing: stripe call failed", { err: err instanceof StripeError ? { status: err.status, code: err.code } : String(err) });
  return new AppError("BILLING_UNAVAILABLE", 503, "billing unavailable");
}

/**
 * Stripeの顧客を用意する（利用者に1つ。なければ作って subscriptions の行を作る）。
 * @param env - Workers のバインディング
 * @param stripe - Stripeのクライアント
 * @param user - 利用者
 * @returns 顧客のID
 * @throws AppError BILLING_UNAVAILABLE
 */
async function ensureCustomer(env: Env, stripe: StripeClient, user: { id: string; email: string }): Promise<string> {
  const db = createDb(env.DATABASE_URL);
  const [existing] = await db.select().from(subscriptions).where(eq(subscriptions.userId, user.id)).limit(1);
  if (existing) return existing.stripeCustomerId;
  // 冪等キーで、同時に押しても・失敗してやり直しても顧客は1つ
  const customer = await stripe.createCustomer({ userId: user.id, email: user.email }, `customer-${user.id}`).catch((err: unknown) => {
    throw unavailable(err);
  });
  await db.insert(subscriptions).values({ userId: user.id, stripeCustomerId: customer.id }).onConflictDoNothing();
  const [row] = await db.select().from(subscriptions).where(eq(subscriptions.userId, user.id)).limit(1);
  return row!.stripeCustomerId;
}

/**
 * Checkoutのセッションを作り、URLを返す（research.md R4）。契約中・支払いの失敗中は作らない。
 * 開いているセッションが前にあれば期限切れにしてから作り、開いているセッションを1つにする（FR-022）。
 * @param env - Workers のバインディング
 * @param user - 利用者（決済のモードを含む）
 * @param stripe - Stripeのクライアント
 * @param now - 今の時刻
 * @returns CheckoutのURL
 * @throws AppError ALREADY_SUBSCRIBED・BILLING_UNAVAILABLE
 */
export async function startCheckout(
  env: Env,
  user: { id: string; email: string; billing: BillingMode },
  stripe: StripeClient = createStripeClient(env),
  now: Date = new Date(),
): Promise<string> {
  const before = await loadEntitlement(createDb(env.DATABASE_URL), user.id, user.billing, now);
  assertCanSubscribe(before);
  const customer = await ensureCustomer(env, stripe, user);
  return withTransaction(env.DATABASE_URL, async (tx) => {
    await lockUserRow(tx, user.id);
    const e = await loadEntitlement(tx, user.id, user.billing, now);
    assertCanSubscribe(e);
    const [row] = await tx.select().from(subscriptions).where(eq(subscriptions.userId, user.id)).limit(1);
    if (row?.pendingCheckoutSessionId) {
      // 終わった・期限切れのセッションは期限切れにできない（400）。それ以外の失敗は止める
      await stripe.expireCheckoutSession(row.pendingCheckoutSessionId).catch((err: unknown) => {
        if (!(err instanceof StripeError && (err.status === 400 || err.status === 404))) throw unavailable(err);
      });
    }
    const trial = e?.state === "trial" ? checkoutTrialFor(e.trialEndsAt, now) : null;
    const session = await stripe
      .createCheckoutSession({
        customer,
        priceId: env.STRIPE_PRICE_ID ?? "",
        quantity: billingQuantity(await countOwned(tx, user.id)),
        userId: user.id,
        successUrl: `${env.WEB_ORIGIN}/settings/billing?checkout=success`,
        cancelUrl: `${env.WEB_ORIGIN}/settings/billing?checkout=canceled`,
        trialEnd: trial && "trialEnd" in trial ? trial.trialEnd : undefined,
        trialPeriodDays: trial && "trialPeriodDays" in trial ? trial.trialPeriodDays : undefined,
        taxRateId: env.STRIPE_TAX_RATE_ID || undefined,
      })
      .catch((err: unknown) => {
        throw unavailable(err);
      });
    await tx
      .update(subscriptions)
      .set({ pendingCheckoutSessionId: session.id, updatedAt: now })
      .where(eq(subscriptions.userId, user.id));
    return session.url;
  });
}

/**
 * 契約できる状態かを確かめる。契約中（試用・解約の予約を含む）と支払いの失敗中は、新しい契約を作らない。
 * @param e - 使える状態
 * @throws AppError ALREADY_SUBSCRIBED
 */
function assertCanSubscribe(e: Entitlement | null) {
  if (!e) throw new AppError("AUTH_REQUIRED", 401, "user not found");
  if (e.state === "subscribed_trial" || e.state === "active" || e.state === "canceling" || e.readOnlyReason === "payment_failed") {
    throw new AppError("ALREADY_SUBSCRIBED", 409, "already subscribed");
  }
}

// ---- 状態の反映（research.md R5） ----

/** 重複した契約のうち、どれを残すかの順（小さいほど残す。PR #16 のCodexレビュー）。 */
const KEEP_RANK: Record<string, number> = { active: 0, trialing: 0, past_due: 1, unpaid: 1, paused: 1, incomplete: 2 };

/**
 * 顧客の契約をStripeから読み直して subscriptions に書く。知らせの中身は使わない（重複・順番の入れ替わりに強い）。
 * 同じ顧客の読み直しは、顧客ごとの鍵で1つずつ行う（先に始めた読み直しが、後の読み直しの新しい結果を上書きしない。
 * PR #16 のCodexレビュー）。終わっていない契約が2つ以上あれば、使える契約（active・trialing）を優先し、
 * 同じなら古いものを残して、ほかを止めてログに残す（返金は運用が手で行う）。
 * 契約がなく、開いていたCheckoutのセッションがもう開いていなければ、その記録を消す（日次の合わせ直しの対象から外す）。
 * @param env - Workers のバインディング
 * @param customerId - Stripeの顧客のID
 * @param stripe - Stripeのクライアント
 * @returns 反映した利用者のID。知らない顧客なら null
 * @throws StripeError（呼び出し側で扱う）
 */
export async function syncCustomer(env: Env, customerId: string, stripe: StripeClient = createStripeClient(env)): Promise<string | null> {
  return withTransaction(env.DATABASE_URL, async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"billing_customer:" + customerId}, 0))`);
    const [row] = await tx.select().from(subscriptions).where(eq(subscriptions.stripeCustomerId, customerId)).limit(1);
    if (!row) return null;
    const readAt = new Date();
    const list = await stripe.listSubscriptions(customerId);
    const live = list
      .filter((s) => !(ENDED_STATUSES as readonly string[]).includes(s.status))
      .sort((a, b) => (KEEP_RANK[a.status] ?? 3) - (KEEP_RANK[b.status] ?? 3) || a.created - b.created);
    for (const extra of live.slice(1)) {
      logger.error("billing: duplicate subscription canceled", { userId: row.userId, subscriptionId: extra.id, status: extra.status });
      await stripe.cancelSubscription(extra.id).catch((err: unknown) => logger.error("billing: cancel duplicate failed", { err: String(err) }));
    }
    const chosen = live[0] ?? [...list].sort((a, b) => b.created - a.created)[0] ?? null;
    const values = chosen
      ? {
          stripeSubscriptionId: chosen.id,
          status: (SUBSCRIPTION_STATUSES as readonly string[]).includes(chosen.status) ? chosen.status : null,
          currentPeriodEnd: periodEndOf(chosen),
          trialEnd: chosen.trial_end ? new Date(chosen.trial_end * 1000) : null,
          cancelAtPeriodEnd: chosen.cancel_at_period_end || chosen.cancel_at !== null,
          quantity: chosen.items.data[0]?.quantity ?? null,
        }
      : {};
    // 契約ができたら、開いていたセッションは要らない。契約がなければ、セッションがまだ開いているかを確かめる
    let clearPending = Boolean(live[0]);
    if (!live[0] && row.pendingCheckoutSessionId) {
      const session = await stripe.retrieveCheckoutSession(row.pendingCheckoutSessionId).catch((err: unknown) => {
        if (err instanceof StripeError && err.status === 404) return null;
        throw err;
      });
      clearPending = session === null || session.status !== "open";
    }
    await tx
      .update(subscriptions)
      .set({
        ...values,
        ...(clearPending ? { pendingCheckoutSessionId: null } : {}),
        stripeSyncedAt: readAt,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(subscriptions.userId, row.userId),
          or(isNull(subscriptions.stripeSyncedAt), lt(subscriptions.stripeSyncedAt, readAt)),
        ),
      );
    return row.userId;
  });
}

/**
 * 利用者の契約を読み直す（顧客がなければ何もしない）。
 * @param env - Workers のバインディング
 * @param userId - users.id
 * @param stripe - Stripeのクライアント
 * @throws AppError BILLING_UNAVAILABLE
 */
export async function syncUser(env: Env, userId: string, stripe: StripeClient = createStripeClient(env)): Promise<void> {
  const [row] = await createDb(env.DATABASE_URL).select().from(subscriptions).where(eq(subscriptions.userId, userId)).limit(1);
  if (!row) return;
  await syncCustomer(env, row.stripeCustomerId, stripe).catch((err: unknown) => {
    throw unavailable(err);
  });
}

// ---- カスタマーポータル（research.md R7） ----

/**
 * カスタマーポータルのURLを作る。
 * @param env - Workers のバインディング
 * @param userId - users.id
 * @param stripe - Stripeのクライアント
 * @returns ポータルのURL
 * @throws AppError NO_SUBSCRIPTION・BILLING_UNAVAILABLE
 */
export async function openPortal(env: Env, userId: string, stripe: StripeClient = createStripeClient(env)): Promise<string> {
  const [row] = await createDb(env.DATABASE_URL).select().from(subscriptions).where(eq(subscriptions.userId, userId)).limit(1);
  if (!row) throw new AppError("NO_SUBSCRIPTION", 409, "no subscription");
  const session = await stripe
    .createPortalSession({
      customer: row.stripeCustomerId,
      returnUrl: `${env.WEB_ORIGIN}/settings/billing`,
      configuration: env.STRIPE_PORTAL_CONFIGURATION_ID,
    })
    .catch((err: unknown) => {
      throw unavailable(err);
    });
  return session.url;
}

// ---- アカウントの数の反映（research.md R6） ----

/**
 * アカウントを作る・削除するトランザクションの中で、数の合わせ直しの印を付ける（契約がなければ何もしない）。
 * @param tx - トランザクション
 * @param userId - オーナーの users.id
 */
export async function markQuantityDirty(tx: Db | TxDb, userId: string): Promise<void> {
  await tx
    .update(subscriptions)
    .set({ quantitySyncNeeded: true })
    .where(and(eq(subscriptions.userId, userId), sql`${subscriptions.stripeSubscriptionId} IS NOT NULL`));
}

/**
 * Stripeの契約の数を、今のアカウントの数（max(n,1)）に合わせる。日割りの請求・返金はしない。
 * 終わった契約・決済OFFでは何もしない。合ったら印を消す。
 * @param env - Workers のバインディング
 * @param userId - オーナーの users.id
 * @param stripe - Stripeのクライアント
 * @returns 合わせたなら true（何もしなかったときも true）
 */
export async function syncQuantity(env: Env, userId: string, stripe: StripeClient = createStripeClient(env)): Promise<boolean> {
  if (!billingModeOf(env).enabled) return true;
  try {
    // 同じ利用者の数の反映は1つずつ行い、鍵の中で数え直す（古い数で新しい数を上書きしない。PR #16 のCodexレビュー）
    return await withTransaction(env.DATABASE_URL, async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"billing_quantity:" + userId}, 0))`);
      const [row] = await tx.select().from(subscriptions).where(eq(subscriptions.userId, userId)).limit(1);
      if (!row?.stripeSubscriptionId || !row.status || (ENDED_STATUSES as readonly string[]).includes(row.status)) {
        if (row?.quantitySyncNeeded) await tx.update(subscriptions).set({ quantitySyncNeeded: false }).where(eq(subscriptions.userId, userId));
        return true;
      }
      const quantity = billingQuantity(await countOwned(tx, userId));
      const sub = (await stripe.listSubscriptions(row.stripeCustomerId)).find((x) => x.id === row.stripeSubscriptionId);
      const item = sub?.items.data[0];
      if (sub && item && item.quantity !== quantity) await stripe.updateSubscriptionQuantity(sub.id, item.id, quantity);
      await tx
        .update(subscriptions)
        .set({ quantity, quantitySyncNeeded: false, updatedAt: new Date() })
        .where(eq(subscriptions.userId, userId));
      return true;
    });
  } catch (err) {
    // 印は残し、日次の処理でやり直す
    logger.error("billing: quantity sync failed", { userId, err: err instanceof StripeError ? { status: err.status, code: err.code } : String(err) });
    return false;
  }
}

/**
 * 日次の契約の合わせ直し（research.md R5・R6）。終わっていない契約、数の合わせ直しが要る契約、開いたCheckoutのある行を読み直す。
 * 1件の失敗で全体を止めない。決済OFFなら何もしない。
 * @param env - Workers のバインディング
 * @param stripe - Stripeのクライアント
 * @returns 読み直した数と失敗の数
 */
export async function reconcileSubscriptions(env: Env, stripe: StripeClient = createStripeClient(env)) {
  if (!billingModeOf(env).enabled) return { synced: 0, failed: 0 };
  const rows = await createDb(env.DATABASE_URL)
    .select({ userId: subscriptions.userId, customerId: subscriptions.stripeCustomerId })
    .from(subscriptions)
    .where(
      or(
        eq(subscriptions.quantitySyncNeeded, true),
        // Checkoutを終えたのに、知らせも画面からの読み直しも届かなかった行も拾う（PR #16 のCodexレビュー）
        sql`${subscriptions.pendingCheckoutSessionId} IS NOT NULL`,
        and(sql`${subscriptions.status} IS NOT NULL`, notInArray(subscriptions.status, [...ENDED_STATUSES])),
      ),
    );
  let synced = 0;
  let failed = 0;
  for (const r of rows) {
    try {
      await syncCustomer(env, r.customerId, stripe);
      if (!(await syncQuantity(env, r.userId, stripe))) failed += 1;
      else synced += 1;
    } catch (err) {
      failed += 1;
      logger.error("billing: reconcile failed", { userId: r.userId, err: String(err) });
    }
  }
  return { synced, failed };
}

/**
 * アカウントのオーナーの使える状態を読む（定期処理が使う。specs/013 research.md R8）。
 * @param db - データベース（トランザクションの中でもよい）
 * @param accountId - accounts.id
 * @param mode - 決済のモード
 * @param now - 今の時刻
 * @returns 使える状態。オーナーがいなければ null
 */
export async function loadOwnerEntitlement(db: Db | TxDb, accountId: string, mode: BillingMode, now: Date = new Date()) {
  if (!mode.enabled) return entitlementFromFacts(mode, { createdAt: now, billingExempt: false, status: null, cancelAtPeriodEnd: null }, now);
  const [owner] = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.accountId, accountId), eq(memberships.role, "owner")))
    .limit(1);
  return owner ? loadEntitlement(db, owner.userId, mode, now) : null;
}

/** 料金なしの印を付け・外した結果。 */
export type ExemptResult =
  | { kind: "updated"; email: string; before: boolean; after: boolean }
  | { kind: "not_found" }
  | { kind: "has_subscription"; status: string };

/**
 * 料金なしの印を付け・外す（運用のスクリプト。specs/013 FR-062、research.md R11）。
 * 付けるときに終わっていない契約があれば、重ねて請求しないよう止める（force で付ける）。
 * @param db - データベース
 * @param email - 利用者のメールアドレス（大文字・小文字を区別しない）
 * @param on - 付けるなら true
 * @param force - 契約があっても付ける
 * @returns 結果
 */
export async function setBillingExemptByEmail(db: Db, email: string, on: boolean, force = false): Promise<ExemptResult> {
  const [user] = await db
    .select({ id: users.id, email: users.email, exempt: users.billingExempt })
    .from(users)
    .where(sql`lower(${users.email}) = ${email.trim().toLowerCase()}`)
    .limit(1);
  if (!user) return { kind: "not_found" };
  if (on && !force) {
    const [sub] = await db.select({ status: subscriptions.status }).from(subscriptions).where(eq(subscriptions.userId, user.id));
    if (sub?.status && !(ENDED_STATUSES as readonly string[]).includes(sub.status)) return { kind: "has_subscription", status: sub.status };
  }
  await db.update(users).set({ billingExempt: on, updatedAt: new Date() }).where(eq(users.id, user.id));
  return { kind: "updated", email: user.email, before: user.exempt, after: on };
}
