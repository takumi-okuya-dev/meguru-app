// POST /api/threads/connect と GET /api/threads/callback（contracts/api.md、research.md R3・R4・R8）
import { connectRequestSchema, tokenConnectRequestSchema, type ErrorCode } from "@threads-grower/shared";
import { Hono, type MiddlewareHandler } from "hono";
import type { AppEnv } from "../app";
import { createDb } from "../db/client";
import { AppError } from "../lib/errors";
import { logger } from "../lib/logger";
import { createThreadsClient, ThreadsApiError, ThreadsAuthError } from "../lib/threads-client";
import { completeConnection, requestFromState } from "../services/account-service";
import { consumeState, startConnect, type ConsumedState } from "../services/threads-oauth";
import { connectWithToken } from "../services/token-connect";
import { refreshUsernameOnlyMatch } from "../services/username-match";

/** トークンの要求の本文の上限（バイト。contracts/api.md） */
const TOKEN_BODY_MAX_BYTES = 2048;

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
        c.get("user").id,
        parsed.data,
      );
      return c.json({ authorizeUrl });
    })
    .post("/threads/token-connect", authed, async (c) => {
      // 自分のMetaアプリのトークンでの追加・接続し直し（specs/010 contracts/api.md）。本文はログに出さない
      const raw = await c.req.text();
      if (new TextEncoder().encode(raw).length > TOKEN_BODY_MAX_BYTES) {
        throw new AppError("VALIDATION_FAILED", 400, "token request too large");
      }
      let json: unknown = null;
      try {
        json = JSON.parse(raw);
      } catch {
        json = null;
      }
      const parsed = tokenConnectRequestSchema.safeParse(json);
      if (!parsed.success) throw new AppError("VALIDATION_FAILED", 400, "invalid token connect request");
      const result = await connectWithToken(c.env, createThreadsClient(c.env), c.get("user"), parsed.data);
      return c.json(result);
    })
    .get("/threads/callback", async (c) => {
      // ユーザーが認可した直後にリダイレクトされるので、受け取った時刻を認可の時刻とみなす（research.md R7）
      const authorizedAt = new Date();
      const web = c.env.WEB_ORIGIN.replace(/\/$/, "");
      const redirect = (path: string, params: Record<string, string>) =>
        c.redirect(`${web}${path}?${new URLSearchParams(params)}`, 302);

      // 想定外の失敗でも、JSON の画面で止めずに Web へ戻してエラーの案内を出す
      let failTarget = "/accounts/new";
      try {
        const stateParam = c.req.query("state");
        const state = stateParam ? await consumeState(createDb(c.env.DATABASE_URL), stateParam) : null;
        if (!state) return redirect("/accounts/new", { error: "OAUTH_STATE_INVALID" });

        if (state.mode === "reconnect") failTarget = `/accounts/${state.targetAccountId}/settings`;
        const fail = (code: ErrorCode) =>
          state.mode === "reconnect"
            ? redirect(`/accounts/${state.targetAccountId}/settings`, { error: code })
            : redirect("/accounts/new", { error: code });

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
            request: requestFromState(state as ConsumedState),
            threadsUserId: profile.id,
            profile,
            accessToken: longLived.accessToken,
            expiresAt: longLived.expiresAt,
            authorizedAt,
          });
          if (result.kind === "reconnect") {
            return redirect(`/accounts/${result.accountId}/settings`, { connected: "reconnect" });
          }
          return redirect(`/accounts/${result.accountId}`, { connected: result.kind });
        } catch (err) {
          if (err instanceof AppError) return fail(err.code);
          throw err;
        }
      } catch (err) {
        logger.error("threads callback failed unexpectedly", { err });
        return redirect(failTarget, { error: "INTERNAL_ERROR" });
      }
    });
}
