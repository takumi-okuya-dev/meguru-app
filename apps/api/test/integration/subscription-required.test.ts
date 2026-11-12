// US6：契約前の人（無料体験なし）の止め方（specs/024-tester-invite-connect research.md R9、contracts/api.md「認証のミドルウェア」、T028）
import { neon } from "@neondatabase/serverless";
import { beforeEach, describe, expect, it } from "vitest";
import { call, insertSubscription, makeApp, resetDb, setBillingExempt, testEnv } from "../helpers/app";
import { billingEnv, callBilling } from "../helpers/billing";
import { ensureUser } from "../helpers/team";

const app = makeApp();
const q = () => neon(testEnv.DATABASE_URL);
const codeOf = async (res: Response) => ((await res.json()) as { error?: { code: string } }).error?.code;

beforeEach(async () => {
  await resetDb();
});

/**
 * 024のあとに登録した人（JIT作成。legacy_trial は false）の users.id。
 * @param user - Clerk のユーザーID
 * @returns users.id
 */
async function freshUser(user: string): Promise<string> {
  expect((await callBilling(app, "GET", "/api/me", { user })).status).toBe(200);
  const [row] = (await q()`SELECT id, legacy_trial FROM users WHERE clerk_user_id = ${user}`) as { id: string; legacy_trial: boolean }[];
  expect(row!.legacy_trial).toBe(false);
  return row!.id;
}

describe("新しく登録した人（契約前）", () => {
  it("許す経路は通る：自分・退会の確認・契約と支払い・テスト版の招待・チームの招待の確認", async () => {
    await freshUser("n1");
    for (const [method, path] of [
      ["GET", "/api/me"],
      ["GET", "/api/me/withdrawal-preview"],
      ["GET", "/api/billing"],
    ] as const) {
      const res = await callBilling(app, method, path, { user: "n1" });
      expect(res.status, path).toBe(200);
    }
    // 招待の文字列が違うだけで、契約前で止められてはいない
    expect(await codeOf(await callBilling(app, "GET", "/api/test-invites/g_x", { user: "n1" }))).not.toBe("SUBSCRIPTION_REQUIRED");
    expect(await codeOf(await callBilling(app, "GET", "/api/invites/t_x", { user: "n1" }))).not.toBe("SUBSCRIPTION_REQUIRED");
    // 新しい道筋でも同じ（specs/meguru/029 contracts/api-routes.md 3。PR #100 のセルフレビュー）
    expect(await codeOf(await callBilling(app, "GET", "/api/threads/invites/t_x", { user: "n1" }))).not.toBe("SUBSCRIPTION_REQUIRED");
    expect(await codeOf(await callBilling(app, "POST", "/api/billing/checkout", { user: "n1" }))).not.toBe("SUBSCRIPTION_REQUIRED");
  });

  it("ほかはすべて 403 SUBSCRIPTION_REQUIRED（アカウントを作る・チーム・参加・紹介）", async () => {
    await freshUser("n1");
    for (const [method, path, body] of [
      ["POST", "/api/accounts", { name: "店" }],
      ["POST", "/api/teams", { name: "チーム", accountIds: [] }],
      ["POST", "/api/invites/t_x/accept", { accounts: [] }],
      ["POST", "/api/threads/invites/t_x/accept", { accounts: [] }],
      ["POST", "/api/threads/accounts", { name: "店" }],
      ["GET", "/api/me/referral", undefined],
      ["GET", "/api/me/needs-review-counts", undefined],
    ] as const) {
      const res = await callBilling(app, method, path, { user: "n1", body });
      expect([res.status, await codeOf(res)], path).toEqual([403, "SUBSCRIPTION_REQUIRED"]);
    }
  });

  it("契約すると（active）すぐに使える", async () => {
    const id = await freshUser("n1");
    await insertSubscription(id, { status: "active" });
    expect((await callBilling(app, "POST", "/api/accounts", { user: "n1", body: { name: "店" } })).status).toBe(201);
  });
});

describe("止めない人", () => {
  it("024の前からいた人（無料体験中）", async () => {
    await ensureUser("old");
    expect((await callBilling(app, "POST", "/api/accounts", { user: "old", body: { name: "店" } })).status).toBe(201);
  });

  it("料金なしの印の人", async () => {
    const id = await freshUser("n1");
    await setBillingExempt(id, true);
    expect((await callBilling(app, "POST", "/api/accounts", { user: "n1", body: { name: "店" } })).status).toBe(201);
  });

  it("運営者（招待制がOFFでも。specs/024 FR-023）", async () => {
    const env = billingEnv({ OPERATOR_CLERK_USER_IDS: "op1" });
    expect((await call(app, "POST", "/api/accounts", { user: "op1", body: { name: "店" }, env })).status).toBe(201);
  });

  it("決済がOFFの環境", async () => {
    expect((await call(app, "POST", "/api/accounts", { user: "n1", body: { name: "店" } })).status).toBe(201);
  });
});

describe("判定の順", () => {
  it("退会の途中の人は WITHDRAWAL_IN_PROGRESS が先", async () => {
    await freshUser("n1");
    await q()`UPDATE users SET withdrawal_requested_at = now() WHERE clerk_user_id = 'n1'`;
    const res = await callBilling(app, "POST", "/api/accounts", { user: "n1", body: { name: "店" } });
    expect(await codeOf(res)).toBe("WITHDRAWAL_IN_PROGRESS");
  });

  it("テスト版に入れない人は TEST_ACCESS_REQUIRED が先", async () => {
    const env = billingEnv({ TEST_GROUPS_ENABLED: "true" });
    const res = await call(app, "POST", "/api/accounts", { user: "n1", body: { name: "店" }, env });
    expect(await codeOf(res)).toBe("TEST_ACCESS_REQUIRED");
  });
});
