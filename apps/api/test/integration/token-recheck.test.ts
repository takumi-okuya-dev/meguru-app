// US4：期限を確かめられなかったトークンの、2時間後の確かめ直し（specs/010-token-account-add FR-012、research.md R8）
import { neon } from "@neondatabase/serverless";
import { beforeEach, describe, expect, it } from "vitest";
import { createThreadsClient } from "../../src/adapters/threads-api/threads-client";
import { createDb } from "../../src/kernel/db/client";
import { runTokenRecheck } from "../../src/apps/threads/connection/token-recheck";
import { fake, makeApp, resetDb, testEnv, tokenConnectNew } from "../helpers/app";

const app = makeApp();
const q = () => neon(testEnv.DATABASE_URL);
const DAY = 86_400_000;

beforeEach(async () => {
  await resetDb();
  await fake.reset();
  await fake.addUser("9003", "cafe_b");
});

async function addWithoutDebug(user = "u1") {
  const token = await fake.issueToken({ user: "9003", debug: false });
  const { res } = await tokenConnectNew(app, user, token);
  return { token, accountId: ((await res.json()) as { accountId: string }).accountId };
}
const row = async () =>
  ((await q()`SELECT a.connection_status, a.reconnect_hint, a.connection_generation, c.recheck_at, c.expires_at
    FROM accounts a JOIN threads_connections c ON c.account_id = a.id`) as Record<string, unknown>[])[0]!;
const due = () => q()`UPDATE threads_connections SET recheck_at = now() - interval '1 minute'`;
const recheck = () => runTokenRecheck(testEnv, createDb(testEnv.DATABASE_URL), createThreadsClient(testEnv), new Date());

describe("確かめ直し", () => {
  it("使えるトークンなら recheck_at を消し、接続中のまま", async () => {
    await addWithoutDebug();
    await due();
    expect((await recheck()).checked).toBe(1);
    expect(await row()).toMatchObject({ connection_status: "connected", recheck_at: null, reconnect_hint: null });
  });

  it("使えなくなっていれば要再接続にし、短期トークンの補いを入れる", async () => {
    const { token } = await addWithoutDebug();
    await fake.revokeToken(token);
    await due();
    await recheck();
    expect(await row()).toMatchObject({ connection_status: "needs_reconnect", reconnect_hint: "short_lived_token", recheck_at: null });
  });

  it("Threadsの一時的な失敗なら、10分後にやり直す", async () => {
    await addWithoutDebug();
    await due();
    await fake.fail("getProfile", 1, "server");
    await recheck();
    const r = await row();
    expect(r.connection_status).toBe("connected");
    const min = (new Date(r.recheck_at as string).getTime() - Date.now()) / 60_000;
    expect(min).toBeGreaterThan(9);
    expect(min).toBeLessThanOrEqual(10);
  });

  it("その間に接続し直していれば（世代番号が違えば）、結果を捨てる", async () => {
    const { token } = await addWithoutDebug();
    await fake.revokeToken(token);
    await due();
    // 読んだ後に接続し直したことにする（世代番号を進める）
    const db = createDb(testEnv.DATABASE_URL);
    const threads = createThreadsClient(testEnv);
    const original = threads.getProfile.bind(threads);
    threads.getProfile = async (t) => {
      await q()`UPDATE accounts SET connection_generation = connection_generation + 1`;
      return original(t);
    };
    await runTokenRecheck(testEnv, db, threads, new Date());
    expect(await row()).toMatchObject({ connection_status: "connected", reconnect_hint: null });
  });

  it("時刻の来ていないものは確かめない。1回に最大20件", async () => {
    await addWithoutDebug();
    expect((await recheck()).checked).toBe(0);
    expect((await row()).recheck_at).not.toBeNull();
  });
});

describe("日次の延長（SC-006、FR-040）", () => {
  it("トークンの接続も、期限まで7日を切れば延長され、アプリのユーザーIDのまま", async () => {
    const { refreshExpiringTokens } = await import("../../src/apps/threads/connection/token-refresh");
    await tokenConnectNew(app, "u1", await fake.issueToken({ user: "9003" }));
    await q()`UPDATE threads_connections SET expires_at = now() + interval '3 days', issued_at = now() - interval '2 days'`;
    const result = await refreshExpiringTokens(testEnv, createThreadsClient(testEnv), new Date());
    expect(result.refreshed).toBe(1);
    const r = await row();
    expect(new Date(r.expires_at as string).getTime()).toBeGreaterThan(Date.now() + 59 * DAY);
    const [a] = (await q()`SELECT threads_user_id, connection_method FROM accounts`) as Record<string, string>[];
    expect(a).toEqual({ threads_user_id: "9003-myapp", connection_method: "token" });
  });
});
