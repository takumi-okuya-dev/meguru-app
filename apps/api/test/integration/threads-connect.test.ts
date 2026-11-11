// 接続フロー（001 contracts/api.md の connect・callback、research.md R3・R4）。
// specs/012 で「つないで作る（mode = new）」をなくし、未接続のアカウントにはじめてつなぐ（mode = connect）にした（research.md R4）。
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { accounts, memberships, oauthStates, threadsConnections, users } from "../../src/db/schema";
import { sha256Hex } from "../../src/kernel/identifier-hash";
import { TEST_WEB_ORIGIN } from "../env";
import {
  authorizeAndCallback,
  call,
  connectNew,
  createAccountVia,
  createUserWithAccount,
  db,
  fake,
  makeApp,
  redirectTarget,
  resetDb,
  testEnv,
} from "../helpers/app";
import { assign, joinTeam, makeTeam, setRole } from "../helpers/team";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
  await fake.reset();
  await fake.addUser("1001", "takumi");
});

async function errorOf(res: Response) {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

describe("POST /api/threads/connect（mode = connect）", () => {
  it("authorizeUrl を返し、state は SHA-256 だけが10分の有効期限で、対象のアカウントとともに保存される", async () => {
    const { accountId } = await createAccountVia(app, "u1");
    const res = await call(app, "POST", "/api/threads/connect", { user: "u1", body: { mode: "connect", accountId } });
    expect(res.status).toBe(200);
    const { authorizeUrl } = (await res.json()) as { authorizeUrl: string };
    const url = new URL(authorizeUrl);
    expect(url.pathname).toBe("/oauth/authorize");
    expect(url.searchParams.get("scope")).toBe("threads_basic,threads_content_publish,threads_manage_insights,threads_manage_replies");
    const state = url.searchParams.get("state")!;
    expect(state.length).toBeGreaterThanOrEqual(43);

    const rows = await db().select().from(oauthStates);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.stateHash).toBe(await sha256Hex(state));
    expect(rows[0]!.mode).toBe("connect");
    expect(rows[0]!.targetAccountId).toBe(accountId);
    const ttl = rows[0]!.expiresAt.getTime() - rows[0]!.createdAt.getTime();
    expect(ttl).toBeGreaterThan(9.5 * 60_000);
    expect(ttl).toBeLessThanOrEqual(10 * 60_000 + 1000);
  });

  it("mode = new（つないで作る）はもう受け付けない（VALIDATION_FAILED）", async () => {
    const res = await call(app, "POST", "/api/threads/connect", { user: "u1", body: { mode: "new" } });
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe("VALIDATION_FAILED");
  });

  it("未ログインなら 401 AUTH_REQUIRED", async () => {
    const res = await call(app, "POST", "/api/threads/connect", { body: { mode: "connect", accountId: crypto.randomUUID() } });
    expect(res.status).toBe(401);
    expect(await errorOf(res)).toBe("AUTH_REQUIRED");
  });

  it("オーナーだけ：関わりのない人は ACCOUNT_NOT_FOUND、担当の人は ROLE_FORBIDDEN（FR-015）", async () => {
    const { accountId } = await createUserWithAccount("owner");
    const { accountId: unconnected } = await createAccountVia(app, "owner2");
    expect(await errorOf(await call(app, "POST", "/api/threads/connect", { user: "stranger", body: { mode: "connect", accountId: unconnected } }))).toBe(
      "ACCOUNT_NOT_FOUND",
    );
    // 担当の人（チームの編集者）は、つながっているアカウントの接続し直しもできない
    const { accountId: adminAcc } = await createUserWithAccount("admin");
    const { teamId } = await makeTeam("admin", [adminAcc]);
    const { accountId: editorAcc } = await createUserWithAccount("editor");
    await joinTeam(teamId, "owner", [accountId]);
    await joinTeam(teamId, "editor", [editorAcc]);
    await setRole(teamId, "editor", "editor");
    await assign(teamId, "editor", accountId);
    const res = await call(app, "POST", "/api/threads/connect", { user: "editor", body: { mode: "reconnect", accountId } });
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toBe("ROLE_FORBIDDEN");
  });

  it("つながっているアカウントへの connect は ACCOUNT_ALREADY_CONNECTED（FR-018）", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const res = await call(app, "POST", "/api/threads/connect", { user: "u1", body: { mode: "connect", accountId } });
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toBe("ACCOUNT_ALREADY_CONNECTED");
  });

  it("未接続のアカウントへの reconnect は、Threadsに問い合わせる前に ACCOUNT_NOT_CONNECTED（PR #15 のCodexレビュー）", async () => {
    const { accountId } = await createAccountVia(app, "u1");
    const before = await fake.callCounts();
    const res = await call(app, "POST", "/api/threads/connect", { user: "u1", body: { mode: "reconnect", accountId } });
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toBe("ACCOUNT_NOT_CONNECTED");
    expect(await db().select().from(oauthStates)).toHaveLength(0);
    expect((await fake.callCounts()).total).toBe(before.total);
  });

});

