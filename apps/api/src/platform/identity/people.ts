// 利用者の名前と、ログインしている人（specs/meguru/029-threads-pattern1 contracts/platform-entry.md 2）。
// アプリは users の表を読まず、ここから受け取る。
import { inArray } from "drizzle-orm";
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
 * ログインしている人（認証のミドルウェアが入れたもの）。
 * @param c - Hono の文脈
 * @returns ログインしている人
 */
export function currentUser(c: Context<AppEnv>): CurrentUser {
  return c.get("user");
}
