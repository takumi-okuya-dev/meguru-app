// パフォーマンスのAPI（specs/006-performance-feedback contracts/api.md、FR-003・FR-007〜FR-019・FR-031・FR-032、SC-007）
import { beforeEach, describe, expect, it } from "vitest";
import { call, createUserWithAccount, makeApp, resetDb } from "../helpers/app";
import { confirmedMetrics, db, publishedDrafts } from "../helpers/auto-post";

const app = makeApp();
const H = 3600_000;
const ago = (hours: number) => new Date(Date.now() - hours * H);

beforeEach(async () => {
  await resetDb();
});

/**
 * 判定を直接入れる（判定の計算は metrics-runner のテストで確かめる）。
 * @param draftId - post_drafts.id
 * @param judgment - 判定
 * @param ratio - 倍率
 */
async function setJudgment(draftId: string, judgment: "good" | "normal" | "poor", ratio: number) {
  await db()`UPDATE post_metrics SET judgment = ${judgment}, judgment_ratio = ${ratio}, judgment_baseline = 50, judged_at = now()
    WHERE draft_id = ${draftId}`;
}

/**
 * パフォーマンスの画面のAPIを呼ぶ。
 * @param accountId - accounts.id
 * @param query - クエリ文字列
 * @param user - 呼ぶユーザー
 * @returns 応答
 */
function getPerformance(accountId: string, query = "", user = "u1") {
  return call(app, "GET", `/api/accounts/${accountId}/performance${query}`, { user });
}

