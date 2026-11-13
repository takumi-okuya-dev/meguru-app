// 退会を出来事（user.withdrawn）で伝える（specs/meguru/029-threads-pattern1 tasks.md T017、spec US2-1・US2-2・SC-004）。
// 共通は退会を記録して出来事を書き、Threadsが受け取って片づける。users の行は、片づけが届いたあとで消す（029 tasks.md PR2 の頭）。
import { beforeEach, describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import { EDITOR_COLUMNS } from "../../src/apps/threads/accounts/withdrawal-cleanup";
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
    expect(await count("threads.received_events", `event_id = '${events[0]!.id}'`)).toBe(1);
    // 持ち主のアカウントが消え、チームは m1 に引き継がれ、利用者の行も消えた
    expect(await count("threads.accounts", `id = '${o1.accountId}'`)).toBe(0);
    expect(await count("threads.teams", `id = '${teamId}' AND admin_user_id <> '${userId}'`)).toBe(1);
    expect(await count("threads.team_members", `user_id = '${userId}'`)).toBe(0);
    expect(await count("users", `id = '${userId}'`)).toBe(0);
    expect(await count("withdrawn_users", `clerk_user_id = 'o1'`)).toBe(1);
  });

  it("外部キーで消えていた行を消し、作った人・直した人の欄を空にする（029 の PR3。research.md R3）", async () => {
    await createUserWithAccount("o1", { name: "A" });
    const m1 = await createUserWithAccount("m1", { name: "B" });
    const userId = (await rows<{ id: string }>(`SELECT id FROM users WHERE clerk_user_id = 'o1'`))[0]!.id;
    // o1 がほかの人（m1）のアカウントで直した記録と、o1 の接続の途中の記録
    await db().query(`UPDATE threads.accounts SET core_rules_updated_by_user_id = $1 WHERE id = $2`, [userId, m1.accountId]);
    await db().query(`INSERT INTO threads.posting_schedules (account_id, slot_minutes, updated_by_user_id) VALUES ($1, '{}', $2)`, [m1.accountId, userId]);
    await db().query(`INSERT INTO threads.token_check_failures (user_id, failed_at, reason) VALUES ($1, now(), 'invalid')`, [userId]);
    await db().query(`INSERT INTO threads.oauth_states (state_hash, user_id, mode, expires_at) VALUES ('h1', $1, 'new', now() + interval '10 minutes')`, [userId]);

    expect((await withdraw("o1")).status).toBe(204);

    expect(await count("threads.accounts", `id = '${m1.accountId}' AND core_rules_updated_by_user_id IS NULL`)).toBe(1);
    expect(await count("threads.posting_schedules", `account_id = '${m1.accountId}' AND updated_by_user_id IS NULL`)).toBe(1);
    expect(await count("threads.token_check_failures", `user_id = '${userId}'`)).toBe(0);
    expect(await count("threads.oauth_states", `user_id = '${userId}'`)).toBe(0);
    expect(await count("users", `id = '${userId}'`)).toBe(0);
  });

  it("Threadsの利用者の番号の列は、すべて退会の片づけで扱う（列を足したときの入れ忘れを知らせる）", async () => {
    // 退会の片づけが行ごと消すか、ほかの処理で扱う列（withdrawal-cleanup.ts・tester-application-service.ts の purgeForWithdrawal）
    const handled = [
      "activity_logs.actor_user_id",
      "memberships.user_id",
      "oauth_states.user_id",
      "team_members.user_id",
      "teams.admin_user_id",
      "tester_applications.user_id",
      "token_check_failures.user_id",
      "user_states.user_id",
    ];
    const editors = EDITOR_COLUMNS.flatMap(({ table, columns }) => columns.map((c) => `${getTableName(table)}.${c.name}`));
    const found = await rows<{ c: string }>(
      `SELECT table_name || '.' || column_name AS c FROM information_schema.columns
       WHERE table_schema = 'threads' AND data_type = 'uuid' AND column_name LIKE '%user_id' ORDER BY 1`,
    );
    expect(found.map((r) => r.c)).toEqual([...handled, ...editors].sort());
  });

  it("出来事が届くまでは利用者の行を消さず、届いたあとに消す", async () => {
    const o1 = await createUserWithAccount("o1", { name: "A" });
    const userId = (await rows<{ id: string }>(`SELECT id FROM users WHERE clerk_user_id = 'o1'`))[0]!.id;
    await db().query(`UPDATE users SET withdrawal_requested_at = now() WHERE id = $1`, [userId]);
    const eventId = await withTransaction(testEnv.DATABASE_URL, (tx) => emitEvent(tx, "user.withdrawn", { userId }));

    expect(await deleteUserRowIfCleaned(billingEnv(), userId)).toBe(false);
    expect(await count("users", `id = '${userId}'`)).toBe(1);
    expect(await count("threads.accounts", `id = '${o1.accountId}'`)).toBe(1);

    // 届け先は、退会を受け取ると登録したアプリの数（Threads・人物メモなど。アプリが増えても数を書き直さない）
    const targets = await count("platform_event_deliveries", `event_id = '${eventId}'`);
    expect(targets).toBeGreaterThanOrEqual(2);
    expect(await deliverPendingEvents(billingEnv())).toEqual({ delivered: targets, failed: 0 });
    expect(await count("threads.accounts", `id = '${o1.accountId}'`)).toBe(0);
    expect(await deleteUserRowIfCleaned(billingEnv(), userId)).toBe(true);
    expect(await count("users", `id = '${userId}'`)).toBe(0);
  });

  it("持ち主が退会したアカウントは、出来事が届く前でも、担当のチームの人に見せない（T030）", async () => {
    const o1 = await createUserWithAccount("o1", { name: "A" });
    const { teamId } = await makeTeam("o1", [o1.accountId]);
    await createUserWithAccount("m1", { name: "B" });
    await joinTeam(teamId, "m1", []);
    await assign(teamId, "m1", o1.accountId);
    expect((await call(app, "GET", `/api/threads/accounts/${o1.accountId}`, { user: "m1" })).status).toBe(200);
    const userId = (await rows<{ id: string }>(`SELECT id FROM users WHERE clerk_user_id = 'o1'`))[0]!.id;
    await db().query(`UPDATE users SET withdrawal_requested_at = now() WHERE id = $1`, [userId]);
    await withTransaction(testEnv.DATABASE_URL, (tx) => emitEvent(tx, "user.withdrawn", { userId }));
    expect((await call(app, "GET", `/api/threads/accounts/${o1.accountId}`, { user: "m1" })).status).toBe(404);
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
    const targets = await count("platform_event_deliveries", `event_id = '${eventId}'`);
    expect(await deliverPendingEvents(billingEnv())).toEqual({ delivered: targets, failed: 0 });
    expect(await count("threads.received_events", `event_id = '${eventId}'`)).toBe(1);
    expect(await count("people.received_events", `event_id = '${eventId}'`)).toBe(1);
    expect(await count("threads.accounts", `id = '${other.accountId}'`)).toBe(1);
  });

  it("届けが失敗で止まっても、日次の続きでやり直し、片づいたら利用者の行を消す（契約は止め直さない）", async () => {
    const o1 = await createUserWithAccount("o1", { name: "A" });
    const userId = (await rows<{ id: string }>(`SELECT id FROM users WHERE clerk_user_id = 'o1'`))[0]!.id;
    await db().query(`UPDATE users SET withdrawal_requested_at = now() - interval '2 hours' WHERE id = $1`, [userId]);
    await db().query(`INSERT INTO withdrawn_users (clerk_user_id, withdrawn_at) VALUES ('o1', now())`);
    const eventId = await withTransaction(testEnv.DATABASE_URL, (tx) => emitEvent(tx, "user.withdrawn", { userId }));
    await db().query(`UPDATE platform_event_deliveries SET status = 'failed', attempts = 10 WHERE event_id = $1`, [eventId]);

    await resumeWithdrawals(billingEnv(), (id) => fakeClerk.delete(id));

    // 登録したアプリの届けがすべて済む
    expect(await count("platform_event_deliveries", `event_id = '${eventId}' AND status = 'done'`)).toBe(await count("platform_event_deliveries", `event_id = '${eventId}'`));
    expect(await count("threads.accounts", `id = '${o1.accountId}'`)).toBe(0);
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
