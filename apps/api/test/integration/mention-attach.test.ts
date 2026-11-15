// 時間差のメンションを付ける・直す・外す・承認（specs/023-delayed-mention contracts/api.md、tasks.md T014・T015・T030）
import { neon } from "@neondatabase/serverless";
import type { PostDraft } from "@meguru/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { call, createUserWithAccount, makeApp, resetDb, testEnv } from "../helpers/app";
import { activityRows, putInTeam } from "../helpers/team";
import { draftOf } from "../helpers/mention";

const app = makeApp();
const sql = () => neon(testEnv.DATABASE_URL);
const base = (accountId: string) => `/api/threads/accounts/${accountId}`;

async function json<T>(res: Response, status = 200): Promise<T> {
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as T;
}
const errorOf = async (res: Response) => ((await res.json()) as { error: { code: string; details?: string[] } }).error;

/**
 * メンションする人とひとことを決めたアカウント。
 * @param user - ユーザー
 * @returns accountId
 */
async function setup(user = "u1") {
  const { accountId } = await createUserWithAccount(user);
  await call(app, "PUT", `${base(accountId)}/mention-settings`, {
    user,
    body: { expectedVersion: null, message: "シェアお願いします", delayMinutes: 30 },
  });
  for (const [u, always] of [["a", true], ["b", true], ["c", false]] as const)
    await call(app, "POST", `${base(accountId)}/mention-people`, { user, body: { username: u, label: u, always } });
  return accountId;
}
const versionOf = async (id: string) => ((await sql()`SELECT version FROM threads.post_drafts WHERE id = ${id}`) as [{ version: number }])[0].version;
const attach = async (accountId: string, id: string, body: Record<string, unknown>, user = "u1") =>
  call(app, "PUT", `${base(accountId)}/post-drafts/${id}/mention`, { user, body: { expectedVersion: await versionOf(id), ...body } });
const review = async (accountId: string, action: "approve" | "reject", id: string) =>
  call(app, "POST", `${base(accountId)}/post-drafts/review`, {
    user: "u1",
    body: {
      action,
      requestId: crypto.randomUUID(),
      items: [{ id, expectedVersion: await versionOf(id) }],
      ...(action === "reject" ? { reject: { reasons: ["tone"], note: "x" } } : {}),
    },
  });

beforeEach(async () => {
  await resetDb();
});

