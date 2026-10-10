// 自動投稿の状態と知らせ（specs/005-auto-post FR-018・FR-022、research.md R8・R9、contracts/api.md「GET /auto-post」）
import { AUTOPOST_LATE_WINDOW_MINUTES } from "@threads-grower/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { call, createUserWithAccount, fake, makeApp, resetDb } from "../helpers/app";
import { approvedDrafts, connectedAccount, db, setSchedule } from "../helpers/auto-post";

const app = makeApp();
// 予定を過ぎて60分以内の時刻は、まだ試みていなければ「次の時刻」になる（findDueSlot）。
// 時刻の直後（例：12:00の枠の12:22）に流しても落ちないよう、その幅を含めて確かめる
const notBeforeLateWindow = () => Date.now() - AUTOPOST_LATE_WINDOW_MINUTES * 60_000;
const status = (accountId: string, user = "u1") =>
  call(app, "GET", `/api/accounts/${accountId}/auto-post`, { user });

beforeEach(async () => {
  await resetDb();
  await fake.reset();
});

describe("GET /auto-post：承認済みが0件の知らせ（US1 シナリオ5）", () => {
  it("オンで承認済みが0件なら no_approved を、次の時刻とともに出す", async () => {
    const { accountId } = await connectedAccount("u1", app);
    await setSchedule(accountId, { slotMinutes: [0, 720] });
    const res = await status(accountId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      autoPost: unknown;
      notices: { kind: string; nextSlotAt: string | null }[];
      approvedCount: number;
    };
    expect(body.autoPost).toEqual({ enabled: true, slotCount: 2, stoppedReason: null });
    expect(body.approvedCount).toBe(0);
    expect(body.notices).toHaveLength(1);
    expect(body.notices[0]!.kind).toBe("no_approved");
    expect(Date.parse(body.notices[0]!.nextSlotAt!)).toBeGreaterThan(notBeforeLateWindow());
  });

  it("オフ、または承認済みがあるときは出さない", async () => {
    const off = await connectedAccount("u1", app);
    await setSchedule(off.accountId, { slotMinutes: [720], enabled: false });
    expect(await (await status(off.accountId)).json()).toMatchObject({ notices: [] });

    const has = await connectedAccount("u2", app);
    await setSchedule(has.accountId, { slotMinutes: [720] });
    await approvedDrafts(has.accountId, ["A"]);
    expect(await (await status(has.accountId, "u2")).json()).toMatchObject({
      notices: [],
      approvedCount: 1,
    });
  });

  it("他人のAccountは 404 ACCOUNT_NOT_FOUND", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await createUserWithAccount("u2");
    expect((await status(accountId, "u2")).status).toBe(404);
  });
});

describe("US2：直前のチェックの知らせ", () => {
  it("戻した件数と最新の理由を出し、閉じても下書きの理由と設定の版は残る", async () => {
    const { accountId } = await connectedAccount("u1", app);
    await setSchedule(accountId, { slotMinutes: [720] });
    const ids = await approvedDrafts(accountId, ["NG", "長すぎる"]);
    await db()`UPDATE post_drafts SET status = 'needs_review', reviewed_at = NULL, blocked_at = now() - interval '1 second', blocked_reason = 'ng_word', blocked_words = ARRAY['NG'] WHERE id = ${ids[0]!}`;
    await db()`UPDATE post_drafts SET status = 'needs_review', reviewed_at = NULL, blocked_at = now(), blocked_reason = 'over_threads_limit' WHERE id = ${ids[1]!}`;
    expect(await (await status(accountId)).json()).toMatchObject({
      notices: expect.arrayContaining([
        { kind: "blocked", count: 2, latestReason: "over_threads_limit", latestWords: [] },
      ]),
    });
    const res = await call(
      app,
      "POST",
      `/api/accounts/${accountId}/auto-post/notices/blocked/dismiss`,
      { user: "u1" },
    );
    expect(res.status).toBe(204);
    const body = (await (await status(accountId)).json()) as { notices: { kind: string }[] };
    expect(body.notices.some((n) => n.kind === "blocked")).toBe(false);
    expect(await db()`SELECT blocked_reason FROM post_drafts WHERE id = ${ids[0]!}`).toMatchObject([
      { blocked_reason: "ng_word" },
    ]);
    expect(
      await db()`SELECT version FROM posting_schedules WHERE account_id = ${accountId}`,
    ).toMatchObject([{ version: 1 }]);
  });

  it("設定なしでも閉じられ、他人のAccountでは404", async () => {
    const { accountId } = await connectedAccount("u1", app);
    await createUserWithAccount("u2");
    const path = `/api/accounts/${accountId}/auto-post/notices/blocked/dismiss`;
    expect((await call(app, "POST", path, { user: "u2" })).status).toBe(404);
    expect((await call(app, "POST", path, { user: "u1" })).status).toBe(204);
    expect(
      await db()`SELECT enabled, version, blocked_notice_seen_at FROM posting_schedules WHERE account_id = ${accountId}`,
    ).toMatchObject([{ enabled: false, version: 1, blocked_notice_seen_at: expect.any(String) }]);
  });
});

