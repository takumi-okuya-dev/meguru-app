// US1：GET /api/me（FR-004・FR-005、research.md R2・R10）
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { users } from "../../src/db/schema";
import { call, connectNew, db, fake, makeApp, resetDb } from "../helpers/app";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
  await fake.reset();
  await fake.addUser("1001", "takumi");
});

type Me = {
  user: { id: string; email: string };
  accounts: { id: string }[];
  landingAccountId: string | null;
  accountLimit: { max: number; used: number };
};

describe("GET /api/me", () => {
  it("Clerkの新しいユーザーで呼ぶと users 行が作られ、Accountが0件なら landingAccountId は null", async () => {
    const res = await call(app, "GET", "/api/me", { user: "new-user" });
    expect(res.status).toBe(200);
    const me = (await res.json()) as Me;
    expect(me.landingAccountId).toBeNull();
    expect(me.accounts).toEqual([]);
    expect(me.accountLimit).toEqual({ max: 1, used: 0 });
    const rows = await db().select().from(users).where(eq(users.clerkUserId, "new-user"));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.email).toBe("new-user@example.com");
  });

  it("Accountを登録した後は、そのAccountが landingAccountId になる", async () => {
    await connectNew(app, "u1", "1001");
    const me = (await (await call(app, "GET", "/api/me", { user: "u1" })).json()) as Me;
    expect(me.accounts).toHaveLength(1);
    expect(me.landingAccountId).toBe(me.accounts[0]!.id);
    expect(me.accountLimit).toEqual({ max: 1, used: 1 });
  });

  it("ブラウザのキャッシュに残さない（Cache-Control: no-store）", async () => {
    const res = await call(app, "GET", "/api/me", { user: "u1" });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("未ログインなら 401", async () => {
    expect((await call(app, "GET", "/api/me")).status).toBe(401);
  });
});
