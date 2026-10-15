// 定期処理：自動投稿（specs/005-auto-post contracts/auto-post-job.md、FR-005〜FR-012・FR-017、SC-001〜SC-003・SC-006・SC-008）
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fake, makeApp, resetDb, testEnv } from "../helpers/app";
import { createThreadsClient } from "../../src/lib/threads-client";
import { runAutoPost } from "../../src/services/auto-post-runner";
import {
  addMin,
  approvedDrafts,
  attempts,
  connectedAccount,
  db,
  draftRow,
  jst,
  publishedDrafts,
  run,
  setSchedule,
} from "../helpers/auto-post";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
  await fake.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** console.log に出た構造化ログ（JSON）を集める。 */
function captureLogs() {
  const lines: { level: string; message: string; [k: string]: unknown }[] = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    try {
      lines.push(JSON.parse(String(line)));
    } catch {
      // JSON でない出力は無視する
    }
  });
  return lines;
}

const NOON = jst("2030-01-10 12:00");

describe("US1：時刻になったら、投稿の順の先頭の1件だけを公開する", () => {
  it("承認済み5件で、先頭の1件だけが投稿済みになり、IDとURLと日時が記録される（SC-006）", async () => {
    const { accountId } = await connectedAccount("u1", app);
    const ids = await approvedDrafts(accountId, ["A", "B", "C", "D", "E"]);
    await setSchedule(accountId, { slotMinutes: [720] });

    await run(addMin(NOON, 1));

    const posts = await fake.posts();
    expect(posts.map((p) => p.text)).toEqual(["A"]);
    const a = await draftRow(ids[0]!);
    expect(a).toMatchObject({
      status: "published",
      threads_media_id: posts[0]!.id,
      threads_permalink: posts[0]!.permalink,
    });
    expect(new Date(a.published_at as string).getTime()).toBe(addMin(NOON, 1).getTime());
    for (const id of ids.slice(1)) expect(await draftRow(id)).toMatchObject({ status: "approved" });
    expect((await attempts(accountId)).map((t) => [t.state, t.draft_id])).toEqual([
      ["succeeded", ids[0]],
    ]);
  });

  it("オフなら何もしない。承認済み0件なら skipped（no_drafts）。要確認・却下・投稿に失敗は公開されない（SC-001）", async () => {
    const off = await connectedAccount("u1", app);
    await approvedDrafts(off.accountId, ["OFF"]);
    await setSchedule(off.accountId, { slotMinutes: [720], enabled: false });

    const empty = await connectedAccount("u2", app);
    const ids = await approvedDrafts(empty.accountId, ["N", "R", "F"]);
    await db()`UPDATE post_drafts SET status = 'needs_review', reviewed_at = NULL WHERE id = ${ids[0]!}`;
    await db()`UPDATE post_drafts SET status = 'rejected', reject_note = 'x' WHERE id = ${ids[1]!}`;
    await db()`UPDATE post_drafts SET status = 'publish_failed', publish_failed_at = now(), publish_error = 'network' WHERE id = ${ids[2]!}`;
    await setSchedule(empty.accountId, { slotMinutes: [720] });

    await run(addMin(NOON, 1));

    expect(await fake.posts()).toHaveLength(0);
    expect(await attempts(off.accountId)).toHaveLength(0);
    expect((await attempts(empty.accountId)).map((t) => [t.state, t.skip_reason])).toEqual([
      ["skipped", "no_drafts"],
    ]);
  });

  it("予定から59分後は公開し、61分後は公開しない。2つの時刻が過ぎていても、新しい1つだけ（FR-011）", async () => {
    const a = await connectedAccount("u1", app);
    await approvedDrafts(a.accountId, ["A59"]);
    await setSchedule(a.accountId, { slotMinutes: [720] });
    const b = await connectedAccount("u2", app);
    await approvedDrafts(b.accountId, ["B1", "B2"]);
    await setSchedule(b.accountId, { slotMinutes: [690, 720] });

    await run(addMin(NOON, 59));
    expect((await fake.posts()).map((p) => p.text).sort()).toEqual(["A59", "B1"]);
    expect((await attempts(b.accountId)).map((t) => t.slot_minute)).toEqual([720]);

    const c = await connectedAccount("u3", app);
    await approvedDrafts(c.accountId, ["C61"]);
    await setSchedule(c.accountId, { slotMinutes: [720] });
    await run(addMin(NOON, 61));
    expect((await fake.posts()).map((p) => p.text)).not.toContain("C61");
  });

  it("effective_from より前の予定は、60分以内でも公開しない（FR-012）", async () => {
    const { accountId } = await connectedAccount("u1", app);
    await approvedDrafts(accountId, ["A"]);
    await setSchedule(accountId, { slotMinutes: [720], effectiveFrom: addMin(NOON, 10) });
    await run(addMin(NOON, 30));
    expect(await fake.posts()).toHaveLength(0);
  });

  it("その日の投稿済みが時刻の数に達していれば、daily_limit で飛ばす（SC-008）", async () => {
    const { accountId } = await connectedAccount("u1", app);
    const ids = await approvedDrafts(accountId, ["P1", "P2", "A"]);
    for (const [i, id] of ids.slice(0, 2).entries()) {
      await db()`UPDATE post_drafts SET status = 'published', published_at = ${addMin(NOON, -120 + i).toISOString()} WHERE id = ${id}`;
    }
    // その日のうちに、時刻を2つにした（13:00 を足した）
    await setSchedule(accountId, { slotMinutes: [600, 780] });
    await run(jst("2030-01-10 13:01"));
    expect(await fake.posts()).toHaveLength(0);
    expect((await attempts(accountId)).map((t) => [t.state, t.skip_reason])).toEqual([
      ["skipped", "daily_limit"],
    ]);
  });

  it("定期処理が2つ同時に動いても、公開は1回", async () => {
    const { accountId } = await connectedAccount("u1", app);
    await approvedDrafts(accountId, ["ONCE", "TWICE"]);
    await setSchedule(accountId, { slotMinutes: [720] });
    await Promise.all([run(addMin(NOON, 1)), run(addMin(NOON, 1))]);
    expect((await fake.posts()).map((p) => p.text)).toEqual(["ONCE"]);
  });

  it("1回の処理で最大4件。残りは deferred とログに出し、次の回で公開する", async () => {
    const logs = captureLogs();
    for (let i = 0; i < 5; i++) {
      const { accountId } = await connectedAccount(`u${i}`, app);
      await approvedDrafts(accountId, [`X${i}`]);
      await setSchedule(accountId, { slotMinutes: [720] });
    }
    await run(addMin(NOON, 1));
    expect(await fake.posts()).toHaveLength(4);
    expect(logs.find((l) => l.message === "auto-post: run")).toMatchObject({ deferred: 1 });
    await run(addMin(NOON, 6));
    expect(await fake.posts()).toHaveLength(5);
  });

  it("予定から10分を超えて公開すると warn。60分を過ぎて飛ばした時刻があると warn（SC-004）", async () => {
    const logs = captureLogs();
    const a = await connectedAccount("u1", app);
    await approvedDrafts(a.accountId, ["LATE"]);
    await setSchedule(a.accountId, { slotMinutes: [720] });
    await run(addMin(NOON, 11));
    expect(logs.some((l) => l.level === "warn" && l.message === "auto-post: late publish")).toBe(
      true,
    );

    const b = await connectedAccount("u2", app);
    await approvedDrafts(b.accountId, ["EXPIRED"]);
    await setSchedule(b.accountId, { slotMinutes: [720] });
    await run(addMin(NOON, 61));
    expect(logs.some((l) => l.level === "warn" && l.message === "auto-post: slots expired")).toBe(
      true,
    );
  });

  it("原則I：公開の直前に、その時点のNGワードを含む先頭の下書きは要確認に戻り、次の下書きが公開される", async () => {
    const { accountId } = await connectedAccount("u1", app);
    const ids = await approvedDrafts(accountId, ["絶対に伸びる", "ふつうの投稿"]);
    await db()`INSERT INTO ng_words (account_id, word, normalized) VALUES (${accountId}, '絶対', '絶対')`;
    await setSchedule(accountId, { slotMinutes: [720] });
    await run(addMin(NOON, 1));
    expect((await fake.posts()).map((p) => p.text)).toEqual(["ふつうの投稿"]);
    expect(await draftRow(ids[0]!)).toMatchObject({
      status: "needs_review",
      blocked_reason: "ng_word",
      blocked_words: ["絶対"],
    });
  });
});

