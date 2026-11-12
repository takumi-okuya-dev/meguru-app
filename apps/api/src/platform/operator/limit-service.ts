// アカウントの数と1日の投稿数の上限（specs/024-tester-invite-connect research.md R6・R7、data-model.md 4）。
// 上限の読み書きはこのファイルの外に書かない。運営者には上限をかけない（アカウントは null、投稿は Threads の上限まで）。
import {
  DAILY_POST_LIMIT_MAX,
  LIMIT_EVENTS_LIMIT,
  type DefaultLimitsRequest,
  type OperatorLimitUser,
  type OperatorLimits,
  type UserLimitsRequest,
} from "@meguru/shared";
import { and, asc, eq, isNotNull, or, sql } from "drizzle-orm";
import type { Env } from "../../kernel/env";
import { withTransaction, type Db, type TxDb } from "../../kernel/db/client";
import { appLimitDefaults, operatorSettings, userAppLimits, users } from "../schema";
import { appUsageOf } from "../usage/usage";
import { appLimits, isValidAppLimit, operatorLimitsApp } from "../registry/registry";
import { operatorIdsOf } from "../../kernel/config";
import { AppError } from "../../kernel/errors";
import { isUuid } from "../../kernel/validate";
import { listOperatorEvents, recordOperatorEvent } from "./operator-events";
import { deliverPendingEvents, emitEvent } from "../events/events";
import { logger } from "../../kernel/logger";
import { isOperatorSql } from "../test-groups/test-group-service";
import { readOperatorSettings } from "./operator-settings";

/** 上限の判定に要る、利用者の値。 */
export type LimitSubject = { id: string; clerkUserId: string };

/** 全員共通の既定値（古い列の形。PR5 で古い列を消すまで、判定はこの形で読む）。 */
type DefaultLimits = { accountLimit: number; dailyPostLimit: number };

/**
 * 全員共通の既定値。
 * @param db - データベース（トランザクションの中でもよい）
 * @returns 既定値
 */
export async function getDefaults(db: Db | TxDb): Promise<DefaultLimits> {
  const s = await readOperatorSettings(db);
  return { accountLimit: s.defaultAccountLimit, dailyPostLimit: s.defaultDailyPostLimit };
}

/**
 * 運営者か（環境の設定。招待制にかかわらない。research.md R11）。
 * @param env - Workers のバインディング
 * @param clerkUserId - ClerkのユーザーID
 * @returns 運営者なら true
 */
export function isOperator(env: Pick<Env, "OPERATOR_CLERK_USER_IDS">, clerkUserId: string): boolean {
  return operatorIdsOf(env).includes(clerkUserId);
}

/**
 * その人の実際の上限（運営者は、アカウント null・投稿 250。data-model.md 4）。
 * @param db - データベース（トランザクションの中でもよい）
 * @param env - Workers のバインディング（運営者の判定）
 * @param userId - users.id
 * @returns アカウントの数の上限（null は上限なし）と1日の投稿数の上限
 */
export async function effectiveLimits(
  db: Db | TxDb,
  env: Pick<Env, "OPERATOR_CLERK_USER_IDS">,
  userId: string,
): Promise<{ accountLimit: number | null; dailyPostLimit: number; operator: boolean }> {
  const [[u], defaults] = await Promise.all([
    db
      .select({ clerkUserId: users.clerkUserId, accountLimit: users.accountLimit, dailyPostLimit: users.dailyPostLimit })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1),
    getDefaults(db),
  ]);
  if (u && isOperator(env, u.clerkUserId)) return { accountLimit: null, dailyPostLimit: DAILY_POST_LIMIT_MAX, operator: true };
  return {
    accountLimit: u?.accountLimit ?? defaults.accountLimit,
    dailyPostLimit: u?.dailyPostLimit ?? defaults.dailyPostLimit,
    operator: false,
  };
}

/**
 * 1日の投稿数の上限を、SQLで求める式（自動投稿の時刻の処理で、オーナーの行に結合して使う。research.md R7）。
 * @param ownerClerkUserId - オーナーの clerk_user_id の列
 * @param ownerDailyPostLimit - オーナーの daily_post_limit の列
 * @param operators - 運営者の clerk_user_id
 * @returns 式（整数）
 */
export function dailyPostLimitSql(
  ownerClerkUserId: typeof users.clerkUserId,
  ownerDailyPostLimit: typeof users.dailyPostLimit,
  operators: readonly string[],
) {
  const def = sql`(SELECT ${operatorSettings.defaultDailyPostLimit} FROM ${operatorSettings} WHERE ${operatorSettings.id} = 1)`;
  return sql<number>`(CASE WHEN ${isOperatorSql(ownerClerkUserId, operators)} THEN ${DAILY_POST_LIMIT_MAX} ELSE coalesce(${ownerDailyPostLimit}, ${def}, ${DAILY_POST_LIMIT_MAX}) END)::int`;
}

