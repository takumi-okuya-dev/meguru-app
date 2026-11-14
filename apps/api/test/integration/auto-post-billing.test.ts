// 読むだけの間の自動投稿（specs/013-billing FR-041、research.md R8、T031）。決済ONで確かめる。
import { beforeEach, describe, expect, it } from "vitest";
import { runAutoPost } from "../../src/apps/threads/publish/auto-post-runner";
import { endTrial, fake, insertSubscription, makeApp, resetDb, setBillingExempt } from "../helpers/app";
import { addMin, approvedDrafts, attempts, connectedAccount, db, draftRow, jst, setSchedule } from "../helpers/auto-post";
import { billingEnv } from "../helpers/billing";

const app = makeApp();
const NOON = jst("2030-01-10 12:00");

beforeEach(async () => {
  await resetDb();
  await fake.reset();
});

/** 決済ONで定期処理を1回動かす（関所を消してから）。 */
async function runOn(now: Date) {
  const env = billingEnv();
  await env.AUTOPOST_KV.delete("autopost:gate");
  return runAutoPost(env, now, undefined, () => now);
}

async function ownerIdOf(accountId: string) {
  const [r] = (await db()`SELECT user_id FROM threads.memberships WHERE account_id = ${accountId} AND role = 'owner'`) as [{ user_id: string }];
  return r.user_id;
}

describe("オーナーが読むだけ", () => {
  it("時刻が来ても、Threadsへの問い合わせが0回で、試みの行も作らない。承認済みは承認済みのまま", async () => {
    const { accountId } = await connectedAccount("u1", app);
    const [id] = await approvedDrafts(accountId, ["A"]);
    await setSchedule(accountId, { slotMinutes: [720] });
    await endTrial(await ownerIdOf(accountId));
    const before = (await fake.callCounts()).total;
    await runOn(addMin(NOON, 1));
    expect((await fake.callCounts()).total).toBe(before);
    expect(await attempts(accountId)).toHaveLength(0);
    expect((await draftRow(id!)).status).toBe("approved");
  });

  it("契約して戻った後は、次の時刻から投稿し、過ぎた時刻はまとめて投稿しない（005 FR-011）", async () => {
    const { accountId } = await connectedAccount("u1", app);
    await approvedDrafts(accountId, ["A", "B", "C"]);
    await setSchedule(accountId, { slotMinutes: [600, 720] });
    const owner = await ownerIdOf(accountId);
    await endTrial(owner);
    await runOn(addMin(jst("2030-01-10 10:00"), 1));
    expect(await fake.posts()).toHaveLength(0);
    await insertSubscription(owner, { status: "active" });
    await runOn(addMin(NOON, 1));
    expect((await fake.posts()).map((p) => p.text)).toEqual(["A"]);
  });

  it("やり直し待ちの試みは、読むだけになったら投稿せず、案を承認済みに戻す（billing_inactive）", async () => {
    const { accountId } = await connectedAccount("u1", app);
    const [id] = await approvedDrafts(accountId, ["A"]);
    await setSchedule(accountId, { slotMinutes: [720] });
    // 定期処理の時刻（2030年）では無料体験が終わっているので、はじめは契約中にしておく
    const owner = await ownerIdOf(accountId);
    await insertSubscription(owner, { status: "active" });
    // 1回目は一時的な失敗でやり直し待ちにする
    await fake.publishFail("createContainer", "transient", 1);
    await runOn(addMin(NOON, 1));
    const [first] = await attempts(accountId);
    expect(first!.state).toBe("retry_wait");
    // 支払いが失敗して読むだけになる
    await insertSubscription(owner, { status: "past_due" });
    await db()`UPDATE threads.publish_attempts SET next_retry_at = now() - interval '1 minute' WHERE id = ${first!.id as string}`;
    await runOn(addMin(NOON, 10));
    const [after] = await attempts(accountId);
    expect(after).toMatchObject({ state: "skipped", skip_reason: "billing_inactive" });
    expect((await draftRow(id!)).status).toBe("approved");
    expect(await fake.posts()).toHaveLength(0);
  });

  it("料金なし・決済OFFなら、今のまま投稿する", async () => {
    const { accountId } = await connectedAccount("u1", app);
    await approvedDrafts(accountId, ["A"]);
    await setSchedule(accountId, { slotMinutes: [720] });
    const owner = await ownerIdOf(accountId);
    await endTrial(owner);
    await setBillingExempt(owner, true);
    await runOn(addMin(NOON, 1));
    expect((await fake.posts()).map((p) => p.text)).toEqual(["A"]);
  });

  it("自動投稿の状態は billing_inactive で止まっていると出し、予定の時刻を出さない", async () => {
    const { accountId } = await connectedAccount("u1", app);
    await approvedDrafts(accountId, ["A"]);
    await setSchedule(accountId, { slotMinutes: [720] });
    await endTrial(await ownerIdOf(accountId));
    const { callBilling } = await import("../helpers/billing");
    const list = (await (await callBilling(app, "GET", `/api/threads/accounts/${accountId}/post-drafts`, { user: "u1" })).json()) as {
      autoPost: { stoppedReason: string | null };
      schedule: Record<string, string>;
    };
    expect(list.autoPost.stoppedReason).toBe("billing_inactive");
    expect(list.schedule).toEqual({});
  });
});
