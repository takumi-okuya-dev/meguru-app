// アプリの利用の許可の読み書き（運営者。specs/meguru/030-app-access plan.md「運営者のAPI」、FR-005）。
// 許可の表（app_access_grants・group_app_access_grants）は、このファイルの外から書かない。使えるかの判定は app-access.ts だけ。
// 開けるのは「運営者が開いた人だけ」（granted）で登録したアプリだけ。開いた・閉じたことは運営の記録（operator_events）に残す。
import type { AppAccessRequest, AppAccessResponse } from "@meguru/shared";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Env } from "../../kernel/env";
import { withTransaction, type Db, type TxDb } from "../../kernel/db/client";
import { AppError } from "../../kernel/errors";
import { isUuid } from "../../kernel/validate";
import { recordOperatorEvent } from "../operator/operator-events";
import { grantedApps } from "../registry/registry";
import { appAccessGrants, groupAppAccessGrants, testGroups, users } from "../schema";

/** 開く・閉じるの値（アプリ → true なら開く）。 */
type AppAccessValues = AppAccessRequest["apps"];

/**
 * 許可のあるアプリを、granted で登録した順に並べる（登録していない・open のアプリは除く）。
 * @param apps - 許可の行のアプリ（順不同）
 * @returns 登録の順のアプリ
 */
export function orderedGrants(apps: readonly string[] | null | undefined): string[] {
  const set = new Set(apps ?? []);
  return grantedApps().filter((a) => set.has(a));
}

/**
 * その人に、人ごとに開いているアプリの配列の式（グループの許可は含まない。運営の画面に出すため）。
 * @param userId - users.id の列（外側の問い合わせの列）
 * @returns text[] の式
 */
export function userGrantsSql(userId: AnyPgColumn | SQL): SQL<string[]> {
  return sql<string[]>`coalesce((SELECT array_agg(${appAccessGrants.app}) FROM ${appAccessGrants} WHERE ${appAccessGrants.userId} = ${userId}), '{}')`;
}

/**
 * グループに開いているアプリの配列の式（運営の画面に出すため）。
 * @param groupId - test_groups.id の列（外側の問い合わせの列）
 * @returns text[] の式
 */
export function groupGrantsSql(groupId: AnyPgColumn | SQL): SQL<string[]> {
  return sql<string[]>`coalesce((SELECT array_agg(${groupAppAccessGrants.app}) FROM ${groupAppAccessGrants} WHERE ${groupAppAccessGrants.groupId} = ${groupId}), '{}')`;
}

/**
 * 保存する値のアプリが、すべて granted で登録したアプリかを確かめる。道筋で、DBを読む前に呼ぶ（形の誤りは 404 より先に 400）。
 * @param apps - アプリ → 開く・閉じる
 * @throws AppError VALIDATION_FAILED（登録していない・open のアプリがあるとき。項目は apps）
 */
export function assertAppAccessValues(apps: AppAccessValues): void {
  const allowed = grantedApps();
  if (Object.keys(apps).some((a) => !allowed.includes(a))) {
    throw new AppError("VALIDATION_FAILED", 400, "apps must be registered as granted", undefined, ["apps"]);
  }
}

/**
 * グループに開いているアプリ（登録の順。グループの詳しい画面に出す）。
 * @param db - データベース（トランザクションの中でもよい）
 * @param groupId - test_groups.id
 * @returns アプリの番号
 */
export async function groupAppAccess(db: Db | TxDb, groupId: string): Promise<string[]> {
  const rows = await db.select({ app: groupAppAccessGrants.app }).from(groupAppAccessGrants).where(eq(groupAppAccessGrants.groupId, groupId));
  return orderedGrants(rows.map((r) => r.app));
}

/**
 * 人ごとに開いているアプリ（登録の順）。
 * @param db - データベース（トランザクションの中でもよい）
 * @param userId - users.id
 * @returns アプリの番号
 */
async function userAppAccess(db: Db | TxDb, userId: string): Promise<string[]> {
  const rows = await db.select({ app: appAccessGrants.app }).from(appAccessGrants).where(eq(appAccessGrants.userId, userId));
  return orderedGrants(rows.map((r) => r.app));
}

/**
 * 今の許可と保存する値から、開く・閉じるアプリを求める。
 * @param before - 今開いているアプリ
 * @param apps - アプリ → 開く・閉じる
 * @returns 開くアプリと閉じるアプリ（登録の順）
 */
