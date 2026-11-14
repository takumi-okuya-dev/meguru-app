// Hono アプリの組み立て。認証の検証処理は差し込めるようにし、テストでは偽の検証を渡す
// （本番コードにテスト用の抜け道は作らない）。
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./kernel/env";
import { validateConfig } from "./kernel/config";
import { AppError } from "./kernel/errors";
import { logger, setLogAppEnv } from "./kernel/logger";
import {
  registerAppModules,
  authMiddleware,
  optionalAuthMiddleware,
  clerkVerifier,
  type AuthVerifier,
  type AppEnv,
  billingRoutes,
  stripeWebhookRoutes,
  operatorFeatureRoutes,
  operatorAppRegistryRoutes,
  operatorTestGroupRoutes,
  testInviteRoutes,
  referralRoutes,
  meRoutes,
  operatorLimitRoutes,
  operatorAppAccessRoutes,
  clerkUserDeleter,
  type ClerkUserDeleter,
} from "./platform";
import {
  dataDeletionRoutes,
  threadsWebhookRoutes,
  needsReviewCountRoutes,
  performanceRoutes,
  postDraftRoutes,
  autoPostRoutes,
  postingRulesRoutes,
  postingScheduleRoutes,
  threadsCheckRoutes,
  promotionRoutes,
  promptRoutes,
  researchRoutes,
  strategyRoutes,
  analysisRoutes,
  mentionRoutes,
  externalMediaRoutes,
  threadsConnectRoutes,
  testerApplicationRoutes,
  operatorAccountRoutes,
  operatorTesterInviteRoutes,
  accountRoutes,
  accountTeamRoutes,
  inviteRoutes,
  teamsRoutes,
  activityRoutes,
  threadsMeRoutes,
} from "./apps/threads";
import { API_APPS } from "./app-modules";

/** アプリに差し込む依存。テストでは偽の認証を渡す。 */
export type AppDeps = {
  verifyAuth: (env: Env) => AuthVerifier;
  /** 退会でClerkのユーザーを消す（specs/013 research.md R10）。テストでは偽を渡す */
  deleteClerkUser?: (env: Env) => ClerkUserDeleter;
};

/** Hono のアプリの型引数（定義は共通の認証。027）。 */
export type { AppEnv };

/** 本番の依存。認証は Clerk で検証する。 */
export const defaultDeps: AppDeps = {
  verifyAuth: (env) => clerkVerifier(env),
  deleteClerkUser: (env) => clerkUserDeleter(env),
};


/**
 * API の Hono アプリを組み立てる。CORS・設定の確認・エラーの形・各ルートをまとめる。
 * @param deps - 差し込む依存。省略すると本番の依存（Clerk の検証）を使う
 * @returns /api 以下のルートを持つアプリ
 */
export function createApp(deps: AppDeps = defaultDeps) {
  // アプリの登録（機能・上限・利用の決まり・出来事の受け取り）をする（specs/027・specs/meguru/031。何度呼んでも1回だけ）
  registerAppModules(API_APPS);
  const app = new Hono<AppEnv>();

  app.use("/api/*", async (c, next) => {
    const corsMiddleware = cors({
      origin: c.env.WEB_ORIGIN,
      // X-Referral-Code：紹介リンクを開いた人の登録で、紹介した人を記録する（specs/017 research.md R4）
      // X-Collect-Device：集金管理の手伝う人の端末の印（specs/collect/001 research.md R7）
      allowHeaders: ["Authorization", "Content-Type", "X-Referral-Code", "X-Collect-Device"],
      // PATCH：チーム名・任せる範囲・改善メモ（specs/006・008。PR #9 のCodexレビュー）
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      // 画面から読む応答の見出し（別のオリジンからは、ここに書いたものしか読めない）。ファイルの書き出しのファイル名と、
      // 上限で切ったか（人物メモの書き出しなど。アプリの名前を付けない共通の見出しにする）
      exposeHeaders: ["Content-Disposition", "X-Export-Truncated"],
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
          `${web}/threads/accounts/new?${new URLSearchParams({ error: "CONFIG_ERROR" })}`,
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

  // Threadsの道筋（/api/threads/…。specs/meguru/029-threads-pattern1 contracts/api-routes.md 1）。古い道筋（/api/accounts/…・/api/teams/… など）は
  // PR5 で消した。Metaに登録した /api/threads/… の6本と /api/data-deletion は、ここに入れず今のまま。
  const threadsApi = new Hono<AppEnv>()
    .route("/", needsReviewCountRoutes(authed))
    .route("/", accountRoutes(authed))
    .route("/", accountTeamRoutes(authed))
    .route("/", inviteRoutes(authed, maybeAuthed))
    // テスター招待（specs/024 contracts/api.md）
    .route("/", testerApplicationRoutes(authed))
    .route("/", operatorTesterInviteRoutes(authed))
    .route("/", operatorAccountRoutes(authed))
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
    .route("/", performanceRoutes(authed));

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
    // Threadsの「自分」（specs/meguru/029 contracts/api-routes.md 2）
    .route("/", threadsMeRoutes(authed))
    // テスト用のグループ（specs/016 contracts/api.md）
    .route("/", testInviteRoutes(authed, maybeAuthed))
    .route("/", referralRoutes(authed))
    .route("/", operatorTestGroupRoutes(authed))
    .route("/", operatorFeatureRoutes(authed))
    // 登録されたアプリの機能と上限の一覧（運営の画面のため。specs/meguru/029 tasks.md T069）
    .route("/", operatorAppRegistryRoutes(authed))
    // 上限（specs/024 contracts/api.md）
    .route("/", operatorLimitRoutes(authed))
    // アプリの利用の許可（specs/meguru/030-app-access FR-005）
    .route("/", operatorAppAccessRoutes(authed))
    .route("/threads", threadsApi)
    .route("/", threadsConnectRoutes(authed))
    .route("/", billingRoutes(authed))
    .route("/", stripeWebhookRoutes())
    .route("/", threadsWebhookRoutes())
    .route("/", dataDeletionRoutes());
  // アプリの道筋は /api/<アプリの番号> の下につなぐ（アプリの一覧 app-modules.ts。specs/meguru/031）。どの道筋の関所も、アプリの側が付ける
  for (const m of API_APPS) if (m.routes) routes.route(`/${m.id}`, m.routes(authed));

  return routes;
}

/** API のアプリの型。 */
export type AppType = ReturnType<typeof createApp>;
