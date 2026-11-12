// 退会を出来事（user.withdrawn）で伝える（specs/meguru/029-threads-pattern1 tasks.md T017、spec US2-1・US2-2・SC-004）。
// 共通は退会を記録して出来事を書き、Threadsが受け取って片づける。users の行は、片づけが届いたあとで消す（029 tasks.md PR2 の頭）。
import { beforeEach, describe, expect, it } from "vitest";
import { withTransaction } from "../../src/kernel/db/client";
import { deliverPendingEvents } from "../../src/platform";
import { emitEvent } from "../../src/platform/events/events";
import { deleteUserRowIfCleaned, resumeWithdrawals } from "../../src/platform/withdrawal/withdrawal-service";
import { call, createUserWithAccount, fake, fakeClerk, makeApp, resetDb, testEnv } from "../helpers/app";
import { db } from "../helpers/auto-post";
import { billingEnv, callBilling, fakeStripe } from "../helpers/billing";
import { assign, joinTeam, makeTeam } from "../helpers/team";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
  await fake.reset();
  await fakeStripe.reset();
  fakeClerk.reset();
});

const withdraw = (user: string) => callBilling(app, "POST", "/api/me/withdraw", { user, body: { confirmEmail: `${user}@example.com` } });
const rows = async <T>(query: string) => (await db().query(query)) as T[];
const count = async (table: string, where = "true") => Number((await rows<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`))[0]!.n);

describe("退会の出来事（user.withdrawn）", () => {
  it("退会すると出来事が1つ書かれ、Threadsに届いて片づき、そのあとで利用者の行が消える", async () => {
    const o1 = await createUserWithAccount("o1", { name: "A" });
    const { teamId } = await makeTeam("o1", [o1.accountId]);
    const m1 = await createUserWithAccount("m1", { name: "B" });
    await joinTeam(teamId, "m1", [m1.accountId]);
    const userId = (await rows<{ id: string }>(`SELECT id FROM users WHERE clerk_user_id = 'o1'`))[0]!.id;

    expect((await withdraw("o1")).status).toBe(204);

    const events = await rows<{ id: string }>(`SELECT id FROM platform_events WHERE type = 'user.withdrawn' AND payload->>'userId' = '${userId}'`);
    expect(events).toHaveLength(1);
    expect(await count("platform_event_deliveries", `event_id = '${events[0]!.id}' AND consumer = 'threads' AND status = 'done'`)).toBe(1);
    expect(await count("threads_received_events", `event_id = '${events[0]!.id}'`)).toBe(1);
    // 持ち主のアカウントが消え、チームは m1 に引き継がれ、利用者の行も消えた
    expect(await count("accounts", `id = '${o1.accountId}'`)).toBe(0);
    expect(await count("teams", `id = '${teamId}' AND admin_user_id <> '${userId}'`)).toBe(1);
    expect(await count("team_members", `user_id = '${userId}'`)).toBe(0);
    expect(await count("users", `id = '${userId}'`)).toBe(0);
    expect(await count("withdrawn_users", `clerk_user_id = 'o1'`)).toBe(1);
  });

  it("出来事が届くまでは利用者の行を消さず、届いたあとに消す", async () => {
    const o1 = await createUserWithAccount("o1", { name: "A" });
    const userId = (await rows<{ id: string }>(`SELECT id FROM users WHERE clerk_user_id = 'o1'`))[0]!.id;
    await db().query(`UPDATE users SET withdrawal_requested_at = now() WHERE id = $1`, [userId]);
    await withTransaction(testEnv.DATABASE_URL, (tx) => emitEvent(tx, "user.withdrawn", { userId }));

    expect(await deleteUserRowIfCleaned(billingEnv(), userId)).toBe(false);
    expect(await count("users", `id = '${userId}'`)).toBe(1);
    expect(await count("accounts", `id = '${o1.accountId}'`)).toBe(1);

    expect(await deliverPendingEvents(billingEnv())).toEqual({ delivered: 1, failed: 0 });
    expect(await count("accounts", `id = '${o1.accountId}'`)).toBe(0);
    expect(await deleteUserRowIfCleaned(billingEnv(), userId)).toBe(true);
    expect(await count("users", `id = '${userId}'`)).toBe(0);
  });

  it("持ち主が退会したアカウントは、出来事が届く前でも、担当のチームの人に見せない（T030）", async () => {
    const o1 = await createUserWithAccount("o1", { name: "A" });
    const { teamId } = await makeTeam("o1", [o1.accountId]);
    await createUserWithAccount("m1", { name: "B" });
    await joinTeam(teamId, "m1", []);
    await assign(teamId, "m1", o1.accountId);
    expect((await call(app, "GET", `/api/accounts/${o1.accountId}`, { user: "m1" })).status).toBe(200);
    const userId = (await rows<{ id: string }>(`SELECT id FROM users WHERE clerk_user_id = 'o1'`))[0]!.id;
    await db().query(`UPDATE users SET withdrawal_requested_at = now() WHERE id = $1`, [userId]);
    await withTransaction(testEnv.DATABASE_URL, (tx) => emitEvent(tx, "user.withdrawn", { userId }));
    expect((await call(app, "GET", `/api/accounts/${o1.accountId}`, { user: "m1" })).status).toBe(404);
  });

  it("同じ出来事を2回届けても、結果は同じ（2回目は何もしない）", async () => {
    await createUserWithAccount("o1", { name: "A" });
    const other = await createUserWithAccount("o2", { name: "C" });
    const userId = (await rows<{ id: string }>(`SELECT id FROM users WHERE clerk_user_id = 'o1'`))[0]!.id;
    await db().query(`UPDATE users SET withdrawal_requested_at = now() WHERE id = $1`, [userId]);
    const eventId = await withTransaction(testEnv.DATABASE_URL, (tx) => emitEvent(tx, "user.withdrawn", { userId }));
    await deliverPendingEvents(billingEnv());
    // 届けたことを忘れたことにして、もう一度届ける
    await db().query(`UPDATE platform_event_deliveries SET status = 'pending', next_attempt_at = now() - interval '1 minute' WHERE event_id = $1`, [eventId]);
    expect(await deliverPendingEvents(billingEnv())).toEqual({ delivered: 1, failed: 0 });
    expect(await count("threads_received_events", `event_id = '${eventId}'`)).toBe(1);
    expect(await count("accounts", `id = '${other.accountId}'`)).toBe(1);
  });

  it("届けが失敗で止まっても、日次の続きでやり直し、片づいたら利用者の行を消す（契約は止め直さない）", async () => {
    const o1 = await createUserWithAccount("o1", { name: "A" });
    const userId = (await rows<{ id: string }>(`SELECT id FROM users WHERE clerk_user_id = 'o1'`))[0]!.id;
    await db().query(`UPDATE users SET withdrawal_requested_at = now() - interval '2 hours' WHERE id = $1`, [userId]);
    await db().query(`INSERT INTO withdrawn_users (clerk_user_id, withdrawn_at) VALUES ('o1', now())`);
    const eventId = await withTransaction(testEnv.DATABASE_URL, (tx) => emitEvent(tx, "user.withdrawn", { userId }));
    await db().query(`UPDATE platform_event_deliveries SET status = 'failed', attempts = 10 WHERE event_id = $1`, [eventId]);

    await resumeWithdrawals(billingEnv(), (id) => fakeClerk.delete(id));

    expect(await count("platform_event_deliveries", `event_id = '${eventId}' AND status = 'done'`)).toBe(1);
    expect(await count("accounts", `id = '${o1.accountId}'`)).toBe(0);
    expect(await count("users", `id = '${userId}'`)).toBe(0);
    // 出来事は書き足していない（1つのまま）
    expect(await count("platform_events", `type = 'user.withdrawn'`)).toBe(1);
    // 契約は止め直していない（偽のStripeを呼んでいない）
    expect(await fakeStripe.subscriptions()).toEqual([]);
  });

  it("利用者の行が残っている間は、withdrawn_users の記録を消さない（出来事を書き直さない）", async () => {
    await createUserWithAccount("o1", { name: "A" });
    await db().query(`INSERT INTO withdrawn_users (clerk_user_id, withdrawn_at, clerk_deleted_at) VALUES ('o1', now() - interval '3 days', now() - interval '2 days')`);
    await resumeWithdrawals(billingEnv(), (id) => fakeClerk.delete(id));
    expect(await count("withdrawn_users", `clerk_user_id = 'o1'`)).toBe(1);
  });
});
