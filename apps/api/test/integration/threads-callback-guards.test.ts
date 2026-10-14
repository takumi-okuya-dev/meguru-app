// US1：callback の拒否条件（research.md R7・R8・R13、contracts/api.md のエラーコード表）
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { accounts, threadsDeletionRequests, threadsRevocations } from "../../src/db/schema";
import { threadsUserHmac } from "../../src/lib/identifier-hash";
import {
  authorizeAndCallback,
  call,
  connectNew,
  createAccountVia,
  db,
  fake,
  makeApp,
  redirectTarget,
  resetDb,
  testEnv,
} from "../helpers/app";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
  await fake.reset();
  await fake.addUser("1001", "takumi");
});

/** 未接続のアカウントを作り、はじめてつなぐ流れを始める（specs/012） */
async function startConnect(user: string) {
  const { accountId } = await createAccountVia(app, user);
  const res = await call(app, "POST", "/api/threads/connect", { user, body: { mode: "connect", accountId } });
  return ((await res.json()) as { authorizeUrl: string }).authorizeUrl;
}

/** 作ったアカウントがつながっていない（未接続のまま） */
async function expectNothingConnected() {
  const rows = await db().select().from(accounts);
  expect(rows.map((a) => a.connectionStatus)).toEqual(rows.map(() => "not_connected"));
}

describe("callback の拒否条件", () => {
  it("別ユーザーが登録済みの Threads アカウントは THREADS_ACCOUNT_TAKEN で、つなごうとしたアカウントは未接続のまま", async () => {
    await connectNew(app, "owner", "1001");
    const { accountId, callbackRes } = await connectNew(app, "other", "1001");
    expect(redirectTarget(callbackRes!).searchParams.get("error")).toBe("THREADS_ACCOUNT_TAKEN");
    const [mine] = await db().select().from(accounts).where(eq(accounts.id, accountId!));
    expect(mine!.connectionStatus).toBe("not_connected");
  });

  it("自分の別のアカウントと同じ Threads アカウントなら、つながず ACCOUNT_ALREADY_REGISTERED（specs/012 FR-022。接続を更新しない）", async () => {
    await connectNew(app, "u1", "1001");
    await db().update(accounts).set({ plan: "multi-account" });
    const [before] = await db().select().from(accounts);
    const { accountId, callbackRes } = await connectNew(app, "u1", "1001");
    const target = redirectTarget(callbackRes!);
    expect(target.searchParams.get("error")).toBe("ACCOUNT_ALREADY_REGISTERED");
    expect(target.searchParams.get("account")).toBe(before!.id);
    expect(target.pathname).toBe(`/accounts/${accountId}/settings`);
    const [after] = await db().select().from(accounts).where(eq(accounts.id, before!.id));
    expect(after!.connectionGeneration).toBe(before!.connectionGeneration);
    const [mine] = await db().select().from(accounts).where(eq(accounts.id, accountId!));
    expect(mine!.connectionStatus).toBe("not_connected");
  });

  it("認可の後に発行された取り消しがあれば THREADS_AUTH_REVOKED で、未接続のまま", async () => {
    const authorizeUrl = await startConnect("u1");
    // callback がリダイレクトを受け取った後に発行された取り消しを、未来時刻で記録しておく
    await db()
      .insert(threadsRevocations)
      .values({
        threadsUserHmac: await threadsUserHmac(testEnv.IDENTIFIER_HASH_KEY, "1001"),
        issuedAt: new Date(Date.now() + 60_000),
        receivedAt: new Date(),
      });
    const res = await authorizeAndCallback(app, authorizeUrl, { fakeUser: "1001" });
    expect(redirectTarget(res).searchParams.get("error")).toBe("THREADS_AUTH_REVOKED");
    await expectNothingConnected();
  });

  it("認可より前に発行された取り消しは拒否の理由にならない", async () => {
    await db()
      .insert(threadsRevocations)
      .values({
        threadsUserHmac: await threadsUserHmac(testEnv.IDENTIFIER_HASH_KEY, "1001"),
        issuedAt: new Date(Date.now() - 60_000),
        receivedAt: new Date(Date.now() - 60_000),
      });
    const { callbackRes } = await connectNew(app, "u1", "1001");
    expect(redirectTarget(callbackRes!).searchParams.get("connected")).toBe("connect");
  });

  it("未完了の削除要求があれば、受付時刻に関係なく THREADS_DATA_DELETION_REQUESTED", async () => {
    await db()
      .insert(threadsDeletionRequests)
      .values({
        confirmationCode: "c1",
        requestFingerprint: "f1",
        threadsUserId: "1001",
        threadsUserHmac: await threadsUserHmac(testEnv.IDENTIFIER_HASH_KEY, "1001"),
        status: "failed",
        receivedAt: new Date(Date.now() - 3600_000),
        lastAttemptedAt: new Date(Date.now() - 3600_000),
      });
    const { callbackRes } = await connectNew(app, "u1", "1001");
    expect(redirectTarget(callbackRes!).searchParams.get("error")).toBe("THREADS_DATA_DELETION_REQUESTED");
    await expectNothingConnected();
  });

  it("認可フローの開始以降に完了した削除要求があれば THREADS_DATA_DELETION_REQUESTED", async () => {
    const authorizeUrl = await startConnect("u1");
    await db()
      .insert(threadsDeletionRequests)
      .values({
        confirmationCode: "c2",
        requestFingerprint: "f2",
        threadsUserId: null,
        threadsUserHmac: await threadsUserHmac(testEnv.IDENTIFIER_HASH_KEY, "1001"),
        status: "completed",
        receivedAt: new Date(Date.now() - 3600_000),
        lastAttemptedAt: new Date(),
        completedAt: new Date(Date.now() + 1000),
      });
    const res = await authorizeAndCallback(app, authorizeUrl, { fakeUser: "1001" });
    expect(redirectTarget(res).searchParams.get("error")).toBe("THREADS_DATA_DELETION_REQUESTED");
  });

  it("認可フローの開始より前に完了した削除要求は拒否の理由にならない", async () => {
    await db()
      .insert(threadsDeletionRequests)
      .values({
        confirmationCode: "c3",
        requestFingerprint: "f3",
        threadsUserId: null,
        threadsUserHmac: await threadsUserHmac(testEnv.IDENTIFIER_HASH_KEY, "1001"),
        status: "completed",
        receivedAt: new Date(Date.now() - 3600_000),
        lastAttemptedAt: new Date(Date.now() - 3600_000),
        completedAt: new Date(Date.now() - 3000_000),
      });
    const { callbackRes } = await connectNew(app, "u1", "1001");
    expect(redirectTarget(callbackRes!).searchParams.get("connected")).toBe("connect");
  });
});
