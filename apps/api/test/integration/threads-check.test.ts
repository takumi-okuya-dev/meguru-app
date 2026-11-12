// 「接続を確かめる」（specs/005-auto-post FR-002b、research.md R15、contracts/api.md「POST /threads-check」）
import { beforeEach, describe, expect, it } from "vitest";
import { call, createUserWithAccount, fake, makeApp, resetDb, setAccount } from "../helpers/app";
import { connectedAccount, db } from "../helpers/auto-post";

const app = makeApp();
const check = (accountId: string, user = "u1") =>
  call(app, "POST", `/api/accounts/${accountId}/threads-check`, { user });

beforeEach(async () => {
  await resetDb();
  await fake.reset();
});

async function connectionStatus(accountId: string) {
  const [r] = (await db()`SELECT connection_status FROM threads.accounts WHERE id = ${accountId}`) as [
    { connection_status: string },
  ];
  return r.connection_status;
}

describe("POST /threads-check", () => {
  it("投稿できる状態なら ok と直近24時間の投稿数。投稿は作らない", async () => {
    const { accountId } = await connectedAccount("u1", app);
    const res = await check(accountId);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", quotaUsage: 0, quotaTotal: 250 });
    expect(await fake.posts()).toHaveLength(0);
  });

  it("投稿の権限がなければ no_publish_permission（要再接続にはしない）", async () => {
    const { accountId, threadsUserId } = await connectedAccount("u1", app);
    await fake.setPublishPermission(threadsUserId, false);
    expect(await (await check(accountId)).json()).toEqual({ status: "no_publish_permission" });
    expect(await connectionStatus(accountId)).toBe("connected");
  });

  it("トークンが無効なら needs_reconnect で、Accountを要再接続にする", async () => {
    const { accountId, threadsUserId } = await connectedAccount("u1", app);
    await fake.invalidate(threadsUserId);
    expect(await (await check(accountId)).json()).toEqual({ status: "needs_reconnect" });
    expect(await connectionStatus(accountId)).toBe("needs_reconnect");
  });

  it("一時的な失敗は unknown", async () => {
    const { accountId } = await connectedAccount("u1", app);
    await fake.publishFail("publishingLimit", "transient", 1);
    expect(await (await check(accountId)).json()).toEqual({ status: "unknown" });
  });

  it("すでに要再接続なら、Threadsを呼ばずに needs_reconnect", async () => {
    const { accountId, threadsUserId } = await connectedAccount("u1", app);
    await setAccount(accountId, { connectionStatus: "needs_reconnect" });
    // 呼べば認証エラーになるが、呼ばないので無効にしても結果は同じ。権限なしにしても呼ばれないことを確かめる
    await fake.setPublishPermission(threadsUserId, false);
    expect(await (await check(accountId)).json()).toEqual({ status: "needs_reconnect" });
  });

  it("他人のAccountは 404 ACCOUNT_NOT_FOUND", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await createUserWithAccount("u2");
    expect((await check(accountId, "u2")).status).toBe(404);
  });
});
