// GET /api/me（FR-004・FR-005、research.md R10。specs/008 research.md R11 で役割つきに広げ、
// specs/011 research.md R5 で入っているチームを足した）。029 から、共通の情報だけを作り、アプリの中身は
// アプリが登録した関数で足す（specs/meguru/029-threads-pattern1 contracts/api-routes.md 2）。
import { type MeApps, lastAppRequestSchema, releasedApps, resolveLandingApp, withdrawRequestSchema } from "@meguru/shared";
import { eq } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "./auth";
import { createDb } from "../../kernel/db/client";
import { users } from "../schema";
import { loadEntitlement, toMeBilling } from "../billing/billing-service";
import { usingAppsOf } from "../usage/usage";
import { withdraw, withdrawalPreview, type ClerkUserDeleter } from "../withdrawal/withdrawal-service";
import type { Env } from "../../kernel/env";
import { AppError } from "../../kernel/errors";

/**
 * /api/me の apps を決める（specs/028 contracts/api.md 1、research.md R6）。
 * 使っているアプリは、アプリから伝えられた利用の状態（app_usage）で決める（specs/meguru/029 research.md R6）。
 * @param using - 使っているアプリ（app_usage）
 * @param lastAppId - users.last_app_id
 * @returns apps
 */
export function resolveMeApps(using: readonly string[], lastAppId: string | null): MeApps {
  const available = releasedApps().map((a) => a.id);
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
    // 共通の中身だけを返す（アプリの中身は各アプリの道筋。Threadsなら /api/threads/me。specs/meguru/029 contracts/api-routes.md 2）
    const [entitlement, using] = await Promise.all([loadEntitlement(db, user.id, user.billing, now), usingAppsOf(db, user.id)]);
    // Account切り替えメニューは開くたびに一覧を読み直すため、ブラウザに保存させない。
    c.header("Cache-Control", "no-store");
    return c.json({
      user: { id: user.id, email: user.email, displayName: user.displayName },
      billing: toMeBilling(user.billing, entitlement!, now),
      withdrawalInProgress: user.withdrawalRequestedAt !== null,
      // テスト用のグループ（specs/016 contracts/api.md「GET /api/me」）
      testGroups: { enabled: Boolean(user.billing.testGroups), ...user.testAccess },
      operator: user.operator,
      // 出せるアプリ・使っているアプリ・最後に使ったアプリ・入口の行き先（specs/028 contracts/api.md 1）
      apps: resolveMeApps(using, user.lastAppId),
    });
  })
    // 最後に使ったアプリを覚える（specs/028 contracts/api.md 2）。外枠が、アプリの画面を開いたときに呼ぶ
    .put("/me/last-app", authed, async (c) => {
      const parsed = lastAppRequestSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new AppError("VALIDATION_FAILED", 400, "invalid last app", undefined, ["app"]);
      const db = createDb(c.env.DATABASE_URL);
      await db.update(users).set({ lastAppId: parsed.data.app, updatedAt: new Date() }).where(eq(users.id, c.get("user").id));
      return c.body(null, 204);
    })
    // 退会（specs/013 contracts/api.md「自分」、research.md R10）
    .get("/me/withdrawal-preview", authed, async (c) => {
      c.header("Cache-Control", "no-store");
      // 共通の分だけ（アプリの分は各アプリの道筋。Threadsなら /api/threads/me/withdrawal-preview）
      return c.json(await withdrawalPreview(createDb(c.env.DATABASE_URL), c.get("user").id));
    })
    .post("/me/withdraw", authed, async (c) => {
      const parsed = withdrawRequestSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new AppError("VALIDATION_FAILED", 400, "invalid withdraw request", undefined, ["confirmEmail"]);
      const user = c.get("user");
      await withdraw(c.env, deleteClerkUser(c.env), user, parsed.data.confirmEmail);
      return c.body(null, 204);
    });
}
