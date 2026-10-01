// Hono アプリの組み立て。認証の検証処理は差し込めるようにし、テストでは偽の検証を渡す
// （本番コードにテスト用の抜け道は作らない）。
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./env";
import { AppError } from "./lib/errors";
import { logger } from "./lib/logger";
import { authMiddleware, clerkVerifier, type AuthVerifier, type AuthVariables } from "./middleware/auth";
import { accountRoutes } from "./routes/accounts";
import { meRoutes } from "./routes/me";
import { threadsConnectRoutes } from "./routes/threads-connect";

export type AppDeps = {
  verifyAuth: (env: Env) => AuthVerifier;
};

export const defaultDeps: AppDeps = {
  verifyAuth: (env) => clerkVerifier(env),
};

export type AppEnv = { Bindings: Env; Variables: AuthVariables };

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
    .get("/health", (c) => c.json({ ok: true }))
    .route("/", meRoutes(authed))
    .route("/", accountRoutes(authed))
    .route("/", threadsConnectRoutes(authed));

  return routes;
}

export type AppType = ReturnType<typeof createApp>;
