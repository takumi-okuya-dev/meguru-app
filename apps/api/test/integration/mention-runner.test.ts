// 定期処理：メンションの返信の段階（specs/023-delayed-mention contracts/mention-job.md、tasks.md T016・T023・T031）
import { neon } from "@neondatabase/serverless";
import { beforeEach, describe, expect, it } from "vitest";
import { fake, makeApp, resetDb, testEnv } from "../helpers/app";
import { approvedDrafts, connectedAccount, draftRow, jst, run, setSchedule } from "../helpers/auto-post";
import { draftOf } from "../helpers/mention";

const app = makeApp();
const sql = () => neon(testEnv.DATABASE_URL);
const MIN = 60_000;

beforeEach(async () => {
  await resetDb();
  await fake.reset();
});

/**
 * 偽のThreadsに投稿があり、アプリから投稿した下書きと、時間差のメンションがある状態を作る。
 * @param o - publishedAt：投稿した時刻、delay：時間差（分）、usernames・text・sendAfter
 * @returns accountId・draftId・投稿のid
 */
async function seed(o: { publishedAt: Date; delay?: number | null; usernames?: string[]; text?: string; sendAfter?: Date | null; user?: string }) {
  const { accountId, threadsUserId } = await connectedAccount(o.user ?? "u1", app);
  const mediaId = await fake.addPost(threadsUserId, "本文", o.publishedAt);
  const draftId = await draftOf(accountId, "published", mediaId);
  await sql()`UPDATE post_drafts SET published_at = ${o.publishedAt.toISOString()} WHERE id = ${draftId}`;
  await sql()`INSERT INTO post_mentions (draft_id, account_id, usernames, text, delay_minutes, send_after)
    VALUES (${draftId}, ${accountId}, ${o.usernames ?? ["a", "b"]}, ${o.text ?? "シェアお願いします\n@a @b"},
      ${o.delay === undefined ? 30 : o.delay}, ${o.sendAfter ? o.sendAfter.toISOString() : null})`;
  return { accountId, draftId, mediaId, threadsUserId };
}
const mentionRow = async (draftId: string) =>
  ((await sql()`SELECT * FROM post_mentions WHERE draft_id = ${draftId}`) as Record<string, unknown>[])[0]!;
const replies = async () => (await fake.posts()).filter((p) => (p as { replyToId?: string }).replyToId);

describe("出す（T016）", () => {
  it("時間差の前は出さず、過ぎた最初の回に、返信先を指定して承認した文をそのまま出す", async () => {
    const t0 = new Date("2030-01-10T03:00:00Z");
    const { draftId, mediaId } = await seed({ publishedAt: t0 });
    await run(new Date(t0.getTime() + 29 * MIN));
    expect(await replies()).toEqual([]);
    await run(new Date(t0.getTime() + 31 * MIN));
    const [reply] = await replies();
    expect(reply).toMatchObject({ text: "シェアお願いします\n@a @b", replyToId: mediaId });
    expect(await mentionRow(draftId)).toMatchObject({ state: "sent", reply_media_id: reply!.id });
    // もう一度回しても出ない（SC-003）
    await run(new Date(t0.getTime() + 40 * MIN));
    expect((await replies()).length).toBe(1);
  });

  it("公開の応答が失われても、次の回に確かめて二重に出さない（SC-003）", async () => {
    const t0 = new Date("2030-01-10T03:00:00Z");
    const { draftId } = await seed({ publishedAt: t0 });
    await fake.dropPublishResponse(1);
    await run(new Date(t0.getTime() + 31 * MIN));
    expect((await replies()).length).toBe(1);
    expect(await mentionRow(draftId)).toMatchObject({ state: "pending" });
    await run(new Date(t0.getTime() + 36 * MIN));
    expect((await replies()).length).toBe(1);
    expect(await mentionRow(draftId)).toMatchObject({ state: "sent" });
  });

  it("出す直前のNGワードは出さない。同じ人が24時間以内に済みなら、文を書き換えずに出さない（SC-002・SC-004）", async () => {
    const t0 = new Date("2030-01-10T03:00:00Z");
    const { accountId, draftId } = await seed({ publishedAt: t0 });
    await sql()`INSERT INTO ng_words (account_id, word, normalized) VALUES (${accountId}, 'シェア', 'シェア')`;
    await run(new Date(t0.getTime() + 31 * MIN));
    expect(await mentionRow(draftId)).toMatchObject({ state: "failed", failure_reason: "ng_word" });

    const s2 = await seed({ publishedAt: t0, user: "u2" });
    const other = await draftOf(s2.accountId);
    await sql()`INSERT INTO post_mentions (draft_id, account_id, usernames, text, delay_minutes, state, sent_at)
      VALUES (${other}, ${s2.accountId}, ${["b"]}, '@b', 30, 'sent', ${new Date(t0.getTime()).toISOString()})`;
    await run(new Date(t0.getTime() + 31 * MIN));
    expect(await mentionRow(s2.draftId)).toMatchObject({ state: "failed", failure_reason: "limit", text: "シェアお願いします\n@a @b" });
    expect(await replies()).toEqual([]);
  });

  it("投稿済みに付けたものは、押した時刻のあとの最初の回に出す（T031）", async () => {
    const t0 = new Date("2030-01-10T03:00:00Z");
    const pushed = new Date(t0.getTime() + 3 * 60 * MIN);
    const { draftId } = await seed({ publishedAt: t0, delay: null, sendAfter: pushed });
    await run(new Date(pushed.getTime() - MIN));
    expect(await replies()).toEqual([]);
    await run(new Date(pushed.getTime() + MIN));
    expect(await mentionRow(draftId)).toMatchObject({ state: "sent" });
  });

  it("次の返信の時刻が関所の候補に入る", async () => {
    const t0 = new Date("2030-01-10T03:00:00Z");
    await seed({ publishedAt: t0 });
    await run(new Date(t0.getTime() + 5 * MIN));
    const gate = JSON.parse((await testEnv.AUTOPOST_KV.get("autopost:gate"))!) as { nextCheckAt: string };
    expect(new Date(gate.nextCheckAt).getTime()).toBeLessThanOrEqual(t0.getTime() + 30 * MIN);
  });
});