describe("付ける（T014）", () => {
  it("要確認に付けると行ができ、版が上がる。文を省くとひとこと＋@。設定を変えても付けた時間差は変わらない", async () => {
    const accountId = await setup();
    const id = await draftOf(accountId);
    const before = await versionOf(id);
    const r = await json<{ draft: PostDraft; blocked: unknown[] }>(await attach(accountId, id, { usernames: ["A", "b"] }));
    expect(r.draft.version).toBe(before + 1);
    expect(r.draft.mention).toMatchObject({ usernames: ["a", "b"], text: "シェアお願いします\n@a @b", delayMinutes: 30, state: "pending", dueAt: null });
    await call(app, "PUT", `${base(accountId)}/mention-settings`, {
      user: "u1",
      body: { expectedVersion: 1, message: "x", delayMinutes: 60 },
    });
    const [row] = (await sql()`SELECT delay_minutes FROM threads.post_mentions WHERE draft_id = ${id}`) as [{ delay_minutes: number }];
    expect(row.delay_minutes).toBe(30);
    expect((await activityRows(accountId)).map((a) => a.action)).not.toContain("never");
  });

  it("文を送ると、選んだ人は文の中の一覧の人になる。一覧にない @ は数えない。0人・6人・一覧にない人は付けられない（FR-011）", async () => {
    const accountId = await setup();
    const id = await draftOf(accountId);
    const r = await json<{ draft: PostDraft }>(await attach(accountId, id, { usernames: ["a"], text: "ぜひ @c と @other" }));
    expect(r.draft.mention).toMatchObject({ usernames: ["c"], text: "ぜひ @c と @other" });
    const none = await attach(accountId, id, { usernames: ["a"], text: "だれもいない" });
    expect([none.status, (await errorOf(none)).details]).toEqual([400, ["text"]]);
    const unknown = await attach(accountId, id, { usernames: ["zzz"] });
    expect([unknown.status, (await errorOf(unknown)).details]).toEqual([400, ["zzz"]]);
    expect((await attach(accountId, id, { usernames: ["a", "b", "c", "d", "e", "f"] })).status).toBe(400);
  });

  it("承認済みに付けると要確認に戻る（FR-013）", async () => {
    const accountId = await setup();
    const id = await draftOf(accountId, "approved");
    const r = await json<{ draft: PostDraft }>(await attach(accountId, id, { usernames: ["a"] }));
    expect(r.draft.status).toBe("needs_review");
  });

  it("ほかの投稿で予定・24時間以内に済みの人は選べず、blocked に理由が出る（FR-014）", async () => {
    const accountId = await setup();
    const [d1, d2, d3] = [await draftOf(accountId), await draftOf(accountId), await draftOf(accountId)];
    await json(await attach(accountId, d1, { usernames: ["a"] }));
    const hit = await attach(accountId, d2, { usernames: ["a"] });
    expect([hit.status, (await errorOf(hit)).details]).toEqual([400, ["a"]]);
    await sql()`UPDATE threads.post_mentions SET state = 'sent', sent_at = now() WHERE draft_id = ${d1}`;
    const r = await json<{ blocked: { username: string; reason: string }[] }>(await attach(accountId, d3, { usernames: ["b"] }));
    expect(r.blocked).toEqual([{ username: "a", reason: "recent" }]);
    expect((await attach(accountId, d2, { usernames: ["a"] })).status).toBe(400);
  });

  it("まとめて付ける：いつも付けるの人で付く。人がいない・版の違いは skipped", async () => {
    const accountId = await setup();
    const [d1, d2] = [await draftOf(accountId), await draftOf(accountId)];
    const r = await json<{ updated: PostDraft[]; skipped: { id: string; reason: string }[] }>(
      await call(app, "POST", `${base(accountId)}/post-drafts/mentions`, {
        user: "u1",
        body: { items: [{ id: d1, expectedVersion: await versionOf(d1) }, { id: d2, expectedVersion: 99 }] },
      }),
    );
    expect(r.updated.map((d) => d.mention?.usernames)).toEqual([["a", "b"]]);
    expect(r.skipped).toEqual([{ id: d2, reason: "STALE" }]);
    // a・b は d1 で予定に入ったので、次の下書きには付けられない
    const again = await json<{ skipped: { reason: string }[] }>(
      await call(app, "POST", `${base(accountId)}/post-drafts/mentions`, {
        user: "u1",
        body: { items: [{ id: d2, expectedVersion: await versionOf(d2) }] },
      }),
    );
    expect(again.skipped).toEqual([{ id: d2, reason: "NO_PEOPLE" }]);
  });

  it("外す：要確認は行が消え版が上がる。一覧の応答に mention が入り、見せてもらっている人には null", async () => {
    const { accountId } = await createUserWithAccount("o1");
    await putInTeam(accountId, "o1", { shared: true });
    await call(app, "POST", `${base(accountId)}/mention-people`, { user: "o1", body: { username: "a", label: "a" } });
    const id = await draftOf(accountId);
    await json(await attach(accountId, id, { usernames: ["a"] }, "o1"));
    const list = await json<{ needsReview: PostDraft[] }>(await call(app, "GET", `${base(accountId)}/post-drafts`, { user: "o1" }));
    expect(list.needsReview[0]!.mention?.usernames).toEqual(["a"]);
    const viewer = await json<{ needsReview: PostDraft[] }>(await call(app, "GET", `${base(accountId)}/post-drafts`, { user: "a1" }));
    expect(viewer.needsReview[0]!.mention).toBeNull();
    const del = await json<{ draft: PostDraft }>(
      await call(app, "DELETE", `${base(accountId)}/post-drafts/${id}/mention`, { user: "o1", body: { expectedVersion: await versionOf(id) } }),
    );
    expect(del.draft.mention).toBeNull();
    expect((await activityRows(accountId)).map((a) => a.action)).toEqual(expect.arrayContaining(["mention_attached", "mention_detached"]));
  });
});

