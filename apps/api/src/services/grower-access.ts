// grower機能の判定（specs/002-strategy-profile FR-024、research.md R14）。
// 書き込み（POST・PUT・DELETE）の前に必ず呼ぶ。読み取り（GET）は止めず、canEdit を返すだけにする。
// 無料体験はAccountのオーナーの登録日時で判定する。パートナー・編集者の操作でも、オーナーと同じ結果になる（specs/008 research.md R3）。
// 呼び出し側は authorizeAccount の結果の owner を渡す。
import { hasGrowerAccess } from "@threads-grower/shared";
import { AppError } from "../lib/errors";
import type { AccountRow } from "./access";

/** 判定に使うユーザーの情報（Accountのオーナーの users の行の一部。specs/008 research.md R3）。 */
type UserForAccess = { createdAt: Date };

/**
 * そのAccountで、戦略プロファイル（課題・宣伝内容・リサーチ）を編集できるかを返す。
 * @param account - Account の行
 * @param user - Accountのオーナー（登録日時で無料体験を判定する）
 * @param now - 現在時刻
 * @returns 編集できるなら true
 */
export function canEditProfile(account: AccountRow, user: UserForAccess, now: Date = new Date()): boolean {
  return hasGrowerAccess(account.plan, user.createdAt, now);
}

/**
 * 編集できなければ 403 GROWER_FEATURE_REQUIRED を投げる。
 * @param account - Account の行
 * @param user - Accountのオーナー
 * @param now - 現在時刻
 * @throws AppError GROWER_FEATURE_REQUIRED（プラン1で、無料体験も終わっている）
 */
export function requireGrowerAccess(account: AccountRow, user: UserForAccess, now: Date = new Date()): void {
  if (!canEditProfile(account, user, now)) {
    throw new AppError("GROWER_FEATURE_REQUIRED", 403, "grower feature required");
  }
}
