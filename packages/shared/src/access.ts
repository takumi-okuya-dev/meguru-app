// grower機能の判定と無料体験（specs/002-strategy-profile FR-024、research.md R14）。
// 無料体験はユーザー単位（登録から1か月）、プランはAccount単位。両方をここで判定する。
import type { Plan } from "./plans";

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** grower機能を常に使えるプラン（プラン2以上）。 */
const GROWER_PLANS: readonly Plan[] = ["auto-grower", "multi-account", "team"];

/**
 * 無料体験の終了時刻を求める。日本時間の暦で1か月後の同じ時刻とし、日がない月は月の最終日に丸める。
 * @param userCreatedAt - ユーザーの登録日時（users.created_at）
 * @returns 無料体験の終了時刻（この時刻より前が無料体験中）
 */
export function trialEndsAt(userCreatedAt: Date): Date {
  const jst = new Date(userCreatedAt.getTime() + JST_OFFSET_MS);
  const year = jst.getUTCFullYear();
  const month = jst.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(jst.getUTCDate(), lastDay);
  const endJst = Date.UTC(
    year,
    month,
    day,
    jst.getUTCHours(),
    jst.getUTCMinutes(),
    jst.getUTCSeconds(),
    jst.getUTCMilliseconds(),
  );
  return new Date(endJst - JST_OFFSET_MS);
}

/**
 * ユーザーが無料体験中かを確かめる。
 * @param userCreatedAt - ユーザーの登録日時
 * @param now - 現在時刻
 * @returns 無料体験中なら true
 */
export function isInTrial(userCreatedAt: Date, now: Date): boolean {
  return now.getTime() < trialEndsAt(userCreatedAt).getTime();
}

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