function diff(before: readonly string[], apps: AppAccessValues) {
  const order = grantedApps();
  return {
    toGrant: order.filter((a) => apps[a] === true && !before.includes(a)),
    toRevoke: order.filter((a) => apps[a] === false && before.includes(a)),
  };
}

/**
 * 人ごとの許可を開く・閉じる（書いたアプリだけを変える）。変わったアプリごとに運営の記録を残す（FR-005）。
 * @param env - Workers のバインディング
 * @param operator - 運営者
 * @param userId - 許可を変える人の users.id
 * @param apps - アプリ → 開く・閉じる（granted で登録したアプリだけ）
 * @returns 保存した後に、その人に人ごとに開いているアプリ
 * @throws AppError VALIDATION_FAILED・USER_NOT_FOUND
 */
export async function setUserAppAccess(env: Env, operator: { id: string }, userId: string, apps: AppAccessValues): Promise<AppAccessResponse> {
  assertAppAccessValues(apps);
  if (!isUuid(userId)) throw new AppError("USER_NOT_FOUND", 404, "user not found");
  return withTransaction(env.DATABASE_URL, async (tx) => {
    // 同じ人の保存を順に並べる（記録が実際の変化と食い違わないように）
    const [locked] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
    if (!locked) throw new AppError("USER_NOT_FOUND", 404, "user not found");
    const before = await userAppAccess(tx, userId);
    const { toGrant, toRevoke } = diff(before, apps);
    if (toGrant.length > 0) {
      await tx
        .insert(appAccessGrants)
        .values(toGrant.map((app) => ({ app, userId, grantedBy: operator.id })))
        .onConflictDoNothing();
    }
    if (toRevoke.length > 0) {
      await tx.delete(appAccessGrants).where(and(eq(appAccessGrants.userId, userId), inArray(appAccessGrants.app, toRevoke)));
    }
    for (const [app, granted] of [...toGrant.map((a) => [a, true] as const), ...toRevoke.map((a) => [a, false] as const)]) {
      await recordOperatorEvent(tx, { actorUserId: operator.id, subjectUserId: userId, action: "app_access", detail: { app, granted } });
    }
    return { granted: await userAppAccess(tx, userId) };
  });
}

/**
 * テストのグループの許可を開く・閉じる（書いたアプリだけを変える）。閉じたグループは変えられない（機能のON/OFFと同じ）。
 * @param env - Workers のバインディング
 * @param operator - 運営者
 * @param groupId - test_groups.id
 * @param apps - アプリ → 開く・閉じる（granted で登録したアプリだけ）
 * @returns 保存した後に、そのグループに開いているアプリ
 * @throws AppError VALIDATION_FAILED・ITEM_NOT_FOUND・TEST_GROUP_CLOSED
 */
export async function setGroupAppAccess(env: Env, operator: { id: string }, groupId: string, apps: AppAccessValues): Promise<AppAccessResponse> {
  assertAppAccessValues(apps);
  if (!isUuid(groupId)) throw new AppError("ITEM_NOT_FOUND", 404, "test group not found");
  return withTransaction(env.DATABASE_URL, async (tx) => {
    const [g] = await tx.select({ id: testGroups.id, closedAt: testGroups.closedAt }).from(testGroups).where(eq(testGroups.id, groupId)).for("update");
    if (!g) throw new AppError("ITEM_NOT_FOUND", 404, "test group not found");
    if (g.closedAt) throw new AppError("TEST_GROUP_CLOSED", 409, "test group closed");
    const before = await groupAppAccess(tx, groupId);
    const { toGrant, toRevoke } = diff(before, apps);
    if (toGrant.length > 0) {
      await tx
        .insert(groupAppAccessGrants)
        .values(toGrant.map((app) => ({ app, groupId, grantedBy: operator.id })))
        .onConflictDoNothing();
    }
    if (toRevoke.length > 0) {
      await tx.delete(groupAppAccessGrants).where(and(eq(groupAppAccessGrants.groupId, groupId), inArray(groupAppAccessGrants.app, toRevoke)));
    }
    for (const [app, granted] of [...toGrant.map((a) => [a, true] as const), ...toRevoke.map((a) => [a, false] as const)]) {
      await recordOperatorEvent(tx, { actorUserId: operator.id, action: "app_access", detail: { app, granted, groupId } });
    }
    return { granted: await groupAppAccess(tx, groupId) };
  });
}