describe("US3：停止と失敗の知らせ", () => {
  it("接続・上限・失敗・差し戻しの順に出し、オフでは接続の知らせを出さない", async () => {
    const { accountId } = await connectedAccount("u1", app);
    await setSchedule(accountId, {
      slotMinutes: [720],
      pausedUntil: new Date(Date.now() + 86400_000),
    });
    const ids = await approvedDrafts(accountId, ["OLD", "NEW", "BLOCKED"]);
    await db()`UPDATE accounts SET connection_status = 'needs_reconnect' WHERE id = ${accountId}`;
    await db()`UPDATE post_drafts SET status = 'publish_failed', publish_failed_at = now() - interval '1 minute', publish_error = 'network' WHERE id = ${ids[0]!}`;
    await db()`UPDATE post_drafts SET status = 'publish_failed', publish_failed_at = now(), publish_error = 'invalid_request' WHERE id = ${ids[1]!}`;
    await db()`UPDATE post_drafts SET status = 'needs_review', reviewed_at = NULL, blocked_at = now(), blocked_reason = 'ng_word', blocked_words = ARRAY['NG'] WHERE id = ${ids[2]!}`;
    const body = (await (await status(accountId)).json()) as { notices: { kind: string }[] };
    expect(body.notices.map((n) => n.kind)).toEqual([
      "needs_reconnect",
      "rate_limited",
      "publish_failed",
      "blocked",
    ]);
    expect(body.notices[2]).toMatchObject({
      count: 2,
      latestError: "invalid_request",
      latestAt: expect.any(String),
    });
    await db()`UPDATE posting_schedules SET enabled = false WHERE account_id = ${accountId}`;
    expect(
      ((await (await status(accountId)).json()) as { notices: { kind: string }[] }).notices.some(
        (n) => n.kind === "needs_reconnect",
      ),
    ).toBe(false);
  });
});

describe("US4：次の投稿と残りの日数", () => {
  it("承認済み5件・時刻3つであと1日分、本文の書き出しは40文字。停止中は予定なし", async () => {
    const { accountId } = await connectedAccount("u1", app);
    await setSchedule(accountId, { slotMinutes: [450, 720, 1260] });
    const ids = await approvedDrafts(accountId, ["あ".repeat(50), "B", "C", "D", "E"]);
    const body = (await (await status(accountId)).json()) as {
      next: { at: string; draft: unknown };
      approvedCount: number;
      daysLeft: number;
    };
    expect(body).toMatchObject({
      approvedCount: 5,
      daysLeft: 1,
      next: { draft: { id: ids[0], excerpt: "あ".repeat(40) } },
    });
    expect(Date.parse(body.next.at)).toBeGreaterThan(notBeforeLateWindow());
    await db()`UPDATE accounts SET connection_status = 'needs_reconnect' WHERE id = ${accountId}`;
    expect(await (await status(accountId)).json()).toMatchObject({ next: null });
    await setSchedule(accountId, { slotMinutes: [], enabled: false });
    expect(await (await status(accountId)).json()).toMatchObject({ next: null, daysLeft: null });
  });
});
