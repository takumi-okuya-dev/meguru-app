// 保存の失敗の扱い（specs/002 contracts/ui-routes.md 規則2）
import { ApiError, describeError } from "./api-client";

/** 通信の失敗・想定外のエラーのときの文言。入力内容は残す。 */
export const SAVE_FAILED_MESSAGE = "保存できませんでした。通信状況を確認して、もう一度お試しください。";

/**
 * 保存の失敗を、トーストに出す文言にする。通信の失敗・想定外のエラーは共通の文言にする。
 * @param err - 保存の失敗
 * @returns 画面に出す文言
 */
export function saveErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError) || err.code === "API_UNREACHABLE" || err.code === "INTERNAL_ERROR") {
    return SAVE_FAILED_MESSAGE;
  }
  return describeError(err);
}

/**
 * 409 STALE_UPDATE かを確かめる。
 * @param err - 保存の失敗
 * @returns 他で先に保存されていたなら true
 */
export function isStale(err: unknown): err is ApiError {
  return err instanceof ApiError && err.code === "STALE_UPDATE";
}

/**
 * 403 BILLING_REQUIRED（オーナーが読むだけ）かを確かめる（specs/013）。
 * @param err - 保存の失敗
 * @returns 読むだけになっていたなら true
 */
export function isBillingRequired(err: unknown): err is ApiError {
  return err instanceof ApiError && err.code === "BILLING_REQUIRED";
}

/**
 * 403 BILLING_REQUIRED の読むだけの理由（details の1つ目）。
 * @param err - 保存の失敗
 * @returns 理由（BILLING_REQUIRED でなければ null）
 */
export function billingReasonOf(err: unknown): string | null {
  return isBillingRequired(err) ? (err.details[0] ?? "trial_ended") : null;
}

/**
 * 403 FEATURE_DISABLED（オーナーの設定で、その機能のまとまりがOFF）かを確かめる（specs/019）。
 * @param err - 読み込み・保存の失敗
 * @returns まとまりがOFFなら true
 */
export function isFeatureDisabled(err: unknown): err is ApiError {
  return err instanceof ApiError && err.code === "FEATURE_DISABLED";
}