describe("GET /api/threads/callback（mode = connect）", () => {
  it("許可されると、そのアカウントが接続中になり、プロフィールと接続の方法が入り、設定の画面へ302（US2-2）", async () => {
    const { accountId, callbackRes } = await connectNew(app, "u1", "1001");
    expect(callbackRes!.status).toBe(302);
    const target = redirectTarget(callbackRes!);
    expect(target.origin).toBe(TEST_WEB_ORIGIN);
    expect(target.pathname).toBe(`/accounts/${accountId}/settings`);
    expect(target.searchParams.get("connected")).toBe("connect");

    const all = await db().select().from(accounts);
    expect(all).toHaveLength(1);
    const account = all[0]!;
    expect(account.id).toBe(accountId);
    expect(account.name).toBe("アカウント 1001"); // つないでも名前は変えない（Clarifications 2026-10-14）
    expect(account.threadsUserId).toBe("1001");
    expect(account.username).toBe("takumi");
    expect(account.displayName).toBe("Name takumi");
    expect(account.connectionStatus).toBe("connected");
    expect(account.connectionMethod).toBe("app");

    const ms = await db().select().from(memberships).where(eq(memberships.accountId, account.id));
    expect(ms.map((m) => m.role)).toEqual(["owner"]);
    const [conn] = await db().select().from(threadsConnections);
    expect(conn!.scopes).toEqual(["threads_basic", "threads_content_publish", "threads_manage_insights", "threads_manage_replies"]);
    expect(conn!.accessTokenIv).toHaveLength(12);
    expect(conn!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 59 * 24 * 3600_000);
  });

  it("Threads側で拒否されたら THREADS_AUTH_CANCELLED で設定の画面へ戻り、未接続のまま（Edge Cases）", async () => {
    const { accountId, callbackRes } = await connectNew(app, "u1", "1001", "deny");
    const target = redirectTarget(callbackRes!);
    expect(target.pathname).toBe(`/accounts/${accountId}/settings`);
    expect(target.searchParams.get("error")).toBe("THREADS_AUTH_CANCELLED");
    const [account] = await db().select().from(accounts);
    expect(account!.connectionStatus).toBe("not_connected");
    expect(await db().select().from(threadsConnections)).toHaveLength(0);
  });

  // 接続の完了は、ログイン済みの POST /api/threads/complete に移した（セキュリティ監査 run-1）。
  // callback は state と code を Web へ渡すだけなので、state の良し悪しはそちらで判断する
  it("同じ state で2回目の完了は OAUTH_STATE_INVALID で、振り分け（/）へ", async () => {
    const { accountId } = await createAccountVia(app, "u1");
    const res = await call(app, "POST", "/api/threads/connect", { user: "u1", body: { mode: "connect", accountId } });
    const { authorizeUrl } = (await res.json()) as { authorizeUrl: string };
    const url = new URL(authorizeUrl);
    url.searchParams.set("fake_action", "allow");
    const authRes = await fetch(url, { redirect: "manual" });
    const cb = new URL(authRes.headers.get("Location")!);
    const hop = await app.request(`${cb.pathname}${cb.search}`, {}, testEnv);
    const next = new URL(hop.headers.get("Location")!);
    const body = { state: next.searchParams.get("state"), code: next.searchParams.get("code") };

    const first = await call(app, "POST", "/api/threads/complete", { user: "u1", body });
    expect(((await first.json()) as { redirectTo: string }).redirectTo).toContain("connected=connect");
    const second = await call(app, "POST", "/api/threads/complete", { user: "u1", body });
    expect(second.status).toBe(400);
    expect(((await second.json()) as { error: { code: string } }).error.code).toBe("OAUTH_STATE_INVALID");
  });

  it("state がなければ、callback は理由だけを付けて完了の画面へ送る", async () => {
    const res = await call(app, "GET", "/api/threads/callback?code=abc");
    const target = redirectTarget(res);
    expect(target.pathname).toBe("/threads/complete");
    expect(target.searchParams.get("error")).toBe("THREADS_AUTH_FAILED");
    expect(target.searchParams.get("code")).toBeNull();
  });

  it("012 より前の mode = new の state は OAUTH_STATE_INVALID（公開の時点で10分以内に始めたもの）", async () => {
    const state = "legacy-state-value-legacy-state-value-legacy";
    const [u] = await db()
      .insert(users)
      .values({ clerkUserId: "u1", email: "u1@example.com" })
      .returning();
    const now = Date.now();
    await db()
      .insert(oauthStates)
      .values({ stateHash: await sha256Hex(state), userId: u!.id, mode: "new", targetAccountId: null, expiresAt: new Date(now + 600_000), createdAt: new Date(now) });
    const res = await call(app, "POST", "/api/threads/complete", { user: "u1", body: { state, code: "abc" } });
    const { redirectTo } = (await res.json()) as { redirectTo: string };
    expect(redirectTo).toBe("/?error=OAUTH_STATE_INVALID");
    expect(await db().select().from(accounts)).toHaveLength(0);
  });

  it("許可の画面にいる間に対象のアカウントを消したら、/?error=ACCOUNT_NOT_FOUND で、何も作らない（U1）", async () => {
    const { accountId } = await createAccountVia(app, "u1", "消すアカウント");
    const res = await call(app, "POST", "/api/threads/connect", { user: "u1", body: { mode: "connect", accountId } });
    const { authorizeUrl } = (await res.json()) as { authorizeUrl: string };
    await call(app, "DELETE", `/api/accounts/${accountId}`, { user: "u1", body: { confirmName: "消すアカウント" } });
    const cb = await authorizeAndCallback(app, authorizeUrl, { fakeUser: "1001" });
    const target = redirectTarget(cb);
    expect(target.pathname).toBe("/");
    expect(target.searchParams.get("error")).toBe("ACCOUNT_NOT_FOUND");
    expect(await db().select().from(accounts)).toHaveLength(0);
    expect(await db().select().from(threadsConnections)).toHaveLength(0);
  });

  it("トークン交換に失敗したら THREADS_AUTH_FAILED で、未接続のまま", async () => {
    await fake.fail("exchangeCode", 1, "server");
    const { callbackRes } = await connectNew(app, "u1", "1001");
    expect(redirectTarget(callbackRes!).searchParams.get("error")).toBe("THREADS_AUTH_FAILED");
    expect((await db().select().from(accounts))[0]!.connectionStatus).toBe("not_connected");
  });

  it("プロフィールを取得できなければ THREADS_PROFILE_FETCH_FAILED で、未接続のまま", async () => {
    await fake.fail("getProfile", 1, "server");
    const { callbackRes } = await connectNew(app, "u1", "1001");
    expect(redirectTarget(callbackRes!).searchParams.get("error")).toBe("THREADS_PROFILE_FETCH_FAILED");
    expect((await db().select().from(accounts))[0]!.connectionStatus).toBe("not_connected");
  });
});
