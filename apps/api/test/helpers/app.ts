// 結合テストの共通部品：偽の認証で動くアプリ、DBの初期化、偽のThreadsサーバーの操作、認可〜callbackの一連の流れ
import { syncThreadsUsage } from "../../src/apps/threads/accounts/usage";
import { env } from "cloudflare:test";
import { neon } from "@neondatabase/serverless";
import { createApp } from "../../src/app";
import { createDb } from "../../src/kernel/db/client";
import type { Env } from "../../src/kernel/env";
import type { AuthVerifier } from "../../src/platform/identity/auth";

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

/** 偽のClerkのユーザーの削除（退会。specs/013）。消したIDを記録し、fail を立てると失敗する。 */
export const fakeClerk = {
  deleted: [] as string[],
  fail: false,
  reset() {
    this.deleted = [];
    this.fail = false;
  },
  async delete(clerkUserId: string) {
    if (fakeClerk.fail) throw new Error("clerk unavailable");
    fakeClerk.deleted.push(clerkUserId);
  },
};

export function makeApp() {
  return createApp({ verifyAuth: () => fakeVerifier, deleteClerkUser: () => (id) => fakeClerk.delete(id) });
}

export type TestApp = ReturnType<typeof makeApp>;

export function call(
  app: TestApp,
  method: string,
  path: string,
  opts: { user?: string; body?: unknown; headers?: Record<string, string>; env?: Env } = {},
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
  return app.request(path, { method, headers, body }, opts.env ?? testEnv);
}

/**
 * DBの処理を、行き詰まり（deadlock。Postgres の 40P01）のときだけ数回やり直す。TRUNCATE は多くの表をまとめてロックするので、
 * 前のテストの裏で終わりきっていない処理とぶつかることがある。行き詰まりでは Postgres が片方を取り消すので、やり直してよい。
 * @param run - 処理
 */
async function retryOnDeadlock(run: () => Promise<unknown>): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await run();
      return;
    } catch (err) {
      if ((err as { code?: string }).code !== "40P01" || attempt >= 5) throw err;
      await new Promise((r) => setTimeout(r, 100 * attempt));
    }
  }
}

/** アプリのスキーマの表（1回だけ読む）。 */
let appTables: Promise<string[]> | undefined;

/**
 * アプリのスキーマ（public・drizzle のほか）のすべての表を読む。アプリや表を足しても、ここを直さずに済む（specs/meguru/031）。
 * @param sql - DBの問い合わせ
 * @returns 「スキーマ.表」の一覧
 */
function loadAppTables(sql: ReturnType<typeof neon<false, false>>): Promise<string[]> {
  appTables ??= sql
    .query(
      "SELECT quote_ident(schemaname) || '.' || quote_ident(tablename) AS name FROM pg_tables WHERE schemaname NOT IN ('public', 'drizzle', 'pg_catalog', 'information_schema') ORDER BY 1",
    )
    .then((rows) => (rows as { name: string }[]).map((r) => r.name));
  return appTables;
}

export async function resetDb() {
  const sql = neon(testEnv.DATABASE_URL);
  createDb(testEnv.DATABASE_URL); // ローカルプロキシの設定を有効にする
  // 共通（public）は決めた表だけ、アプリのスキーマはすべての表を空にする
  const tables = ["users", "subscriptions", "withdrawn_users", "platform_events", "app_usage", "user_app_limits", ...(await loadAppTables(sql))];
  await retryOnDeadlock(() => sql.query(`TRUNCATE ${tables.join(", ")} CASCADE`));
  // 上限の既定の値を初めの値に戻す（specs/024、specs/meguru/029 research.md R7）
  await sql`INSERT INTO app_limit_defaults (app, key, value) VALUES ('threads', 'accounts', 3), ('threads', 'daily_posts', 10)
    ON CONFLICT (app, key) DO UPDATE SET value = EXCLUDED.value`;
  // Threadsの運営の設定（テスター招待の枠。specs/meguru/029 tasks.md T024）
  await sql`INSERT INTO threads.settings (id, tester_slot_capacity) VALUES (1, 25) ON CONFLICT (id) DO UPDATE SET tester_slot_capacity = 25`;
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
  // ---- 利用者のMetaアプリのトークン（specs/010 research.md R13）----
  /** ユーザートークン生成ツールの代わりにトークンを作る。appScope ごとにユーザーIDが変わる */
  issueToken: async (opts: {
    user: string;
    appScope?: string;
    lifetime?: "long" | "short";
    debug?: boolean;
    scopes?: string[];
  }) => ((await control("tokens", opts)) as { token: string }).token,
  /** トークンを無効にする（Metaアプリ側での取り消し） */
  revokeToken: (token: string) => control("tokens/revoke", { token }),
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
  callCounts: async () => (await control("call-counts")) as { insights: number; followers: number; total: number },
  containers: async () =>
    ((await control("containers")) as { containers: { id: string; userId: string; text: string; status: string }[] })
      .containers,
};

