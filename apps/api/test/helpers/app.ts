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
  await sql`TRUNCATE users, accounts, memberships, threads_connections, oauth_states, threads_deletion_requests, threads_revocations CASCADE`;
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
