// US4：トークンの定期更新と競合制御（FR-018・FR-021、research.md R6）
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { accounts, threadsConnections } from "../../src/db/schema";
import { createThreadsClient } from "../../src/adapters/threads-api/threads-client";
import { handleUninstall } from "../../src/apps/threads/connection/revocation";
import { refreshExpiringTokens, refreshOne, selectRefreshCandidates } from "../../src/apps/threads/connection/token-refresh";
import { authorizeAndCallback, call, connectNew, db, fake, makeApp, resetDb, testEnv } from "../helpers/app";

const app = makeApp();
const DAY = 24 * 3600_000;

beforeEach(async () => {
  await resetDb();
  await fake.reset();
  await fake.addUser("1001", "takumi");
});

/** 接続を「期限まで7日を切り、発行から24時間以上経った」状態にする */
async function makeExpiring() {
  await db()
    .update(threadsConnections)
    .set({ expiresAt: new Date(Date.now() + 3 * DAY), issuedAt: new Date(Date.now() - 2 * DAY) });
}

async function reconnect(user: string, accountId: string) {
  const res = await call(app, "POST", "/api/threads/connect", { user, body: { mode: "reconnect", accountId } });
  const { authorizeUrl } = (await res.json()) as { authorizeUrl: string };
  await authorizeAndCallback(app, authorizeUrl, { fakeUser: "1001" });
}

describe("日次のトークン更新", () => {
  it("期限まで7日を切った接続は更新され、IVと期限が新しくなる", async () => {
    await connectNew(app, "u1", "1001");
    await makeExpiring();
    const [before] = await db().select().from(threadsConnections);
    const result = await refreshExpiringTokens(testEnv, createThreadsClient(testEnv), new Date());
    expect(result.refreshed).toBe(1);
    const [after] = await db().select().from(threadsConnections);
    expect(after!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 59 * DAY);
    expect(Buffer.from(after!.accessTokenIv).equals(Buffer.from(before!.accessTokenIv))).toBe(false);
    expect(after!.authorizedAt.getTime()).toBe(before!.authorizedAt.getTime());
  });

  it("発行から24時間経っていない接続は更新しない", async () => {
    await connectNew(app, "u1", "1001");
    await db().update(threadsConnections).set({ expiresAt: new Date(Date.now() + 3 * DAY) });
    const result = await refreshExpiringTokens(testEnv, createThreadsClient(testEnv), new Date());
    expect(result.refreshed).toBe(0);
  });

  it("更新時に認証エラーなら needs_reconnect", async () => {
    await connectNew(app, "u1", "1001");
    await makeExpiring();
    await fake.invalidate("1001");
    await refreshExpiringTokens(testEnv, createThreadsClient(testEnv), new Date());
    const [a] = await db().select().from(accounts);
    expect(a!.connectionStatus).toBe("needs_reconnect");
  });

  it("期限を過ぎた接続は needs_reconnect", async () => {
    await connectNew(app, "u1", "1001");
    await db().update(threadsConnections).set({ expiresAt: new Date(Date.now() - 1000) });
    await refreshExpiringTokens(testEnv, createThreadsClient(testEnv), new Date());
    const [a] = await db().select().from(accounts);
    expect(a!.connectionStatus).toBe("needs_reconnect");
  });

  it("Cronが読んだ後に再接続されたら、Cronの更新結果も認証エラーも反映されない", async () => {
    await connectNew(app, "u1", "1001");
    await makeExpiring();
    const [a] = await db().select().from(accounts);
    const candidates = await selectRefreshCandidates(testEnv, new Date());
    expect(candidates).toHaveLength(1);
    await reconnect("u1", a!.id);
    const [connAfterReconnect] = await db().select().from(threadsConnections);
    // 古いトークンは無効化しておく：Cronは認証エラーを受けるが、反映してはいけない
    await fake.invalidate("1001");
    await refreshOne(testEnv, createThreadsClient(testEnv), candidates[0]!);
    const [acc] = await db().select().from(accounts);
    expect(acc!.connectionStatus).toBe("connected");
    const [conn] = await db().select().from(threadsConnections);
    expect(Buffer.from(conn!.accessTokenCiphertext).equals(Buffer.from(connAfterReconnect!.accessTokenCiphertext))).toBe(true);
  });

  it("Cronが読んだ後に、アンインストールで接続行が消え再接続で作り直されても、Cronの結果は反映されない（ABA）", async () => {
    await connectNew(app, "u1", "1001");
    await makeExpiring();
    const [a] = await db().select().from(accounts);
    const candidates = await selectRefreshCandidates(testEnv, new Date());
    await handleUninstall(testEnv, createThreadsClient(testEnv), { userId: "1001", issuedAt: new Date() }, new Date());
    expect(await db().select().from(threadsConnections)).toHaveLength(0);
    // 少し待ってから再接続（authorized_at がアンインストールより後になるように）
    await new Promise((r) => setTimeout(r, 5));
    await reconnect("u1", a!.id);
    const [connAfter] = await db().select().from(threadsConnections);
    await refreshOne(testEnv, createThreadsClient(testEnv), candidates[0]!);
    const [conn] = await db().select().from(threadsConnections);
    expect(Buffer.from(conn!.accessTokenCiphertext).equals(Buffer.from(connAfter!.accessTokenCiphertext))).toBe(true);
    const [acc] = await db().select().from(accounts).where(eq(accounts.id, a!.id));
    expect(acc!.connectionStatus).toBe("connected");
  });
});
