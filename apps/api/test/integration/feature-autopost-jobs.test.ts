// 自動投稿が使えないオーナーの定期処理（specs/019-feature-switches FR-008、research.md R12）。
// 時刻の処理・公開の直前の確かめ・反応の取り込みのどれでも止め、承認済みの案は消さない。ONに戻すと次の時刻から投稿する。
import { beforeEach, describe, expect, it } from "vitest";
import { runAutoPost } from "../../src/apps/threads/publish/auto-post-runner";
import { fake, makeApp, resetDb, testEnv } from "../helpers/app";
import {
  addMin,
  approvedDrafts,
  attempts,
  clearCatchup,
  connectedAccount,
  db,
  draftRow,
  jst,
  markCatchupDone,
  publishedDrafts,
  run,
  setSchedule,
  snapshotsOf,
} from "../helpers/auto-post";
import { disableFeatures, disableGroupFeatures, enableAll, makeGroup } from "../helpers/features";

const app = makeApp();
const NOON = jst("2030-01-10 12:00");

beforeEach(async () => {
  await resetDb();
  await fake.reset();
  await clearCatchup();
});

/** 定期処理を1回動かす（関所を消してから）。 */
async function runOn(now: Date) {
  await testEnv.AUTOPOST_KV.delete("autopost:gate");
  return runAutoPost(testEnv, now, undefined, () => now);
}

async function ownerIdOf(accountId: string) {
  const [r] = (await db()`SELECT user_id FROM memberships WHERE account_id = ${accountId} AND role = 'owner'`) as [{ user_id: string }];
  return r.user_id;
}

describe("自動投稿が使えないオーナー", () => {
  it("時刻が来ても投稿せず、試みも作らない。承認済みは承認済みのまま。ONに戻すと次の時刻から投稿する", async () => {
    const { accountId } = await connectedAccount("u1", app);
    const [id] = await approvedDrafts(accountId, ["A", "B"]);
    await setSchedule(accountId, { slotMinutes: [600, 720] });
    const owner = await ownerIdOf(accountId);
    await disableFeatures(owner, "autopost");
    await runOn(addMin(jst("2030-01-10 10:00"), 1));
    expect(await fake.posts()).toHaveLength(0);
    expect(await attempts(accountId)).toHaveLength(0);
    expect((await draftRow(id!)).status).toBe("approved");

    await enableAll(owner);
    await runOn(addMin(NOON, 1));
    expect((await fake.posts()).map((p) => p.text)).toEqual(["A"]);
  });

  it("グループでOFFでも同じく投稿しない", async () => {
    const { accountId } = await connectedAccount("u1", app);
    await approvedDrafts(accountId, ["A"]);
    await setSchedule(accountId, { slotMinutes: [720] });
    const group = await makeGroup("g", [await ownerIdOf(accountId)]);
    await disableGroupFeatures(group, "autopost");
    await runOn(addMin(NOON, 1));
    expect(await fake.posts()).toHaveLength(0);
  });

  it("やり直し待ちの試みは、使えなくなったら投稿せず、案を承認済みに戻す（auto_post_off）", async () => {
    const { accountId } = await connectedAccount("u1", app);
    const [id] = await approvedDrafts(accountId, ["A"]);
    await setSchedule(accountId, { slotMinutes: [720] });
    await fake.publishFail("createContainer", "transient", 1);
    await runOn(addMin(NOON, 1));
    const [first] = await attempts(accountId);
    expect(first!.state).toBe("retry_wait");
    await disableFeatures(await ownerIdOf(accountId), "autopost");
    await db()`UPDATE publish_attempts SET next_retry_at = now() - interval '1 minute' WHERE id = ${first!.id as string}`;
    await runOn(addMin(NOON, 10));
    const [after] = await attempts(accountId);
    expect(after).toMatchObject({ state: "skipped", skip_reason: "auto_post_off" });
    expect((await draftRow(id!)).status).toBe("approved");
    expect(await fake.posts()).toHaveLength(0);
  });

  it("反応を取り込まない。ONに戻すと取り込む", async () => {
    const { accountId } = await connectedAccount("u1", app);
    const owner = await ownerIdOf(accountId);
    await disableFeatures(owner, "autopost");
    await markCatchupDone("2030-01-10");
    const [d] = await publishedDrafts(accountId, [{ publishedAt: new Date(NOON.getTime() - 24.5 * 3600_000) }]);
    await fake.setInsights(d!.mediaId!, { views: 40 });
    await run(NOON);
    expect(await snapshotsOf(d!.id)).toEqual([]);

    await enableAll(owner);
    await run(addMin(NOON, 5));
    expect((await snapshotsOf(d!.id)).map((s) => s.views)).toEqual([40]);
  });
});