/**
 * connect で得た authorizeUrl から、偽の認可画面で許可/拒否し、接続を完了させる。
 *
 * 完了は無認証の callback ではなく、ログイン済みの `POST /api/threads/complete` で行う
 * （セキュリティ監査 run-1）。呼び出し側を変えずに済むよう、ここで state の作成者を
 * DBから引いて、その人として完了させる。本来の流れ（自分で始めて自分で終える）と同じ。
 * 「他人の state を踏ませる」側は、complete を直接呼ぶ試験で確かめる。
 *
 * @param app - テストのアプリ
 * @param authorizeUrl - connect が返した認可URL
 * @param opts - 偽の認可画面の挙動と、完了を行う利用者（既定は state の作成者）、環境（既定は testEnv）
 * @returns 302 の応答（Location は以前の callback と同じ行き先）
 */
export async function authorizeAndCallback(
  app: TestApp,
  authorizeUrl: string,
  opts: { fakeUser?: string; action?: "allow" | "deny"; user?: string; env?: Env } = {},
) {
  const env = opts.env ?? testEnv;
  const url = new URL(authorizeUrl);
  url.searchParams.set("fake_action", opts.action ?? "allow");
  if (opts.fakeUser) url.searchParams.set("fake_user", opts.fakeUser);
  const res = await fetch(url, { redirect: "manual" });
  const location = res.headers.get("Location");
  if (!location) throw new Error(`fake authorize did not redirect: ${res.status}`);
  const cb = new URL(location);
  // callback は転送するだけ（DBにも Threads にも触らない）
  const hop = await app.request(`${cb.pathname}${cb.search}`, { method: "GET" }, env);
  const next = new URL(hop.headers.get("Location")!);
  const state = next.searchParams.get("state");
  const code = next.searchParams.get("code");
  const error = next.searchParams.get("error");
  // state を持たずに戻ってくる場合（code も error も無い）はそのまま返す
  if (!state) return redirectResponse(`${next.pathname}${next.search}`);

  const user = opts.user ?? (await stateOwner(state));
  // 許可しなかったときも state を渡して、元のアカウントの画面へ戻してもらう
  const body = error ? { state, error } : { state, code };
  const done = await call(app, "POST", "/api/threads/complete", { user, body, env });
  if (!done.ok) return done;
  const { redirectTo } = (await done.json()) as { redirectTo: string };
  return redirectResponse(redirectTo);
}

/**
 * state を作った利用者の clerk_user_id を引く（テストの便宜。本番にこの経路は無い）。
 * @param state - 認可URLに入っていた state の平文
 * @returns clerk_user_id
 */
async function stateOwner(state: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(state));
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const rows = (await neon(testEnv.DATABASE_URL)`
    SELECT u.clerk_user_id FROM threads.oauth_states s JOIN users u ON u.id = s.user_id
    WHERE s.state_hash = ${hash}`) as { clerk_user_id: string }[];
  if (!rows[0]) throw new Error("state が見つかりません（作成者を引けません）");
  return rows[0].clerk_user_id;
}

/**
 * 以前の callback と同じ形（302 と Location）の応答を作る。呼び出し側の assert を変えずに済む。
 * @param to - 行き先（アプリの中の相対パス）
 * @returns 302 の応答
 */
const redirectResponse = (to: string) =>
  new Response(null, { status: 302, headers: { Location: `${testEnv.WEB_ORIGIN.replace(/\/$/, "")}${to}` } });

/**
 * 名前だけでアカウントを作る（POST /api/threads/accounts。specs/012）。
 * @returns 作ったアカウントのID。作れなければ（上限など）NULL と応答
 */
export async function createAccountVia(app: TestApp, user: string, name = "テストのアカウント") {
  const res = await call(app, "POST", "/api/threads/accounts", { user, body: { name } });
  if (res.status !== 201) return { accountId: null as string | null, res };
  return { accountId: ((await res.clone().json()) as { id: string }).id, res };
}

/**
 * 未接続のアカウントに、このアプリの接続ではじめてつなぐ（connect（mode=connect）→ 認可 → callback）。
 * @returns connect の応答と callback の応答（302）
 */