describe("US2：公開の直前のチェック", () => {
  it("長すぎる本文とNGワードを続けて戻し、規約の注意だけなら公開する", async () => {
    const { accountId } = await connectedAccount("u1", app);
    const ids = await approvedDrafts(accountId, [
      "あ".repeat(501),
      "禁止語入り",
      "副業のコツを紹介",
    ]);
    await db()`INSERT INTO ng_words (account_id, word, normalized) VALUES (${accountId}, '禁止語', '禁止語')`;
    await setSchedule(accountId, { slotMinutes: [720] });
    await run(addMin(NOON, 1));
    expect(await draftRow(ids[0]!)).toMatchObject({
      status: "needs_review",
      blocked_reason: "over_threads_limit",
      reviewed_at: null,
      prioritized_at: null,
      carryover_attempt_id: null,
    });
    expect(await draftRow(ids[1]!)).toMatchObject({
      status: "needs_review",
      blocked_reason: "ng_word",
    });
    expect((await fake.posts()).map((p) => p.text)).toEqual(["副業のコツを紹介"]);
    expect(await attempts(accountId)).toHaveLength(1);
  });
  it("全件が不適切なら公開せず no_drafts になる", async () => {
    const { accountId } = await connectedAccount("u1", app);
    await approvedDrafts(accountId, ["あ".repeat(501), "い".repeat(501)]);
    await setSchedule(accountId, { slotMinutes: [720] });
    await run(addMin(NOON, 1));
    expect(await fake.posts()).toHaveLength(0);
    expect(await attempts(accountId)).toMatchObject([
      { state: "skipped", skip_reason: "no_drafts" },
    ]);
  });
});

