// grower機能の判定と無料体験（specs/002-strategy-profile FR-024、research.md R14）。
// 無料体験はユーザー単位（登録から1か月）、プランはAccount単位。両方をここで判定する。
import { isInTrial } from "./billing";
import type { Plan } from "./plans";

/** grower機能を常に使えるプラン（プラン2以上）。 */
const GROWER_PLANS: readonly Plan[] = ["auto-grower", "multi-account", "team"];

/**
 * そのAccountで grower機能を使えるかを確かめる。プラン2以上か、ユーザーが無料体験中なら使える（FR-024）。
 * @param plan - Accountの契約プラン
 * @param userCreatedAt - ユーザーの登録日時
 * @param now - 現在時刻
 * @returns 使えるなら true
 */
export function hasGrowerAccess(plan: Plan, userCreatedAt: Date, now: Date): boolean {
  return GROWER_PLANS.includes(plan) || isInTrial(userCreatedAt, now);
}
