// GET /api/me（FR-004・FR-005、research.md R10。specs/008 research.md R11 で役割つきに広げ、
// specs/011 research.md R5 で入っているチームを足した）。029 から、共通の情報だけを作り、アプリの中身は
// アプリが登録した関数で足す（specs/meguru/029-threads-pattern1 contracts/api-routes.md 2）。
// 出せるアプリは、その人が使えるアプリで絞る（specs/meguru/030-app-access FR-004）。
import { type MeApps, lastAppRequestSchema, releasedApps, resolveLandingApp, withdrawRequestSchema } from "@meguru/shared";
import { eq } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "./auth";
import { collectSections } from "./me-sections";
import { createDb } from "../../kernel/db/client";
import { users } from "../schema";
import { loadEntitlement, toMeBilling } from "../billing/billing-service";
import { usingAppsOf } from "../usage/usage";
import { withdraw, withdrawalPreview, type ClerkUserDeleter } from "../withdrawal/withdrawal-service";
import type { Env } from "../../kernel/env";
import { AppError } from "../../kernel/errors";
import { accessibleApps, canUseApp } from "../access/app-access";

/**
 * /api/me の apps を決める（specs/028 contracts/api.md 1、research.md R6）。
 * 使っているアプリは、アプリから伝えられた利用の状態（app_usage）で決める（specs/meguru/029 research.md R6）。
 * 出せるアプリは、出してよいアプリ（released）のうち、その人が使えるものだけ。using・last・landing もこれで絞る（specs/meguru/030 FR-004）。
 * @param using - 使っているアプリ（app_usage）
 * @param lastAppId - users.last_app_id
 * @param accessible - その人が使えるアプリ（accessibleApps）
 * @returns apps
 */
export function resolveMeApps(using: readonly string[], lastAppId: string | null, accessible: ReadonlySet<string>): MeApps {
  const available = releasedApps()
    .map((a) => a.id)
    .filter((id) => accessible.has(id));
  const usingApps = available.filter((id) => using.includes(id));
  const last = lastAppId && available.includes(lastAppId) ? lastAppId : null;
  return { available, using: usingApps, last, landing: resolveLandingApp(usingApps, last) };
}

/**
 * GET /api/me のルート（FR-004・FR-005）。
 * @param authed - 認証のミドルウェア
 * @param deleteClerkUser - 退会でClerkのユーザーを消す関数を作る（specs/013）
 * @returns Hono のルート
 */
export function meRoutes(authed: MiddlewareHandler<AppEnv>, deleteClerkUser: (env: Env) => ClerkUserDeleter) {
  return new Hono<AppEnv>().get("/me", authed, async (c) => {
    const user = c.get("user");
    const db = createDb(c.env.DATABASE_URL);
    const now = new Date();
    // アプリの中身と使える状態は並べて読む。使っているアプリは、アプリの中身のあとで読む（アプリが利用の状態を伝え直すことがあるため）
    const [sections, entitlement] = await Promise.all([collectSections(c, "me"), loadEntitlement(db, user.id, user.billing, now)]);
    const [using, accessible] = await Promise.all([usingAppsOf(db, user.id), accessibleApps(db, user.id, user.operator)]);
    // Account切り替えメニューは開くたびに一覧を読み直すため、ブラウザに保存させない。
    c.header("Cache-Control", "no-store");
    return c.json({
      ...sections,
      user: { id: user.id, email: user.email, displayName: user.displayName },
      billing: toMeBilling(user.billing, entitlement!, now),
      withdrawalInProgress: user.withdrawalRequestedAt !== null,
      // テスト用のグループ（specs/016 contracts/api.md「GET /api/me」）
      testGroups: { enabled: Boolean(user.billing.testGroups), ...user.testAccess },
      operator: user.operator,
      // 出せるアプリ・使っているアプリ・最後に使ったアプリ・入口の行き先（specs/028 contracts/api.md 1）
      apps: resolveMeApps(using, user.lastAppId, accessible),
    });
  })
    // 最後に使ったアプリを覚える（specs/028 contracts/api.md 2）。外枠が、アプリの画面を開いたときに呼ぶ
    .put("/me/last-app", authed, async (c) => {
      const parsed = lastAppRequestSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new AppError("VALIDATION_FAILED", 400, "invalid last app", undefined, ["app"]);
      const db = createDb(c.env.DATABASE_URL);
      const user = c.get("user");
      // 使えないアプリは、最後に使ったアプリとして覚えない（specs/meguru/030 FR-004）
      if (!(await canUseApp(db, user.id, user.operator, parsed.data.app))) {
        throw new AppError("VALIDATION_FAILED", 400, "app not available", undefined, ["app"]);
      }
      await db.update(users).set({ lastAppId: parsed.data.app, updatedAt: new Date() }).where(eq(users.id, user.id));
      return c.body(null, 204);
    })
    // 退会（specs/013 contracts/api.md「自分」、research.md R10）
    .get("/me/withdrawal-preview", authed, async (c) => {
      c.header("Cache-Control", "no-store");
      // アプリの中身（消えるアカウントなど）は、アプリが登録した関数で足す（前の版の画面のため。PR5c で消す）
      const [own, sections] = await Promise.all([withdrawalPreview(createDb(c.env.DATABASE_URL), c.get("user").id), collectSections(c, "preview")]);
      return c.json({ ...sections, ...own });
    })
    .post("/me/withdraw", authed, async (c) => {
      const parsed = withdrawRequestSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new AppError("VALIDATION_FAILED", 400, "invalid withdraw request", undefined, ["confirmEmail"]);
      const user = c.get("user");
      await withdraw(c.env, deleteClerkUser(c.env), user, parsed.data.confirmEmail);
      return c.body(null, 204);
    });
}
