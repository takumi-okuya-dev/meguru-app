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
 * 403 GROWER_FEATURE_REQUIRED かを確かめる。
 * @param err - 保存の失敗
 * @returns grower機能を使えなくなっていたなら true
 */
export function isGrowerRequired(err: unknown): boolean {
  return err instanceof ApiError && err.code === "GROWER_FEATURE_REQUIRED";
}
