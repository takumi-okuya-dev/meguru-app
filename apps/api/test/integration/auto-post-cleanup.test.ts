import { beforeEach, expect, it } from "vitest";
import { runDailyJobs } from "../../src/services/daily-jobs";
import { call, fake, makeApp, resetDb, testEnv, authorizeAndCallback } from "../helpers/app";
import { approvedDrafts, connectedAccount, db, jst, run, setSchedule } from "../helpers/auto-post";

beforeEach(async () => {
  await resetDb();
  await fake.reset();
});

it("30日より前の試みだけを消す。持ち越しで下書きが参照している試みは残す（PR #6 のCodexレビュー）", async () => {
  const { accountId } = await connectedAccount("u1");
  const [carried] =
    await db()`INSERT INTO publish_attempts (account_id, slot_at, slot_date, slot_minute, state, last_error) VALUES (${accountId}, '2030-01-01T03:00:00Z', '2030-01-01', 720, 'carried_over', 'threads_server') RETURNING id`;
  await db()`INSERT INTO publish_attempts (account_id, slot_at, slot_date, slot_minute, state, skip_reason) VALUES (${accountId}, '2030-01-01T04:00:00Z', '2030-01-01', 780, 'skipped', 'no_drafts')`;
  await db()`INSERT INTO publish_attempts (account_id, slot_at, slot_date, slot_minute, state, skip_reason) VALUES (${accountId}, '2030-01-02T03:00:00Z', '2030-01-02', 720, 'skipped', 'no_drafts')`;
  const [id] = await approvedDrafts(accountId, ["持ち越し"]);
  await db()`UPDATE post_drafts SET carryover_attempt_id = ${carried!.id as string} WHERE id = ${id!}`;
  await runDailyJobs(testEnv, jst("2030-02-01 00:00"));
  // 参照されていない古い試み（2030-01-01 の skipped）だけが消える
  expect(
    await db()`SELECT slot_date, state FROM publish_attempts ORDER BY slot_at`,
  ).toMatchObject([
    { slot_date: "2030-01-01", state: "carried_over" },
    { slot_date: "2030-01-02", state: "skipped" },
  ]);
  expect(await db()`SELECT carryover_attempt_id FROM post_drafts WHERE id = ${id!}`).toMatchObject([
    { carryover_attempt_id: carried!.id },
  ]);
});

it("30日より前でも、処理中・やり直し待ちの試みは消さない（PR #6 のCodexレビュー）", async () => {
  const { accountId } = await connectedAccount("u1");
  const [inProgress, retryWait] = await approvedDrafts(accountId, ["確認待ち", "やり直し待ち"]);
  await db()`UPDATE post_drafts SET status = 'publishing' WHERE id IN (${inProgress!}, ${retryWait!})`;
  await db()`INSERT INTO publish_attempts (account_id, slot_at, slot_date, slot_minute, state, draft_id, publish_requested_at)
    VALUES (${accountId}, '2030-01-01T03:00:00Z', '2030-01-01', 720, 'in_progress', ${inProgress!}, '2030-01-01T03:00:00Z')`;
  await db()`INSERT INTO publish_attempts (account_id, slot_at, slot_date, slot_minute, state, draft_id, next_retry_at, retry_count)
    VALUES (${accountId}, '2030-01-01T04:00:00Z', '2030-01-01', 780, 'retry_wait', ${retryWait!}, '2030-01-01T04:05:00Z', 1)`;
  await runDailyJobs(testEnv, jst("2030-02-01 00:00"));
  expect(
    await db()`SELECT state FROM publish_attempts WHERE account_id = ${accountId} ORDER BY slot_at`,
  ).toMatchObject([{ state: "in_progress" }, { state: "retry_wait" }]);
});

it("過ぎた paused_until だけを消し、設定の版は変えない（PR #6 のCodexレビュー）", async () => {
  const { accountId: past } = await connectedAccount("u1");
  const { accountId: future } = await connectedAccount("u2");
  await setSchedule(past, { slotMinutes: [720], pausedUntil: jst("2030-01-20 00:00") });
  await setSchedule(future, { slotMinutes: [720], pausedUntil: jst("2030-02-02 00:00") });
  await runDailyJobs(testEnv, jst("2030-02-01 03:00"));
  const rows = await db()`SELECT account_id, paused_until, version FROM posting_schedules`;
  const byId = new Map(rows.map((r) => [r.account_id as string, r]));
  expect(byId.get(past)).toMatchObject({ paused_until: null, version: 1 });
  expect(new Date(byId.get(future)!.paused_until as string).toISOString()).toBe(
    jst("2030-02-02 00:00").toISOString(),
  );
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
