// 集金管理の画面のエラーの文言（共通のエラーの文言を使う。通信の失敗などもまとめて扱う）。
import { errorMessage } from "@meguru/shared";
import { ApiError } from "@/lib/api-client";

/**
 * 失敗を、画面に出す文言にする。
 * @param err - 捕まえたエラー
 * @returns 文言
 */
export function collectErrorText(err: unknown): string {
  return err instanceof ApiError ? errorMessage(err.code).message : "保存できませんでした。もう一度お試しください。";
}
