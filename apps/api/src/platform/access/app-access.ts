// アプリの利用の許可の判定（specs/meguru/030-app-access plan.md「判定」、FR-002・FR-003）。
// 「運営者が開いた人だけ」（granted）のアプリは、運営者・人ごとの許可がある人・閉じていないテストのグループの許可がある人だけが使える。
// 判定はここだけに置き、/api/me・入口の関数（loadAppEntitlement）・道筋の関所はここを使う（Constitution原則V）。
// 共通のコードにはアプリの名前を書かない（どのアプリが granted かは、登録の一覧で決まる）。
import { APP_CATALOG } from "@meguru/shared";
import { eq, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { MiddlewareHandler } from "hono";
import { createDb, type Db, type TxDb } from "../../kernel/db/client";
import { AppError } from "../../kernel/errors";
import type { AppEnv } from "../identity/auth";
import { appAccessMode, grantedApps } from "../registry/registry";
import { appAccessGrants, groupAppAccessGrants, testGroupMembers, testGroups, users } from "../schema";

/**
 * その人の、許可のあるアプリ（人ごとの許可と、入っている閉じていないグループの許可）を返す副問い合わせ。条件はここだけに置く。
 * @param userId - users.id の列（外側の問い合わせの列）か値
 * @returns app の1列を返す副問い合わせ
 */
function grantedRows(userId: AnyPgColumn | SQL): SQL {
  return sql`SELECT ${appAccessGrants.app} AS app FROM ${appAccessGrants} WHERE ${appAccessGrants.userId} = ${userId}
    UNION
    SELECT ${groupAppAccessGrants.app} FROM ${testGroupMembers}
      JOIN ${testGroups} ON ${testGroups.id} = ${testGroupMembers.groupId} AND ${testGroups.closedAt} IS NULL
      JOIN ${groupAppAccessGrants} ON ${groupAppAccessGrants.groupId} = ${testGroupMembers.groupId}
    WHERE ${testGroupMembers.userId} = ${userId}`;
}

/**
 * その人に、あるアプリの許可があるかの式（運営者かどうかは見ない。運営者は呼ぶ側で足す）。
 * @param userId - users.id の列か値
 * @param app - アプリの番号
 * @returns 真偽の式
 */
export function appGrantedSql(userId: AnyPgColumn | SQL, app: string): SQL<boolean> {
  return sql<boolean>`EXISTS (SELECT 1 FROM (${grantedRows(userId)}) g WHERE g.app = ${app})`;
}

/**
 * その人に許可のあるアプリ（決まりは見ない。人ごとの許可と、閉じていないグループの許可の和）。
 * @param db - データベース（トランザクションの中でもよい）
 * @param userId - users.id
 * @returns アプリの番号の集合（利用者がいなければ空）
 */
async function grantedAppsOf(db: Db | TxDb, userId: string): Promise<Set<string>> {
  const [row] = await db
    .select({ apps: sql<string[]>`coalesce((SELECT array_agg(DISTINCT g.app) FROM (${grantedRows(sql`${userId}`)}) g), '{}')` })
    .from(users)
    .where(eq(users.id, userId));
  return new Set(row?.apps ?? []);
}

/**
 * 判定の相手になるアプリ（アプリの一覧のアプリと、granted で登録したアプリ。一覧の順のあとに登録の順）。
 * @returns アプリの番号
 */
function candidateApps(): string[] {
  return [...new Set([...APP_CATALOG.map((a) => a.id as string), ...grantedApps()])];
}

/**
 * その人が使えるアプリ（FR-002）。open のアプリはすべて。granted のアプリは、運営者か、許可のあるときだけ。
 * granted のアプリがなければ DB を読まない（Threadsだけの今と同じ）。
 * @param db - データベース（トランザクションの中でもよい）
 * @param userId - users.id
 * @param operator - 運営者か
 * @returns 使えるアプリの番号の集合
 */
export async function accessibleApps(db: Db | TxDb, userId: string, operator: boolean): Promise<ReadonlySet<string>> {
  const candidates = candidateApps();
  const gated = candidates.filter((app) => appAccessMode(app) === "granted");
  if (gated.length === 0 || operator) return new Set(candidates);
  const granted = await grantedAppsOf(db, userId);
  return new Set(candidates.filter((app) => appAccessMode(app) === "open" || granted.has(app)));
}

/**
 * その人が、あるアプリを使えるか（FR-002）。
 * @param db - データベース（トランザクションの中でもよい）
 * @param userId - users.id
 * @param operator - 運営者か
 * @param app - アプリの番号
 * @returns 使えれば true
 */
export async function canUseApp(db: Db | TxDb, userId: string, operator: boolean, app: string): Promise<boolean> {
  if (appAccessMode(app) === "open" || operator) return true;
  return (await grantedAppsOf(db, userId)).has(app);
}

/**
 * アプリの道筋の関所（FR-003）。認証のミドルウェアのあとに置く。使えない人は 403 APP_NOT_AVAILABLE。
 * open のアプリでは DB を読まずに通す。
 * @param app - アプリの番号
 * @returns Hono のミドルウェア
 */
export function requireAppAccess(app: string): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get("user");
    if (!(await canUseApp(createDb(c.env.DATABASE_URL), user.id, user.operator, app))) {
      throw new AppError("APP_NOT_AVAILABLE", 403, "app not available");
    }
    await next();
  };
}
