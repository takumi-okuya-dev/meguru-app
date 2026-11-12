// US3：違うアカウントでつながった知らせ（specs/025-threads-account-guide contracts/api.md、FR-007・FR-008、T014）
import { neon } from "@neondatabase/serverless";
import { beforeEach, describe, expect, it } from "vitest";
import { call, connectExisting, fake, makeApp, resetDb, testEnv } from "../helpers/app";
import { applyFor, markInvited, publicEnv, unconnectedAccountOf } from "../helpers/tester-invites";

const app = makeApp();
const q = () => neon(testEnv.DATABASE_URL);
type Notice = { otherAccount: null | { appliedUsername: string; connectedUsername: string } };
const notice = async (accountId: string, user = "u1", env = testEnv) =>
  call(app, "GET", `/api/accounts/${accountId}/connection-notice`, { user, env });

beforeEach(async () => {
  await resetDb();
  await fake.reset();
  await fake.addUser("9001", "shop_tokyo");
  await fake.addUser("9002", "Other_Shop");
});

/**
 * 招待済みの申し込みのアカウントを、指定の Threads アカウントでつなぐ。
 * @returns アカウントのID
 */
async function invitedAndConnected(fakeUser: string, applied = "shop_tokyo") {
  const accountId = await unconnectedAccountOf(app, "u1");
  const { id } = (await (await applyFor(app, "u1", accountId, applied)).json()) as { id: string };
  await markInvited(id);
  await connectExisting(app, "u1", accountId, fakeUser);
  return accountId;
}

describe("GET /api/accounts/:id/connection-notice", () => {
  it("招待済みで違う名前でつながると、申し込んだ名前とつながった名前を返す", async () => {
    const accountId = await invitedAndConnected("9002");
    const res = await notice(accountId);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ otherAccount: { appliedUsername: "shop_tokyo", connectedUsername: "other_shop" } });
  });

  it("同じ名前でつながったとき・申し込みがないときは null", async () => {
    const same = await invitedAndConnected("9001");
    expect(((await (await notice(same)).json()) as Notice).otherAccount).toBeNull();
    const plain = await unconnectedAccountOf(app, "u1", "ふつう");
    expect(((await (await notice(plain)).json()) as Notice).otherAccount).toBeNull();
  });

  // 接続し直しでは別のThreadsアカウントに変えられない（specs/010 FR-032）。記録と今のIDが合わないときの守りとして確かめる
  it("アカウントの今のThreadsのユーザーIDが、つながった記録と違えば出さない", async () => {
    const accountId = await invitedAndConnected("9002");
    await q()`UPDATE threads.accounts SET threads_user_id = '9001', username = 'shop_tokyo' WHERE id = ${accountId}`;
    expect(((await (await notice(accountId)).json()) as Notice).otherAccount).toBeNull();
  });

  it("つながったアカウントがThreadsで名前を変えても出し続け、今の名前を返す（IDで比べる。/code-review 4）", async () => {
    const accountId = await invitedAndConnected("9002");
    await q()`UPDATE threads.accounts SET username = 'other_shop2' WHERE id = ${accountId}`;
    expect(((await (await notice(accountId)).json()) as Notice).otherAccount).toEqual({
      appliedUsername: "shop_tokyo",
      connectedUsername: "other_shop2",
    });
  });

  it("招待の管理がOFFの環境でも読める", async () => {
    const accountId = await invitedAndConnected("9002");
    const res = await notice(accountId, "u1", publicEnv());
    expect(((await res.json()) as Notice).otherAccount).not.toBeNull();
  });

  it("関わりがなければ 404", async () => {
    const accountId = await invitedAndConnected("9002");
    await call(app, "GET", "/api/me", { user: "u2" });
    expect((await notice(accountId, "u2")).status).toBe(404);
  });
});

describe("POST /api/accounts/:id/connection-notice/dismiss", () => {
  it("閉じると 204 で、そのあとは出ない。行がなくても 204", async () => {
    const accountId = await invitedAndConnected("9002");
    const res = await call(app, "POST", `/api/accounts/${accountId}/connection-notice/dismiss`, { user: "u1" });
    expect(res.status).toBe(204);
    expect(((await (await notice(accountId)).json()) as Notice).otherAccount).toBeNull();
    const plain = await unconnectedAccountOf(app, "u1", "ふつう");
    expect((await call(app, "POST", `/api/accounts/${plain}/connection-notice/dismiss`, { user: "u1" })).status).toBe(204);
  });
});