describe("US3：失敗とやり直し", () => {
  it("5分・10分後にやり直し、オフにしても途中の試みを終える", async () => {
    const { accountId } = await connectedAccount("u1", app);
    const [id] = await approvedDrafts(accountId, ["RETRY"]);
    await setSchedule(accountId, { slotMinutes: [720] });
    await fake.publishFail("createContainer", "transient", 2);
    await run(NOON);
    expect(await attempts(accountId)).toMatchObject([{ state: "retry_wait", retry_count: 1 }]);
    await setSchedule(accountId, { slotMinutes: [720], enabled: false });
    await run(addMin(NOON, 4));
    expect(await attempts(accountId)).toMatchObject([{ retry_count: 1 }]);
    await run(addMin(NOON, 5));
    expect(await attempts(accountId)).toMatchObject([{ state: "retry_wait", retry_count: 2 }]);
    await run(addMin(NOON, 15));
    expect(await draftRow(id!)).toMatchObject({ status: "published" });
    expect(await fake.posts()).toHaveLength(1);
  });
  it("次の時刻を待たせ、4回の失敗で持ち越し、次の時刻でも4回失敗すると失敗にする", async () => {
    const { accountId } = await connectedAccount("u1", app);
    const ids = await approvedDrafts(accountId, ["CARRY", "NEXT"]);
    await setSchedule(accountId, { slotMinutes: [720, 730, 780] });
    await fake.publishFail("createContainer", "transient", 8);
    for (const minute of [0, 5, 10, 15]) await run(addMin(NOON, minute));
    expect(await attempts(accountId)).toHaveLength(1);
    await run(addMin(NOON, 30));
    expect(await attempts(accountId)).toMatchObject([
      { state: "carried_over" },
      { state: "retry_wait", is_carryover: true },
    ]);
    for (const minute of [35, 45, 60]) await run(addMin(NOON, minute));
    expect(await draftRow(ids[0]!)).toMatchObject({
      status: "publish_failed",
      publish_error: "threads_server",
      prioritized_at: null,
      carryover_attempt_id: null,
    });
    expect((await fake.posts()).map((p) => p.text)).toEqual(["NEXT"]);
  });
  it("確かな失敗は直ちに失敗になり、認証の失敗は再接続待ちになる", async () => {
    const { accountId } = await connectedAccount("u1", app);
    const ids = await approvedDrafts(accountId, ["INVALID", "AUTH"]);
    await setSchedule(accountId, { slotMinutes: [720, 780] });
    await fake.publishFail("createContainer", "invalid", 1);
    await run(NOON);
    expect(await draftRow(ids[0]!)).toMatchObject({
      status: "publish_failed",
      publish_error: "invalid_request",
    });
    await fake.publishFail("createContainer", "auth", 1);
    await run(addMin(NOON, 60));
    expect(await draftRow(ids[1]!)).toMatchObject({ status: "approved" });
    expect(
      await db()`SELECT connection_status FROM accounts WHERE id = ${accountId}`,
    ).toMatchObject([{ connection_status: "needs_reconnect" }]);
    expect(await attempts(accountId)).toMatchObject([
      { state: "failed" },
      { state: "skipped", skip_reason: "needs_reconnect" },
    ]);
  });
  it("投稿数の上限は今日の残りを止め、翌日の最初の時刻で再開する", async () => {
    const { accountId } = await connectedAccount("u1", app);
    await approvedDrafts(accountId, ["RATE"]);
    await setSchedule(accountId, { slotMinutes: [720, 780] });
    await fake.publishFail("createContainer", "rate_limit", 1);
    await run(NOON);
    const [pause] =
      await db()`SELECT paused_until FROM posting_schedules WHERE account_id = ${accountId}`;
    expect(new Date(pause!.paused_until as string).toISOString()).toBe("2030-01-10T15:00:00.000Z");
    await run(addMin(NOON, 60));
    expect(await fake.posts()).toHaveLength(0);
    await run(addMin(NOON, 1440));
    expect((await fake.posts()).map((p) => p.text)).toEqual(["RATE"]);
  });
});

