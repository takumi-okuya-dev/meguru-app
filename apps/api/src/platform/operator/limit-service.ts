// 運営者の上限の読み書き（specs/024-tester-invite-connect research.md R6・R7、specs/meguru/029 research.md R7）。
// 上限の名前と範囲はアプリが登録し、値は app_limit_defaults・user_app_limits に置く。判定は利用権（entitlement）が読む。
import {
  LIMIT_EVENTS_LIMIT,
  type DefaultLimitsRequest,
  type OperatorLimitUser,
  type OperatorLimits,
  type UserLimitsRequest,
} from "@meguru/shared";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Env } from "../../kernel/env";
import { withTransaction, type Db, type TxDb } from "../../kernel/db/client";
import { appLimitDefaults, userAppLimits, users } from "../schema";
import { appUsageOf } from "../usage/usage";
import { appLimits, isValidAppLimit, operatorLimitsApp } from "../registry/registry";
import { operatorIdsOf } from "../../kernel/config";
import { AppError } from "../../kernel/errors";
import { isUuid } from "../../kernel/validate";
import { listOperatorEvents, recordOperatorEvent } from "./operator-events";
import { deliverPendingEvents, emitEvent } from "../events/events";
import { wakeEventDelivery } from "../events/delivery-gate";
import { logger } from "../../kernel/logger";

/** 上限の判定に要る、利用者の値。 */
export type LimitSubject = { id: string; clerkUserId: string };

/**
 * 運営者か（環境の設定。招待制にかかわらない。research.md R11）。
 * @param env - Workers のバインディング
 * @param clerkUserId - ClerkのユーザーID
 * @returns 運営者なら true
 */
export function isOperator(env: Pick<Env, "OPERATOR_CLERK_USER_IDS">, clerkUserId: string): boolean {
  return operatorIdsOf(env).includes(clerkUserId);
}

// ---- 運営者（US3。contracts/api.md「運営者の上限」） ----

/**
 * 運営者の上限の画面の内容。
 * @param db - データベース
 * @returns 既定値・既定値と違う人・記録
 */
export async function listLimits(db: Db): Promise<OperatorLimits> {
  const app = limitsApp();
  const [defaults, perUser, events] = await Promise.all([
    namedDefaults(db, app),
    namedUserLimits(db, app),
    listOperatorEvents(db, { actions: ["default_limits", "user_limits"], limit: LIMIT_EVENTS_LIMIT }),
  ]);
  const ids = [...perUser.keys()];
  const people = ids.length
    ? await db
        .select({ userId: users.id, name: users.displayName, email: users.email })
        .from(users)
        .where(inArray(users.id, ids))
        .orderBy(asc(users.email))
        .limit(500)
    : [];
  return {
    defaults,
    overrides: people.map((p) => ({ ...p, limits: perUser.get(p.userId)! })),
    events,
  };
}

// ---- 運営者の上限（名前 → 値。specs/meguru/029-threads-pattern1 research.md R7、tasks.md T070）----
// 名前と範囲はアプリが登録したもの。値は app_limit_defaults・user_app_limits だけに読み書きする（古い列は PR5 で消した）。

/**
 * 運営の上限の画面が扱うアプリ（Threadsが registerAppLimits で宣言する）。
 * @returns アプリの番号
 * @throws Error 宣言したアプリがないとき（組み立ての登録漏れ。機能のON/OFFと同じく、黙って続けない）
 */
function limitsApp(): string {
  const app = operatorLimitsApp();
  if (!app) throw new Error("運営の上限の画面を持つアプリが登録されていません（registerAppLimits(…, { operatorScreen: true })）");
  return app;
}

/**
 * 保存する値が、登録した上限とちょうどそろい、範囲に入っているかを確かめる。道筋で、DBを読む前に呼ぶ。
 * @param values - 名前 → 値（allowNull なら null は既定値に戻す）
 * @param allowNull - null を受け付けるか（人ごとの上限）
 * @throws AppError VALIDATION_FAILED（足りない・登録していない・範囲の外の名前を limits.<名前> で示す）
 */
export function assertLimitValues(values: Record<string, number | null>, allowNull: boolean): void {
  const app = limitsApp();
  const keys = Object.keys(appLimits(app));
  const wrong = [
    ...keys.filter((k) => {
      const v = values[k];
      if (v === undefined) return true;
      if (v === null) return !allowNull;
      return !isValidAppLimit(app, k, v);
    }),
    ...Object.keys(values).filter((k) => !keys.includes(k)),
  ];
  if (wrong.length > 0) throw new AppError("VALIDATION_FAILED", 400, "limits must list every registered limit", undefined, wrong.map((k) => `limits.${k}`));
}