export async function connectExisting(
  app: TestApp,
  user: string,
  accountId: string,
  fakeUser: string,
  action: "allow" | "deny" = "allow",
) {
  const res = await call(app, "POST", "/api/threads/connect", { user, body: { mode: "connect", accountId } });
  if (res.status !== 200) return { connectRes: res, callbackRes: null as Response | null, authorizeUrl: undefined };
  const { authorizeUrl } = (await res.json()) as { authorizeUrl: string };
  const callbackRes = await authorizeAndCallback(app, authorizeUrl, { fakeUser, action });
  return { connectRes: res, callbackRes, authorizeUrl };
}

/**
 * アカウントを作ってから、このアプリの接続でつなぐ（012 より前の「つないで追加」の代わり）。
 * 作れなければ（上限など）、作る応答を connectRes に入れ、callbackRes は NULL。
 * @returns 作ったアカウントのID・connect の応答・callback の応答
 */
export async function connectNew(app: TestApp, user: string, fakeUser: string, action: "allow" | "deny" = "allow") {
  const created = await createAccountVia(app, user, `アカウント ${fakeUser}`);
  if (!created.accountId) return { accountId: null, connectRes: created.res, callbackRes: null as Response | null, authorizeUrl: undefined };
  return { accountId: created.accountId, ...(await connectExisting(app, user, created.accountId, fakeUser, action)) };
}

/**
 * アカウントを作ってから、トークンでつなぐ（POST /api/threads/token-connect、mode=connect）。
 * 作れなければ、作る応答を返す。
 * @returns token-connect の応答（作れなければ作る応答）と、作ったアカウントのID
 */
export async function tokenConnectNew(app: TestApp, user: string, token: string, name = "トークンのアカウント") {
  const created = await createAccountVia(app, user, name);
  if (!created.accountId) return { accountId: null, res: created.res };
  const res = await call(app, "POST", "/api/threads/token-connect", {
    user,
    body: { mode: "connect", accountId: created.accountId, token },
  });
  return { accountId: created.accountId, res };
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
  opts: { userCreatedAt?: Date; name?: string } = {},
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
  const username = `${user}_${accountSeq}`;
  const [a] = (await sql`
    INSERT INTO threads.accounts (name, threads_user_id, username)
    VALUES (${opts.name ?? username}, ${threadsUserId}, ${username})
    RETURNING id`) as [{ id: string }];
  await sql`INSERT INTO threads.memberships (user_id, account_id, role) VALUES (${u.id}, ${a.id}, 'owner')`;
  // 本物のアカウントの作成と同じく、利用の数を共通へ伝える（specs/meguru/029 research.md R6）
  await syncThreadsUsage(createDb(testEnv.DATABASE_URL), u.id);
  return { userId: u.id, accountId: a.id };
}

/**
 * ユーザーと、Threadsにつないでいない owner の Account を直接作る（specs/012 data-model.md）。
 * @param user - Clerk のユーザーID
 * @param opts - name：アカウントの名前（既定「未接続のアカウント」）、userCreatedAt
 * @returns users.id と accounts.id
 */
export async function createUnconnectedAccount(
  user: string,
  opts: { name?: string; userCreatedAt?: Date } = {},
) {
  const sql = neon(testEnv.DATABASE_URL);
  const createdAt = (opts.userCreatedAt ?? new Date()).toISOString();
  const [u] = (await sql`
    INSERT INTO users (clerk_user_id, email, display_name, created_at, updated_at)
    VALUES (${user}, ${`${user}@example.com`}, ${user}, ${createdAt}, ${createdAt})
    ON CONFLICT (clerk_user_id) DO UPDATE SET updated_at = users.updated_at
    RETURNING id`) as [{ id: string }];
  const [a] = (await sql`
    INSERT INTO threads.accounts (name, connection_status, connection_method)
    VALUES (${opts.name ?? "未接続のアカウント"}, 'not_connected', NULL)
    RETURNING id`) as [{ id: string }];
  await sql`INSERT INTO threads.memberships (user_id, account_id, role) VALUES (${u.id}, ${a.id}, 'owner')`;
  // 本物のアカウントの作成と同じく、利用の数を共通へ伝える（specs/meguru/029 research.md R6）
  await syncThreadsUsage(createDb(testEnv.DATABASE_URL), u.id);
  return { userId: u.id, accountId: a.id };
}

/** Account の接続状態を書き換える */
export async function setAccount(accountId: string, values: { connectionStatus?: "connected" | "needs_reconnect" }) {
  const sql = neon(testEnv.DATABASE_URL);
  createDb(testEnv.DATABASE_URL);
  if (values.connectionStatus) {
    await sql`UPDATE threads.accounts SET connection_status = ${values.connectionStatus} WHERE id = ${accountId}`;
  }
}

