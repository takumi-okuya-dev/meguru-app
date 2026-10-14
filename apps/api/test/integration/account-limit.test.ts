// US3：プランによる登録数の上限（FR-014〜FR-017、research.md R8・R9）。
// specs/012 で上限の判定はアカウントを作るとき（POST /api/accounts）だけになった。つなぐことではアカウントは増えない（FR-016）。
// 作るときの上限・同時の作成は account-create.test.ts でも確かめる。
import { beforeEach, describe, expect, it } from "vitest";
import { accounts } from "../../src/db/schema";
import { call, connectExisting, connectNew, createAccountVia, db, fake, makeApp, redirectTarget, resetDb } from "../helpers/app";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
  await fake.reset();
  for (let i = 1; i <= 7; i++) await fake.addUser(`100${i}`, `user${i}`);
});

describe("登録数の上限", () => {
  it("プラン1で1件持つユーザーは、2件目を作れず 409 ACCOUNT_LIMIT_REACHED", async () => {
    await connectNew(app, "u1", "1001");
    const { accountId, res } = await createAccountVia(app, "u1");
    expect(accountId).toBeNull();
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("ACCOUNT_LIMIT_REACHED");
  });

  it("multi-account のAccountを持てば5件まで作ってつなげ、2件目以降は最上位プランを引き継ぐ（FR-014〜FR-016）", async () => {
    await connectNew(app, "u1", "1001");
    await db().update(accounts).set({ plan: "multi-account" });
    for (const id of ["1002", "1003", "1004", "1005"]) {
      const { callbackRes } = await connectNew(app, "u1", id);
      expect(redirectTarget(callbackRes!).searchParams.get("connected")).toBe("connect");
    }
    const all = await db().select().from(accounts);
    expect(all).toHaveLength(5);
    expect(all.every((a) => a.plan === "multi-account")).toBe(true);
    expect((await createAccountVia(app, "u1")).res.status).toBe(409);
  });

  it("上限に達した後も、未接続のアカウントはつなげる（アカウントは増えない。specs/012 FR-016）", async () => {
    const { accountId } = await createAccountVia(app, "u1");
    expect((await createAccountVia(app, "u1")).res.status).toBe(409);
    const { callbackRes } = await connectExisting(app, "u1", accountId!, "1001");
    expect(redirectTarget(callbackRes!).searchParams.get("connected")).toBe("connect");
    expect(await db().select().from(accounts)).toHaveLength(1);
  });

  it("GET /api/me の accountLimit は最上位プランから計算し、未接続のアカウントも数える", async () => {
    await connectNew(app, "u1", "1001");
    await db().update(accounts).set({ plan: "multi-account" });
    await createAccountVia(app, "u1");
    const me = (await (await call(app, "GET", "/api/me", { user: "u1" })).json()) as {
      accountLimit: { max: number; used: number };
    };
    expect(me.accountLimit).toEqual({ max: 5, used: 2 });
  });
});