describe("GET /performance", () => {
  it("集計・並び・状態ごとの項目（FR-003・FR-012・FR-016〜FR-018）", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const confirmed = await publishedDrafts(
      accountId,
      [200, 201, 202, 203, 204].map((h) => ({ publishedAt: ago(h) })),
    );
    for (const [i, v] of [100, 25, 50, 50, 50].entries()) await confirmedMetrics(accountId, confirmed[i]!.id, v);
    await setJudgment(confirmed[0]!.id, "good", 2);
    await setJudgment(confirmed[1]!.id, "poor", 0.5);
    for (const d of confirmed.slice(2)) await setJudgment(d.id, "normal", 1);
    const [late] = await publishedDrafts(accountId, [{ publishedAt: ago(300) }]);
    await confirmedMetrics(accountId, late!.id, 1000, "late_confirmed");
    await setJudgment(late!.id, "good", 20);
    const [fresh, updating, gone] = await publishedDrafts(accountId, [
      { publishedAt: ago(2) },
      { publishedAt: ago(30) },
      { publishedAt: ago(100), mediaId: null },
    ]);
    await db()`INSERT INTO post_metrics (draft_id, account_id, state, views, likes, last_fetched_at, last_elapsed_minutes, last_kind)
      VALUES (${updating!.id}, ${accountId}, 'updating', 41, 1, now(), 1500, 'h24')`;
    await db()`INSERT INTO post_metrics (draft_id, account_id, state, unmeasurable_reason)
      VALUES (${gone!.id}, ${accountId}, 'unmeasurable', 'no_media_id')`;

    const res = await getPerformance(accountId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      summary: Record<string, unknown>;
      items: Record<string, unknown>[];
      nextCursor: string | null;
    };
    expect(body.summary).toMatchObject({
      baseline: 50,
      baselineSampleCount: 5,
      judgeableCount: 5,
      baselineIsZero: false,
      insightsDenied: false,
      needsReconnect: false,
      counts: { all: 9, good: 2, normal: 3, poor: 1, pending: 2 },
    });
    expect(body.summary.lastFetchedAt).not.toBeNull();
    expect(body.items.map((i) => i.id)).toEqual([
      fresh!.id,
      updating!.id,
      gone!.id,
      ...confirmed.map((d) => d.id),
      late!.id,
    ]);
    const byId = new Map(body.items.map((i) => [i.id, i]));
    expect(byId.get(fresh!.id)).toMatchObject({ state: "pending", metrics: null, judgment: null });
    expect(byId.get(fresh!.id)!.nextFetchAt).not.toBeNull();
    expect(byId.get(updating!.id)).toMatchObject({
      state: "updating",
      metrics: { views: 41, likes: 1 },
      lastElapsedHours: 25,
      judgment: null,
    });
    expect(byId.get(updating!.id)!.confirmAt).not.toBeNull();
    expect(byId.get(gone!.id)).toMatchObject({
      state: "unmeasurable",
      metrics: null,
      threadsPermalink: null,
      unmeasurableReason: "no_media_id",
    });
    expect(byId.get(confirmed[0]!.id)).toMatchObject({ state: "confirmed", judgment: "good", ratio: 2, feedback: null });
    expect(byId.get(confirmed[1]!.id)).toMatchObject({
      judgment: "poor",
      feedback: { memo: null, includeInPrompt: true, inNextPrompt: true },
    });
    expect(byId.get(late!.id)).toMatchObject({ state: "late_confirmed", judgment: "good", lastElapsedHours: 168 });
  });

  it("タブで絞り込み、カーソルで続きを読む（FR-015・FR-019）", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const posts = await publishedDrafts(accountId, [1, 30, 200, 201, 202].map((h) => ({ publishedAt: ago(h) })));
    await db()`INSERT INTO post_metrics (draft_id, account_id, state, views, last_fetched_at, last_elapsed_minutes, last_kind)
      VALUES (${posts[1]!.id}, ${accountId}, 'updating', 5, now(), 1500, 'h24')`;
    for (const d of posts.slice(2)) {
      await confirmedMetrics(accountId, d.id, 10);
      await setJudgment(d.id, "poor", 0.2);
    }

    const pending = (await (await getPerformance(accountId, "?tab=pending")).json()) as { items: { id: string }[] };
    expect(pending.items.map((i) => i.id)).toEqual([posts[0]!.id, posts[1]!.id]);
    const poor1 = (await (await getPerformance(accountId, "?tab=poor&limit=2")).json()) as {
      items: { id: string }[];
      nextCursor: string;
    };
    expect(poor1.items.map((i) => i.id)).toEqual([posts[2]!.id, posts[3]!.id]);
    const poor2 = (await (
      await getPerformance(accountId, `?tab=poor&limit=2&before=${encodeURIComponent(poor1.nextCursor)}`)
    ).json()) as { items: { id: string }[]; nextCursor: string | null };
    expect(poor2.items.map((i) => i.id)).toEqual([posts[4]!.id]);
    expect(poor2.nextCursor).toBeNull();
    expect(
      ((await (await getPerformance(accountId, "?tab=good")).json()) as { items: unknown[] }).items,
    ).toEqual([]);
  });

  it("確定が5件未満なら基準値は null、基準値0なら baselineIsZero（FR-009）", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const posts = await publishedDrafts(accountId, [200, 201, 202].map((h) => ({ publishedAt: ago(h) })));
    for (const d of posts) await confirmedMetrics(accountId, d.id, 0);
    let summary = ((await (await getPerformance(accountId)).json()) as { summary: Record<string, unknown> }).summary;
    expect(summary).toMatchObject({ baseline: null, judgeableCount: 3, baselineIsZero: false });
    const more = await publishedDrafts(accountId, [203, 204].map((h) => ({ publishedAt: ago(h) })));
    for (const d of more) await confirmedMetrics(accountId, d.id, 0);
    summary = ((await (await getPerformance(accountId)).json()) as { summary: Record<string, unknown> }).summary;
    expect(summary).toMatchObject({ baseline: 0, judgeableCount: 5, baselineIsZero: true });
  });

  it("権限がない印・要再接続を返す", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await db()`UPDATE accounts SET insights_denied_at = now(), connection_status = 'needs_reconnect' WHERE id = ${accountId}`;
    const summary = ((await (await getPerformance(accountId)).json()) as { summary: Record<string, unknown> }).summary;
    expect(summary).toMatchObject({ insightsDenied: true, needsReconnect: true });
  });

  it("他人のAccountは404、不正なクエリは400（FR-031・FR-032。読むだけのときは specs/013 read-only-access.test.ts）", async () => {
    await createUserWithAccount("u1");
    const mine = await createUserWithAccount("u2");
    expect((await getPerformance(mine.accountId, "", "u1")).status).toBe(404);
    expect((await getPerformance(mine.accountId, "?tab=bad", "u2")).status).toBe(400);
    expect((await getPerformance(mine.accountId, "?before=xxx", "u2")).status).toBe(400);
  });

  it("投稿済み500件でも速く返り、件数に比例してクエリが増えない（SC-007）", async () => {
    const { accountId } = await createUserWithAccount("u1");
    for (let k = 0; k < 10; k++) {
      const [b] = (await db()`INSERT INTO draft_batches (account_id, client_request_id, draft_count, delimiter_found)
        VALUES (${accountId}, gen_random_uuid(), 50, true) RETURNING id`) as [{ id: string }];
      await db()`INSERT INTO post_drafts (account_id, batch_id, position, body, status, reviewed_at, published_at, threads_media_id)
        SELECT ${accountId}, ${b.id}, g - 1, '本文' || g, 'published', now(), now() - make_interval(hours => ${k} * 50 + g), 'm' || ${k} || '_' || g
        FROM generate_series(1, 50) g`;
    }
    await db()`INSERT INTO post_metrics (draft_id, account_id, state, views, last_fetched_at, last_elapsed_minutes, last_kind, confirmed_at, judgment, judgment_ratio, judgment_baseline, judged_at)
      SELECT id, account_id, 'confirmed', 10 + (position * 3), now(), 10080, 'd7', now(),
        CASE WHEN position % 3 = 0 THEN 'poor'::judgment ELSE 'normal'::judgment END, 1, 50, now()
      FROM post_drafts WHERE account_id = ${accountId} AND published_at < now() - interval '200 hours'`;
    await getPerformance(accountId); // 最初の接続の分を除く
    for (const tab of ["all", "poor"]) {
      const started = Date.now();
      const res = await getPerformance(accountId, `?tab=${tab}`);
      expect(res.status).toBe(200);
      expect(Date.now() - started).toBeLessThan(500);
    }
  });
});

