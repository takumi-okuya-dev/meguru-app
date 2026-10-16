// 退会（specs/013-billing FR-050〜FR-056、SC-007、research.md R10、T047）。決済ON・偽のStripe・偽のClerk。
import { emptyStrategyValues } from "@threads-grower/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { resumeWithdrawals } from "../../src/services/withdrawal-service";
import { call, createUserWithAccount, fake, fakeClerk, makeApp, resetDb } from "../helpers/app";
import { connectedAccount, db } from "../helpers/auto-post";
import { billingEnv, callBilling, fakeStripe } from "../helpers/billing";
import { assign, joinTeam, makeTeam } from "../helpers/team";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
  await fake.reset();
  await fakeStripe.reset();
  fakeClerk.reset();
});

/** 契約中にする（偽のCheckoutを終えて読み直す）。 */
async function subscribe(user: string) {
  const { url } = (await (await callBilling(app, "POST", "/api/billing/checkout", { user })).json()) as { url: string };
  await fakeStripe.completeCheckout(url);
  await callBilling(app, "POST", "/api/billing/sync", { user });
}

const withdraw = (user: string, confirmEmail: string) => callBilling(app, "POST", "/api/me/withdraw", { user, body: { confirmEmail } });
const count = async (table: string, where = "true") =>
  Number(((await db().query(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`)) as [{ n: number }])[0].n);
const one = async <T>(query: Promise<unknown>) => ((await query) as T[])[0];

/** 管理者 o1（アカウント A）と、メンバー m1（B）・m2（C）のチーム。o1 は B の担当で、B に記録がある。 */
async function teamSetup() {
  const o1 = await createUserWithAccount("o1", { name: "A" });
  const { teamId } = await makeTeam("o1", [o1.accountId]);
  const m1 = await createUserWithAccount("m1", { name: "B" });
  await joinTeam(teamId, "m1", [m1.accountId]);
  const m2 = await createUserWithAccount("m2", { name: "C" });
  await joinTeam(teamId, "m2", [m2.accountId]);
  await assign(teamId, "o1", m1.accountId);
  // o1 が担当として B の戦略を保存する（B の操作の記録に o1 の名前が残る）
  const res = await call(app, "PUT", `/api/accounts/${m1.accountId}/strategy`, {
    user: "o1",
    body: { ...emptyStrategyValues(), finalAction: "来店", expectedVersion: 0 },
  });
  expect(res.status).toBe(200);
  return { o1, m1, m2, teamId };
}

describe("退会の確認の内容", () => {
  it("消えるアカウント・チームの行き先・契約中かを返す", async () => {
    const { teamId } = await teamSetup();
    await subscribe("o1");
    const res = await callBilling(app, "GET", "/api/me/withdrawal-preview", { user: "o1" });
    expect(await res.json()).toEqual({
      email: "o1@example.com",
      ownedAccounts: [{ id: expect.any(String), name: "A" }],
      teams: [{ id: teamId, name: "o1のチーム", isAdmin: true, outcome: "transfer", nextAdminName: "m1" }],
      hasActiveSubscription: true,
    });
    const member = (await (await callBilling(app, "GET", "/api/me/withdrawal-preview", { user: "m1" })).json()) as { teams: unknown[] };
    expect(member.teams).toEqual([{ id: teamId, name: "o1のチーム", isAdmin: false, outcome: "leave", nextAdminName: null }]);
  });
});

describe("POST /api/me/withdraw", () => {
  it("メールアドレスが違えば 422 で、何も変わらない", async () => {
    await createUserWithAccount("o1");
    for (const email of ["", "other@example.com"]) {
      const res = await withdraw("o1", email);
      expect(res.status).toBe(422);
    }
    expect(await count("users", "clerk_user_id = 'o1' AND withdrawal_requested_at IS NULL")).toBe(1);
  });

  it("契約を止め、管理者を引き継ぎ、アカウント・担当・契約・利用者を消し、記録の名前を「退会した人」にし、Clerkを消す", async () => {
    const { o1, m1, teamId } = await teamSetup();
    await subscribe("o1");
    const res = await withdraw("o1", "  O1@Example.com ");
    expect(res.status).toBe(204);
    expect((await fakeStripe.subscriptions()).map((s) => s.status)).toEqual(["canceled"]);
    expect(await count("accounts", `id = '${o1.accountId}'`)).toBe(0);
    expect(await count("users", "clerk_user_id = 'o1'")).toBe(0);
    expect(await count("subscriptions")).toBe(0);
    expect(await count("memberships", `user_id = '${o1.userId}'`)).toBe(0);
    const team = await one<{ admin_user_id: string }>(db()`SELECT admin_user_id FROM teams WHERE id = ${teamId}`);
    expect(team?.admin_user_id).toBe(m1.userId);
    const logs = (await db()`SELECT actor_name, actor_user_id FROM activity_logs WHERE account_id = ${m1.accountId}`) as {
      actor_name: string;
      actor_user_id: string | null;
    }[];
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.filter((l) => l.actor_user_id === null).map((l) => l.actor_name)).toContain("退会した人");
    expect(logs.some((l) => l.actor_name === "o1")).toBe(false);
    expect(await count("withdrawn_users", "clerk_user_id = 'o1' AND clerk_deleted_at IS NOT NULL")).toBe(1);
    expect(fakeClerk.deleted).toEqual(["o1"]);
  });

  it("ほかに人がいないチームは消える", async () => {
    const o1 = await createUserWithAccount("o1");
    const { teamId } = await makeTeam("o1", [o1.accountId]);
    expect((await withdraw("o1", "o1@example.com")).status).toBe(204);
    expect(await count("teams", `id = '${teamId}'`)).toBe(0);
  });

  it("Threadsのトークンが消え、処理中のデータ削除の求めは完了になる", async () => {
    const { accountId, threadsUserId } = await connectedAccount("o1", app);
    await db()`INSERT INTO threads_deletion_requests (confirmation_code, request_fingerprint, threads_user_id, status, received_at, last_attempted_at)
      VALUES ('code1', 'fp1', ${threadsUserId}, 'pending', now(), now())`;
    expect(await count("threads_connections", `account_id = '${accountId}'`)).toBe(1);
    expect((await withdraw("o1", "o1@example.com")).status).toBe(204);
    expect(await count("threads_connections")).toBe(0);
    const req = await one<{ status: string; threads_user_id: string | null }>(
      db()`SELECT status, threads_user_id FROM threads_deletion_requests WHERE confirmation_code = 'code1'`,
    );
    expect(req).toEqual({ status: "completed", threads_user_id: null });
  });

  it("Stripeが失敗したら 503 で何も消えず、退会の途中になる。ほかのAPIは止まり、もう一度押すと終わる", async () => {
    const { accountId } = await createUserWithAccount("o1");
    await subscribe("o1");
    await fakeStripe.fail("/v1/subscriptions", { method: "GET", status: 500 });
    const res = await withdraw("o1", "o1@example.com");
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("BILLING_UNAVAILABLE");
    expect(await count("accounts", `id = '${accountId}'`)).toBe(1);
    expect(await count("users", "clerk_user_id = 'o1' AND withdrawal_requested_at IS NOT NULL")).toBe(1);
    const blocked = await callBilling(app, "GET", `/api/accounts/${accountId}`, { user: "o1" });
    expect(blocked.status).toBe(409);
    expect(((await blocked.json()) as { error: { code: string } }).error.code).toBe("WITHDRAWAL_IN_PROGRESS");
    const me = (await (await callBilling(app, "GET", "/api/me", { user: "o1" })).json()) as { withdrawalInProgress: boolean };
    expect(me.withdrawalInProgress).toBe(true);
    expect((await callBilling(app, "GET", "/api/me/withdrawal-preview", { user: "o1" })).status).toBe(200);
    expect((await withdraw("o1", "o1@example.com")).status).toBe(204);
    expect(await count("users", "clerk_user_id = 'o1'")).toBe(0);
  });

  it("Clerkの削除が失敗しても 204。日次の処理が消し、25時間後に記録を消す", async () => {
    await createUserWithAccount("o1");
    fakeClerk.fail = true;
    expect((await withdraw("o1", "o1@example.com")).status).toBe(204);
    expect(await count("withdrawn_users", "clerk_deleted_at IS NULL")).toBe(1);
    fakeClerk.fail = false;
    const r1 = await resumeWithdrawals(billingEnv(), (id) => fakeClerk.delete(id));
    expect(r1).toMatchObject({ failed: 0, purged: 0 });
    expect(fakeClerk.deleted).toEqual(["o1"]);
    await db()`UPDATE withdrawn_users SET clerk_deleted_at = now() - interval '26 hours'`;
    expect((await resumeWithdrawals(billingEnv(), (id) => fakeClerk.delete(id))).purged).toBe(1);
    expect(await count("withdrawn_users")).toBe(0);
  });

  it("退会した人のトークンでは users の行が作り直されない（401）", async () => {
    await createUserWithAccount("o1");
    expect((await withdraw("o1", "o1@example.com")).status).toBe(204);
    const res = await callBilling(app, "GET", "/api/me", { user: "o1" });
    expect(res.status).toBe(401);
    expect(await count("users", "clerk_user_id = 'o1'")).toBe(0);
  });

  it("日次の処理が、受け付けから1時間を過ぎた人の退会を終える", async () => {
    await createUserWithAccount("o1");
    await db()`UPDATE users SET withdrawal_requested_at = now() - interval '2 hours' WHERE clerk_user_id = 'o1'`;
    const r = await resumeWithdrawals(billingEnv(), (id) => fakeClerk.delete(id));
    expect(r.finished).toBe(1);
    expect(await count("users", "clerk_user_id = 'o1'")).toBe(0);
  });

  it("契約のない人・決済OFFでも退会できる", async () => {
    await createUserWithAccount("o1");
    expect((await call(app, "POST", "/api/me/withdraw", { user: "o1", body: { confirmEmail: "o1@example.com" } })).status).toBe(204);
    expect(await count("users")).toBe(0);
  });
});
