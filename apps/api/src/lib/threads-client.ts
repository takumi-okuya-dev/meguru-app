// Threads API のクライアント（research.md R3・R5・R6）。
// - ベースURLは環境変数から取る（テストでは偽のThreadsサーバーに向ける）
// - トークンはできるだけ Authorization ヘッダーで渡す。クエリで渡すしかないエンドポイントでは、URLをログに出さない
// - 認証エラー（OAuthエラー190、HTTP 401）は ThreadsAuthError として区別する
// - 投稿（specs/005-auto-post research.md R7）：上限は ThreadsRateLimitError、通信の失敗・5xx は ThreadsTransientError、
//   それ以外は ThreadsApiError（確かな失敗）。Graph API は上限・権限のエラーも type を OAuthException で返すので、code で見分ける
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

/**
 * Threads の上限のエラー（Graph APIのコード4・17・32・613）。
 * ThreadsApiError の一種なので、001 の「認証エラー以外の失敗」の扱いはそのまま働く。分けるときは先にこちらを見る。
 */
export class ThreadsRateLimitError extends ThreadsApiError {
  override name = "ThreadsRateLimitError";
}

/**
 * Threads の一時的な失敗（通信の失敗・タイムアウト・HTTP 5xx・コード1・2）。やり直せば成功しうる。
 * ThreadsApiError の一種（通信の失敗は status 0）。分けるときは先にこちらを見る。
 */
export class ThreadsTransientError extends ThreadsApiError {
  override name = "ThreadsTransientError";
}

/**
 * 投稿が見つからない（HTTP 404、またはGraph APIのコード100・サブコード33）。消された投稿など（specs/006 research.md R1）。
 * ThreadsApiError の一種。
 */
export class ThreadsNotFoundError extends ThreadsApiError {
  override name = "ThreadsNotFoundError";
}

/**
 * 権限がない（Graph APIのコード10・200番台）。反応数を読む許可がない場合など（specs/006 research.md R1・R11）。
 * ThreadsApiError の一種。
 */
export class ThreadsPermissionError extends ThreadsApiError {
  override name = "ThreadsPermissionError";
}

/** 投稿の反応数（specs/006 contracts/api.md）。返らなかった指標は null。 */
export type ThreadsMediaInsights = {
  views: number | null;
  likes: number | null;
  replies: number | null;
  reposts: number | null;
  quotes: number | null;
  shares: number | null;
};

/** コンテナーの状態（GET /{container-id}?fields=status）。 */
export type ContainerStatus = "IN_PROGRESS" | "FINISHED" | "PUBLISHED" | "ERROR" | "EXPIRED";

/** Threads の投稿（一覧・取得）。 */
export type ThreadsMedia = { id: string; text: string | null; permalink: string | null; timestamp: string };

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
  /** テキストのコンテナーを作る（2段階の1つ目）。 */
  createTextContainer(accessToken: string, userId: string, text: string): Promise<{ containerId: string }>;
  /** コンテナーを公開する（2段階の2つ目）。1つのコンテナーは1回しか公開できない。 */
  publishContainer(accessToken: string, userId: string, containerId: string): Promise<{ mediaId: string }>;
  /** コンテナーの状態を読む。公開した投稿のIDは返らない。 */
  getContainerStatus(accessToken: string, containerId: string): Promise<{ status: ContainerStatus }>;
  /** 投稿のURLと日時を読む。 */
  getMedia(accessToken: string, mediaId: string): Promise<{ id: string; permalink: string | null; timestamp: string }>;
  /** 投稿数の使用量を読む。投稿の権限（threads_content_publish）がないと呼べない（research.md R15）。 */
  getPublishingLimit(accessToken: string, userId: string): Promise<{ quotaUsage: number; quotaTotal: number }>;
  /** since 以降の自分の投稿を、新しい順に読む（最大25件）。 */
  listRecentThreads(accessToken: string, userId: string, since: Date): Promise<ThreadsMedia[]>;
  /** 投稿の6つの反応数を1回で読む（specs/006 research.md R1）。 */
  getMediaInsights(accessToken: string, mediaId: string): Promise<ThreadsMediaInsights>;
  /** Accountの今のフォロワー数を読む（specs/006 FR-002c）。 */
  getFollowersCount(accessToken: string, userId: string): Promise<number>;
};

const TIMEOUT_MS = 10_000;
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613]);
const TRANSIENT_CODES = new Set([1, 2]);
const AUTH_CODES = new Set([102, 190]);

type GraphError = { error?: { message?: string; code?: number; type?: string; error_subcode?: number } };