/** 無料体験が終わった登録日時（今から40日前） */
export const AFTER_TRIAL = () => new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);

// ---- 決済のテスト用（specs/013-billing）----

/**
 * 料金なしの印を付け・外す。
 * @param userId - users.id
 * @param on - 付けるなら true
 */
export async function setBillingExempt(userId: string, on: boolean) {
  const sql = neon(testEnv.DATABASE_URL);
  createDb(testEnv.DATABASE_URL);
  await sql`UPDATE users SET billing_exempt = ${on} WHERE id = ${userId}`;
}

/**
 * 契約の行を直接入れる（Stripeを通さない）。同じ利用者の行があれば置き換える。
 * @param userId - users.id
 * @param values - 状態など。顧客・契約のIDは既定で利用者から作る
 */
export async function insertSubscription(
  userId: string,
  values: {
    status: string | null;
    cancelAtPeriodEnd?: boolean;
    currentPeriodEnd?: Date;
    stripeCustomerId?: string;
    stripeSubscriptionId?: string | null;
    quantity?: number;
  },
) {
  const sql = neon(testEnv.DATABASE_URL);
  createDb(testEnv.DATABASE_URL);
  const customer = values.stripeCustomerId ?? `cus_${userId.slice(0, 8)}`;
  const subscription = values.stripeSubscriptionId === undefined ? `sub_${userId.slice(0, 8)}` : values.stripeSubscriptionId;
  const periodEnd = (values.currentPeriodEnd ?? new Date(Date.now() + 20 * 86_400_000)).toISOString();
  await sql`
    INSERT INTO subscriptions (user_id, stripe_customer_id, stripe_subscription_id, status, cancel_at_period_end, current_period_end, quantity)
    VALUES (${userId}, ${customer}, ${subscription}, ${values.status}, ${values.cancelAtPeriodEnd ?? false}, ${periodEnd}, ${values.quantity ?? 1})
    ON CONFLICT (user_id) DO UPDATE SET
      stripe_customer_id = EXCLUDED.stripe_customer_id,
      stripe_subscription_id = EXCLUDED.stripe_subscription_id,
      status = EXCLUDED.status,
      cancel_at_period_end = EXCLUDED.cancel_at_period_end,
      current_period_end = EXCLUDED.current_period_end,
      quantity = EXCLUDED.quantity`;
}

/**
 * 無料体験を終わらせる（登録日時を40日前にする）。
 * @param userId - users.id
 */
export async function endTrial(userId: string) {
  const sql = neon(testEnv.DATABASE_URL);
  createDb(testEnv.DATABASE_URL);
  // 無料体験が終わるのは、024の前からいた人だけ（specs/024 research.md R8）
  await sql`UPDATE users SET created_at = ${AFTER_TRIAL().toISOString()}, legacy_trial = true WHERE id = ${userId}`;
}

// ---- 上限（運営者が決める値）をテストで直接変える ----

/**
 * 人ごとの上限を書く（user_app_limits。運営の画面と同じ。specs/meguru/029 research.md R7）。
 * @param who - clerkUserId か userId
 * @param key - accounts（アカウントの数）か daily_posts（1日の投稿数）
 * @param n - 値（null は既定の値に戻す）
 */
export async function setUserLimit(who: { clerkUserId: string } | { userId: string }, key: "accounts" | "daily_posts", n: number | null) {
  const sql = neon(testEnv.DATABASE_URL);
  createDb(testEnv.DATABASE_URL);
  const [row] = (
    "userId" in who ? await sql`SELECT id FROM users WHERE id = ${who.userId}` : await sql`SELECT id FROM users WHERE clerk_user_id = ${who.clerkUserId}`
  ) as { id: string }[];
  if (!row) throw new Error("user not found");
  if (n === null) await sql`DELETE FROM user_app_limits WHERE user_id = ${row.id} AND app = 'threads' AND key = ${key}`;
  else
    await sql`INSERT INTO user_app_limits (user_id, app, key, value) VALUES (${row.id}, 'threads', ${key}, ${n})
      ON CONFLICT (user_id, app, key) DO UPDATE SET value = EXCLUDED.value`;
}

/**
 * 既定の上限を書く（app_limit_defaults）。
 * @param key - accounts か daily_posts
 * @param n - 値
 */
export async function setDefaultLimit(key: "accounts" | "daily_posts", n: number) {
  const sql = neon(testEnv.DATABASE_URL);
  createDb(testEnv.DATABASE_URL);
  await sql`INSERT INTO app_limit_defaults (app, key, value) VALUES ('threads', ${key}, ${n}) ON CONFLICT (app, key) DO UPDATE SET value = EXCLUDED.value`;
}
