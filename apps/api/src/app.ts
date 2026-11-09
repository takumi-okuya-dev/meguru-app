// Hono アプリの組み立て。認証の検証処理は差し込めるようにし、テストでは偽の検証を渡す
// （本番コードにテスト用の抜け道は作らない）。
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./kernel/env";
import { validateConfig } from "./kernel/config";
import { AppError } from "./kernel/errors";
import { logger, setLogAppEnv } from "./kernel/logger";
import {
  authMiddleware,
  optionalAuthMiddleware,
  clerkVerifier,
  type AuthVerifier,
  type AuthVariables,
} from "./middleware/auth";
import { accountRoutes } from "./routes/accounts";
import { billingRoutes } from "./routes/billing";
import { stripeWebhookRoutes } from "./routes/stripe-webhook";
import { accountTeamRoutes } from "./routes/account-team";
import { inviteRoutes } from "./routes/invites";
import { operatorFeatureRoutes } from "./routes/operator-features";
import { operatorTestGroupRoutes } from "./routes/operator-test-groups";
import { testInviteRoutes } from "./routes/test-invites";
import { referralRoutes } from "./routes/referrals";
import { teamsRoutes } from "./routes/teams";
import { activityRoutes } from "./routes/activity";
import { dataDeletionRoutes } from "./routes/data-deletion";
import { threadsWebhookRoutes } from "./routes/threads-webhooks";
import { meRoutes } from "./routes/me";
import { performanceRoutes } from "./routes/performance";
import { postDraftRoutes } from "./routes/post-drafts";
import { autoPostRoutes } from "./routes/auto-post";
import { postingRulesRoutes } from "./routes/posting-rules";
import { postingScheduleRoutes } from "./routes/posting-schedule";
import { threadsCheckRoutes } from "./routes/threads-check";
import { promotionRoutes } from "./routes/promotions";
import { promptRoutes } from "./routes/prompt";
import { researchRoutes } from "./routes/research";
import { strategyRoutes } from "./routes/strategy";
import { analysisRoutes } from "./routes/analysis";
import { mentionRoutes } from "./routes/mention";
import { externalMediaRoutes } from "./routes/external-media";
import { threadsConnectRoutes } from "./routes/threads-connect";
import { testerApplicationRoutes } from "./routes/tester-applications";
import { operatorAccountRoutes } from "./routes/operator-accounts";
import { operatorTesterInviteRoutes } from "./routes/operator-tester-invites";
import { operatorLimitRoutes } from "./routes/operator-limits";
import { clerkUserDeleter, type ClerkUserDeleter } from "./services/withdrawal-service";

/** アプリに差し込む依存。テストでは偽の認証を渡す。 */
export type AppDeps = {
  verifyAuth: (env: Env) => AuthVerifier;
  /** 退会でClerkのユーザーを消す（specs/013 research.md R10）。テストでは偽を渡す */
  deleteClerkUser?: (env: Env) => ClerkUserDeleter;
};

