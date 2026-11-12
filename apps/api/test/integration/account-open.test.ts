// US2：POST /api/threads/accounts/:id/open（FR-007・FR-018、SC-004・SC-007、research.md R10・R14）
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { accounts, users } from "../../src/db/schema";
import { openAccount } from "../../src/apps/threads/accounts/account-service";
import { call, connectNew, db, fake, makeApp, resetDb, testEnv } from "../helpers/app";

const app = makeApp();

type Me = { landingAccountId: string | null; accounts: { id: string; connectionStatus: string }[] };

async function me(user: string) {
  return (await (await call(app, "GET", "/api/threads/me", { user })).json()) as Me;
}

async function twoAccounts(user: string) {
  await connectNew(app, user, "1001");
  await connectNew(app, user, "1002");
  const rows = await db().select().from(accounts);
  const a = rows.find((r) => r.threadsUserId === "1001")!;
  const b = rows.find((r) => r.threadsUserId === "1002")!;
  const [u] = await db().select().from(users).where(eq(users.clerkUserId, user));
  return { a, b, userId: u!.id };
}

beforeEach(async () => {
  await resetDb();
  await fake.reset();
  await fake.addUser("1001", "takumi");
  await fake.addUser("1002", "ai_bu");
});

describe("POST /api/threads/accounts/:id/open", () => {
  it("開いたAccountが landingAccountId になり、最新の AccountSummary を返す", async () => {
    const { a, b } = await twoAccounts("u1");
    const res = await call(app, "POST", `/api/threads/accounts/${a.id}/open`, { user: "u1", body: { clientId: "p1", openSeq: 1 } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { id: string }).id).toBe(a.id);
    expect((await me("u1")).landingAccountId).toBe(a.id);
    await call(app, "POST", `/api/threads/accounts/${b.id}/open`, { user: "u1", body: { clientId: "p1", openSeq: 2 } });
    expect((await me("u1")).landingAccountId).toBe(b.id);
  });

  it("同じ clientId で古い openSeq のリクエストは記録を変えない（遅れて届いた再試行）", async () => {
    const { a, b } = await twoAccounts("u1");
    await call(app, "POST", `/api/threads/accounts/${b.id}/open`, { user: "u1", body: { clientId: "p1", openSeq: 5 } });
    await call(app, "POST", `/api/threads/accounts/${a.id}/open`, { user: "u1", body: { clientId: "p1", openSeq: 4 } });
    expect((await me("u1")).landingAccountId).toBe(b.id);
  });

  it("clientId が替われば openSeq が小さくても反映される（再読み込み）", async () => {
    const { a, b } = await twoAccounts("u1");
    await call(app, "POST", `/api/threads/accounts/${a.id}/open`, { user: "u1", body: { clientId: "page-1", openSeq: 12 } });
    await call(app, "POST", `/api/threads/accounts/${b.id}/open`, { user: "u1", body: { clientId: "page-2", openSeq: 1 } });
    expect((await me("u1")).landingAccountId).toBe(b.id);
  });

  it("先に受け取ったリクエストが後から完了しても、後で受け取ったBの記録が残る（受信時刻の比較）", async () => {
    const { a, b, userId } = await twoAccounts("u1");
    const t = Date.now();
    // B（後で受け取った）が先に記録され、その後でA（先に受け取った）の処理が完了する
    await openAccount(testEnv, userId, b.id, { clientId: "page-2", openSeq: 1 }, new Date(t + 10));
    await openAccount(testEnv, userId, a.id, { clientId: "page-1", openSeq: 12 }, new Date(t));
    expect((await me("u1")).landingAccountId).toBe(b.id);
  });

  it("トークンが無効なら、そのレスポンスで needs_reconnect になり、GET /api/me にも反映される", async () => {
    const { a } = await twoAccounts("u1");
    await fake.invalidate("1001");
    const res = await call(app, "POST", `/api/threads/accounts/${a.id}/open`, { user: "u1", body: { clientId: "p1", openSeq: 1 } });
    expect(((await res.json()) as { connectionStatus: string }).connectionStatus).toBe("needs_reconnect");
    expect((await me("u1")).accounts.find((x) => x.id === a.id)!.connectionStatus).toBe("needs_reconnect");
  });

  it("認証エラー以外の失敗（Threads側の障害）では状態を変えない", async () => {
    const { a } = await twoAccounts("u1");
    await fake.fail("getProfile", 1, "server");
    const res = await call(app, "POST", `/api/threads/accounts/${a.id}/open`, { user: "u1", body: { clientId: "p1", openSeq: 1 } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { connectionStatus: string }).connectionStatus).toBe("connected");
  });

  it("確認に成功するとプロフィールを最新にする", async () => {
    const { a } = await twoAccounts("u1");
    await fake.addUser("1001", "takumi_renamed", "New Name");
    const res = await call(app, "POST", `/api/threads/accounts/${a.id}/open`, { user: "u1", body: { clientId: "p1", openSeq: 1 } });
    const body = (await res.json()) as { username: string; displayName: string };
    expect(body.username).toBe("takumi_renamed");
    expect(body.displayName).toBe("New Name");
  });

  it("他人のAccountは404", async () => {
    const { a } = await twoAccounts("u1");
    const res = await call(app, "POST", `/api/threads/accounts/${a.id}/open`, { user: "intruder", body: { clientId: "x", openSeq: 1 } });
    expect(res.status).toBe(404);
  });
});
