import type { ErrorCode } from "@threads-grower/shared";

/** API が返すエラー。message は開発者向けの英文で、秘密情報を含めない（contracts/api.md「エラーの形」）。 */
export class AppError extends Error {
  override name = "AppError";
  constructor(
    readonly code: ErrorCode,
    readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 500,
    message: string = code,
    /** 409 STALE_UPDATE のときに返す、DBにある最新の値（specs/002 contracts/api.md「共通事項」） */
    readonly latest?: unknown,
    /** VALIDATION_FAILED のときに返す、違反した項目名 */
    readonly details?: string[],
    /** エラーの本文に足す値（投稿のスケジュールの検証の reason など。specs/005-auto-post contracts/api.md） */
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/**
 * Postgres のエラーコード（SQLSTATE）を取り出す。Drizzle が包んだエラー（cause）もたどる。
 * @param err - 捕まえたエラー
 * @returns SQLSTATE（"23505" など）。取り出せなければ undefined
 */
export function pgErrorCode(err: unknown): string | undefined {
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur && typeof cur === "object"; i++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * 宣伝内容・参考投稿・キーワードが見つからない（または別のAccountのもの）ことを表すエラーを作る。
 * @returns 404 ITEM_NOT_FOUND の AppError
 */
export const itemNotFound = () => new AppError("ITEM_NOT_FOUND", 404, "item not found");

/**
 * Accountが見つからない（または自分のものではない）ことを表すエラーを作る。
 * @returns 404 ACCOUNT_NOT_FOUND の AppError
 */
export const notFound = () => new AppError("ACCOUNT_NOT_FOUND", 404, "account not found");
