// アカウントの数の上限（specs/013-billing FR-010〜FR-014・FR-043、SC-001、research.md R9）。決済ONで確かめる。
// 無料体験中（契約なし）は1件まで。契約中・料金なし・決済OFFは上限なし。読むだけなら作れない。
import { beforeEach, describe, expect, it } from "vitest";
import { accounts } from "../../src/db/schema";
import {
  call,
  createUnconnectedAccount,
  createUserWithAccount,
  db,
  endTrial,
  insertSubscription,
  makeApp,
  resetDb,
  setBillingExempt,
} from "../helpers/app";
import { callBilling } from "../helpers/billing";
import { ensureUser, putInTeam } from "../helpers/team";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
});

const create = (user: string, name = "アカウント") => callBilling(app, "POST", "/api/threads/accounts", { user, body: { name } });

async function errorOf(res: Response) {
  return ((await res.json()) as { error: { code: string; details?: string[]; max?: number } }).error;
}

async function meLimit(user: string) {
  const res = await callBilling(app, "GET", "/api/threads/me", { user });
  return ((await res.json()) as { accountLimit: { max: number | null; used: number } }).accountLimit;
}

describe("無料体験中（契約なし）", () => {
  it("未接続のアカウントも数え、2件目は 409 ACCOUNT_LIMIT_REACHED（max: 1）", async () => {
    await createUnconnectedAccount("u1");
    const res = await create("u1");
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toMatchObject({ code: "ACCOUNT_LIMIT_REACHED", max: 1 });
    expect(await meLimit("u1")).toEqual({ max: 1, used: 1 });
  });

  it("並べて2つ送っても、作られるのは1件まで", async () => {
    await ensureUser("u1"); // 024の前からいた人（無料体験中）
    const results = await Promise.all([create("u1", "A"), create("u1", "B")]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await db().select().from(accounts)).toHaveLength(1);
  });

  it("チームで担当しているほかの人のアカウントは数えない", async () => {
    const { accountId } = await createUserWithAccount("o1");
    await putInTeam(accountId, "o1", { admin: "a1", editor: "e1" });
    // e1 は putInTeam で自分のアカウントを1件持つ。担当の o1 のアカウントは数えない
    expect(await meLimit("e1")).toEqual({ max: 1, used: 1 });
  });

  it("このfeatureの前に2件ある人は、今の2件をそのまま使え、3件目は作れない（FR-014）", async () => {
    const a = await createUserWithAccount("u1");
    await createUserWithAccount("u1");
    expect((await create("u1")).status).toBe(409);
    const write = await callBilling(app, "POST", `/api/threads/accounts/${a.accountId}/research-keywords`, { user: "u1", body: { keyword: "x" } });
    expect(write.status).toBe(201);
  });

  it("上限に達していても、未接続のアカウントはつなぎ始められる（アカウントは増えない。specs/012 FR-016）", async () => {
    const { accountId } = await createUnconnectedAccount("u1");
    expect((await create("u1")).status).toBe(409);
    const res = await callBilling(app, "POST", "/api/threads/connect", { user: "u1", body: { mode: "connect", accountId } });
    expect(res.status).toBe(200);
  });
});

describe("契約中・料金なし・決済OFF", () => {
  it.each(["trialing", "active"] as const)("契約が %s なら3件目も作れ、上限は運営者が決める既定値（3件。specs/024 FR-018）", async (status) => {
    const { userId } = await createUserWithAccount("u1");
    await insertSubscription(userId, { status });
    expect((await create("u1", "2")).status).toBe(201);
    expect((await create("u1", "3")).status).toBe(201);
    expect(await meLimit("u1")).toEqual({ max: 3, used: 3 });
    expect((await create("u1", "4")).status).toBe(409);
  });

  it("解約の予約（canceling）でも、期間の終わりまでは作れる", async () => {
    const { userId } = await createUserWithAccount("u1");
    await endTrial(userId);
    await insertSubscription(userId, { status: "active", cancelAtPeriodEnd: true });
    expect((await create("u1")).status).toBe(201);
  });

  it("料金なしの印なら、無料体験の後でも上限なく作れる", async () => {
    const { userId } = await createUserWithAccount("u1");
    await endTrial(userId);
    await setBillingExempt(userId, true);
    expect((await create("u1", "2")).status).toBe(201);
    expect((await create("u1", "3")).status).toBe(201);
  });

  it("決済OFFなら上限なし", async () => {
    await createUserWithAccount("u1");
    expect((await call(app, "POST", "/api/threads/accounts", { user: "u1", body: { name: "2" } })).status).toBe(201);
    expect((await call(app, "POST", "/api/threads/accounts", { user: "u1", body: { name: "3" } })).status).toBe(201);
  });
});

describe("読むだけ", () => {
  it("無料体験の後で契約がなければ 403 BILLING_REQUIRED（trial_ended）で、上限は 0", async () => {
    const { userId } = await createUserWithAccount("u1");
    await endTrial(userId);
    const res = await create("u1");
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toMatchObject({ code: "BILLING_REQUIRED", details: ["trial_ended"] });
    expect(await meLimit("u1")).toEqual({ max: 0, used: 1 });
  });

  it("支払いの失敗なら payment_failed", async () => {
    const { userId } = await createUserWithAccount("u1");
    await insertSubscription(userId, { status: "past_due" });
    expect(await errorOf(await create("u1"))).toMatchObject({ code: "BILLING_REQUIRED", details: ["payment_failed"] });
  });
});