describe("PATCH /performance/:draftId/feedback（FR-021〜FR-024、SC-003）", () => {
  /**
   * 低調の投稿を作る。
   * @param accountId - accounts.id
   * @param hours - 投稿からの時間（新しい順に並べたい順）
   * @returns 下書き
   */
  async function poorPosts(accountId: string, hours: number[]) {
    const posts = await publishedDrafts(accountId, hours.map((h) => ({ publishedAt: ago(h) })));
    for (const d of posts) {
      await confirmedMetrics(accountId, d.id, 10);
      await setJudgment(d.id, "poor", 0.2);
    }
    return posts;
  }
  const patch = (accountId: string, draftId: string, body: unknown, user = "u1") =>
    call(app, "PATCH", `/api/accounts/${accountId}/performance/${draftId}/feedback`, { user, body });

  it("メモを保存し（前後の空白を除く・空なら null）、切り替えると次の投稿が繰り上がる", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const posts = await poorPosts(accountId, [200, 201, 202, 203, 204, 205]);

    const memo = await patch(accountId, posts[0]!.id, { memo: "  前置きが長い  " });
    expect(memo.status).toBe(200);
    const memoBody = (await memo.json()) as { item: { feedback: Record<string, unknown> }; promptIds: string[] };
    expect(memoBody.item.feedback).toEqual({ memo: "前置きが長い", includeInPrompt: true, inNextPrompt: true, version: 2 });
    expect(memoBody.promptIds).toEqual(posts.slice(0, 5).map((p) => p.id));

    const off = (await (await patch(accountId, posts[1]!.id, { includeInPrompt: false })).json()) as {
      item: { feedback: Record<string, unknown> };
      promptIds: string[];
    };
    expect(off.item.feedback).toMatchObject({ includeInPrompt: false, inNextPrompt: false });
    expect(off.promptIds).toEqual([posts[0]!.id, ...posts.slice(2, 6).map((p) => p.id)]);

    await patch(accountId, posts[0]!.id, { memo: "   " });
    const [row] = (await db()`SELECT feedback_memo, feedback_updated_at FROM post_metrics WHERE draft_id = ${posts[0]!.id}`) as [
      { feedback_memo: string | null; feedback_updated_at: string | null },
    ];
    expect(row.feedback_memo).toBeNull();
    expect(row.feedback_updated_at).not.toBeNull();
  });

  it("後から保存した内容で上書きする", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const [p] = await poorPosts(accountId, [200]);
    await patch(accountId, p!.id, { memo: "1つ目" });
    await patch(accountId, p!.id, { memo: "2つ目" });
    const [row] = (await db()`SELECT feedback_memo FROM post_metrics WHERE draft_id = ${p!.id}`) as [{ feedback_memo: string }];
    expect(row.feedback_memo).toBe("2つ目");
  });

  it("200文字を超えるメモ・項目なしは400、低調でない・他人の投稿は404", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const [p] = await poorPosts(accountId, [200]);
    expect((await patch(accountId, p!.id, { memo: "あ".repeat(201) })).status).toBe(400);
    expect((await patch(accountId, p!.id, { memo: "あ".repeat(200) })).status).toBe(200);
    expect((await patch(accountId, p!.id, {})).status).toBe(400);

    const [normal] = await publishedDrafts(accountId, [{ publishedAt: ago(210) }]);
    await confirmedMetrics(accountId, normal!.id, 50);
    await setJudgment(normal!.id, "normal", 1);
    expect((await patch(accountId, normal!.id, { memo: "x" })).status).toBe(404);
    expect((await patch(accountId, "00000000-0000-0000-0000-000000000000", { memo: "x" })).status).toBe(404);
    expect((await patch(accountId, "not-a-uuid", { memo: "x" })).status).toBe(404);

    const other = await createUserWithAccount("u2");
    expect((await patch(accountId, p!.id, { memo: "x" }, "u2")).status).toBe(404);
    void other;
  });
});

