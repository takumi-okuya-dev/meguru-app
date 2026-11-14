// 利用者の名前と、ログインしている人（specs/meguru/029-threads-pattern1 contracts/platform-entry.md 2）。
// アプリは users の表を読まず、ここから受け取る。
import { ilike, inArray, or } from "drizzle-orm";
import type { Context } from "hono";
import type { Db, TxDb } from "../../kernel/db/client";
import { users } from "../schema";
import type { AppEnv, CurrentUser } from "./auth";

/**
 * 画面に出す名前（表示名、なければメールアドレスの@の前）。
 * @param u - 表示名とメールアドレス
 * @returns 名前
 */
export function personName(u: { displayName: string | null; email: string }): string {
  return u.displayName?.trim() || u.email.split("@")[0] || u.email;
}

/**
 * 利用者の番号をまとめて、画面に出す名前を読む。
 * @param db - データベース（トランザクションの中でもよい）
 * @param userIds - 利用者の番号（重複は1つにまとめる）
 * @returns 番号ごとの名前（見つからない番号は入らない）
 */
export async function peopleNames(db: Db | TxDb, userIds: readonly string[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: users.id, displayName: users.displayName, email: users.email })
    .from(users)
    .where(inArray(users.id, ids));
  return new Map(rows.map((r) => [r.id, personName(r)]));
}

/**
 * 利用者の表示名とメールアドレスをまとめて読む（運営者の画面など、名前とメールアドレスを分けて出すところ。
 * specs/meguru/029-threads-pattern1 contracts/platform-entry.md 2「利用者の情報」）。
 * @param db - データベース（トランザクションの中でもよい）
 * @param userIds - 利用者の番号（重複は1つにまとめる）
 * @returns 利用者の番号ごとの表示名とメールアドレス（見つからない番号は入らない）
 */
export async function peopleProfiles(
  db: Db | TxDb,
  userIds: readonly string[],
): Promise<Map<string, { displayName: string | null; email: string }>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: users.id, displayName: users.displayName, email: users.email })
    .from(users)
    .where(inArray(users.id, ids));
  return new Map(rows.map((r) => [r.id, { displayName: r.displayName, email: r.email }]));
}

/**
 * 表示名かメールアドレスに検索語を含む利用者の番号（運営者の画面の検索。specs/meguru/029-threads-pattern1 contracts/platform-entry.md 2）。
 * @param db - データベース
 * @param pattern - ILIKE のパターン（呼ぶ側で \ % _ を逃がし、前後に % を付けたもの）
 * @returns 当てはまる利用者の番号
 */
export async function searchPeople(db: Db | TxDb, pattern: string): Promise<string[]> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(or(ilike(users.displayName, pattern), ilike(users.email, pattern)));
  return rows.map((r) => r.id);
}

/**
 * ログインしている人（認証のミドルウェアが入れたもの）。
 * @param c - Hono の文脈
 * @returns ログインしている人
 */
export function currentUser(c: Context<AppEnv>): CurrentUser {
  return c.get("user");
}