/**
 * アプリの既定の上限（名前 → 値。新しい表から読む）。
 * @param db - データベース（トランザクションの中でもよい）
 * @param app - アプリの番号
 * @returns 名前 → 既定値
 */
async function namedDefaults(db: Db | TxDb, app: string): Promise<Record<string, number>> {
  const rows = await db.select({ key: appLimitDefaults.key, value: appLimitDefaults.value }).from(appLimitDefaults).where(eq(appLimitDefaults.app, app));
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/**
 * 利用者ごとの上限（利用者の番号 → 名前 → 値。登録した名前はすべて入り、行がなければ null。新しい表から読む）。
 * @param db - データベース（トランザクションの中でもよい）
 * @param app - アプリの番号
 * @param userIds - 利用者の番号（省けば、行のある人すべて）
 * @returns 利用者の番号 → 名前 → 値
 */
async function namedUserLimits(db: Db | TxDb, app: string, userIds?: readonly string[]): Promise<Map<string, Record<string, number | null>>> {
  if (userIds && userIds.length === 0) return new Map();
  const keys = Object.keys(appLimits(app));
  const rows = await db
    .select({ userId: userAppLimits.userId, key: userAppLimits.key, value: userAppLimits.value })
    .from(userAppLimits)
    .where(and(eq(userAppLimits.app, app), userIds ? inArray(userAppLimits.userId, [...userIds]) : undefined));
  const out = new Map<string, Record<string, number | null>>();
  for (const id of userIds ?? []) out.set(id, Object.fromEntries(keys.map((k) => [k, null])));
  for (const r of rows) {
    const limits = out.get(r.userId) ?? Object.fromEntries(keys.map((k) => [k, null]));
    if (keys.includes(r.key)) limits[r.key] = r.value;
    out.set(r.userId, limits);
  }
  return out;
}

/**
 * 既定の上限を書く。
 * @param tx - トランザクション
 * @param app - アプリの番号
 * @param v - 名前 → 既定値
 */
async function saveDefaultRows(tx: TxDb, app: string, v: Record<string, number>): Promise<void> {
  for (const [key, value] of Object.entries(v)) {
    await tx
      .insert(appLimitDefaults)
      .values({ app, key, value })
      .onConflictDoUpdate({ target: [appLimitDefaults.app, appLimitDefaults.key], set: { value } });
  }
}

/**
 * 利用者ごとの上限を書く（null は行を消して既定値に戻す）。
 * @param tx - トランザクション
 * @param app - アプリの番号
 * @param userId - 利用者の番号
 * @param v - 名前 → 値
 */
async function saveUserLimitRows(tx: TxDb, app: string, userId: string, v: Record<string, number | null>): Promise<void> {
  for (const [key, value] of Object.entries(v)) {
    const where = and(eq(userAppLimits.userId, userId), eq(userAppLimits.app, app), eq(userAppLimits.key, key));
    if (value === null) await tx.delete(userAppLimits).where(where);
    else
      await tx
        .insert(userAppLimits)
        .values({ userId, app, key, value })
        .onConflictDoUpdate({ target: [userAppLimits.userId, userAppLimits.app, userAppLimits.key], set: { value } });
  }
}

/**
 * 書いた出来事だけをすぐ届ける（ほかの出来事の届けを待たない。失敗しても保存は成功のまま。5分ごとの届けでやり直す）。
 * @param env - Workers のバインディング
 * @param eventId - 書いた出来事の番号（なければ何もしない）
 */
async function deliverSoon(env: Env, eventId: string | null): Promise<void> {
  if (!eventId) return;
  await deliverPendingEvents(env, new Date(), { eventIds: [eventId] }).catch((err: unknown) =>
    logger.error("limits: event delivery failed", { err: String(err) }),
  );
}

/**
 * 既定値を保存する（FR-016）。
 * @param env - Workers のバインディング
 * @param operator - 運営者
 * @param v - 名前 → 既定値（登録した上限すべて）
 * @returns 保存した既定値
 * @throws AppError VALIDATION_FAILED
 */
export async function setDefaults(env: Env, operator: { id: string }, v: DefaultLimitsRequest["limits"]): Promise<DefaultLimitsRequest> {
  assertLimitValues(v, false);
  const app = limitsApp();
  // 出来事を書く前に、5分ごとの届けを起こす（すぐの届けが途中で止まっても、5分ごとの届けが拾う。delivery-gate.ts）
  await wakeEventDelivery(env.AUTOPOST_KV);
  return withTransaction(env.DATABASE_URL, async (tx) => {
    const before = await namedDefaults(tx, app);
    await saveDefaultRows(tx, app, v);
    await recordOperatorEvent(tx, { actorUserId: operator.id, action: "default_limits", detail: { before, after: v } });
    // 上限が上がると、次に見る時刻が早まることがある。アプリに出来事で知らせる（Threads：自動投稿を起こす。PR #71 のCodexレビュー）
    const eventId = await emitEvent(tx, "limits.changed", { app });
    return { saved: { limits: v }, eventId };
  }).then(async ({ saved, eventId }) => {
    await deliverSoon(env, eventId);
    return saved;
  });
}

/**
 * 利用者をメールアドレスで探す（完全一致。FR-017）。
 * @param db - データベース
 * @param env - Workers のバインディング（運営者の判定）
 * @param email - メールアドレス（小文字にそろえたもの）
 * @returns 見つかった人と上限
 * @throws AppError USER_NOT_FOUND
 */
export async function findLimitUser(db: Db, env: Pick<Env, "OPERATOR_CLERK_USER_IDS">, email: string): Promise<OperatorLimitUser> {
  const [u] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
  if (!u) throw new AppError("USER_NOT_FOUND", 404, "user not found");
  return toLimitUser(db, env, u);
}

/**
 * 運営者の画面の、見つかった人の形にする。
 * @param db - データベース（トランザクションの中でもよい）
 * @param env - Workers のバインディング
 * @param u - users の行
 * @returns 見つかった人と上限
 */
async function toLimitUser(db: Db | TxDb, env: Pick<Env, "OPERATOR_CLERK_USER_IDS">, u: typeof users.$inferSelect): Promise<OperatorLimitUser> {
  // 利用の数は、運営の上限の画面が扱うアプリから伝えられた数（specs/meguru/029 research.md R6）。全アプリの合計（料金の数）ではない
  const app = limitsApp();
  const usage = (await appUsageOf(db, u.id, app))?.quantity ?? 0;
  return {
    userId: u.id,
    name: u.displayName,
    email: u.email,
    operator: isOperator(env, u.clerkUserId),
    limits: (await namedUserLimits(db, app, [u.id])).get(u.id)!,
    usage,
  };
}

/**
 * 利用者ごとの上限を保存する（null は既定値に戻す。FR-017）。
 * @param env - Workers のバインディング
 * @param operator - 運営者
 * @param userId - 上限を変える人
 * @param v - 名前 → 値（登録した上限すべて。null は既定値に戻す）
 * @returns 保存した後の、その人と上限
 * @throws AppError VALIDATION_FAILED・USER_NOT_FOUND
 */
export async function setUserLimits(
  env: Env,
  operator: { id: string },
  userId: string,
  v: UserLimitsRequest["limits"],
): Promise<OperatorLimitUser> {
  assertLimitValues(v, true);
  if (!isUuid(userId)) throw new AppError("USER_NOT_FOUND", 404, "user not found");
  const app = limitsApp();
  // 出来事を書く前に、5分ごとの届けを起こす（すぐの届けが途中で止まっても、5分ごとの届けが拾う。delivery-gate.ts）
  await wakeEventDelivery(env.AUTOPOST_KV);
  return withTransaction(env.DATABASE_URL, async (tx) => {
    const [before] = await tx.select().from(users).where(eq(users.id, userId)).for("update").limit(1); // 同じ人の保存を順に並べる
    if (!before) throw new AppError("USER_NOT_FOUND", 404, "user not found");
    const beforeLimits = (await namedUserLimits(tx, app, [userId])).get(userId)!;
    await saveUserLimitRows(tx, app, userId, v);
    await recordOperatorEvent(tx, {
      actorUserId: operator.id,
      subjectUserId: userId,
      action: "user_limits",
      detail: { before: beforeLimits, after: v },
    });
    const eventId = await emitEvent(tx, "limits.changed", { app, userId });
    return { saved: await toLimitUser(tx, env, before), eventId };
  }).then(async ({ saved, eventId }) => {
    await deliverSoon(env, eventId);
    return saved;
  });
}
