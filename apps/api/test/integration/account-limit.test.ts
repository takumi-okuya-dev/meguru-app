// US3：プランによる登録数の上限（FR-014〜FR-017、research.md R8・R9）
import { beforeEach, describe, expect, it } from "vitest";
import { accounts } from "../../src/db/schema";
import { authorizeAndCallback, call, connectNew, db, fake, makeApp, redirectTarget, resetDb } from "../helpers/app";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
  await fake.reset();
  for (let i = 1; i <= 7; i++) await fake.addUser(`100${i}`, `user${i}`);
});

describe("登録数の上限", () => {
  it("プラン1で1件持つユーザーの mode = new は、認可に進む前に 409 ACCOUNT_LIMIT_REACHED", async () => {
    await connectNew(app, "u1", "1001");
    const res = await call(app, "POST", "/api/threads/connect", { user: "u1", body: { mode: "new" } });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("ACCOUNT_LIMIT_REACHED");
  });

  it("multi-account のAccountを持てば5件まで作れ、2件目以降は最上位プランを引き継ぐ（FR-014〜FR-016）", async () => {
    await connectNew(app, "u1", "1001");
    await db().update(accounts).set({ plan: "multi-account" });
    for (const id of ["1002", "1003", "1004", "1005"]) {
      const { callbackRes } = await connectNew(app, "u1", id);
      expect(redirectTarget(callbackRes!).searchParams.get("connected")).toBe("new");
    }
    const all = await db().select().from(accounts);
    expect(all).toHaveLength(5);
    expect(all.every((a) => a.plan === "multi-account")).toBe(true);
    const sixth = await call(app, "POST", "/api/threads/connect", { user: "u1", body: { mode: "new" } });
    expect(sixth.status).toBe(409);
  });

  it("上限1件のユーザーで2つの callback を同時に処理しても、作られるAccountは1件だけ（FR-017）", async () => {
    // Account 0件のうちに2つの接続フローを始めておく（どちらも事前判定は通る）
    const urls: string[] = [];
    for (let i = 0; i < 2; i++) {
      const res = await call(app, "POST", "/api/threads/connect", { user: "u1", body: { mode: "new" } });
      urls.push(((await res.json()) as { authorizeUrl: string }).authorizeUrl);
    }
    const results = await Promise.all([
      authorizeAndCallback(app, urls[0]!, { fakeUser: "1001" }),
      authorizeAndCallback(app, urls[1]!, { fakeUser: "1002" }),
    ]);
    const outcomes = results.map((r) => {
      const t = redirectTarget(r);
      return t.searchParams.get("connected") ?? t.searchParams.get("error");
    });
    expect(outcomes.sort()).toEqual(["ACCOUNT_LIMIT_REACHED", "new"]);
    expect(await db().select().from(accounts)).toHaveLength(1);
  });

  it("GET /api/me の accountLimit は最上位プランから計算する", async () => {
    await connectNew(app, "u1", "1001");
    await db().update(accounts).set({ plan: "multi-account" });
    const me = (await (await call(app, "GET", "/api/me", { user: "u1" })).json()) as {
      accountLimit: { max: number; used: number };
    };
    expect(me.accountLimit).toEqual({ max: 5, used: 1 });
  });
});
