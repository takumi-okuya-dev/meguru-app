// US3：アカウントの数の上限（specs/024-tester-invite-connect research.md R6・R7、data-model.md 4、FR-018・FR-021・FR-024、T040・T056）
import { beforeEach, describe, expect, it } from "vitest";
import { call, createUserWithAccount, db, insertSubscription, makeApp, resetDb, setBillingExempt, testEnv, setUserLimit, setDefaultLimit } from "../helpers/app";
import { billingEnv } from "../helpers/billing";
import { accounts } from "../../src/db/schema";

const app = makeApp();
const create = (user: string, name: string, env = testEnv) => call(app, "POST", "/api/threads/accounts", { user, body: { name }, env });
const errorOf = async (res: Response) => ((await res.json()) as { error: { code: string; max?: number; details?: string[] } }).error;
const meLimit = async (user: string, env = testEnv) =>
  ((await (await call(app, "GET", "/api/threads/me", { user, env })).json()) as { accountLimit: { max: number | null; used: number } }).accountLimit;

beforeEach(async () => {
  await resetDb();
});

describe("アカウントの数の上限", () => {
  it("既定値（3件）で止まる。未接続も数える。決済OFFの環境でもかかる", async () => {
    for (const n of ["1", "2", "3"]) expect((await create("u1", n)).status).toBe(201);
    const res = await create("u1", "4");
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toMatchObject({ code: "ACCOUNT_LIMIT_REACHED", max: 3 });
    expect(await meLimit("u1")).toEqual({ max: 3, used: 3 });
  });

  it("利用者ごとの値が既定値より優先される", async () => {
    await create("u1", "1");
    await setUserLimit({ clerkUserId: "u1" }, "accounts", 1);
    expect((await create("u1", "2")).status).toBe(409);
    await setUserLimit({ clerkUserId: "u1" }, "accounts", 5);
    for (const n of ["2", "3", "4", "5"]) expect((await create("u1", n)).status).toBe(201);
    expect(await meLimit("u1")).toEqual({ max: 5, used: 5 });
  });

  it("前からの無料体験の1件とは小さい方が効き、details に trial が付く", async () => {
    await createUserWithAccount("old"); // 024の前からいた人（無料体験中）
    const res = await create("old", "2", billingEnv());
    expect(await errorOf(res)).toMatchObject({ code: "ACCOUNT_LIMIT_REACHED", max: 1, details: ["trial"] });
  });

  it("料金なしの印の人・契約中の人にもかかる（上限はMetaアプリを守るためで、料金とは別）", async () => {
    const { userId } = await createUserWithAccount("ex");
    await setBillingExempt(userId, true);
    await setUserLimit({ userId }, "accounts", 2);
    expect((await create("ex", "2", billingEnv())).status).toBe(201);
    expect((await create("ex", "3", billingEnv())).status).toBe(409);

    const sub = await createUserWithAccount("sub");
    await insertSubscription(sub.userId, { status: "active" });
    await setUserLimit({ userId: sub.userId }, "accounts", 1);
    expect(await errorOf(await create("sub", "2", billingEnv()))).toMatchObject({ code: "ACCOUNT_LIMIT_REACHED", max: 1 });
  });

  it("運営者にはかからない（招待制がOFFの環境でも。FR-024）", async () => {
    const env = { ...billingEnv(), OPERATOR_CLERK_USER_IDS: "op1" };
    for (const n of ["1", "2", "3", "4", "5"]) expect((await create("op1", n, env)).status).toBe(201);
    expect(await meLimit("op1", env)).toEqual({ max: null, used: 5 });
  });

  it("同時に10件作っても、上限を超えない", async () => {
    await create("u1", "0");
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => create("u1", `p${i}`)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(await db().select().from(accounts)).toHaveLength(3);
  });

  it("上限を下げても、今あるアカウントは残る（FR-021）", async () => {
    for (const n of ["1", "2", "3"]) await create("u1", n);
    await setDefaultLimit("accounts", 1);
    expect(await db().select().from(accounts)).toHaveLength(3);
    expect(await meLimit("u1")).toEqual({ max: 1, used: 3 });
    expect((await create("u1", "4")).status).toBe(409);
  });
});
