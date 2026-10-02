// US1：callback の拒否条件（research.md R7・R8・R13、contracts/api.md のエラーコード表）
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { accounts, threadsDeletionRequests, threadsRevocations, users } from "../../src/db/schema";
import { threadsUserHmac } from "../../src/lib/identifier-hash";
import {
  authorizeAndCallback,
  call,
  connectNew,
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

async function startConnect(user: string) {
  const res = await call(app, "POST", "/api/threads/connect", { user, body: { mode: "new" } });
  return ((await res.json()) as { authorizeUrl: string }).authorizeUrl;
}

describe("callback の拒否条件", () => {
  it("別ユーザーが登録済みの Threads アカウントは THREADS_ACCOUNT_TAKEN", async () => {
    await connectNew(app, "owner", "1001");
    const { callbackRes } = await connectNew(app, "other", "1001");
    expect(redirectTarget(callbackRes!).searchParams.get("error")).toBe("THREADS_ACCOUNT_TAKEN");
    expect(await db().select().from(accounts)).toHaveLength(1);
  });

  it("自分の既存Accountと同じ Threads アカウントなら、Accountは増えず接続だけ更新して connected=updated（FR-013）", async () => {
    await connectNew(app, "u1", "1001");
    // 上限1件のプランでは新規の接続を始められないので、上限に余裕のあるプランにしておく
    await db().update(accounts).set({ plan: "multi-account" });
    const [before] = await db().select().from(accounts);
    const { callbackRes } = await connectNew(app, "u1", "1001");
    const target = redirectTarget(callbackRes!);
    expect(target.searchParams.get("connected")).toBe("updated");
    expect(target.pathname).toBe(`/accounts/${before!.id}`);
    const all = await db().select().from(accounts);
    expect(all).toHaveLength(1);
    expect(all[0]!.connectionGeneration).toBe(before!.connectionGeneration + 1);
  });

  it("認可の後に発行された取り消しがあれば THREADS_AUTH_REVOKED（Accountがない場合も）", async () => {
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
    expect(await db().select().from(accounts)).toHaveLength(0);
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
    expect(redirectTarget(callbackRes!).searchParams.get("connected")).toBe("new");
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
    expect(await db().select().from(accounts)).toHaveLength(0);
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
    expect(redirectTarget(callbackRes!).searchParams.get("connected")).toBe("new");
  });

  it("認可フローの開始後に自分のAccountを削除していたら ACCOUNT_DELETED_DURING_CONNECT", async () => {
    // users 行を作るために一度 /api/me を呼ぶ
    await call(app, "GET", "/api/me", { user: "u1" });
    const authorizeUrl = await startConnect("u1");
    await db()
      .update(users)
      .set({ lastAccountDeletedAt: new Date(Date.now() + 1000) })
      .where(eq(users.clerkUserId, "u1"));
    const res = await authorizeAndCallback(app, authorizeUrl, { fakeUser: "1001" });
    expect(redirectTarget(res).searchParams.get("error")).toBe("ACCOUNT_DELETED_DURING_CONNECT");
    expect(await db().select().from(accounts)).toHaveLength(0);
  });
});
