import type { ErrorCode } from "@threads-grower/shared";

// API が返すエラー。message は開発者向けの英文で、秘密情報を含めない（contracts/api.md「エラーの形」）
export class AppError extends Error {
  override name = "AppError";
  constructor(
    readonly code: ErrorCode,
    readonly status: 400 | 401 | 404 | 409 | 422 | 500,
    message: string = code,
  ) {
    super(message);
  }
}

export const notFound = () => new AppError("ACCOUNT_NOT_FOUND", 404, "account not found");
