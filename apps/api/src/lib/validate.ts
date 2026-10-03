// リクエストの本文の検証（specs/002-strategy-profile contracts/api.md「検証の失敗」）
import { invalidFields } from "@threads-grower/shared";
import type { z } from "zod";
import { AppError } from "./errors";

/**
 * リクエストの本文を検証する。違反は 400 VALIDATION_FAILED（details に項目名）。
 * @param schema - zod のスキーマ
 * @param body - リクエストの本文
 * @returns 検証済みの値
 */
export async function parseBody<S extends z.ZodTypeAny>(schema: S, body: Promise<unknown>): Promise<z.infer<S>> {
  const parsed = schema.safeParse(await body.catch(() => null));
  if (!parsed.success) throw new AppError("VALIDATION_FAILED", 400, "invalid request", undefined, invalidFields(parsed.error));
  return parsed.data;
}
