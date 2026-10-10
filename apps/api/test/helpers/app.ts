// 結合テストの共通部品：偽の認証で動くアプリ、DBの初期化、偽のThreadsサーバーの操作、認可〜callbackの一連の流れ
import { env } from "cloudflare:test";
import { neon } from "@neondatabase/serverless";
import { createApp } from "../../src/app";
import { createDb } from "../../src/db/client";
import type { Env } from "../../src/env";
import type { AuthVerifier } from "../../src/middleware/auth";

export const testEnv = env as unknown as Env;

/** トークンの形は "test:<clerkUserId>"。メールアドレスは clerkUserId から作る */
export const fakeVerifier: AuthVerifier = {
  async verify(token) {
    if (!token.startsWith("test:")) return null;
    const clerkUserId = token.slice("test:".length);
    return { clerkUserId, email: `${clerkUserId}@example.com`, displayName: clerkUserId };
  },
  async fetchProfile(clerkUserId) {
    return { email: `${clerkUserId}@example.com`, displayName: clerkUserId };
  },
};

export function makeApp() {
  return createApp({ verifyAuth: () => fakeVerifier });
}

export type TestApp = ReturnType<typeof makeApp>;

export function call(
  app: TestApp,
  method: string,
  path: string,
  opts: { user?: string; body?: unknown; headers?: Record<string, string> } = {},
) {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.user) headers.Authorization = `Bearer test:${opts.user}`;
  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    if (typeof opts.body === "string" || opts.body instanceof URLSearchParams) {
      body = opts.body;
    } else {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.body);
    }
  }
  return app.request(path, { method, headers, body }, testEnv);
}

export async function resetDb() {
  const sql = neon(testEnv.DATABASE_URL);
  createDb(testEnv.DATABASE_URL); // ローカルプロキシの設定を有効にする
  await sql`TRUNCATE users, accounts, memberships, threads_connections, oauth_states, threads_deletion_requests, threads_revocations, strategy_designs, promotions, reference_posts, research_keywords, draft_batches, post_drafts, ng_words, posting_schedules, publish_attempts, teams, team_editors, account_partners, account_partner_invites, activity_logs CASCADE`;
}

export function db() {
  return createDb(testEnv.DATABASE_URL);
}