/** 本番の依存。認証は Clerk で検証する。 */
export const defaultDeps: AppDeps = {
  verifyAuth: (env) => clerkVerifier(env),
  deleteClerkUser: (env) => clerkUserDeleter(env),
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
      // X-Referral-Code：紹介リンクを開いた人の登録で、紹介した人を記録する（specs/017 research.md R4）
      allowHeaders: ["Authorization", "Content-Type", "X-Referral-Code"],
      // PATCH：チーム名・任せる範囲・改善メモ（specs/006・008。PR #9 のCodexレビュー）
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      credentials: false,
    });
    return corsMiddleware(c, next);
  });

  // どの環境の記録かが分かるようにする（specs/015 FR-026）
  app.use("*", async (c, next) => {
    setLogAppEnv(c.env.APP_ENV);
    return next();
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
        logger.error("server configuration error: fix these variables and restart the API", {
          variables: problems,
        });
      }
    }
    if (problems.length === 0) return next();
    // 誤っている項目名は、設定という制御の内部状態。手元の開発のときだけ返す。
    // 公開された環境では、資格情報を持たない相手が /api/* のどのパスからでも
    // 「どの秘密が未設定か」を数えられてしまう（セキュリティ監査 run-1）。
    // 運用者向けには、上の logger.error が env ごとに1回出している
    const inDevelopment = c.env.APP_ENV === "development";
    if (c.req.path === "/api/threads/callback") {
      try {
        const web = new URL(c.env.WEB_ORIGIN).origin;
        return c.redirect(
          `${web}/accounts/new?${new URLSearchParams({ error: "CONFIG_ERROR" })}`,
          302,
        );
      } catch {
        return c.text(
          inDevelopment
            ? `サーバーの設定に誤りがあります（${problems.join("、")}）。apps/api/.dev.vars を確認し、APIを起動し直してください。`
            : "サーバーの設定に誤りがあります。運用者にお問い合わせください。",
          500,
        );
      }
    }
    return c.json(
      {
        error: {
          code: "CONFIG_ERROR" as const,
          message: "server configuration error",
          ...(inDevelopment ? { details: problems } : {}),
        },
      },
      500,
    );
  });

  app.onError((err, c) => {
    if (err instanceof AppError) {
      // 保存の衝突の「先に保存した人」は本文の一番上に置く（specs/008 FR-007、contracts/api.md）
      const { updatedBy, ...extra } = err.extra ?? {};
      const error = {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
        ...extra,
      };
      return c.json(
        {
          error,
          ...(err.latest === undefined ? {} : { latest: err.latest }),
          ...(updatedBy === undefined ? {} : { updatedBy }),
        },
        err.status,
      );
    }
    logger.error("unhandled error", { err });
    return c.json({ error: { code: "INTERNAL_ERROR" as const, message: "internal error" } }, 500);
  });

  const authed = authMiddleware(deps.verifyAuth);
  const maybeAuthed = optionalAuthMiddleware(deps.verifyAuth) as unknown as typeof authed;

  const routes = app
    .basePath("/api")
    .get("/health", (c) => {
      // この経路は無認証で、設定が壊れている間も答え続ける（関所が免除している）。
      // 誤っている項目名は手元の開発のときだけ返す。公開された環境では、
      // 資格情報を持たない相手に「どの秘密が未設定か」を渡さない（セキュリティ監査 run-1）
      const configErrors = validateConfig(c.env);
      if (configErrors.length === 0) return c.json({ ok: true });
      return c.json(c.env.APP_ENV === "development" ? { ok: false, configErrors } : { ok: false });
    })
    .route("/", meRoutes(authed, deps.deleteClerkUser ?? ((env) => clerkUserDeleter(env))))
    .route("/", accountRoutes(authed))
    .route("/", accountTeamRoutes(authed))
    .route("/", inviteRoutes(authed, maybeAuthed))
    // テスト用のグループ（specs/016 contracts/api.md）
    .route("/", testInviteRoutes(authed, maybeAuthed))
    .route("/", referralRoutes(authed))
    .route("/", operatorTestGroupRoutes(authed))
    .route("/", operatorFeatureRoutes(authed))
    // テスター招待・上限（specs/024 contracts/api.md）
    .route("/", testerApplicationRoutes(authed))
    .route("/", operatorTesterInviteRoutes(authed))
    .route("/", operatorAccountRoutes(authed))
    .route("/", operatorLimitRoutes(authed))
    .route("/", teamsRoutes(authed))
    .route("/", activityRoutes(authed))
    .route("/", strategyRoutes(authed))
    .route("/", externalMediaRoutes(authed))
    .route("/", analysisRoutes(authed))
    .route("/", mentionRoutes(authed))
    .route("/", promotionRoutes(authed))
    .route("/", researchRoutes(authed))
    .route("/", promptRoutes(authed))
    .route("/", postDraftRoutes(authed))
    .route("/", postingRulesRoutes(authed))
    .route("/", postingScheduleRoutes(authed))
    .route("/", threadsCheckRoutes(authed))
    .route("/", autoPostRoutes(authed))
    .route("/", performanceRoutes(authed))
    .route("/", threadsConnectRoutes(authed))
    .route("/", billingRoutes(authed))
    .route("/", stripeWebhookRoutes())
    .route("/", threadsWebhookRoutes())
    .route("/", dataDeletionRoutes());

  return routes;
}

/** API のアプリの型。 */
export type AppType = ReturnType<typeof createApp>;