// ---- 運営者（US3。contracts/api.md「運営者の上限」） ----

/**
 * 運営者の上限の画面の内容。
 * @param db - データベース
 * @returns 既定値・既定値と違う人・記録
 */
export async function listLimits(db: Db): Promise<OperatorLimits> {
  const [defaults, overrides, events] = await Promise.all([
    getDefaults(db),
    db
      .select({
        userId: users.id,
        name: users.displayName,
        email: users.email,
        accountLimit: users.accountLimit,
        dailyPostLimit: users.dailyPostLimit,
      })
      .from(users)
      .where(or(isNotNull(users.accountLimit), isNotNull(users.dailyPostLimit)))
      .orderBy(asc(users.email))
      .limit(500),
    listOperatorEvents(db, { actions: ["default_limits", "user_limits"], limit: LIMIT_EVENTS_LIMIT }),
  ]);
  return {
    defaults: toNamed(defaults),
    overrides: overrides.map((o) => ({ userId: o.userId, name: o.name, email: o.email, limits: toNamed(o) })),
    events,
  };
}

// ---- 運営者の上限の、名前 → 値 の形と、古い列の対応（specs/meguru/029-threads-pattern1 research.md R7、tasks.md T070）----
// 運営の API は「名前 → 値」の形で受け渡す（名前と範囲はアプリが登録したもの）。PR5 で古い列（operator_settings・users の
// account_limit・daily_post_limit）を消すまでは、古い列と新しい表（app_limit_defaults・user_app_limits）の両方に書き、
// 判定は古い列から読む。この対応は、その間だけの仕組み（PR5 で消す）。
const OLD_COLUMNS = { accounts: "accountLimit", daily_posts: "dailyPostLimit" } as const;
type OldKey = keyof typeof OLD_COLUMNS;

/**
 * 運営の上限の画面が扱うアプリ（Threadsが registerAppLimits で宣言する）。
 * @returns アプリの番号
 * @throws Error 宣言したアプリがないとき（組み立ての登録漏れ）
 */
function limitsApp(): string {
  const app = operatorLimitsApp();
  if (!app) throw new Error("運営の上限の画面を持つアプリが登録されていません（registerAppLimits(…, { operatorScreen: true })）");
  return app;
}

/**
 * 古い列の形の値を、名前 → 値 の形にする。
 * @param v - 古い列の形の値
 * @returns 名前 → 値
 */
function toNamed<T>(v: { accountLimit: T; dailyPostLimit: T }): Record<string, T> {
  return Object.fromEntries((Object.entries(OLD_COLUMNS) as [OldKey, keyof typeof v][]).map(([key, field]) => [key, v[field]]));
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
 * 既定の上限を、新しい表にも書く。
 * @param tx - トランザクション
 * @param app - アプリの番号
 * @param v - 名前 → 既定値
 */
async function mirrorDefaults(tx: TxDb, app: string, v: Record<string, number>): Promise<void> {
  for (const [key, value] of Object.entries(v)) {
    await tx
      .insert(appLimitDefaults)
      .values({ app, key, value })
      .onConflictDoUpdate({ target: [appLimitDefaults.app, appLimitDefaults.key], set: { value } });
  }
}

/**
 * 利用者ごとの上限を、新しい表にも書く（null は行を消して既定値に戻す）。
 * @param tx - トランザクション
 * @param app - アプリの番号
 * @param userId - 利用者の番号
 * @param v - 名前 → 値
 */
async function mirrorUserLimits(tx: TxDb, app: string, userId: string, v: Record<string, number | null>): Promise<void> {
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
  return withTransaction(env.DATABASE_URL, async (tx) => {
    const before = toNamed(await getDefaults(tx));
    await tx
      .update(operatorSettings)
      .set({ defaultAccountLimit: v.accounts!, defaultDailyPostLimit: v.daily_posts!, updatedAt: new Date() })
      .where(eq(operatorSettings.id, 1));
    await mirrorDefaults(tx, app, v);
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
    limits: toNamed(u),
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
  return withTransaction(env.DATABASE_URL, async (tx) => {
    const [before] = await tx.select().from(users).where(eq(users.id, userId)).for("update").limit(1);
    if (!before) throw new AppError("USER_NOT_FOUND", 404, "user not found");
    const [after] = await tx
      .update(users)
      .set({ accountLimit: v.accounts ?? null, dailyPostLimit: v.daily_posts ?? null, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    await mirrorUserLimits(tx, app, userId, v);
    await recordOperatorEvent(tx, {
      actorUserId: operator.id,
      subjectUserId: userId,
      action: "user_limits",
      detail: { before: toNamed(before), after: v },
    });
    const eventId = await emitEvent(tx, "limits.changed", { app, userId });
    return { saved: await toLimitUser(tx, env, after!), eventId };
  }).then(async ({ saved, eventId }) => {
    await deliverSoon(env, eventId);
    return saved;
  });
}