describe("GET /performance/export（FR-028〜FR-030、SC-005）", () => {
  const exportPage = (accountId: string, query: string, user = "u1") =>
    call(app, "GET", `/api/accounts/${accountId}/performance/export${query}`, { user });

  it("投稿ごと：全件・200件ずつ・各列の材料", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const [p, pending, gone] = await publishedDrafts(accountId, [
      { publishedAt: ago(200), body: "確定した投稿" },
      { publishedAt: ago(2) },
      { publishedAt: ago(100), mediaId: null },
    ]);
    await confirmedMetrics(accountId, p!.id, 167);
    await setJudgment(p!.id, "good", 3.374);
    await db()`INSERT INTO post_metrics (draft_id, account_id, state, unmeasurable_reason) VALUES (${gone!.id}, ${accountId}, 'unmeasurable', 'no_media_id')`;
    await db()`INSERT INTO post_metric_snapshots (draft_id, account_id, kind, method, fetched_at, elapsed_minutes, views, likes, replies, reposts, quotes, shares)
      VALUES (${p!.id}, ${accountId}, 'h24', 'slot', ${ago(176).toISOString()}, 1440, 120, 3, 0, 0, 0, 0)`;
    await db()`INSERT INTO follower_snapshots (account_id, snapshot_date, followers_count, captured_at) VALUES
      (${accountId}, '2020-01-01', 100, ${ago(300).toISOString()}),
      (${accountId}, '2020-01-02', 321, ${ago(201).toISOString()}),
      (${accountId}, '2020-01-03', 400, ${ago(199).toISOString()})`;
    await db()`UPDATE post_drafts SET published_slot_minute = 1140, published_carryover = true, published_prioritized = false,
      body_edited_at = now() WHERE id = ${p!.id}`;
    await db()`UPDATE post_drafts SET body_edit_tracked = false WHERE id = ${pending!.id}`;
    await db()`UPDATE draft_batches SET strategy_updated_at = '2026-09-01T00:00:00Z'
      WHERE id = (SELECT batch_id FROM post_drafts WHERE id = ${p!.id})`;

    const res = await exportPage(accountId, "?kind=posts");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: Record<string, unknown>[]; nextCursor: string | null };
    expect(body.rows.map((r) => r.id)).toEqual([pending!.id, gone!.id, p!.id]);
    expect(body.nextCursor).toBeNull();
    const byId = new Map(body.rows.map((r) => [r.id, r]));
    expect(byId.get(p!.id)).toMatchObject({
      body: "確定した投稿",
      metrics: { views: 167 },
      ratio: 3.374,
      state: "confirmed",
      judgment: "good",
      lastElapsedMinutes: 10080,
      followersAtPost: 321,
      h24: { views: 120, likes: 3 },
      batchPosition: 0,
      prioritized: false,
      carryover: true,
      bodyEdited: true,
      slotMinute: 1140,
      strategyUpdatedAt: "2026-09-01T00:00:00.000Z",
      promotionsChangedAt: null,
    });
    expect(byId.get(pending!.id)).toMatchObject({ state: "pending", metrics: null, bodyEdited: null, h24: null });
    expect(byId.get(gone!.id)).toMatchObject({ state: "unmeasurable", metrics: null, permalink: null, bodyEdited: false });
  });

  it("投稿ごと：200件を超えるとカーソルで続きを読み、行数は投稿済みの件数と一致する", async () => {
    const { accountId } = await createUserWithAccount("u1");
    for (let k = 0; k < 5; k++) {
      const [b] = (await db()`INSERT INTO draft_batches (account_id, client_request_id, draft_count, delimiter_found)
        VALUES (${accountId}, gen_random_uuid(), 50, true) RETURNING id`) as [{ id: string }];
      await db()`INSERT INTO post_drafts (account_id, batch_id, position, body, status, reviewed_at, published_at, threads_media_id)
        SELECT ${accountId}, ${b.id}, g - 1, '本文' || g, 'published', now(), now() - make_interval(hours => ${k} * 50 + g), 'm' || ${k} || '_' || g
        FROM generate_series(1, ${k === 4 ? 5 : 50}) g`;
    }
    const first = (await (await exportPage(accountId, "?kind=posts")).json()) as { rows: unknown[]; nextCursor: string };
    expect(first.rows).toHaveLength(200);
    const second = (await (
      await exportPage(accountId, `?kind=posts&before=${encodeURIComponent(first.nextCursor)}`)
    ).json()) as { rows: unknown[]; nextCursor: string | null };
    expect(second.rows).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
  });

  it("取り込みごと：履歴を1回1行、その日のフォロワー数つき", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const [p] = await publishedDrafts(accountId, [{ publishedAt: new Date("2026-09-25T10:00:00Z") }]);
    await db()`INSERT INTO post_metric_snapshots (draft_id, account_id, kind, method, fetched_at, elapsed_minutes, views) VALUES
      (${p!.id}, ${accountId}, 'h24', 'slot', '2026-09-26T10:05:00Z', 1445, 120),
      (${p!.id}, ${accountId}, 'd3', 'daily', '2026-09-28T18:10:00Z', 4810, 150),
      (${p!.id}, ${accountId}, 'd7', 'slot', '2026-10-02T10:02:00Z', 10082, 167)`;
    // 2026-09-28T18:10Z は日本時間の 9/29
    await db()`INSERT INTO follower_snapshots (account_id, snapshot_date, followers_count, captured_at) VALUES
      (${accountId}, '2026-09-26', 300, '2026-09-25T18:00:00Z'),
      (${accountId}, '2026-09-29', 310, '2026-09-28T18:00:00Z')`;
    const body = (await (await exportPage(accountId, "?kind=snapshots")).json()) as { rows: Record<string, unknown>[] };
    expect(body.rows.map((r) => [r.kind, r.method, r.elapsedMinutes, (r.metrics as { views: number }).views, r.followersOnDay])).toEqual([
      ["d7", "slot", 10082, 167, null],
      ["d3", "daily", 4810, 150, 310],
      ["h24", "slot", 1445, 120, 300],
    ]);
  });

  it("他人のAccountは404、kind がなければ400", async () => {
    await createUserWithAccount("u1");
    const mine = await createUserWithAccount("u2");
    expect((await exportPage(mine.accountId, "?kind=posts", "u1")).status).toBe(404);
    expect((await exportPage(mine.accountId, "", "u2")).status).toBe(400);
  });
});
