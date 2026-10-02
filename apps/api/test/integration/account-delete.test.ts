// US4：Accountの削除（FR-022、research.md R13）
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { accounts, memberships, threadsConnections, users } from "../../src/db/schema";
import { authorizeAndCallback, call, connectNew, db, fake, makeApp, redirectTarget, resetDb } from "../helpers/app";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
  await fake.reset();
  await fake.addUser("1001", "Takumi");
  await fake.addUser("1002", "other");
});

describe("DELETE /api/accounts/:id", () => {
  it("確認入力が違えば 422 CONFIRMATION_MISMATCH で、何も消えない", async () => {
    await connectNew(app, "u1", "1001");
    const [a] = await db().select().from(accounts);
    const res = await call(app, "DELETE", `/api/accounts/${a!.id}`, { user: "u1", body: { confirmUsername: "@wrong" } });
    expect(res.status).toBe(422);
    expect(await db().select().from(accounts)).toHaveLength(1);
  });

  it.each(["@takumi", "takumi", " @Takumi "])("確認入力 %j で、関連行がすべて消え、last_account_deleted_at が記録される", async (input) => {
    await connectNew(app, "u1", "1001");
    const [a] = await db().select().from(accounts);
    await call(app, "POST", `/api/accounts/${a!.id}/open`, { user: "u1", body: { clientId: "p", openSeq: 1 } });
    const res = await call(app, "DELETE", `/api/accounts/${a!.id}`, { user: "u1", body: { confirmUsername: input } });
    expect(res.status).toBe(204);
    expect(await db().select().from(accounts)).toHaveLength(0);
    expect(await db().select().from(memberships)).toHaveLength(0);
    expect(await db().select().from(threadsConnections)).toHaveLength(0);
    const [u] = await db().select().from(users).where(eq(users.clerkUserId, "u1"));
    expect(u!.lastAccountId).toBeNull();
    expect(u!.lastAccountDeletedAt).not.toBeNull();
  });

  it("mode = new の認可の開始後に削除すると、その callback は ACCOUNT_DELETED_DURING_CONNECT で作り直されない", async () => {
    await connectNew(app, "u1", "1001");
    await db().update(accounts).set({ plan: "multi-account" });
    const [a] = await db().select().from(accounts);
    const res = await call(app, "POST", "/api/threads/connect", { user: "u1", body: { mode: "new" } });
    const { authorizeUrl } = (await res.json()) as { authorizeUrl: string };
    await call(app, "DELETE", `/api/accounts/${a!.id}`, { user: "u1", body: { confirmUsername: "takumi" } });
    const cb = await authorizeAndCallback(app, authorizeUrl, { fakeUser: "1001" });
    expect(redirectTarget(cb).searchParams.get("error")).toBe("ACCOUNT_DELETED_DURING_CONNECT");
    expect(await db().select().from(accounts)).toHaveLength(0);
  });

  it("削除の後に始めた認可フローは成功する", async () => {
    await connectNew(app, "u1", "1001");
    const [a] = await db().select().from(accounts);
    await call(app, "DELETE", `/api/accounts/${a!.id}`, { user: "u1", body: { confirmUsername: "takumi" } });
    const { callbackRes } = await connectNew(app, "u1", "1001");
    expect(redirectTarget(callbackRes!).searchParams.get("connected")).toBe("new");
  });

  it("他人のAccountは 404", async () => {
    await connectNew(app, "u1", "1001");
    const [a] = await db().select().from(accounts);
    const res = await call(app, "DELETE", `/api/accounts/${a!.id}`, { user: "intruder", body: { confirmUsername: "takumi" } });
    expect(res.status).toBe(404);
  });
});