describe("出せなかったとき（T023）", () => {
  it("24時間を過ぎた・返信の権限なし・投稿されていない", async () => {
    const t0 = new Date("2030-01-10T03:00:00Z");
    const a = await seed({ publishedAt: t0 });
    await run(new Date(t0.getTime() + 25 * 60 * MIN));
    expect(await mentionRow(a.draftId)).toMatchObject({ state: "failed", failure_reason: "expired" });

    const b = await seed({ publishedAt: t0, user: "u2" });
    await sql()`UPDATE accounts SET replies_denied_at = now() WHERE id = ${b.accountId}`;
    await run(new Date(t0.getTime() + 31 * MIN));
    expect(await mentionRow(b.draftId)).toMatchObject({ state: "failed", failure_reason: "no_permission" });
  });

  it("返信先が見つからない → not_found。一時的な失敗はやり直し、3回で error", async () => {
    const t0 = new Date("2030-01-10T03:00:00Z");
    const a = await seed({ publishedAt: t0 });
    await sql()`UPDATE post_drafts SET threads_media_id = 'missing' WHERE id = ${a.draftId}`;
    await run(new Date(t0.getTime() + 31 * MIN));
    expect(await mentionRow(a.draftId)).toMatchObject({ state: "failed", failure_reason: "not_found" });

    const b = await seed({ publishedAt: t0, user: "u2" });
    await fake.publishFail("createContainer", "transient", 10);
    let at = t0.getTime() + 31 * MIN;
    for (let i = 0; i < 3; i++) {
      await run(new Date(at));
      at += 20 * MIN;
    }
    expect(await mentionRow(b.draftId)).toMatchObject({ state: "failed", failure_reason: "error" });
  });

  it("要再接続のあいだは待ち、出さない", async () => {
    const t0 = new Date("2030-01-10T03:00:00Z");
    const a = await seed({ publishedAt: t0 });
    await sql()`UPDATE accounts SET connection_status = 'needs_reconnect' WHERE id = ${a.accountId}`;
    await run(new Date(t0.getTime() + 31 * MIN));
    expect(await mentionRow(a.draftId)).toMatchObject({ state: "pending" });
    expect(await replies()).toEqual([]);
  });

  it("返信のもとが処理中のまま24時間を過ぎたら error（いつまでも借り直さない）", async () => {
    const t0 = new Date("2030-01-10T03:00:00Z");
    const a = await seed({ publishedAt: t0 });
    await fake.dropPublishResponse(1);
    await run(new Date(t0.getTime() + 31 * MIN));
    const row = await mentionRow(a.draftId);
    await fake.setContainerStatus(String(row.container_id), "IN_PROGRESS");
    await run(new Date(t0.getTime() + 36 * MIN));
    expect(await mentionRow(a.draftId)).toMatchObject({ state: "pending" });
    await run(new Date(t0.getTime() + 26 * 60 * MIN));
    expect(await mentionRow(a.draftId)).toMatchObject({ state: "failed", failure_reason: "error" });
  });

  it("時間差が24時間でも、返信の時刻から数えるので出せる（PR #66 のCodexレビュー）", async () => {
    const t0 = new Date("2030-01-10T03:00:00Z");
    const a = await seed({ publishedAt: t0, delay: 1440 });
    await run(new Date(t0.getTime() + 1440 * MIN + 3 * MIN));
    expect(await mentionRow(a.draftId)).toMatchObject({ state: "sent" });
  });

  it("公開を送る前に取りやめていたら送らない（PR #66 のCodexレビュー）", async () => {
    const t0 = new Date("2030-01-10T03:00:00Z");
    const a = await seed({ publishedAt: t0 });
    // 返信のもとを作ったあと、公開の前に「やめる」が入った状態
    await fake.publishFail("publish", "transient", 1);
    await run(new Date(t0.getTime() + 31 * MIN));
    await sql()`UPDATE post_mentions SET state = 'canceled', publish_requested_at = NULL WHERE draft_id = ${a.draftId}`;
    await run(new Date(t0.getTime() + 60 * MIN));
    expect(await replies()).toEqual([]);
    expect(await mentionRow(a.draftId)).toMatchObject({ state: "canceled" });
  });

  it("下書きの投稿に失敗したら、時間差のメンションも出せなかったことにする（予定のまま残さない。PR #66 のCodexレビュー）", async () => {
    const { accountId } = await connectedAccount("u1", app);
    const [id] = await approvedDrafts(accountId, ["INVALID"]);
    await sql()`INSERT INTO post_mentions (draft_id, account_id, usernames, text, delay_minutes)
      VALUES (${id}, ${accountId}, ${["a"]}, '@a', 30)`;
    await setSchedule(accountId, { slotMinutes: [720] });
    await fake.publishFail("createContainer", "invalid", 1);
    await run(jst("2030-01-10 12:00"));
    expect(await draftRow(id!)).toMatchObject({ status: "publish_failed" });
    expect(await mentionRow(id!)).toMatchObject({ state: "failed", failure_reason: "post_failed" });
  });
});