// ---- 偽のThreadsサーバーの操作 ----
async function control(path: string, body?: unknown) {
  const res = await fetch(`${testEnv.THREADS_GRAPH_BASE_URL}/__control/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`fake control ${path} failed: ${res.status}`);
  return res.json();
}

export const fake = {
  reset: () => control("reset", {}),
  addUser: (id: string, username: string, name = `Name ${username}`) =>
    control("users", { id, username, name, picture: `https://cdn.example.com/${id}.jpg` }),
  invalidate: (userId: string) => control("invalidate", { userId }),
  fail: (endpoint: "exchangeCode" | "exchangeLongLived" | "refresh" | "getProfile", times: number, kind: "auth" | "server") =>
    control("fail", { endpoint, times, kind }),
  delay: (endpoint: "exchangeCode" | "exchangeLongLived" | "refresh" | "getProfile", ms: number) =>
    control("delay", { endpoint, ms }),
  issuedTokens: async () => ((await control("issued-tokens")) as { tokens: string[] }).tokens,
  // ---- 投稿（specs/005-auto-post）----
  publishFail: (
    endpoint: "createContainer" | "publish" | "containerStatus" | "getMedia" | "publishingLimit" | "listThreads",
    kind: "transient" | "auth" | "rate_limit" | "invalid",
    times: number,
  ) => control("publish-failures", { endpoint, kind, times }),
  dropPublishResponse: (times: number) => control("drop-publish-response", { times }),
  setContainerStatus: (containerId: string, status: "IN_PROGRESS" | "FINISHED" | "PUBLISHED" | "ERROR" | "EXPIRED") =>
    control("container-status", { containerId, status }),
  setPublishPermission: (userId: string, granted: boolean) => control("publish-permission", { userId, granted }),
  /** 投稿の権限の確認（threads_publishing_limit）を ms だけ遅らせる */
  delayPublishingLimit: (ms: number) => control("publishing-limit-delay", { ms }),
  /** アプリを通さない投稿（手動の投稿など）を、任意の時刻で入れる */
  addPost: async (userId: string, text: string, at: Date) =>
    ((await control("add-post", { userId, text, timestamp: at.toISOString() })) as { id: string }).id,
  posts: async () =>
    ((await control("posts")) as { posts: { id: string; userId: string; text: string; containerId: string; permalink: string }[] })
      .posts,
  // ---- 反応数（specs/006-performance-feedback）----
  /** 投稿の反応数を決める。omit の指標は応答に入れない */
  setInsights: (
    mediaId: string,
    metrics: Partial<Record<"views" | "likes" | "replies" | "reposts" | "quotes" | "shares", number>>,
    omit?: ("views" | "likes" | "replies" | "reposts" | "quotes" | "shares")[],
  ) => control("insights", { mediaId, metrics, omit }),
  /** 反応数の応答の形（values か total_value） */
  setInsightsShape: (shape: "values" | "total_value") => control("insights-shape", { shape }),
  /** 反応数・フォロワー数の呼び出しを失敗させる。key は mediaId、"user:{userId}"、"*"。times が -1 なら解除まで */
  insightsFail: (key: string, kind: "not_found" | "permission" | "rate_limit" | "transient" | "auth", times: number) =>
    control("insights-failure", { key, kind, times }),
  setFollowers: (userId: string, count: number) => control("followers", { userId, count }),
  callCounts: async () => (await control("call-counts")) as { insights: number; followers: number },
  containers: async () =>
    ((await control("containers")) as { containers: { id: string; userId: string; text: string; status: string }[] })
      .containers,
};

/** connect で得た authorizeUrl から、偽の認可画面で許可/拒否し、APIのcallbackを呼んだ結果（302）を返す */
export async function authorizeAndCallback(
  app: TestApp,
  authorizeUrl: string,
  opts: { fakeUser?: string; action?: "allow" | "deny" } = {},
) {
  const url = new URL(authorizeUrl);
  url.searchParams.set("fake_action", opts.action ?? "allow");
  if (opts.fakeUser) url.searchParams.set("fake_user", opts.fakeUser);
  const res = await fetch(url, { redirect: "manual" });
  const location = res.headers.get("Location");
  if (!location) throw new Error(`fake authorize did not redirect: ${res.status}`);
  const cb = new URL(location);
  return app.request(`${cb.pathname}${cb.search}`, { method: "GET" }, testEnv);
}

/** connect（mode=new）→ 認可 → callback をまとめて行う */
export async function connectNew(app: TestApp, user: string, fakeUser: string, action: "allow" | "deny" = "allow") {
  const res = await call(app, "POST", "/api/threads/connect", { user, body: { mode: "new" } });
  if (res.status !== 200) return { connectRes: res, callbackRes: null as Response | null };
  const { authorizeUrl } = (await res.json()) as { authorizeUrl: string };
  const callbackRes = await authorizeAndCallback(app, authorizeUrl, { fakeUser, action });
  return { connectRes: res, callbackRes, authorizeUrl };
}

export function redirectTarget(res: Response) {
  const loc = res.headers.get("Location");
  if (!loc) throw new Error(`expected redirect, got ${res.status}`);
  return new URL(loc);
}

// ---- 戦略プロファイルのテスト用（specs/002-strategy-profile）----

let accountSeq = 0;

/**
 * Threadsの接続を通さずに、ユーザーと owner の Account を直接作る。
 * userCreatedAt を指定すると、無料体験の内外を作れる（research.md R14）。
 */
export async function createUserWithAccount(
  user: string,
  opts: { plan?: "auto-only" | "auto-grower" | "multi-account" | "team"; userCreatedAt?: Date } = {},
) {
  const sql = neon(testEnv.DATABASE_URL);
  createDb(testEnv.DATABASE_URL);
  const createdAt = (opts.userCreatedAt ?? new Date()).toISOString();
  const [u] = (await sql`
    INSERT INTO users (clerk_user_id, email, display_name, created_at, updated_at)
    VALUES (${user}, ${`${user}@example.com`}, ${user}, ${createdAt}, ${createdAt})
    ON CONFLICT (clerk_user_id) DO UPDATE SET created_at = EXCLUDED.created_at
    RETURNING id`) as [{ id: string }];
  accountSeq += 1;
  const threadsUserId = `tu_${user}_${Date.now()}_${accountSeq}`;
  const [a] = (await sql`
    INSERT INTO accounts (threads_user_id, username, plan)
    VALUES (${threadsUserId}, ${`${user}_${accountSeq}`}, ${opts.plan ?? "auto-only"})
    RETURNING id`) as [{ id: string }];
  await sql`INSERT INTO memberships (user_id, account_id, role) VALUES (${u.id}, ${a.id}, 'owner')`;
  return { userId: u.id, accountId: a.id };
}

/** Account の plan・接続状態を書き換える */
export async function setAccount(
  accountId: string,
  values: { plan?: "auto-only" | "auto-grower" | "multi-account" | "team"; connectionStatus?: "connected" | "needs_reconnect" },
) {
  const sql = neon(testEnv.DATABASE_URL);
  createDb(testEnv.DATABASE_URL);
  if (values.plan) await sql`UPDATE accounts SET plan = ${values.plan} WHERE id = ${accountId}`;
  if (values.connectionStatus) {
    await sql`UPDATE accounts SET connection_status = ${values.connectionStatus} WHERE id = ${accountId}`;
  }
}

/** 無料体験が終わった登録日時（今から40日前） */
export const AFTER_TRIAL = () => new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
