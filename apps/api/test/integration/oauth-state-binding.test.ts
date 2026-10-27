// state をセッションに結び付ける（セキュリティ監査 run-1 の
// `threads-oauth-callback-state-not-session-bound`）。
//
// 以前は無認証の `GET /api/threads/callback` が state を消費し、その行の `user_id` を
// そのまま主体に持ち上げて接続まで書き込んでいた。state は32バイトの乱数・単回・10分・
// SHA-256 保存なので「第三者が他人の state を推測・再生する」向きは防げるが、
// **state を作った人が自分からそれを第三者に踏ませる**向きは防げなかった。
// 踏んだ人の認可で発行されたトークンが、作った人のアカウントに保存されてしまう。
//
// 止めるはずの関所がすべてすり抜ける理由：失効の確認・削除のtombstone・重複の検出は
// いずれも「その身元が既に製品内に居る」ことを前提に鍵を引くので、まだ登録されていない
// 被害者の身元では3つとも空振りする。
//
// いまは完了がログイン済みの `POST /api/threads/complete` で、state の `user_id` と
// Clerk で確かめた呼び出し元の一致を要求する。
import { describe, expect, it, beforeEach } from "vitest";
import { call, createAccountVia, db, fake, makeApp, resetDb, testEnv } from "../helpers/app";
import { accounts, threadsConnections } from "../../src/db/schema";
import { eq } from "drizzle-orm";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
  await fake.reset();
  await fake.addUser("1001", "attacker");
  await fake.addUser("2002", "victim");
});

/**
 * 認可を始めて、Meta から戻ってくる (state, code) を取り出す。
 * @param user - 認可を始める利用者
 * @param accountId - つなぐ先のAccount
 * @param fakeUser - 偽の認可画面で「許可する」Threadsの利用者
 * @returns state と code
 */
async function authorize(user: string, accountId: string, fakeUser: string) {
  const started = await call(app, "POST", "/api/threads/connect", {
    user,
    body: { mode: "connect", accountId },
  });
  const { authorizeUrl } = (await started.json()) as { authorizeUrl: string };
  const url = new URL(authorizeUrl);
  url.searchParams.set("fake_action", "allow");
  url.searchParams.set("fake_user", fakeUser);
  const res = await fetch(url, { redirect: "manual" });
  const cb = new URL(res.headers.get("Location")!);
  // callback は Web へ転送するだけ
  const hop = await app.request(`${cb.pathname}${cb.search}`, { method: "GET" }, testEnv);
  const next = new URL(hop.headers.get("Location")!);
  return { state: next.searchParams.get("state")!, code: next.searchParams.get("code")! };
}

describe("GET /api/threads/callback は接続を済ませない", () => {
  it("state と code を Web の完了画面へ渡すだけ（DBにも Threads にも触らない）", async () => {
    const accountId = (await createAccountVia(app, "u1")).accountId!;
    const { state, code } = await authorize("u1", accountId, "1001");
    expect(state).toBeTruthy();
    expect(code).toBeTruthy();
    // この時点では、まだ何も接続されていない
    const [row] = await db().select().from(accounts).where(eq(accounts.id, accountId));
    expect(row?.connectionStatus).toBe("not_connected");
    expect(await db().select().from(threadsConnections)).toHaveLength(0);
  });

  it("利用者が許可しなかったときは、理由を付けて完了画面へ送る", async () => {
    const accountId = (await createAccountVia(app, "u1")).accountId!;
    const started = await call(app, "POST", "/api/threads/connect", {
      user: "u1",
      body: { mode: "connect", accountId },
    });
    const { authorizeUrl } = (await started.json()) as { authorizeUrl: string };
    const url = new URL(authorizeUrl);
    url.searchParams.set("fake_action", "deny");
    const res = await fetch(url, { redirect: "manual" });
    const cb = new URL(res.headers.get("Location")!);
    const hop = await app.request(`${cb.pathname}${cb.search}`, { method: "GET" }, testEnv);
    const next = new URL(hop.headers.get("Location")!);
    expect(next.pathname).toBe("/threads/complete");
    expect(next.searchParams.get("error")).toBe("THREADS_AUTH_CANCELLED");
  });
});

describe("POST /api/threads/complete は、state を作った人しか使えない", () => {
  it("他人が作った state では完了できず、何も書き込まれない", async () => {
    // 攻撃者が自分の未接続アカウントのために state を作り、被害者に踏ませる
    const attackerAccount = (await createAccountVia(app, "attacker")).accountId!;
    const { state, code } = await authorize("attacker", attackerAccount, "2002");

    // 被害者のブラウザが完了を試みる（被害者のログインで届く）
    const res = await call(app, "POST", "/api/threads/complete", {
      user: "victim",
      body: { state, code },
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("OAUTH_STATE_INVALID");

    // 攻撃者のアカウントは未接続のまま。被害者のトークンはどこにも保存されない
    const [row] = await db().select().from(accounts).where(eq(accounts.id, attackerAccount));
    expect(row?.connectionStatus).toBe("not_connected");
    expect(row?.threadsUserId).toBeNull();
    expect(await db().select().from(threadsConnections)).toHaveLength(0);
  });

  it("state が無い場合と他人の state の場合で、応答を区別しない（state の存在を漏らさない）", async () => {
    const attackerAccount = (await createAccountVia(app, "attacker")).accountId!;
    const { state, code } = await authorize("attacker", attackerAccount, "2002");
    const others = await call(app, "POST", "/api/threads/complete", { user: "victim", body: { state, code } });
    const unknown = await call(app, "POST", "/api/threads/complete", {
      user: "victim",
      body: { state: "x".repeat(43), code },
    });
    expect(others.status).toBe(unknown.status);
    expect(await others.json()).toEqual(await unknown.json());
  });

  it("自分で始めて自分で終えるなら、これまでどおりつながる", async () => {
    const accountId = (await createAccountVia(app, "u1")).accountId!;
    const { state, code } = await authorize("u1", accountId, "1001");
    const res = await call(app, "POST", "/api/threads/complete", { user: "u1", body: { state, code } });
    expect(res.status).toBe(200);
    const { redirectTo } = (await res.json()) as { redirectTo: string };
    expect(redirectTo).toBe(`/accounts/${accountId}/settings?connected=connect`);
    const [row] = await db().select().from(accounts).where(eq(accounts.id, accountId));
    expect(row?.connectionStatus).toBe("connected");
    expect(row?.threadsUserId).toBe("1001");
  });

  it("state は単回。同じ state では2回完了できない", async () => {
    const accountId = (await createAccountVia(app, "u1")).accountId!;
    const { state, code } = await authorize("u1", accountId, "1001");
    expect((await call(app, "POST", "/api/threads/complete", { user: "u1", body: { state, code } })).status).toBe(200);
    const again = await call(app, "POST", "/api/threads/complete", { user: "u1", body: { state, code } });
    expect(again.status).toBe(400);
    expect(((await again.json()) as { error: { code: string } }).error.code).toBe("OAUTH_STATE_INVALID");
  });

  it("ログインしていなければ呼べない", async () => {
    const accountId = (await createAccountVia(app, "u1")).accountId!;
    const { state, code } = await authorize("u1", accountId, "1001");
    const res = await app.request(
      "/api/threads/complete",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state, code }) },
      testEnv,
    );
    expect(res.status).toBe(401);
  });
});
