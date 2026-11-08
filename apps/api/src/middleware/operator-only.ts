// 運営者（OPERATOR_CLERK_USER_IDS）だけが使えるAPIの関所（specs/016・019・024）。運営者の画面のAPIは、すべてこれを通す。
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../app";
import { AppError } from "../lib/errors";

/**
 * 運営者でなければ 403 OPERATOR_ONLY。応答をブラウザに保存させない。
 * @param c - Hono のコンテキスト
 * @param next - 次の処理
 */
export const operatorOnly: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get("user").operator) throw new AppError("OPERATOR_ONLY", 403, "operator only");
  c.header("Cache-Control", "no-store");
  await next();
};
