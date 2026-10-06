import { beforeEach, expect, it } from "vitest";
import { fake, resetDb, call, makeApp } from "../helpers/app";
import {
  addMin,
  approvedDrafts,
  attempts,
  connectedAccount,
  db,
  draftRow,
  jst,
  run,
  setSchedule,
} from "../helpers/auto-post";

beforeEach(async () => {
  await resetDb();
  await fake.reset();
});

it.each(["auth", "transient"] as const)(
  "コンテナーだけを保存した試みで状態確認が%sでも、処理中のまま待つ",
  async (kind) => {
    const now = jst("2030-01-10 12:00");
    const { accountId } = await connectedAccount("u1");
    const [id] = await approvedDrafts(accountId, ["確認待ち"]);
    await setSchedule(accountId, { slotMinutes: [720] });
    await fake.publishFail("publish", "transient", 1);
    await run(now);
    const [attempt] = await attempts(accountId);
    await db()`UPDATE publish_attempts SET publish_requested_at = NULL WHERE id = ${attempt!.id as string}`;
    await fake.publishFail("containerStatus", kind, 1);
    await run(addMin(now, 5));
    expect(await draftRow(id!)).toMatchObject({ status: "publishing" });
    expect(await attempts(accountId)).toMatchObject([{ state: "in_progress", retry_count: 0 }]);
    expect(await fake.posts()).toHaveLength(0);
  },
);

it("直近24時間で250件なら、翌日0時まで止める（今日の件数だけでは数えない）", async () => {
  const { accountId } = await connectedAccount("u1");
  const [id] = await approvedDrafts(accountId, ["待機する下書き"]);
  await setSchedule(accountId, { slotMinutes: [720] });
  await db()`WITH batches AS (
    INSERT INTO draft_batches (account_id, client_request_id, draft_count, delimiter_found)
    SELECT ${accountId}, gen_random_uuid(), 50, true FROM generate_series(1, 5) RETURNING id
  ) INSERT INTO post_drafts (account_id, batch_id, position, body, status, reviewed_at, published_at)
  SELECT ${accountId}, b.id, g, '公開済み', 'published', now(), '2030-01-09T12:00:00Z' FROM batches b CROSS JOIN generate_series(0, 49) g`;
  await run(jst("2030-01-10 12:00"));
  expect(await attempts(accountId)).toMatchObject([
    { state: "skipped", skip_reason: "rate_limited" },
  ]);
  expect(await draftRow(id!)).toMatchObject({ status: "approved" });
  const [schedule] =
    await db()`SELECT paused_until FROM posting_schedules WHERE account_id = ${accountId}`;
  expect(new Date(schedule!.paused_until as string).toISOString()).toBe("2030-01-10T15:00:00.000Z");
  expect(await fake.posts()).toHaveLength(0);
});

it("URLの取得だけが失敗しても、投稿済みを保ち次の回にURLを補う", async () => {
  const now = jst("2030-01-10 12:00");
  const { accountId } = await connectedAccount("u1");
  const [id] = await approvedDrafts(accountId, ["URLを待つ"]);
  await setSchedule(accountId, { slotMinutes: [720] });
  await fake.publishFail("getMedia", "transient", 2);
  await run(now);
  expect(await draftRow(id!)).toMatchObject({ status: "published", threads_permalink: null });
  await run(addMin(now, 5));
  expect(await draftRow(id!)).toMatchObject({
    status: "published",
    threads_permalink: expect.any(String),
  });
  expect(await fake.posts()).toHaveLength(1);
});

it("US2：NGワードの追加と取り出しを同時に実行しても、未確認の承認済みは残らない", async () => {
  const app = makeApp();
  const { accountId } = await connectedAccount("u1", app);
  const [id] = await approvedDrafts(accountId, ["禁止語を含む本文"]);
  await setSchedule(accountId, { slotMinutes: [720] });
  const [added] = await Promise.all([
    call(app, "POST", `/api/accounts/${accountId}/ng-words`, {
      user: "u1",
      body: { words: ["禁止語"] },
    }),
    run(jst("2030-01-10 12:00")),
  ]);
  expect(added.status).toBe(200);
  const row = await draftRow(id!);
  // 取り出しが先ならチェック済みの本文を公開し、追加が先なら要確認に戻す（research R7）。
  expect(["needs_review", "published"]).toContain(row.status);
  expect(await fake.posts()).toHaveLength(row.status === "published" ? 1 : 0);
});

it("US2：要確認が500件でも、直前のチェックで安全に差し戻せる", async () => {
  const { accountId } = await connectedAccount("u1");
  const [id] = await approvedDrafts(accountId, ["あ".repeat(501)]);
  await setSchedule(accountId, { slotMinutes: [720] });
  await db()`WITH batches AS (
    INSERT INTO draft_batches (account_id, client_request_id, draft_count, delimiter_found)
    SELECT ${accountId}, gen_random_uuid(), 50, true FROM generate_series(1, 10) RETURNING id
  ) INSERT INTO post_drafts (account_id, batch_id, position, body)
  SELECT ${accountId}, b.id, g, '未確認' FROM batches b CROSS JOIN generate_series(0, 49) g`;
  await run(jst("2030-01-10 12:00"));
  expect(await draftRow(id!)).toMatchObject({
    status: "needs_review",
    blocked_reason: "over_threads_limit",
  });
  expect(
    await db()`SELECT count(*)::int AS n FROM post_drafts WHERE account_id = ${accountId} AND status = 'needs_review'`,
  ).toMatchObject([{ n: 501 }]);
  expect(await fake.posts()).toHaveLength(0);
});
