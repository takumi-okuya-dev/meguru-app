// Threadsの「自分」と利用の数（specs/meguru/029-threads-pattern1 contracts/api-routes.md 2、research.md R6、T018・T020）。
// GET /api/threads/me は、/api/me のThreadsの部分と同じ値を返す（PR5 までは /api/me にも同じ中身が入る）。
// アカウントを作る・消すと、応答の前に利用の数が共通へ伝わる。記録がずれても /api/me・毎日の数え直しで直る。
import { threadsMeResponseSchema } from "@meguru/shared";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { recountThreadsUsage } from "../../src/apps/threads/accounts/usage";
import { appUsage } from "../../src/platform/schema";
import { call, createAccountVia, createUserWithAccount, db, makeApp, resetDb, testEnv } from "../helpers/app";
import { ensureUser, joinTeam, makeTeam } from "../helpers/team";

const app = makeApp();

const THREADS_KEYS = [
  "accounts",
  "landingAccountId",
  "accountLimit",
  "threadsAccessMode",
  "threadsConnectMethods",
  "teams",
  "features",
  "dailyPostLimit",
  "testerInvites",
] as const;

beforeEach(async () => {
  await resetDb();
});

/**
 * 利用の記録を読む。
 * @param userId - users.id
 * @returns 数と使っているか（行がなければ null）
 */
async function usageOf(userId: string) {
  const [row] = await db().select({ quantity: appUsage.quantity, using: appUsage.inUse }).from(appUsage).where(eq(appUsage.userId, userId));
  return row ?? null;
}

describe("GET /api/threads/me", () => {
  it("Threadsの中身を返し、共通の /api/me には Threads の中身がない（PR5c で消した）", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const me = (await (await call(app, "GET", "/api/me", { user: "u1" })).json()) as Record<string, unknown>;
    const res = await call(app, "GET", "/api/threads/me", { user: "u1" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const threads = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(threads).sort()).toEqual([...THREADS_KEYS].sort());
    for (const k of THREADS_KEYS) expect(me).not.toHaveProperty(k);
    // 形は共通の threadsMeResponseSchema（specs/meguru/029 tasks.md T021）
    expect(threadsMeResponseSchema.safeParse(threads).success).toBe(true);
    expect((threads.accounts as { id: string }[]).map((a) => a.id)).toEqual([accountId]);
  });

  it("ログインしていなければ401", async () => {
    expect((await call(app, "GET", "/api/threads/me")).status).toBe(401);
  });

  it("退会の確かめ：/api/threads/me/withdrawal-preview は消えるアカウントと外れるチーム。共通の /api/me/withdrawal-preview は共通の分だけ", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const threads = (await (await call(app, "GET", "/api/threads/me/withdrawal-preview", { user: "u1" })).json()) as Record<string, unknown>;
    expect(threads).toEqual({ ownedAccounts: [{ id: accountId, name: expect.any(String) }], teams: [] });
    const all = (await (await call(app, "GET", "/api/me/withdrawal-preview", { user: "u1" })).json()) as Record<string, unknown>;
    expect(all).toEqual({ email: "u1@example.com", hasActiveSubscription: false });
  });
});

describe("利用の数を共通へ伝える", () => {
  it("アカウントを作る・消すと、応答の前に数が変わる", async () => {
    await call(app, "GET", "/api/me", { user: "u1" });
    const { accountId } = await createAccountVia(app, "u1", "店");
    const { userId } = await createUserWithAccount("u1");
    expect(await usageOf(userId)).toEqual({ quantity: 2, using: true });
    const res = await call(app, "DELETE", `/api/threads/accounts/${accountId}`, { user: "u1", body: { confirmName: "店" } });
    expect(res.status).toBe(204);
    expect(await usageOf(userId)).toEqual({ quantity: 1, using: true });
  });

  it("チームにだけ入っている人は、数0・使っている（/api/threads/me を開くと記録が直る）", async () => {
    const { accountId: adminAcc } = await createUserWithAccount("a1");
    const { teamId } = await makeTeam("a1", [adminAcc]);
    const member = await ensureUser("m1");
    await joinTeam(teamId, "m1", []);
    // 共通の /api/me は Threads を数えない（PR5）。Threads の「自分」を開くと数え直して伝える
    await call(app, "GET", "/api/threads/me", { user: "m1" });
    const me = (await (await call(app, "GET", "/api/me", { user: "m1" })).json()) as { apps: { using: string[] } };
    expect(me.apps.using).toEqual(["threads"]);
    expect(await usageOf(member)).toEqual({ quantity: 0, using: true });
  });

  it("記録がずれても、/api/threads/me を開くと直り、使っているアプリも正しい", async () => {
    const { userId } = await createUserWithAccount("u1");
    await db().update(appUsage).set({ quantity: 0, inUse: false }).where(eq(appUsage.userId, userId));
    await call(app, "GET", "/api/threads/me", { user: "u1" });
    const me = (await (await call(app, "GET", "/api/me", { user: "u1" })).json()) as { apps: { using: string[] } };
    expect(me.apps.using).toEqual(["threads"]);
    expect(await usageOf(userId)).toEqual({ quantity: 1, using: true });
  });

  it("毎日の数え直しで、ずれた数と、もうアカウントのない人の記録を直す", async () => {
    const { userId: a } = await createUserWithAccount("u1");
    const { userId: b, accountId } = await createUserWithAccount("u2");
    await db().update(appUsage).set({ quantity: 5 }).where(eq(appUsage.userId, a));
    await db().execute(`DELETE FROM threads.accounts WHERE id = '${accountId}'` as never);
    expect(await recountThreadsUsage(testEnv)).toBeGreaterThanOrEqual(2);
    expect(await usageOf(a)).toEqual({ quantity: 1, using: true });
    expect(await usageOf(b)).toEqual({ quantity: 0, using: false });
  });
});
