// POST /api/threads/connect と GET /api/threads/callback（contracts/api.md、research.md R3・R4・R8）
import {
  completeConnectRequestSchema,
  connectRequestSchema,
  tokenConnectRequestSchema,
  type ErrorCode,
} from "@meguru/shared";
import { Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AppEnv } from "../../../platform";
import { createDb } from "../../../kernel/db/client";
import { connectMethodsOf } from "../../../kernel/config";
import { AppError } from "../../../kernel/errors";
import { logger } from "../../../kernel/logger";
import { createThreadsClient, ThreadsApiError, ThreadsAuthError } from "../../../adapters/threads-api";
import { completeConnection, requestFromState } from "./connection-service";
import { consumeState, startConnect } from "./threads-oauth";
import { connectWithToken } from "./token-connect";
import { refreshUsernameOnlyMatch } from "./username-match";

/**
 * トークンの要求の本文の上限（バイト）。トークンは2,048文字までだが、前後の空白・引用符も含めて受け取り（スキーマは4,096文字まで）、
 * mode・accountId・キー名などのJSONの分も要るので、余裕をもって8KBにする（PR #12 のCodexレビュー）
 */
const TOKEN_BODY_MAX_BYTES = 8192;

/** Threads から戻ってきた人を受け止める Web の画面（ここで完了のPOSTを出す）。 */
const COMPLETE_PATH = "/threads/complete";

/**
 * アプリの中の相対パスに、クエリを付ける。
 * @param path - `/` で始まるパス
 * @param params - クエリ
 * @returns 相対パス（Web はこれにそのまま遷移する）
 */
const withParams = (path: string, params: Record<string, string>) =>
  `${path}?${new URLSearchParams(params)}`;

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
      // 出していない方法は、サーバー側でも断る（画面から消すだけにしない）。
      // 決済OFFのときの Stripe の知らせと同じ作法で 404 にする
      if (!connectMethodsOf(c.env).includes("app")) return c.notFound();
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
        if (!connectMethodsOf(c.env).includes("token")) return c.notFound();
        const parsed = tokenConnectRequestSchema.safeParse(parseJson(raw));
        if (!parsed.success) throw new AppError("VALIDATION_FAILED", 400, "invalid token connect request");
        const result = await connectWithToken(c.env, createThreadsClient(c.env), c.get("user"), parsed.data);
        return c.json(result);
      },
    )
    // Meta からのリダイレクトの受け口。**接続はここでは済ませない**。
    //
    // 以前はここで state を消費し、その行の user_id をそのまま主体に持ち上げて
    // 接続まで書き込んでいた。state は単回・10分・SHA-256 保存だが、**それを作った人が
    // 第三者に踏ませる**向きは防げない。踏んだ人の認可で発行されたトークンが、作った人の
    // アカウントに保存されてしまう（セキュリティ監査 run-1）。
    //
    // いまはここでは何もせず、state と code を Web へ渡すだけにして、完了は
    // ログイン済みの POST /threads/complete で行う。そこで state の user_id と
    // Clerk で確かめた呼び出し元の一致を要求する。
    // この経路はDBにも Threads にも触らないので、無認証でできる仕事も無くなる。
    .get("/threads/callback", (c) => {
      const web = c.env.WEB_ORIGIN.replace(/\/$/, "");
      const to = (params: Record<string, string>) =>
        c.redirect(`${web}${COMPLETE_PATH}?${new URLSearchParams(params)}`, 302);

      const state = c.req.query("state");
      // 利用者が許可しなかったとき（Meta が error を付けて戻す）。
      // state も渡す（どのアカウントの接続だったかはその行にしか無く、元の画面へ戻すのに要る）
      if (c.req.query("error"))
        return to(state ? { state, error: "THREADS_AUTH_CANCELLED" } : { error: "THREADS_AUTH_CANCELLED" });
      const code = c.req.query("code");
      if (!state || !code) return to({ error: "THREADS_AUTH_FAILED" });
      return to({ state, code });
    })
    // 接続の完了。**ログイン済みでしか呼べない**（これがこの修正の要）。
    .post("/threads/complete", authed, async (c) => {
      // 認可そのものは利用者が Meta の画面で済ませている。ここに来た時刻を認可の時刻とみなす
      // （失効の確認は issued_at >= authorizedAt で、進行中の流れだけを見るため。research.md R7）
      const authorizedAt = new Date();
      const user = c.get("user");
      const parsed = completeConnectRequestSchema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) throw new AppError("VALIDATION_FAILED", 400, "invalid complete request");

      const state = await consumeState(createDb(c.env.DATABASE_URL), parsed.data.state);
      // state が無い場合と「自分の state でない」場合を、応答では区別しない
      // （区別すると、state の存在を確かめる手がかりになる）。ログには分けて残す
      // 文面まで同じにする（違えると state の存在を確かめる手がかりになる）
      const invalid = () => new AppError("OAUTH_STATE_INVALID", 400, "invalid state");
      if (!state) throw invalid();
      if (state.userId !== user.id) {
        logger.warn("threads complete: state belongs to another user", { stateUserId: state.userId, caller: user.id });
        throw invalid();
      }

      // 012 より前の「つないで作る」（mode = new）の state は、使えないものとして扱う。
      // 許可の画面にいる間に対象が消されていたら、振り分けへ戻して「見つからない」と出す
      let request;
      try {
        request = requestFromState(state);
      } catch (err) {
        if (err instanceof AppError) return c.json({ redirectTo: withParams("/", { error: err.code }) });
        throw err;
      }
      if (!request) return c.json({ redirectTo: withParams("/", { error: "OAUTH_STATE_INVALID" }) });

      const settings = `/accounts/${request.targetAccountId}/settings`;
      // 許可の画面にいる間に消された・オーナーでなくなったアカウントの画面へは戻さない
      const fail = (code: ErrorCode) =>
        c.json({
          redirectTo:
            code === "ACCOUNT_NOT_FOUND" || code === "ROLE_FORBIDDEN"
              ? withParams("/", { error: code })
              : withParams(settings, { error: code }),
        });

      // 利用者が許可しなかったとき。state は使い切ったうえで、元の画面へ戻す
      if (parsed.data.error) return fail(parsed.data.error);
      if (!parsed.data.code) throw new AppError("VALIDATION_FAILED", 400, "code is required");

      const threads = createThreadsClient(c.env);
      let longLived: { accessToken: string; expiresAt: Date };
      try {
        const short = await threads.exchangeCode(parsed.data.code);
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
        return c.json({
          redirectTo: withParams(`/accounts/${result.accountId}/settings`, { connected: result.kind }),
        });
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
        // 自分の別のアカウントと重なったときは、そのアカウントを添える（画面がその名前とリンクを出す。specs/012 US3-1）
        if (err.code === "ACCOUNT_ALREADY_REGISTERED" && err.details?.[0])
          return c.json({ redirectTo: withParams(settings, { error: err.code, account: err.details[0] }) });
        return fail(err.code);
      }
    })
}
