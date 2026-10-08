// /api/accounts/:accountId/performance（specs/006-performance-feedback contracts/api.md）。
// grower機能を使えるAccountだけ（FR-031）。必ず「所有 → grower機能 → 入力の検証」の順で確かめる。
import { exportQuerySchema, feedbackRequestSchema, invalidFields, performanceQuerySchema } from "@threads-grower/shared";
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../app";
import { createDb } from "../db/client";
import { AppError } from "../lib/errors";
import { findOwnedAccount } from "../services/access";
import { requireGrowerAccess } from "../services/grower-access";
import { getPerformanceSummary, listExportRows, listPerformancePage, updateFeedback } from "../services/performance-service";

/**
 * パフォーマンスのルート。
 * @param authed - 認証のミドルウェア
 * @returns Hono のルート
 */
export function performanceRoutes(authed: MiddlewareHandler<AppEnv>) {
  return new Hono<AppEnv>().get("/accounts/:accountId/performance", authed, async (c) => {
    const db = createDb(c.env.DATABASE_URL);
    const user = c.get("user");
    const account = await findOwnedAccount(db, user.id, c.req.param("accountId"));
    requireGrowerAccess(account, user);
    const parsed = performanceQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      throw new AppError("VALIDATION_FAILED", 400, "invalid query", undefined, invalidFields(parsed.error));
    }
    const [summary, page] = await Promise.all([
      getPerformanceSummary(db, account),
      listPerformancePage(db, account.id, parsed.data),
    ]);
    return c.json({ summary, ...page });
  })
    .patch("/accounts/:accountId/performance/:draftId/feedback", authed, async (c) => {
      // 傾向メモと「プロンプトに入れる」（FR-021）。保存ボタンなしで、Webが入力欄から離れたとき・切り替えたときに呼ぶ
      const db = createDb(c.env.DATABASE_URL);
      const user = c.get("user");
      const account = await findOwnedAccount(db, user.id, c.req.param("accountId"));
      requireGrowerAccess(account, user);
      const parsed = feedbackRequestSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) {
        throw new AppError("VALIDATION_FAILED", 400, "invalid feedback", undefined, invalidFields(parsed.error));
      }
      return c.json(await updateFeedback(db, account.id, c.req.param("draftId"), parsed.data));
    })
    .get("/accounts/:accountId/performance/export", authed, async (c) => {
      // CSVの行のデータ（FR-028〜FR-030）。CSVはWebで組み立てる（research.md R7）
      const db = createDb(c.env.DATABASE_URL);
      const user = c.get("user");
      const account = await findOwnedAccount(db, user.id, c.req.param("accountId"));
      requireGrowerAccess(account, user);
      const parsed = exportQuerySchema.safeParse(c.req.query());
      if (!parsed.success) {
        throw new AppError("VALIDATION_FAILED", 400, "invalid query", undefined, invalidFields(parsed.error));
      }
      const page = await listExportRows(db, account.id, parsed.data.kind, parsed.data.before);
      return c.json({ ...page, generatedAt: new Date().toISOString() });
    });
}
