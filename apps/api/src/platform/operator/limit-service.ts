// アカウントの数と1日の投稿数の上限（specs/024-tester-invite-connect research.md R6・R7、data-model.md 4）。
// 上限の読み書きはこのファイルの外に書かない。運営者には上限をかけない（アカウントは null、投稿は Threads の上限まで）。
import {
  DAILY_POST_LIMIT_MAX,
  LIMIT_EVENTS_LIMIT,
  type DefaultLimits,
  type OperatorLimitUser,
  type OperatorLimits,
  type UserLimitsRequest,
} from "@meguru/shared";
import { and, asc, eq, isNotNull, or, sql } from "drizzle-orm";
import type { Env } from "../../kernel/env";
import { withTransaction, type Db, type TxDb } from "../../kernel/db/client";
import { appLimitDefaults, operatorSettings, userAppLimits, users } from "../schema";
import { appUsageOf } from "../usage/usage";
import { appLimits, registeredApps } from "../registry/registry";
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

/**
 * 投稿に使う時刻（早い時刻から、1日の投稿数の上限の数まで。specs/024 FR-020）。
 * 時刻の一覧を読んで数える・予定を求める・投稿するところは、すべてここを通す（PR #71 のセルフレビュー）。
 * @param slotMinutes - 登録した時刻（0時からの分）
 * @param limit - 1日の投稿数の上限（省けば切らない）
 * @returns 投稿に使う時刻（昇順）
 */
export function effectiveSlotMinutes(slotMinutes: readonly number[], limit: number | undefined): number[] {
  const sorted = [...slotMinutes].sort((a, b) => a - b);
  return limit === undefined ? sorted : sorted.slice(0, limit);
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
  return { defaults, overrides, events };
}

// ---- 新しい上限の表へ同じ値を書く（specs/meguru/029-threads-pattern1 research.md R7、T014）----
// PR1〜PR4 の間は、古い列（operator_settings・users）と新しい表（app_limit_defaults・user_app_limits）の両方に書く。
// 読むのはまだ古い列（今の判定を変えない）。PR2 で読む側を新しい表に替え、PR5 で古い列とこの写しを消す。
const MIRROR_APP = "threads";
const MIRROR_KEYS = { accountLimit: "accounts", dailyPostLimit: "daily_posts" } as const;

/**
 * 既定の上限を、新しい表にも書く。
 * @param tx - トランザクション
 * @param v - 既定値
 */
async function mirrorDefaults(tx: TxDb, v: DefaultLimits): Promise<void> {
  for (const [field, key] of Object.entries(MIRROR_KEYS) as [keyof DefaultLimits, string][]) {
    await tx
      .insert(appLimitDefaults)
      .values({ app: MIRROR_APP, key, value: v[field] })
      .onConflictDoUpdate({ target: [appLimitDefaults.app, appLimitDefaults.key], set: { value: v[field] } });
  }
}

/**
 * 利用者ごとの上限を、新しい表にも書く（null は行を消して既定値に戻す）。
 * @param tx - トランザクション
 * @param userId - 利用者の番号
 * @param v - 値
 */
async function mirrorUserLimits(tx: TxDb, userId: string, v: UserLimitsRequest): Promise<void> {
  for (const [field, key] of Object.entries(MIRROR_KEYS) as [keyof UserLimitsRequest, string][]) {
    const value = v[field];
    const where = and(eq(userAppLimits.userId, userId), eq(userAppLimits.app, MIRROR_APP), eq(userAppLimits.key, key));
    if (value === null) await tx.delete(userAppLimits).where(where);
    else
      await tx
        .insert(userAppLimits)
        .values({ userId, app: MIRROR_APP, key, value })
        .onConflictDoUpdate({ target: [userAppLimits.userId, userAppLimits.app, userAppLimits.key], set: { value } });
  }
}

/**
 * 上限（アカウントの数・1日の投稿数）を登録したアプリ。運営の画面を登録の一覧で出す形にするまで（PR2c の T069・T070）、
 * 上限は1つのアプリのものとして扱う。
 * @returns アプリの番号（登録がなければ undefined）
 */
function limitsApp(): string | undefined {
  return registeredApps().find((a) => "accounts" in appLimits(a));
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
 * @param v - 既定値
 * @returns 保存した既定値
 */
export async function setDefaults(env: Env, operator: { id: string }, v: DefaultLimits): Promise<DefaultLimits> {
  return withTransaction(env.DATABASE_URL, async (tx) => {
    const before = await getDefaults(tx);
    await tx
      .update(operatorSettings)
      .set({ defaultAccountLimit: v.accountLimit, defaultDailyPostLimit: v.dailyPostLimit, updatedAt: new Date() })
      .where(eq(operatorSettings.id, 1));
    await mirrorDefaults(tx, v);
    await recordOperatorEvent(tx, { actorUserId: operator.id, action: "default_limits", detail: { before, after: v } });
    // 上限が上がると、次に見る時刻が早まることがある。アプリに出来事で知らせる（Threads：自動投稿を起こす。PR #71 のCodexレビュー）
    const app = limitsApp();
    const eventId = app ? await emitEvent(tx, "limits.changed", { app }) : null;
    return { saved: v, eventId };
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
  // 持ち主としてのアカウントの数は、アカウントの数の上限を登録したアプリから伝えられた利用の数（specs/meguru/029 research.md R6）。
  // 全アプリの合計（料金の数）ではなく、そのアプリの数だけを出す。運営の画面を登録の一覧で出す形にするのは PR2c（T069・T070）
  const app = limitsApp();
  const owned = app ? ((await appUsageOf(db, u.id, app))?.quantity ?? 0) : 0;
  return {
    userId: u.id,
    name: u.displayName,
    email: u.email,
    operator: isOperator(env, u.clerkUserId),
    accountLimit: u.accountLimit,
    dailyPostLimit: u.dailyPostLimit,
    ownedAccountCount: owned,
  };
}

/**
 * 利用者ごとの上限を保存する（null は既定値に戻す。FR-017）。
 * @param env - Workers のバインディング
 * @param operator - 運営者
 * @param userId - 上限を変える人
 * @param v - 値
 * @returns 保存した後の、その人と上限
 * @throws AppError USER_NOT_FOUND
 */
export async function setUserLimits(env: Env, operator: { id: string }, userId: string, v: UserLimitsRequest): Promise<OperatorLimitUser> {
  if (!isUuid(userId)) throw new AppError("USER_NOT_FOUND", 404, "user not found");
  return withTransaction(env.DATABASE_URL, async (tx) => {
    const [before] = await tx.select().from(users).where(eq(users.id, userId)).for("update").limit(1);
    if (!before) throw new AppError("USER_NOT_FOUND", 404, "user not found");
    const [after] = await tx
      .update(users)
      .set({ accountLimit: v.accountLimit, dailyPostLimit: v.dailyPostLimit, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    await mirrorUserLimits(tx, userId, v);
    await recordOperatorEvent(tx, {
      actorUserId: operator.id,
      subjectUserId: userId,
      action: "user_limits",
      detail: {
        before: { accountLimit: before.accountLimit, dailyPostLimit: before.dailyPostLimit },
        after: { accountLimit: v.accountLimit, dailyPostLimit: v.dailyPostLimit },
      },
    });
    const app = limitsApp();
    const eventId = app ? await emitEvent(tx, "limits.changed", { app, userId }) : null;
    return { saved: await toLimitUser(tx, env, after!), eventId };
  }).then(async ({ saved, eventId }) => {
    await deliverSoon(env, eventId);
    return saved;
  });
}