/** 公開要求を送ったが応答が不明の試みを作る。偽サーバーの実時刻と検索のsinceを合わせる。 */
async function pendingPublish(drop = false) {
  const now = new Date();
  const minute = Math.floor(((now.getTime() + 9 * 3600_000) % 86_400_000) / 60_000);
  const { accountId } = await connectedAccount("u1", app);
  const [id] = await approvedDrafts(accountId, ["ONCE"]);
  await setSchedule(accountId, { slotMinutes: [minute] });
  if (drop) await fake.dropPublishResponse(1);
  else await fake.publishFail("publish", "transient", 1);
  await run(now);
  const [attempt] = await attempts(accountId);
  return { now, accountId, id: id!, attempt: attempt! };
}

describe("US3：公開の結果の確認", () => {
  it("公開済みの応答を失っても、次の回で照合し二重に投稿しない", async () => {
    const { now, id, accountId } = await pendingPublish(true);
    expect(await draftRow(id)).toMatchObject({ status: "publishing" });
    expect(await attempts(accountId)).toMatchObject([
      { state: "in_progress", retry_count: 0, publish_requested_at: expect.any(String) },
    ]);
    await run(addMin(now, 5));
    expect(await draftRow(id)).toMatchObject({
      status: "published",
      threads_media_id: expect.any(String),
    });
    expect(await fake.posts()).toHaveLength(1);
  });
  it("コンテナーだけが記録されていれば同じコンテナーで公開する", async () => {
    const { now, id, attempt } = await pendingPublish();
    await db()`UPDATE publish_attempts SET publish_requested_at = NULL WHERE id = ${attempt.id as string}`;
    await run(addMin(now, 5));
    expect(await draftRow(id)).toMatchObject({ status: "published" });
    expect(await fake.containers()).toHaveLength(1);
    expect(await fake.posts()).toHaveLength(1);
  });
  it.each(["IN_PROGRESS", "EXPIRED", "ERROR"] as const)("%sの結果を安全に扱う", async (state) => {
    const { now, id, attempt, accountId } = await pendingPublish();
    await fake.setContainerStatus(attempt.container_id as string, state);
    await run(addMin(now, 5));
    if (state === "ERROR")
      expect(await draftRow(id)).toMatchObject({
        status: "publish_failed",
        publish_error: "container_error",
      });
    else if (state === "IN_PROGRESS")
      expect(await attempts(accountId)).toMatchObject([{ state: "in_progress", retry_count: 0 }]);
    else {
      expect(await attempts(accountId)).toMatchObject([
        { state: "retry_wait", retry_count: 1, container_id: null },
      ]);
      await run(addMin(now, 10));
      expect(await draftRow(id)).toMatchObject({ status: "published" });
      expect(await fake.containers()).toHaveLength(2);
    }
    expect(await fake.posts()).toHaveLength(state === "EXPIRED" ? 1 : 0);
  });
  it("確認の認証エラーでもpublishingを解かず、再接続を求める", async () => {
    const { now, id, accountId } = await pendingPublish(true);
    await fake.publishFail("containerStatus", "auth", 1);
    await run(addMin(now, 5));
    expect(await draftRow(id)).toMatchObject({ status: "publishing" });
    expect(
      await db()`SELECT connection_status FROM accounts WHERE id = ${accountId}`,
    ).toMatchObject([{ connection_status: "needs_reconnect" }]);
    expect(await fake.posts()).toHaveLength(1);
  });
  it("公開済みだが24時間見つからなければ、IDなしの投稿済みにしログを残す", async () => {
    const logs = captureLogs();
    const { now, id, attempt } = await pendingPublish();
    await fake.setContainerStatus(attempt.container_id as string, "PUBLISHED");
    await run(addMin(now, 1440));
    expect(await draftRow(id)).toMatchObject({ status: "published", threads_media_id: null });
    expect(
      logs.some(
        (l) =>
          l.level === "error" && l.message === "auto-post: published but the post was not found",
      ),
    ).toBe(true);
    expect(await fake.posts()).toHaveLength(0);
  });
});

describe("反応数の段階との関係（specs/006 plan.md「Phase 1の設計後の再確認」）", () => {
  it("反応数の段階が失敗しても、公開の結果に影響しない", async () => {
    const { accountId } = await connectedAccount("u1", app);
    await approvedDrafts(accountId, ["A"]);
    await setSchedule(accountId, { slotMinutes: [720] });
    await publishedDrafts(accountId, [{ publishedAt: addMin(NOON, 1 - 24 * 60) }]);
    // 反応数の書き込みがCHECK制約で失敗する値を返す
    const threads = {
      ...createThreadsClient(testEnv),
      getMediaInsights: async () => ({ views: -1, likes: 0, replies: 0, reposts: 0, quotes: 0, shares: 0 }),
    };
    await testEnv.AUTOPOST_KV.delete("autopost:gate");
    const at = addMin(NOON, 1);
    const r = await runAutoPost(testEnv, at, threads, () => at);
    expect(r.published).toBe(1);
    expect((await fake.posts()).map((p) => p.text)).toEqual(["A"]);
    expect(await db()`SELECT * FROM post_metrics`).toEqual([]);
  });
});
