// /api/accounts/:accountId/performance（specs/006-performance-feedback contracts/api.md）。
// 書き込みは権限の判定（authorizeAccount）で守る。読むだけのオーナーのアカウントでも、見ることはできる（specs/013 FR-040）。
import { exportQuerySchema, feedbackRequestSchema, invalidFields, performanceQuerySchema } from "@threads-grower/shared";
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../app";
import { createDb } from "../kernel/db/client";
import { withActivityTx } from "../platform";
import { AppError } from "../kernel/errors";
import { authorizeAccount } from "../platform";
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
    const access = await authorizeAccount(db, user, c.req.param("accountId"), "view", { feature: "autopost" });
    const account = access.account;
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
      const access = await authorizeAccount(db, user, c.req.param("accountId"), "content", { feature: "autopost" });
      const account = access.account;
      const parsed = feedbackRequestSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) {
        throw new AppError("VALIDATION_FAILED", 400, "invalid feedback", undefined, invalidFields(parsed.error));
      }
      // 保存と操作の記録を同じトランザクションにする（PR #9 のCodexレビュー）
      return c.json(
        await withActivityTx(c.env.DATABASE_URL, db, access, (q) =>
          updateFeedback(q, account.id, c.req.param("draftId"), parsed.data, new Date(), access),
        ),
      );
    })
    .get("/accounts/:accountId/performance/export", authed, async (c) => {
      // CSVの行のデータ（FR-028〜FR-030）。CSVはWebで組み立てる（research.md R7）
      const db = createDb(c.env.DATABASE_URL);
      const user = c.get("user");
      const access = await authorizeAccount(db, user, c.req.param("accountId"), "view", { feature: "autopost" });
      const account = access.account;
      // 未接続のアカウントには書き出すものがない（specs/012 FR-033）
      if (account.connectionStatus === "not_connected")
        throw new AppError("ACCOUNT_NOT_CONNECTED", 409, "account not connected", undefined, [account.id]);
      const parsed = exportQuerySchema.safeParse(c.req.query());
      if (!parsed.success) {
        throw new AppError("VALIDATION_FAILED", 400, "invalid query", undefined, invalidFields(parsed.error));
      }
      const page = await listExportRows(db, account.id, parsed.data.kind, parsed.data.before);
      return c.json({ ...page, generatedAt: new Date().toISOString() });
    });
}
