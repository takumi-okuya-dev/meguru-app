// トークンで接続したAccountも、自動投稿・NGワードの確認・承認の要否が同じ（specs/010 FR-042、Constitution原則I・II）
import { neon } from "@neondatabase/serverless";
import { beforeEach, describe, expect, it } from "vitest";
import { addMin, approvedDrafts, draftRow, jst, run, setSchedule } from "../helpers/auto-post";
import { fake, makeApp, resetDb, testEnv, tokenConnectNew } from "../helpers/app";

const app = makeApp();
const q = () => neon(testEnv.DATABASE_URL);
const NOON = jst("2030-01-10 12:00");

beforeEach(async () => {
  await resetDb();
  await fake.reset();
  await fake.addUser("9003", "cafe_b");
});

async function tokenAccount() {
  const token = await fake.issueToken({ user: "9003" });
  const { res } = await tokenConnectNew(app, "u1", token);
  expect(res.status).toBe(200);
  return ((await res.json()) as { accountId: string }).accountId;
}

describe("トークンで接続したAccountの自動投稿（FR-042）", () => {
  it("承認済みの案が予定の時刻に投稿される", async () => {
    const accountId = await tokenAccount();
    const [first] = await approvedDrafts(accountId, ["トークンの投稿", "次の投稿"]);
    await setSchedule(accountId, { slotMinutes: [720] });
    await run(addMin(NOON, 1));
    expect((await fake.posts()).map((p) => p.text)).toEqual(["トークンの投稿"]);
    expect(await draftRow(first!)).toMatchObject({ status: "published" });
  });

  it("NGワードを含む承認済みの案は直前の確認で戻され、要確認の案は投稿されない（原則I・II）", async () => {
    const accountId = await tokenAccount();
    const [ng] = await approvedDrafts(accountId, ["絶対に伸びる方法"]);
    await q()`INSERT INTO threads.ng_words (account_id, word, normalized) VALUES (${accountId}, '絶対', '絶対')`;
    await q()`
      INSERT INTO threads.post_drafts (account_id, batch_id, position, body, status)
      SELECT ${accountId}, batch_id, 1, '要確認の案', 'needs_review' FROM threads.post_drafts WHERE id = ${ng!}`;
    await setSchedule(accountId, { slotMinutes: [720] });
    await run(addMin(NOON, 1));
    expect(await fake.posts()).toEqual([]);
    expect(await draftRow(ng!)).toMatchObject({ status: "needs_review" });
  });
});