async function parseOrThrow<T>(res: Response, what: string): Promise<T> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  if (res.ok) return body as T;
  const err = (body as GraphError | undefined)?.error;
  const code = err?.code;
  // 上限・権限のエラーも type は OAuthException なので、code を先に見る（research.md R7）
  if (code !== undefined && RATE_LIMIT_CODES.has(code)) {
    throw new ThreadsRateLimitError(`${what}: rate limited (code ${code})`, res.status);
  }
  // 見つからない・権限のエラーも type が OAuthException のことがあるので、認証の判定より先に見る（specs/006 research.md R1）
  if (res.status === 404 || (code === 100 && err?.error_subcode === 33)) {
    throw new ThreadsNotFoundError(`${what}: not found`, res.status);
  }
  if (code !== undefined && (code === 10 || (code >= 200 && code < 300))) {
    throw new ThreadsPermissionError(`${what}: permission denied (code ${code})`, res.status);
  }
  if (res.status === 401 || (code !== undefined && AUTH_CODES.has(code)) || (code === undefined && err?.type === "OAuthException")) {
    throw new ThreadsAuthError(`${what}: authentication failed`);
  }
  if (res.status >= 500 || (code !== undefined && TRANSIENT_CODES.has(code))) {
    throw new ThreadsTransientError(`${what}: temporary failure with status ${res.status}`, res.status);
  }
  // メッセージにトークン等が含まれる可能性があるため、本文はそのまま使わない
  throw new ThreadsApiError(`${what}: request failed with status ${res.status}${code !== undefined ? ` (code ${code})` : ""}`, res.status);
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

  /**
   * 投稿の呼び出しの fetch。10秒でタイムアウトにし、通信の失敗は ThreadsTransientError にする。
   * @param what - 呼び出しの名前（エラーのメッセージに使う）
   * @param url - 呼び出すURL
   * @param init - fetch の設定と、Authorization ヘッダーに入れるトークン
   * @returns 応答の本文
   */
  async function call<T>(what: string, url: URL | string, init: RequestInit & { token: string }): Promise<T> {
    const { token, ...rest } = init;
    let res: Response;
    try {
      res = await fetchImpl(url, {
        ...rest,
        headers: { ...(rest.headers ?? {}), Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      // 原因（タイムアウト・通信の失敗）のメッセージにURLなどが入りうるので、使わない
      throw new ThreadsTransientError(`${what}: network error`, 0);
    }
    return parseOrThrow<T>(res, what);
  }
  const form = (values: Record<string, string>) => ({
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(values),
  });

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

    async createTextContainer(accessToken, userId, text) {
      const body = await call<{ id: string | number }>("createTextContainer", `${graph}/v1.0/${userId}/threads`, {
        method: "POST",
        token: accessToken,
        ...form({ media_type: "TEXT", text }),
      });
      return { containerId: String(body.id) };
    },

    async publishContainer(accessToken, userId, containerId) {
      const body = await call<{ id: string | number }>("publishContainer", `${graph}/v1.0/${userId}/threads_publish`, {
        method: "POST",
        token: accessToken,
        ...form({ creation_id: containerId }),
      });
      return { mediaId: String(body.id) };
    },

    async getContainerStatus(accessToken, containerId) {
      const url = new URL(`${graph}/v1.0/${containerId}`);
      url.searchParams.set("fields", "status");
      const body = await call<{ status: ContainerStatus }>("getContainerStatus", url, { token: accessToken });
      return { status: body.status };
    },

    async getMedia(accessToken, mediaId) {
      const url = new URL(`${graph}/v1.0/${mediaId}`);
      url.searchParams.set("fields", "id,permalink,timestamp");
      const body = await call<{ id: string | number; permalink?: string; timestamp: string }>("getMedia", url, {
        token: accessToken,
      });
      return { id: String(body.id), permalink: body.permalink ?? null, timestamp: body.timestamp };
    },

    async getPublishingLimit(accessToken, userId) {
      const url = new URL(`${graph}/v1.0/${userId}/threads_publishing_limit`);
      url.searchParams.set("fields", "quota_usage,config");
      const body = await call<{ data?: { quota_usage?: number; config?: { quota_total?: number } }[] }>(
        "getPublishingLimit",
        url,
        { token: accessToken },
      );
      const row = body.data?.[0];
      return { quotaUsage: row?.quota_usage ?? 0, quotaTotal: row?.config?.quota_total ?? 250 };
    },

    async listRecentThreads(accessToken, userId, since) {
      const url = new URL(`${graph}/v1.0/${userId}/threads`);
      url.searchParams.set("fields", "id,text,permalink,timestamp");
      url.searchParams.set("since", String(Math.floor(since.getTime() / 1000)));
      url.searchParams.set("limit", "25");
      const body = await call<{ data?: { id: string | number; text?: string; permalink?: string; timestamp: string }[] }>(
        "listRecentThreads",
        url,
        { token: accessToken },
      );
      return (body.data ?? []).map((p) => ({
        id: String(p.id),
        text: p.text ?? null,
        permalink: p.permalink ?? null,
        timestamp: p.timestamp,
      }));
    },

    async getMediaInsights(accessToken, mediaId) {
      const url = new URL(`${graph}/v1.0/${mediaId}/insights`);
      url.searchParams.set("metric", INSIGHT_METRICS.join(","));
      const body = await call<{ data?: InsightRow[] }>("getMediaInsights", url, { token: accessToken });
      const found = new Map((body.data ?? []).map((row) => [row.name, insightValue(row)]));
      return Object.fromEntries(INSIGHT_METRICS.map((m) => [m, found.get(m) ?? null])) as ThreadsMediaInsights;
    },

    async getFollowersCount(accessToken, userId) {
      const url = new URL(`${graph}/v1.0/${userId}/threads_insights`);
      url.searchParams.set("metric", "followers_count");
      const body = await call<{ data?: InsightRow[] }>("getFollowersCount", url, { token: accessToken });
      const row = (body.data ?? []).find((r) => r.name === "followers_count");
      const value = row ? insightValue(row) : null;
      if (value === null) throw new ThreadsApiError("getFollowersCount: no value", 200);
      return value;
    },
  };
}

const INSIGHT_METRICS = ["views", "likes", "replies", "reposts", "quotes", "shares"] as const;

type InsightRow = { name: string; values?: { value?: unknown }[]; total_value?: { value?: unknown } };

/**
 * 反応数の1行から値を取る。応答の形は values[0].value と total_value.value の2通りがある（research.md R1）。
 * @param row - insights の data の1行
 * @returns 0以上の整数。取れなければ null
 */
function insightValue(row: InsightRow): number | null {
  const raw = row.values?.[0]?.value ?? row.total_value?.value;
  const n = typeof raw === "string" ? Number(raw) : raw;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}
