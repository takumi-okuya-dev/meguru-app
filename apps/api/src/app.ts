// Hono アプリの組み立て。認証の検証処理は差し込めるようにし、テストでは偽の検証を渡す
// （本番コードにテスト用の抜け道は作らない）。
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./env";
import { validateConfig } from "./lib/config";
import { AppError } from "./lib/errors";
import { logger } from "./lib/logger";
import { authMiddleware, clerkVerifier, type AuthVerifier, type AuthVariables } from "./middleware/auth";
import { accountRoutes } from "./routes/accounts";
import { dataDeletionRoutes } from "./routes/data-deletion";
import { threadsWebhookRoutes } from "./routes/threads-webhooks";
import { meRoutes } from "./routes/me";
import { threadsConnectRoutes } from "./routes/threads-connect";

/** アプリに差し込む依存。テストでは偽の認証を渡す。 */
export type AppDeps = {
  verifyAuth: (env: Env) => AuthVerifier;
};

/** 本番の依存。認証は Clerk で検証する。 */
export const defaultDeps: AppDeps = {
  verifyAuth: (env) => clerkVerifier(env),
};

/** Hono のアプリの型引数。バインディングと、認証済みのユーザー。 */
export type AppEnv = { Bindings: Env; Variables: AuthVariables };

/**
 * API の Hono アプリを組み立てる。CORS・設定の確認・エラーの形・各ルートをまとめる。
 * @param deps - 差し込む依存。省略すると本番の依存（Clerk の検証）を使う
 * @returns /api 以下のルートを持つアプリ
 */
export function createApp(deps: AppDeps = defaultDeps) {
  const app = new Hono<AppEnv>();

  app.use("/api/*", async (c, next) => {
    const corsMiddleware = cors({
      origin: c.env.WEB_ORIGIN,
      allowHeaders: ["Authorization", "Content-Type"],
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      credentials: false,
    });
    return corsMiddleware(c, next);
  });

  // 設定の確認。誤りがあれば、どの項目が悪いか（項目名だけ）をログに1回出し、CONFIG_ERROR を返す。
  // ブラウザが遷移してくる callback だけは、Web のアカウント追加画面へ戻して案内を出す
  const checked = new WeakMap<object, string[]>();
  app.use("/api/*", async (c, next) => {
    if (c.req.path === "/api/health") return next();
    let problems = checked.get(c.env);
    if (!problems) {
      problems = validateConfig(c.env);
      checked.set(c.env, problems);
      if (problems.length > 0) {
        logger.error("server configuration error: fix these variables and restart the API", { variables: problems });
      }
    }
    if (problems.length === 0) return next();
    if (c.req.path === "/api/threads/callback") {
      try {
        const web = new URL(c.env.WEB_ORIGIN).origin;
        return c.redirect(`${web}/accounts/new?${new URLSearchParams({ error: "CONFIG_ERROR" })}`, 302);
      } catch {
        return c.text(`サーバーの設定に誤りがあります（${problems.join("、")}）。apps/api/.dev.vars を確認し、APIを起動し直してください。`, 500);
      }
    }
    return c.json(
      { error: { code: "CONFIG_ERROR" as const, message: "server configuration error", details: problems } },
      500,
    );
  });

  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json({ error: { code: err.code, message: err.message } }, err.status);
    }
    logger.error("unhandled error", { err });
    return c.json({ error: { code: "INTERNAL_ERROR" as const, message: "internal error" } }, 500);
  });

  const authed = authMiddleware(deps.verifyAuth);

  const routes = app
    .basePath("/api")
    .get("/health", (c) => {
      // 誤っている設定の項目名を返す（値は返さない）。開発時の確認用
      const configErrors = validateConfig(c.env);
      return c.json(configErrors.length === 0 ? { ok: true } : { ok: false, configErrors });
    })
    .route("/", meRoutes(authed))
    .route("/", accountRoutes(authed))
    .route("/", threadsConnectRoutes(authed))
    .route("/", threadsWebhookRoutes())
    .route("/", dataDeletionRoutes());

  return routes;
}

/** API のアプリの型。 */
export type AppType = ReturnType<typeof createApp>;
