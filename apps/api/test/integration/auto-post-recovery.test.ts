import { beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../../src/kernel/db/client";
import { createThreadsClient } from "../../src/adapters/threads-api/threads-client";
import { claimSlot } from "../../src/apps/threads/publish/publish-claim";
import { executeAttempt } from "../../src/apps/threads/publish/publish-executor";
import {
  authorizeAndCallback,
  call,
  fake,
  makeApp,
  resetDb,
  testEnv,
} from "../helpers/app";
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

it("直近24時間で250件ならその時刻を飛ばすが止めず、24時間の件数が減った次の時刻で投稿する（PR #6 のCodexレビュー）", async () => {
  const { accountId } = await connectedAccount("u1");
  const [id] = await approvedDrafts(accountId, ["待機する下書き"]);
  // 12:00 と 21:30（日本時間）。250件は前日21:00（日本時間）なので、21:30には24時間の外になる
  await setSchedule(accountId, { slotMinutes: [720, 1290] });
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
  // 自分の記録で数えた上限では、翌日0時まで止めない（contracts/auto-post-job.md 手順3）
  expect(
    await db()`SELECT paused_until FROM posting_schedules WHERE account_id = ${accountId}`,
  ).toMatchObject([{ paused_until: null }]);
  expect(await fake.posts()).toHaveLength(0);
  await run(jst("2030-01-10 21:30"));
  expect(await draftRow(id!)).toMatchObject({ status: "published" });
  expect(await fake.posts()).toHaveLength(1);
});

it("URLの取得だけが失敗しても、投稿済みを保ち次の回にURLを補う", async () => {
  const now = jst("2030-01-10 12:00");
  const { accountId } = await connectedAccount("u1");
  const [id] = await approvedDrafts(accountId, ["URLを待つ"]);
  await setSchedule(accountId, { slotMinutes: [720] });
  // 公開の直後に取れなければ、同じ回では取り直さず、次の回に取り直す
  await fake.publishFail("getMedia", "transient", 1);
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

describe("PR #6 のCodexレビュー", () => {
  it("試みを取った後に要再接続になったら、新しく公開せず承認済みに戻す", async () => {
    const now = jst("2030-01-10 12:00");
    const { accountId } = await connectedAccount("u1");
    const [id] = await approvedDrafts(accountId, ["再接続待ち"]);
    await setSchedule(accountId, { slotMinutes: [720] });
    await fake.publishFail("createContainer", "transient", 1);
    await run(now);
    expect(await attempts(accountId)).toMatchObject([{ state: "retry_wait" }]);
    // トークンは残っていて復号できるが、接続は要再接続
    await db()`UPDATE accounts SET connection_status = 'needs_reconnect' WHERE id = ${accountId}`;
    await run(addMin(now, 5));
    expect(await attempts(accountId)).toMatchObject([
      { state: "skipped", skip_reason: "needs_reconnect", draft_id: null },
    ]);
    expect(await draftRow(id!)).toMatchObject({ status: "approved" });
    expect(await fake.containers()).toHaveLength(0);
    expect(await fake.posts()).toHaveLength(0);
  });

  it("要再接続でも、公開の結果がわからない途中なら確かめて投稿済みにする（新しく公開しない）", async () => {
    // 偽サーバーの投稿の時刻は実時刻なので、実時刻で動かす
    const now = new Date();
    const minute = Math.floor(((now.getTime() + 9 * 3600_000) % 86_400_000) / 60_000);
    const { accountId } = await connectedAccount("u1");
    const [id] = await approvedDrafts(accountId, ["応答を失った投稿"]);
    await setSchedule(accountId, { slotMinutes: [minute] });
    await fake.dropPublishResponse(1);
    await run(now);
    expect(await draftRow(id!)).toMatchObject({ status: "publishing" });
    await db()`UPDATE accounts SET connection_status = 'needs_reconnect' WHERE id = ${accountId}`;
    await run(addMin(now, 5));
    expect(await draftRow(id!)).toMatchObject({ status: "published" });
    expect(await fake.posts()).toHaveLength(1);
  });

  it("定期処理が設定を読んだ後に effective_from が進んだ・時刻が変わった時刻は、取り出さない", async () => {
    const now = jst("2030-01-10 12:05");
    const { accountId } = await connectedAccount("u1");
    const [id] = await approvedDrafts(accountId, ["変更前の時刻"]);
    await setSchedule(accountId, { slotMinutes: [720] });
    // 定期処理が先に求めた時刻（12:00）
    const slot = { slotAt: jst("2030-01-10 12:00"), slotDate: "2030-01-10", slotMinute: 720 };
    // その後、再接続・設定の変更で effective_from が進んだ
    await setSchedule(accountId, { slotMinutes: [720], effectiveFrom: jst("2030-01-10 12:01") });
    expect(await claimSlot(testEnv, accountId, slot, now)).toEqual({ kind: "stale" });
    // 時刻そのものが変わった
    await setSchedule(accountId, { slotMinutes: [780] });
    expect(await claimSlot(testEnv, accountId, slot, now)).toEqual({ kind: "stale" });
    // ずらす設定に変わった（予定の時刻が変わる）
    await setSchedule(accountId, { slotMinutes: [720], jitter: true });
    expect(await claimSlot(testEnv, accountId, slot, now)).toEqual({ kind: "stale" });
    expect(await attempts(accountId)).toHaveLength(0);
    expect(await draftRow(id!)).toMatchObject({ status: "approved" });
    // 設定が元のままなら取り出す
    await setSchedule(accountId, { slotMinutes: [720] });
    expect(await claimSlot(testEnv, accountId, slot, now)).toMatchObject({ kind: "claimed" });
  });

  it("投稿日時は、Cron の予定時刻ではなく公開の応答を受けた時刻にする", async () => {
    const { accountId } = await connectedAccount("u1");
    const [id] = await approvedDrafts(accountId, ["日付をまたぐ"]);
    await setSchedule(accountId, { slotMinutes: [1435] });
    // 23:56 の回が遅れ、公開の応答を受けたのは翌日の 0:01（日本時間）
    const publishedAt = jst("2030-01-11 00:01");
    await run(jst("2030-01-10 23:56"), { clock: () => publishedAt });
    const row = await draftRow(id!);
    expect(row).toMatchObject({ status: "published" });
    expect(new Date(row.published_at as string).toISOString()).toBe(publishedAt.toISOString());
    const [attempt] = await attempts(accountId);
    expect(new Date(attempt!.publish_requested_at as string).toISOString()).toBe(
      publishedAt.toISOString(),
    );
  });

  it("応答を失った投稿の照合で、公開を送る前の同じ本文の投稿（手動の投稿）を選ばない", async () => {
    const now = new Date();
    const minute = Math.floor(((now.getTime() + 9 * 3600_000) % 86_400_000) / 60_000);
    const { accountId, threadsUserId } = await connectedAccount("u1");
    const [id] = await approvedDrafts(accountId, ["同じ本文"]);
    await setSchedule(accountId, { slotMinutes: [minute] });
    // 公開を送る2分前に、同じ本文を手動で投稿していた（照合で見る5分の中）
    const manualId = await fake.addPost(threadsUserId, "同じ本文", addMin(now, -2));
    await fake.dropPublishResponse(1);
    await run(now);
    await run(addMin(now, 5));
    const posts = await fake.posts();
    expect(posts).toHaveLength(2);
    const published = posts.find((p) => p.id !== manualId)!;
    expect(await draftRow(id!)).toMatchObject({
      status: "published",
      threads_media_id: published.id,
    });
  });

  it("上限で止める期限は、上限の応答を受けた時刻（実際の時刻）の翌日0時にする", async () => {
    const { accountId } = await connectedAccount("u1");
    await approvedDrafts(accountId, ["上限"]);
    await setSchedule(accountId, { slotMinutes: [1435] });
    await fake.publishFail("createContainer", "rate_limit", 1);
    // 23:56 の回が遅れ、上限の応答を受けたのは翌日の 0:01（日本時間）
    await run(jst("2030-01-10 23:56"), { clock: () => jst("2030-01-11 00:01") });
    const [schedule] =
      await db()`SELECT paused_until FROM posting_schedules WHERE account_id = ${accountId}`;
    expect(new Date(schedule!.paused_until as string).toISOString()).toBe(
      jst("2030-01-12 00:00").toISOString(),
    );
  });

  it("URLの取り直しに失敗し続ける投稿があっても、後の投稿のURLを取り直す", async () => {
    const now = jst("2030-01-10 12:00");
    const { accountId, threadsUserId } = await connectedAccount("u1");
    const [bad1, bad2, good] = await approvedDrafts(accountId, ["取れない1", "取れない2", "取れる"]);
    const mediaId = await fake.addPost(threadsUserId, "取れる", addMin(now, -120));
    // 取れない2件のほうが新しい（並び順だけでは、毎回この2件が選ばれる）
    await db()`UPDATE post_drafts SET status = 'published', prioritized_at = NULL, published_at = ${addMin(now, -30).toISOString()},
      threads_media_id = 'missing-' || id WHERE id IN (${bad1!}, ${bad2!})`;
    await db()`UPDATE post_drafts SET status = 'published', prioritized_at = NULL, published_at = ${addMin(now, -120).toISOString()},
      threads_media_id = ${mediaId} WHERE id = ${good!}`;
    await run(now);
    expect(await draftRow(good!)).toMatchObject({ threads_permalink: null });
    expect(await draftRow(bad1!)).toMatchObject({ permalink_checked_at: expect.anything() });
    await run(addMin(now, 5));
    expect(await draftRow(good!)).toMatchObject({ threads_permalink: expect.any(String) });
    expect(await draftRow(bad1!)).toMatchObject({ threads_permalink: null });
  });

  it("試みを取った後に連携が取り消され（接続の行が消え）ても、やり直しにせず承認済みに戻す", async () => {
    const now = jst("2030-01-10 12:00");
    const { accountId } = await connectedAccount("u1");
    const [id] = await approvedDrafts(accountId, ["取り消し"]);
    await setSchedule(accountId, { slotMinutes: [720] });
    await fake.publishFail("createContainer", "transient", 1);
    await run(now);
    expect(await attempts(accountId)).toMatchObject([{ state: "retry_wait", retry_count: 1 }]);
    // 連携の取り消し（revokeConnection）と同じく、接続の行を消して要再接続にする
    await db()`DELETE FROM threads_connections WHERE account_id = ${accountId}`;
    await db()`UPDATE accounts SET connection_status = 'needs_reconnect' WHERE id = ${accountId}`;
    await run(addMin(now, 5));
    expect(await attempts(accountId)).toMatchObject([
      { state: "skipped", skip_reason: "needs_reconnect", draft_id: null },
    ]);
    expect(await draftRow(id!)).toMatchObject({ status: "approved" });
  });

  it("結果を確かめられない試みが4件あっても、毎回の上限を使い切らず、ほかのAccountの時刻を処理する", async () => {
    const now = jst("2030-01-10 12:00");
    const stuck = await connectedAccount("u1");
    const drafts = await approvedDrafts(stuck.accountId, ["a", "b", "c", "d"]);
    for (const [i, draftId] of drafts.entries()) {
      await db()`UPDATE post_drafts SET status = 'publishing', prioritized_at = NULL WHERE id = ${draftId}`;
      // 4時間前に公開を送ったが、結果を確かめられないまま（接続の行が消えている）
      await db()`INSERT INTO publish_attempts (account_id, slot_at, slot_date, slot_minute, state, draft_id, container_id, publish_requested_at, created_at)
        VALUES (${stuck.accountId}, ${addMin(now, -240 - i).toISOString()}, '2030-01-10', ${480 - i}, 'in_progress', ${draftId}, ${`c${i}`},
          ${addMin(now, -240).toISOString()}, ${addMin(now, -240).toISOString()})`;
    }
    await db()`DELETE FROM threads_connections WHERE account_id = ${stuck.accountId}`;
    const other = await connectedAccount("u2");
    const [otherDraft] = await approvedDrafts(other.accountId, ["ほかのAccount"]);
    await setSchedule(other.accountId, { slotMinutes: [720] });

    expect(await run(now)).toMatchObject({ waiting: 4, deferred: 1 });
    // 4時間たった試みは、60分後まで確かめない。次の回はほかのAccountの時刻を処理する
    const r = await run(addMin(now, 5));
    expect(r).toMatchObject({ waiting: 0, published: 1 });
    expect(await draftRow(otherDraft!)).toMatchObject({ status: "published" });
    // 関所は、次に確かめる時刻（60分後）に起こす（処理中の試みがあるだけで毎回起こさない）
    const gate = JSON.parse((await testEnv.AUTOPOST_KV.get("autopost:gate"))!) as { nextCheckAt: string };
    expect(gate.nextCheckAt).toBe(addMin(now, 60).toISOString());
  });

  it("取り消しの後、次の回より前に再接続されても、再接続より前の試みは公開せず承認済みに戻す", async () => {
    const app = makeApp();
    const now = jst("2030-01-10 12:00");
    const { accountId, threadsUserId } = await connectedAccount("u1", app);
    const [id] = await approvedDrafts(accountId, ["再接続前の試み"]);
    await setSchedule(accountId, { slotMinutes: [720] });
    await fake.publishFail("createContainer", "transient", 1);
    await run(now);
    expect(await attempts(accountId)).toMatchObject([{ state: "retry_wait" }]);
    // 連携の取り消し → 次の回より前に再接続
    await db()`DELETE FROM threads_connections WHERE account_id = ${accountId}`;
    await db()`UPDATE accounts SET connection_status = 'needs_reconnect' WHERE id = ${accountId}`;
    const res = await call(app, "POST", "/api/threads/connect", {
      user: "u1",
      body: { mode: "reconnect", accountId },
    });
    const { authorizeUrl } = (await res.json()) as { authorizeUrl: string };
    expect(
      (await authorizeAndCallback(app, authorizeUrl, { fakeUser: threadsUserId })).status,
    ).toBe(302);
    expect(await attempts(accountId)).toMatchObject([
      { state: "skipped", skip_reason: "needs_reconnect", draft_id: null, lease_token: null },
    ]);
    expect(await draftRow(id!)).toMatchObject({ status: "approved" });
    await run(addMin(now, 5));
    expect(await fake.posts()).toHaveLength(0);
  });

  it("持ち時間が切れてほかの処理に取られた古い処理は、コンテナーを記録せず公開も送らない", async () => {
    const now = jst("2030-01-10 12:00");
    const { accountId } = await connectedAccount("u1");
    const [id] = await approvedDrafts(accountId, ["古い処理"]);
    await db()`UPDATE post_drafts SET status = 'publishing', prioritized_at = NULL WHERE id = ${id!}`;
    const token = crypto.randomUUID();
    const [attempt] = await db()`INSERT INTO publish_attempts (account_id, slot_at, slot_date, slot_minute, state, draft_id, lease_until, lease_token)
      VALUES (${accountId}, ${now.toISOString()}, '2030-01-10', 720, 'in_progress', ${id!}, ${addMin(now, 2).toISOString()}, ${token}) RETURNING id`;
    const attemptId = attempt!.id as string;
    const real = createThreadsClient(testEnv);
    // コンテナーを作っている間に処理が止まり、持ち時間が切れて、ほかの処理が新しい札で取った
    const threads = {
      ...real,
      createTextContainer: async (...args: Parameters<typeof real.createTextContainer>) => {
        const r = await real.createTextContainer(...args);
        await db()`UPDATE publish_attempts SET lease_token = gen_random_uuid() WHERE id = ${attemptId}`;
        return r;
      },
    };
    const out = await executeAttempt(testEnv, createDb(testEnv.DATABASE_URL), threads, attemptId, token, now);
    expect(out).toEqual({ kind: "waiting" });
    expect(await fake.posts()).toHaveLength(0);
    expect(await attempts(accountId)).toMatchObject([
      { state: "in_progress", container_id: null, publish_requested_at: null },
    ]);
    expect(await draftRow(id!)).toMatchObject({ status: "publishing" });
    // 札が違えば、最初から何もしない
    expect(
      await executeAttempt(testEnv, createDb(testEnv.DATABASE_URL), real, attemptId, token, now),
    ).toEqual({ kind: "waiting" });
    expect(await fake.containers()).toHaveLength(1);
  });

  it("公開の記録の後に再接続された（片付けから漏れた）試みは、公開を送らず承認済みに戻す", async () => {
    const now = jst("2030-01-10 12:00");
    const { accountId } = await connectedAccount("u1");
    const [id] = await approvedDrafts(accountId, ["記録の後の再接続"]);
    await db()`UPDATE post_drafts SET status = 'publishing', prioritized_at = NULL WHERE id = ${id!}`;
    const real = createThreadsClient(testEnv);
    const { containerId } = await real.createTextContainer(
      (await fake.issuedTokens()).at(-1)!,
      (await db()`SELECT threads_user_id FROM accounts WHERE id = ${accountId}`)[0]!.threads_user_id as string,
      "記録の後の再接続",
    );
    const token = crypto.randomUUID();
    const [attempt] = await db()`INSERT INTO publish_attempts (account_id, slot_at, slot_date, slot_minute, state, draft_id, container_id, lease_until, lease_token, created_at)
      VALUES (${accountId}, ${now.toISOString()}, '2030-01-10', 720, 'in_progress', ${id!}, ${containerId}, ${addMin(now, 2).toISOString()}, ${token}, ${now.toISOString()}) RETURNING id`;
    // コンテナーの状態を確かめた後、公開を送るまでの間に再接続がコミットされた（世代番号が増えた）。
    // 再接続の callback に入った時刻（authorized_at）は、試みを作るより前のまま
    const threads = {
      ...real,
      getContainerStatus: async (...args: Parameters<typeof real.getContainerStatus>) => {
        const r = await real.getContainerStatus(...args);
        await db()`UPDATE accounts SET connection_generation = connection_generation + 1 WHERE id = ${accountId}`;
        await db()`UPDATE threads_connections SET authorized_at = ${addMin(now, -1).toISOString()} WHERE account_id = ${accountId}`;
        return r;
      },
    };
    const out = await executeAttempt(testEnv, createDb(testEnv.DATABASE_URL), threads, attempt!.id as string, token, now);
    expect(out).toEqual({ kind: "skipped", reason: "needs_reconnect" });
    expect(await fake.posts()).toHaveLength(0);
    expect(await attempts(accountId)).toMatchObject([
      { state: "skipped", skip_reason: "needs_reconnect", publish_requested_at: null },
    ]);
    expect(await draftRow(id!)).toMatchObject({ status: "approved" });
  });

  /** 前の時刻で持ち越した下書きを作る（carried_over の試みを参照する）。 */
  async function carriedDraft(accountId: string, body: string) {
    const [id] = await approvedDrafts(accountId, [body]);
    const [carried] = await db()`INSERT INTO publish_attempts (account_id, slot_at, slot_date, slot_minute, state, last_error, retry_count)
      VALUES (${accountId}, ${jst("2030-01-10 07:30").toISOString()}, '2030-01-10', 450, 'carried_over', 'threads_server', 3) RETURNING id`;
    await db()`UPDATE post_drafts SET carryover_attempt_id = ${carried!.id as string} WHERE id = ${id!}`;
    return id!;
  }

  it("持ち越しの試みを認証の失敗で承認済みに戻すとき、持ち越しの印を付け直す", async () => {
    const now = jst("2030-01-10 12:00");
    const { accountId } = await connectedAccount("u1");
    const id = await carriedDraft(accountId, "持ち越し・認証");
    await setSchedule(accountId, { slotMinutes: [450, 720] });
    await fake.publishFail("createContainer", "auth", 1);
    await run(now);
    const current = (await attempts(accountId)).find((a) => a.slot_minute === 720)!;
    expect(current).toMatchObject({ state: "skipped", skip_reason: "needs_reconnect", is_carryover: true });
    expect(await draftRow(id)).toMatchObject({ status: "approved", carryover_attempt_id: current.id });
  });

  it("再接続の片付けで持ち越しの試みを承認済みに戻すとき、持ち越しの印を付け直し、次も持ち越しとして扱う", async () => {
    const app = makeApp();
    const now = jst("2030-01-10 12:00");
    const { accountId, threadsUserId } = await connectedAccount("u1", app);
    const id = await carriedDraft(accountId, "持ち越し・再接続");
    await setSchedule(accountId, { slotMinutes: [450, 720, 1260] });
    await fake.publishFail("createContainer", "transient", 1);
    await run(now);
    expect((await attempts(accountId)).find((a) => a.slot_minute === 720)).toMatchObject({
      state: "retry_wait",
      is_carryover: true,
    });
    await db()`UPDATE accounts SET connection_status = 'needs_reconnect' WHERE id = ${accountId}`;
    const res = await call(app, "POST", "/api/threads/connect", {
      user: "u1",
      body: { mode: "reconnect", accountId },
    });
    const { authorizeUrl } = (await res.json()) as { authorizeUrl: string };
    expect(
      (await authorizeAndCallback(app, authorizeUrl, { fakeUser: threadsUserId })).status,
    ).toBe(302);
    const skipped = (await attempts(accountId)).find((a) => a.slot_minute === 720)!;
    expect(skipped).toMatchObject({ state: "skipped", skip_reason: "needs_reconnect" });
    expect(await draftRow(id)).toMatchObject({ status: "approved", carryover_attempt_id: skipped.id });
    // 再接続の後の次の時刻（21:00）でも、持ち越しとして取り出す
    await setSchedule(accountId, { slotMinutes: [450, 720, 1260] });
    await run(jst("2030-01-10 21:00"));
    expect((await attempts(accountId)).find((a) => a.slot_minute === 1260)).toMatchObject({
      is_carryover: true,
    });
    expect(await draftRow(id)).toMatchObject({ status: "published" });
  });
});
