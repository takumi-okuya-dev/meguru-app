// POST /api/threads/connect と GET /api/threads/callback（contracts/api.md、research.md R3・R4・R8）
import { connectRequestSchema, tokenConnectRequestSchema, type ErrorCode } from "@threads-grower/shared";
import { Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AppEnv } from "../app";
import { createDb } from "../db/client";
import { AppError } from "../lib/errors";
import { logger } from "../lib/logger";
import { createThreadsClient, ThreadsApiError, ThreadsAuthError } from "../lib/threads-client";
import { completeConnection, requestFromState } from "../services/account-service";
import { consumeState, startConnect } from "../services/threads-oauth";
import { connectWithToken } from "../services/token-connect";
import { refreshUsernameOnlyMatch } from "../services/username-match";

/**
 * トークンの要求の本文の上限（バイト）。トークンは2,048文字までだが、前後の空白・引用符も含めて受け取り（スキーマは4,096文字まで）、
 * mode・accountId・キー名などのJSONの分も要るので、余裕をもって8KBにする（PR #12 のCodexレビュー）
 */
const TOKEN_BODY_MAX_BYTES = 8192;

/**
 * JSONを読む。読めなければ null（エラーのメッセージに本文を含めない）。
 * @param raw - 本文
 * @returns 読んだ値
 */
function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * POST /api/threads/connect と GET /api/threads/callback のルート（research.md R3・R4・R8）。
 * @param authed - 認証のミドルウェア（connect だけに使う。callback は state で本人を確かめる）
 * @returns Hono のルート
 */
export function threadsConnectRoutes(authed: MiddlewareHandler<AppEnv>) {
  return new Hono<AppEnv>()
    .post("/threads/connect", authed, async (c) => {
      const parsed = connectRequestSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new AppError("VALIDATION_FAILED", 400, "invalid connect request");
      const authorizeUrl = await startConnect(
        createDb(c.env.DATABASE_URL),
        createThreadsClient(c.env),
        c.get("user"),
        parsed.data,
      );
      return c.json({ authorizeUrl });
    })
    .post(
      "/threads/token-connect",
      authed,
      // 本文を読み込む途中で上限を当て、超えたらそこで止める（読み終えてから測らない。PR #12 のCodexレビュー）
      bodyLimit({
        maxSize: TOKEN_BODY_MAX_BYTES,
        onError: () => {
          throw new AppError("VALIDATION_FAILED", 400, "token request too large");
        },
      }),
      async (c) => {
        // 自分のMetaアプリのトークンでの追加・接続し直し（specs/010 contracts/api.md）。本文はログに出さない
        const raw = await c.req.text();
        const parsed = tokenConnectRequestSchema.safeParse(parseJson(raw));
        if (!parsed.success) throw new AppError("VALIDATION_FAILED", 400, "invalid token connect request");
        const result = await connectWithToken(c.env, createThreadsClient(c.env), c.get("user"), parsed.data);
        return c.json(result);
      },
    )
    .get("/threads/callback", async (c) => {
      // ユーザーが認可した直後にリダイレクトされるので、受け取った時刻を認可の時刻とみなす（research.md R7）
      const authorizedAt = new Date();
      const web = c.env.WEB_ORIGIN.replace(/\/$/, "");
      const redirect = (path: string, params: Record<string, string>) =>
        c.redirect(`${web}${path}?${new URLSearchParams(params)}`, 302);

      // 想定外の失敗でも、JSON の画面で止めずに Web へ戻してエラーの案内を出す。
      // 対象のアカウントが分からない・なくなったときは、振り分け（/）へ戻す（specs/012 contracts/api.md）
      let failTarget = "/";
      try {
        const stateParam = c.req.query("state");
        const state = stateParam ? await consumeState(createDb(c.env.DATABASE_URL), stateParam) : null;
        // 012 より前の「つないで作る」（mode = new）の state は、使えないものとして扱う。
        // 許可の画面にいる間に対象が消されていたら、振り分けへ戻して「見つからない」と出す
        let request;
        try {
          request = state ? requestFromState(state) : null;
        } catch (err) {
          if (err instanceof AppError) return redirect("/", { error: err.code });
          throw err;
        }
        if (!request) return redirect("/", { error: "OAUTH_STATE_INVALID" });

        const settings = `/accounts/${request.targetAccountId}/settings`;
        failTarget = settings;
        const fail = (code: ErrorCode) =>
          // 許可の画面にいる間に消された・オーナーでなくなったアカウントの画面へは戻さない
          code === "ACCOUNT_NOT_FOUND" || code === "ROLE_FORBIDDEN" ? redirect("/", { error: code }) : redirect(settings, { error: code });

        if (c.req.query("error")) return fail("THREADS_AUTH_CANCELLED");
        const code = c.req.query("code");
        if (!code) return fail("THREADS_AUTH_FAILED");

        const threads = createThreadsClient(c.env);
        let longLived: { accessToken: string; expiresAt: Date };
        try {
          const short = await threads.exchangeCode(code);
          longLived = await threads.exchangeLongLived(short.accessToken);
        } catch (err) {
          logger.warn("threads token exchange failed", { err });
          return fail("THREADS_AUTH_FAILED");
        }

        let profile;
        try {
          profile = await threads.getProfile(longLived.accessToken);
        } catch (err) {
          if (!(err instanceof ThreadsAuthError || err instanceof ThreadsApiError)) throw err;
          logger.warn("threads profile fetch failed", { err });
          return fail("THREADS_PROFILE_FETCH_FAILED");
        }

        // ユーザー名だけが一致するAccountの、今の名前を確かめる（specs/010 FR-023）
        await refreshUsernameOnlyMatch(c.env, threads, profile);
        try {
          const result = await completeConnection(c.env, {
            request,
            threadsUserId: profile.id,
            profile,
            accessToken: longLived.accessToken,
            expiresAt: longLived.expiresAt,
            authorizedAt,
          });
          // はじめてつないだときも、接続し直したときも、設定の画面へ戻す（specs/012 US2-2）
          return redirect(`/accounts/${result.accountId}/settings`, { connected: result.kind });
        } catch (err) {
          if (!(err instanceof AppError)) throw err;
          // 自分の別のアカウントと重なったときは、そのアカウントを添える（画面がその名前とリンクを出す。specs/012 US3-1）
          if (err.code === "ACCOUNT_ALREADY_REGISTERED" && err.details?.[0])
            return redirect(settings, { error: err.code, account: err.details[0] });
          return fail(err.code);
        }
      } catch (err) {
        logger.error("threads callback failed unexpectedly", { err });
        return redirect(failTarget, { error: "INTERNAL_ERROR" });
      }
    });
}
