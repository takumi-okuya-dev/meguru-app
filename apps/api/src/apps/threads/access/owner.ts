// アカウントの持ち主（オーナー）の判定（029 で共通から移した。specs/meguru/029-threads-pattern1 research.md R1・R4）。
// 公開の直前・時刻の処理・メンションで、そのアカウントのオーナーが使えるかを確かめる。オーナーの利用権は、
// 共通の入口の関数（loadAppEntitlement）で読む（共通の表は読まない）。
import { DAILY_POST_LIMIT_MAX, type Entitlement } from "@meguru/shared";
import { and, eq } from "drizzle-orm";
import type { BillingMode } from "../../../kernel/config";
import type { Db, TxDb } from "../../../kernel/db/client";
import { loadAppEntitlement, type AppEntitlement } from "../../../platform";
import { THREADS_APP } from "../registry";
import { memberships } from "../schema";

/**
 * アカウントのオーナーの利用権を読む。
 * @param db - データベース（トランザクションの中でもよい）
 * @param accountId - accounts.id
 * @param mode - 決済のモード
 * @param now - 今の時刻
 * @returns 利用権。オーナーがいなければ null
 */
export async function loadOwnerAppEntitlement(
  db: Db | TxDb,
  accountId: string,
  mode: BillingMode,
  now: Date = new Date(),
): Promise<AppEntitlement | null> {
  const [owner] = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.accountId, accountId), eq(memberships.role, "owner")))
    .limit(1);
  return owner ? loadAppEntitlement(db, mode, owner.userId, THREADS_APP, now) : null;
}

/**
 * オーナーの利用権から、自動の公開・返信を止める理由を決める（公開の直前の確かめ。specs/013 research.md R8、specs/019 FR-008）。
 * 読むだけ・退会の途中なら billing_inactive、自動投稿を使えなければ auto_post_off。オーナーがいなければ止めない（ほかの確かめに任せる）。
 * @param owner - オーナーの利用権（loadOwnerAppEntitlement）
 * @returns 止める理由。止めないなら null
 */
export function ownerBlockReason(owner: AppEntitlement | null): "billing_inactive" | "auto_post_off" | null {
  if (!owner) return null;
  if (!owner.billing.fullAccess || owner.withdrawn) return "billing_inactive";
  if (!owner.features.has("autopost")) return "auto_post_off";
  return null;
}

/**
 * アカウントのオーナーの1日の投稿数の上限（投稿の直前の確認で使う。specs/024 research.md R7。運営者は最大）。
 * @param db - データベース（トランザクションの中でもよい）
 * @param accountId - accounts.id
 * @param mode - 決済のモード（運営者の一覧を含む）
 * @returns 上限（オーナーがいなければ Threads の上限）
 */
export async function ownerDailyPostLimit(db: Db | TxDb, accountId: string, mode: BillingMode): Promise<number> {
  const owner = await loadOwnerAppEntitlement(db, accountId, mode);
  return owner?.limits.daily_posts ?? DAILY_POST_LIMIT_MAX;
}

/**
 * アカウントのオーナーの使える状態（契約・料金なし・テスト版の判定。specs/013 research.md R8・specs/016 research.md R4）。
 * @param db - データベース（トランザクションの中でもよい）
 * @param accountId - accounts.id
 * @param mode - 決済のモード
 * @param now - 今の時刻
 * @returns 使える状態。オーナーがいなければ null
 */
export async function loadOwnerEntitlement(db: Db | TxDb, accountId: string, mode: BillingMode, now: Date = new Date()): Promise<Entitlement | null> {
  return (await loadOwnerAppEntitlement(db, accountId, mode, now))?.billing ?? null;
}
