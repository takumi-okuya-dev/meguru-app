import { beforeEach, expect, it } from "vitest";
import { runDailyJobs } from "../../src/services/daily-jobs";
import { call, fake, makeApp, resetDb, testEnv, authorizeAndCallback } from "../helpers/app";
import { approvedDrafts, connectedAccount, db, jst, run, setSchedule } from "../helpers/auto-post";

beforeEach(async () => {
  await resetDb();
  await fake.reset();
});

it("30日より前の試みだけを消し、持ち越しの参照も外す", async () => {
  const { accountId } = await connectedAccount("u1");
  const [old] =
    await db()`INSERT INTO publish_attempts (account_id, slot_at, slot_date, slot_minute, state, skip_reason) VALUES (${accountId}, '2030-01-01T03:00:00Z', '2030-01-01', 720, 'skipped', 'no_drafts') RETURNING id`;
  await db()`INSERT INTO publish_attempts (account_id, slot_at, slot_date, slot_minute, state, skip_reason) VALUES (${accountId}, '2030-01-02T03:00:00Z', '2030-01-02', 720, 'skipped', 'no_drafts')`;
  const [id] = await approvedDrafts(accountId, ["持ち越し"]);
  await db()`UPDATE post_drafts SET carryover_attempt_id = ${old!.id as string} WHERE id = ${id!}`;
  await runDailyJobs(testEnv, jst("2030-02-01 00:00"));
  expect(await db()`SELECT slot_date FROM publish_attempts`).toMatchObject([
    { slot_date: "2030-01-02" },
  ]);
  expect(await db()`SELECT carryover_attempt_id FROM post_drafts WHERE id = ${id!}`).toMatchObject([
    { carryover_attempt_id: null },
  ]);
});

it("再接続でeffective_fromを進め、版を変えずに過去の時刻を拾わない", async () => {
  const app = makeApp();
  const { accountId, threadsUserId } = await connectedAccount("u1", app);
  await approvedDrafts(accountId, ["過去の時刻"]);
  const before = new Date(Date.now() - 60_000);
  const minute = Math.floor(((before.getTime() + 9 * 3600_000) % 86_400_000) / 60_000);
  await setSchedule(accountId, { slotMinutes: [minute] });
  await db()`UPDATE accounts SET connection_status = 'needs_reconnect' WHERE id = ${accountId}`;
  const response = await call(app, "POST", "/api/threads/connect", {
    user: "u1",
    body: { mode: "reconnect", accountId },
  });
  const { authorizeUrl } = (await response.json()) as { authorizeUrl: string };
  expect((await authorizeAndCallback(app, authorizeUrl, { fakeUser: threadsUserId })).status).toBe(
    302,
  );
  const [row] =
    await db()`SELECT effective_from, version FROM posting_schedules WHERE account_id = ${accountId}`;
  expect(new Date(row!.effective_from as string).getTime()).toBeGreaterThan(before.getTime());
  expect(row!.version).toBe(1);
  await run(new Date());
  expect(await fake.posts()).toHaveLength(0);
});