describe("承認（T015）", () => {
  it("返信の文にNGワードがあれば承認できない。却下すると消える（SC-002）", async () => {
    const accountId = await setup();
    await call(app, "POST", `${base(accountId)}/ng-words`, { user: "u1", body: { words: ["絶対"] } });
    const id = await draftOf(accountId);
    await json(await attach(accountId, id, { usernames: ["a"], text: "絶対シェアして @a" }));
    const res = await json<{ updated: PostDraft[]; skipped: { reason: string }[] }>(await review(accountId, "approve", id));
    expect(res.updated).toEqual([]);
    expect(res.skipped[0]!.reason).toBe("NG_WORD");
    await json(await review(accountId, "reject", id));
    expect(((await sql()`SELECT 1 FROM threads.post_mentions WHERE draft_id = ${id}`) as unknown[]).length).toBe(0);
  });

  it("承認すると返信の文も承認され、関所を起こす", async () => {
    const accountId = await setup();
    const id = await draftOf(accountId);
    await json(await attach(accountId, id, { usernames: ["a"] }));
    await testEnv.AUTOPOST_KV.delete("autopost:wake");
    const res = await json<{ updated: PostDraft[] }>(await review(accountId, "approve", id));
    expect(res.updated[0]).toMatchObject({ status: "approved", mention: { usernames: ["a"] } });
    expect(await testEnv.AUTOPOST_KV.get("autopost:wake")).not.toBeNull();
  });
});

describe("投稿済みの投稿にあとから（T030）", () => {
  it("7日以内・アプリから投稿・まだない → 今の時刻で予定。古い・もう付いている・権限なし・NGワードは付けられない。やめると canceled", async () => {
    const accountId = await setup();
    await call(app, "POST", `${base(accountId)}/ng-words`, { user: "u1", body: { words: ["絶対"] } });
    const id = await draftOf(accountId, "published");
    const ng = await attach(accountId, id, { usernames: ["a"], text: "絶対 @a" });
    expect(ng.status).toBe(400);
    const r = await json<{ draft: PostDraft }>(await attach(accountId, id, { usernames: ["a"] }));
    expect(r.draft.mention).toMatchObject({ delayMinutes: null, state: "pending" });
    expect(r.draft.mention!.dueAt).not.toBeNull();
    expect((await attach(accountId, id, { usernames: ["b"] })).status).toBe(400); // 1つまで
    const old = await draftOf(accountId, "published");
    await sql()`UPDATE threads.post_drafts SET published_at = now() - interval '8 days' WHERE id = ${old}`;
    expect((await attach(accountId, old, { usernames: ["b"] })).status).toBe(400);
    const manual = await draftOf(accountId, "published");
    await sql()`UPDATE threads.post_drafts SET threads_media_id = NULL, threads_permalink = NULL WHERE id = ${manual}`;
    expect((await attach(accountId, manual, { usernames: ["b"] })).status).toBe(400);
    const denied = await draftOf(accountId, "published");
    await sql()`UPDATE threads.accounts SET replies_denied_at = now() WHERE id = ${accountId}`;
    expect((await attach(accountId, denied, { usernames: ["b"] })).status).toBe(400);
    await json(await call(app, "DELETE", `${base(accountId)}/post-drafts/${id}/mention`, { user: "u1", body: {} }));
    const [row] = (await sql()`SELECT state FROM threads.post_mentions WHERE draft_id = ${id}`) as [{ state: string }];
    expect(row.state).toBe("canceled");
  });

  it("投稿済みの一覧に mention と version が入る", async () => {
    const accountId = await setup();
    const id = await draftOf(accountId, "published");
    await json(await attach(accountId, id, { usernames: ["a"] }));
    const page = await json<{ items: { id: string; version: number; mention: { state: string } | null }[] }>(
      await call(app, "GET", `${base(accountId)}/post-drafts/published`, { user: "u1" }),
    );
    expect(page.items[0]).toMatchObject({ id, mention: { state: "pending" } });
    expect(page.items[0]!.version).toBeGreaterThan(0);
  });
});
