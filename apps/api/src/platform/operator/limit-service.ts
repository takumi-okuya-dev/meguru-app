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
import { and, asc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import type { Env } from "../../kernel/env";
import { withTransaction, type Db, type TxDb } from "../../kernel/db/client";
import { memberships, operatorSettings, users } from "../schema";
import { operatorIdsOf } from "../../kernel/config";
import { AppError } from "../../kernel/errors";
import { isUuid } from "../access/access";
import { listOperatorEvents, recordOperatorEvent } from "./operator-events";
import { runHook } from "../hooks";
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
 * アカウントのオーナーの1日の投稿数の上限（投稿の直前の確認で使う。specs/024 research.md R7）。
 * @param db - データベース（トランザクションの中でもよい）
 * @param accountId - accounts.id
 * @param operators - 運営者の clerk_user_id
 * @returns 上限（オーナーがいなければ Threads の上限）
 */
export async function ownerDailyPostLimit(db: Db | TxDb, accountId: string, operators: readonly string[]): Promise<number> {
  const [row] = await db
    .select({ limit: dailyPostLimitSql(users.clerkUserId, users.dailyPostLimit, operators) })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.accountId, accountId), eq(memberships.role, "owner")))
    .limit(1);
  return row?.limit ?? DAILY_POST_LIMIT_MAX;
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
    await recordOperatorEvent(tx, { actorUserId: operator.id, action: "default_limits", detail: { before, after: v } });
    return v;
  }).then(async (saved) => {
    // 上限が上がると、次に見る時刻が早まることがある。定期処理を起こす（PR #71 のCodexレビュー）
    // アプリに知らせる（Threads：自動投稿を起こす。specs/027 research.md R4）
    await runHook("limitsChanged", { env });
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
  const [owned] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(memberships)
    .where(and(eq(memberships.userId, u.id), inArray(memberships.role, ["owner"])));
  return {
    userId: u.id,
    name: u.displayName,
    email: u.email,
    operator: isOperator(env, u.clerkUserId),
    accountLimit: u.accountLimit,
    dailyPostLimit: u.dailyPostLimit,
    ownedAccountCount: Number(owned?.n ?? 0),
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
    await recordOperatorEvent(tx, {
      actorUserId: operator.id,
      subjectUserId: userId,
      action: "user_limits",
      detail: {
        before: { accountLimit: before.accountLimit, dailyPostLimit: before.dailyPostLimit },
        after: { accountLimit: v.accountLimit, dailyPostLimit: v.dailyPostLimit },
      },
    });
    return toLimitUser(tx, env, after!);
  }).then(async (saved) => {
    // 上限が上がると、次に見る時刻が早まることがある。定期処理を起こす（PR #71 のCodexレビュー）
    // アプリに知らせる（Threads：自動投稿を起こす。specs/027 research.md R4）
    await runHook("limitsChanged", { env });
    return saved;
  });
}
