// Threads API のクライアント（research.md R3・R5・R6）。
// - ベースURLは環境変数から取る（テストでは偽のThreadsサーバーに向ける）
// - トークンはできるだけ Authorization ヘッダーで渡す。クエリで渡すしかないエンドポイントでは、URLをログに出さない
// - 認証エラー（OAuthエラー190、HTTP 401）は ThreadsAuthError として区別する
import type { Env } from "../env";

/** 接続時にまとめて要求する Threads の権限（research.md R3）。 */
export const THREADS_SCOPES = ["threads_basic", "threads_content_publish", "threads_manage_insights"] as const;

/** Threads の認証エラー（OAuthエラー190、HTTP 401）。トークンが無効になったことを表す。 */
export class ThreadsAuthError extends Error {
  override name = "ThreadsAuthError";
}

/** 認証エラー以外の Threads API の失敗。 */
export class ThreadsApiError extends Error {
  override name = "ThreadsApiError";
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Threads のプロフィール。 */
export type ThreadsProfile = {
  id: string;
  username: string;
  name: string | null;
  profilePictureUrl: string | null;
};

/** 長期トークン（有効期間60日）と有効期限。 */
export type LongLivedToken = { accessToken: string; expiresAt: Date };

/** Threads API の呼び出し（research.md R3・R6）。 */
export type ThreadsClient = {
  buildAuthorizeUrl(state: string): string;
  exchangeCode(code: string): Promise<{ accessToken: string; userId: string }>;
  exchangeLongLived(shortLivedToken: string): Promise<LongLivedToken>;
  refresh(longLivedToken: string): Promise<LongLivedToken>;
  getProfile(accessToken: string): Promise<ThreadsProfile>;
};

type GraphError = { error?: { message?: string; code?: number; type?: string } };

async function parseOrThrow<T>(res: Response, what: string): Promise<T> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  if (res.ok) return body as T;
  const err = (body as GraphError | undefined)?.error;
  if (res.status === 401 || err?.code === 190 || err?.type === "OAuthException") {
    throw new ThreadsAuthError(`${what}: authentication failed`);
  }
  // メッセージにトークン等が含まれる可能性があるため、本文はそのまま使わない
  throw new ThreadsApiError(`${what}: request failed with status ${res.status}`, res.status);
}

/**
 * Threads API のクライアントを作る。ベースURLは環境変数から取る（テストでは偽のサーバーに向ける）。
 * @param env - Workers のバインディング
 * @param fetchImpl - 使う fetch（テスト用に差し替えられる）
 * @returns Threads API のクライアント
 */
export function createThreadsClient(env: Env, fetchImpl: typeof fetch = fetch): ThreadsClient {
  const graph = env.THREADS_GRAPH_BASE_URL.replace(/\/$/, "");
  const auth = env.THREADS_AUTH_BASE_URL.replace(/\/$/, "");

  return {
    buildAuthorizeUrl(state) {
      const url = new URL(`${auth}/oauth/authorize`);
      url.searchParams.set("client_id", env.THREADS_APP_ID);
      url.searchParams.set("redirect_uri", env.THREADS_REDIRECT_URI);
      url.searchParams.set("scope", THREADS_SCOPES.join(","));
      url.searchParams.set("response_type", "code");
      url.searchParams.set("state", state);
      return url.toString();
    },

    async exchangeCode(code) {
      const res = await fetchImpl(`${graph}/oauth/access_token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: env.THREADS_APP_ID,
          client_secret: env.THREADS_APP_SECRET,
          code,
          grant_type: "authorization_code",
          redirect_uri: env.THREADS_REDIRECT_URI,
        }),
      });
      const body = await parseOrThrow<{ access_token: string; user_id: string | number }>(res, "exchangeCode");
      return { accessToken: body.access_token, userId: String(body.user_id) };
    },

    async exchangeLongLived(shortLivedToken) {
      const url = new URL(`${graph}/access_token`);
      url.searchParams.set("grant_type", "th_exchange_token");
      url.searchParams.set("client_secret", env.THREADS_APP_SECRET);
      url.searchParams.set("access_token", shortLivedToken);
      const res = await fetchImpl(url);
      const body = await parseOrThrow<{ access_token: string; expires_in: number }>(res, "exchangeLongLived");
      return { accessToken: body.access_token, expiresAt: new Date(Date.now() + body.expires_in * 1000) };
    },

    async refresh(longLivedToken) {
      const url = new URL(`${graph}/refresh_access_token`);
      url.searchParams.set("grant_type", "th_refresh_token");
      url.searchParams.set("access_token", longLivedToken);
      const res = await fetchImpl(url);
      const body = await parseOrThrow<{ access_token: string; expires_in: number }>(res, "refresh");
      return { accessToken: body.access_token, expiresAt: new Date(Date.now() + body.expires_in * 1000) };
    },

    async getProfile(accessToken) {
      const url = new URL(`${graph}/v1.0/me`);
      url.searchParams.set("fields", "id,username,name,threads_profile_picture_url");
      const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      const body = await parseOrThrow<{
        id: string | number;
        username?: string;
        name?: string;
        threads_profile_picture_url?: string;
      }>(res, "getProfile");
      if (!body.username) throw new ThreadsApiError("getProfile: username missing", 200);
      return {
        id: String(body.id),
        username: body.username,
        name: body.name ?? null,
        profilePictureUrl: body.threads_profile_picture_url ?? null,
      };
    },
  };
}
