// /api/accounts/:accountId/analysis（specs/022-algorithm-analysis contracts/api.md）。
// 読むのは view（オーナーと担当の人）、書くのは content。どれも機能のまとまり「自動投稿」（019）。見せてもらっている人には出さない（research.md R10）。
import {
  analysisQuerySchema,
  analysisSettingsRequestSchema,
  classificationsQuerySchema,
  classificationsRequestSchema,
} from "@meguru/shared";
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../../../platform";
import { createDb, withTransaction } from "../../../kernel/db/client";
import { parseBody, parseQuery } from "../../../kernel/validate";
import { authorizeAccount } from "../access/access";
import {
  getAnalysis,
  listClassificationTargets,
  saveClassifications,
  updateAnalysisSettings,
} from "./analysis-service";
import { lengthSettingsOf } from "./prompt-service";

/**
 * 解析のルート。
 * @param authed - 認証のミドルウェア
 * @returns Hono のルート
 */
export function analysisRoutes(authed: MiddlewareHandler<AppEnv>) {
  return new Hono<AppEnv>()
    .get("/accounts/:accountId/analysis", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const access = await authorizeAccount(db, c.get("user"), c.req.param("accountId"), "view", { feature: "autopost" });
      const { scope } = parseQuery(analysisQuerySchema, c.req.query());
      c.header("Cache-Control", "no-store");
      return c.json(await getAnalysis(db, access, scope, lengthSettingsOf(access.account), new Date()));
    })
    .patch("/accounts/:accountId/analysis/settings", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const access = await authorizeAccount(db, c.get("user"), c.req.param("accountId"), "content", { feature: "autopost" });
      const req = await parseBody(analysisSettingsRequestSchema, c.req.json());
      return c.json(await withTransaction(c.env.DATABASE_URL, (tx) => updateAnalysisSettings(tx, access, req)));
    })
    .get("/accounts/:accountId/analysis/classifications", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const access = await authorizeAccount(db, c.get("user"), c.req.param("accountId"), "content", { feature: "autopost" });
      const { mode } = parseQuery(classificationsQuerySchema, c.req.query());
      c.header("Cache-Control", "no-store");
      return c.json(await listClassificationTargets(db, access.account.id, mode, new Date()));
    })
    .put("/accounts/:accountId/analysis/classifications", authed, async (c) => {
      const db = createDb(c.env.DATABASE_URL);
      const access = await authorizeAccount(db, c.get("user"), c.req.param("accountId"), "content", { feature: "autopost" });
      const req = await parseBody(classificationsRequestSchema, c.req.json());
      return c.json(await withTransaction(c.env.DATABASE_URL, (tx) => saveClassifications(tx, access, req, new Date())));
    });
}
