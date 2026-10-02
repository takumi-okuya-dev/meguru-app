// US1：接続フロー（contracts/api.md の connect・callback、research.md R3・R4）
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { accounts, memberships, oauthStates, threadsConnections } from "../../src/db/schema";
import { sha256Hex } from "../../src/lib/identifier-hash";
import { TEST_WEB_ORIGIN } from "../env";
import { authorizeAndCallback, call, connectNew, db, fake, makeApp, redirectTarget, resetDb, testEnv } from "../helpers/app";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
  await fake.reset();
  await fake.addUser("1001", "takumi");
});

describe("POST /api/threads/connect（mode = new）", () => {
  it("authorizeUrl を返し、state は SHA-256 だけが10分の有効期限で保存される", async () => {
    const res = await call(app, "POST", "/api/threads/connect", { user: "u1", body: { mode: "new" } });
    expect(res.status).toBe(200);
    const { authorizeUrl } = (await res.json()) as { authorizeUrl: string };
    const url = new URL(authorizeUrl);
    expect(url.pathname).toBe("/oauth/authorize");
    expect(url.searchParams.get("scope")).toBe("threads_basic,threads_content_publish,threads_manage_insights");
    const state = url.searchParams.get("state")!;
    expect(state.length).toBeGreaterThanOrEqual(43);

    const rows = await db().select().from(oauthStates);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.stateHash).toBe(await sha256Hex(state));
    expect(rows[0]!.stateHash).not.toBe(state);
    const ttl = rows[0]!.expiresAt.getTime() - rows[0]!.createdAt.getTime();
    expect(ttl).toBeGreaterThan(9.5 * 60_000);
    expect(ttl).toBeLessThanOrEqual(10 * 60_000 + 1000);
  });

  it("未ログインなら 401 AUTH_REQUIRED", async () => {
    const res = await call(app, "POST", "/api/threads/connect", { body: { mode: "new" } });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("AUTH_REQUIRED");
  });
});

describe("GET /api/threads/callback", () => {
  it("許可されると Account・owner の Membership・接続が作られ、/accounts/:id?connected=new へ302", async () => {
    const { callbackRes } = await connectNew(app, "u1", "1001");
    expect(callbackRes!.status).toBe(302);
    const target = redirectTarget(callbackRes!);
    expect(target.origin).toBe(TEST_WEB_ORIGIN);
    expect(target.searchParams.get("connected")).toBe("new");

    const [account] = await db().select().from(accounts);
    expect(target.pathname).toBe(`/accounts/${account!.id}`);
    expect(account!.threadsUserId).toBe("1001");
    expect(account!.username).toBe("takumi");
    expect(account!.plan).toBe("auto-only");
    expect(account!.connectionStatus).toBe("connected");

    const ms = await db().select().from(memberships).where(eq(memberships.accountId, account!.id));
    expect(ms).toHaveLength(1);
    expect(ms[0]!.role).toBe("owner");

    const [conn] = await db().select().from(threadsConnections);
    expect(conn!.scopes).toEqual(["threads_basic", "threads_content_publish", "threads_manage_insights"]);
    expect(conn!.accessTokenIv).toHaveLength(12);
    expect(conn!.keyVersion).toBe(1);
    expect(conn!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 59 * 24 * 3600_000);
  });

  it("Threads側で拒否されたら THREADS_AUTH_CANCELLED で /accounts/new へ戻り、Accountは作られない", async () => {
    const { callbackRes } = await connectNew(app, "u1", "1001", "deny");
    const target = redirectTarget(callbackRes!);
    expect(target.pathname).toBe("/accounts/new");
    expect(target.searchParams.get("error")).toBe("THREADS_AUTH_CANCELLED");
    expect(await db().select().from(accounts)).toHaveLength(0);
  });

  it("同じ state で2回目の callback は OAUTH_STATE_INVALID", async () => {
    const res = await call(app, "POST", "/api/threads/connect", { user: "u1", body: { mode: "new" } });
    const { authorizeUrl } = (await res.json()) as { authorizeUrl: string };
    const url = new URL(authorizeUrl);
    url.searchParams.set("fake_action", "allow");
    const authRes = await fetch(url, { redirect: "manual" });
    const cb = new URL(authRes.headers.get("Location")!);
    const first = await app.request(`${cb.pathname}${cb.search}`, {}, testEnv);
    expect(redirectTarget(first).searchParams.get("connected")).toBe("new");
    const second = await app.request(`${cb.pathname}${cb.search}`, {}, testEnv);
    expect(redirectTarget(second).searchParams.get("error")).toBe("OAUTH_STATE_INVALID");
  });

  it("state がなければ OAUTH_STATE_INVALID で /accounts/new へ", async () => {
    const res = await call(app, "GET", "/api/threads/callback?code=abc");
    const target = redirectTarget(res);
    expect(target.pathname).toBe("/accounts/new");
    expect(target.searchParams.get("error")).toBe("OAUTH_STATE_INVALID");
  });

  it("トークン交換に失敗したら THREADS_AUTH_FAILED", async () => {
    await fake.fail("exchangeCode", 1, "server");
    const { callbackRes } = await connectNew(app, "u1", "1001");
    expect(redirectTarget(callbackRes!).searchParams.get("error")).toBe("THREADS_AUTH_FAILED");
    expect(await db().select().from(accounts)).toHaveLength(0);
  });

  it("プロフィールを取得できなければ THREADS_PROFILE_FETCH_FAILED で、Accountは作られない", async () => {
    await fake.fail("getProfile", 1, "server");
    const { callbackRes } = await connectNew(app, "u1", "1001");
    expect(redirectTarget(callbackRes!).searchParams.get("error")).toBe("THREADS_PROFILE_FETCH_FAILED");
    expect(await db().select().from(accounts)).toHaveLength(0);
  });

  it("認可URLは偽サーバー経由でも正しく組み立てられる（authorizeAndCallback の確認）", async () => {
    const res = await call(app, "POST", "/api/threads/connect", { user: "u1", body: { mode: "new" } });
    const { authorizeUrl } = (await res.json()) as { authorizeUrl: string };
    const cb = await authorizeAndCallback(app, authorizeUrl, { fakeUser: "1001" });
    expect(cb.status).toBe(302);
  });
});
