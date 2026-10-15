// 分析のための記録（specs/006-performance-feedback FR-002e〜FR-002g、research.md R9）
import { beforeEach, describe, expect, it } from "vitest";
import { call, createUserWithAccount, fake, makeApp, resetDb } from "../helpers/app";
import { addMin, approvedDrafts, connectedAccount, db, draftRow, jst, run, setSchedule } from "../helpers/auto-post";

const app = makeApp();
const base = (accountId: string) => `/api/accounts/${accountId}`;

beforeEach(async () => {
  await resetDb();
  await fake.reset();
});

/**
 * 下書きを貼り付けで登録する。
 * @param accountId - accounts.id
 * @param text - 貼り付けた文
 * @returns 登録の結果
 */
async function register(accountId: string, text: string) {
  const res = await call(app, "POST", `${base(accountId)}/draft-batches`, {
    user: "u1",
    body: { clientRequestId: crypto.randomUUID(), text },
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { batchId: string; drafts: { id: string; version: number }[] };
}

/**
 * Accountの材料の日時を読む。
 * @param accountId - accounts.id
 * @returns 3つの日時
 */
async function changedAt(accountId: string) {
  const [r] = (await db()`SELECT promotions_changed_at, research_changed_at, core_rules_changed_at FROM accounts WHERE id = ${accountId}`) as [
    Record<string, string | null>,
  ];
  return r;
}

describe("登録の後に人が本文を直したか（FR-002e）", () => {
  it("新しい下書きは記録の対象で、本文が変わる編集だけで日時が入る（前後の空白だけの違いは除く）", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const { drafts } = await register(accountId, "元の本文");
    const id = drafts[0]!.id;
    expect(await draftRow(id)).toMatchObject({ body_edit_tracked: true, body_edited_at: null });

    const same = await call(app, "PUT", `${base(accountId)}/post-drafts/${id}`, {
      user: "u1",
      body: { body: "  元の本文  ", expectedVersion: drafts[0]!.version },
    });
    expect(same.status).toBe(200);
    expect((await draftRow(id)).body_edited_at).toBeNull();

    const v = ((await same.json()) as { draft: { version: number } }).draft.version;
    await call(app, "PUT", `${base(accountId)}/post-drafts/${id}`, { user: "u1", body: { body: "直した本文", expectedVersion: v } });
    expect((await draftRow(id)).body_edited_at).not.toBeNull();
  });
});

describe("プロンプトの材料の版（FR-002g）", () => {
  it("宣伝内容・リサーチの追加・変更・削除、投稿ルールの保存で、Accountの変更の日時が入る", async () => {
    const { accountId } = await createUserWithAccount("u1");
    expect(await changedAt(accountId)).toEqual({
      promotions_changed_at: null,
      research_changed_at: null,
      core_rules_changed_at: null,
    });

    const promo = await call(app, "POST", `${base(accountId)}/promotions`, {
      user: "u1",
      body: { title: "告知", content: "交流会", priority: 0, status: "active", validUntil: null },
    });
    expect(promo.status).toBe(201);
    const p1 = (await changedAt(accountId)).promotions_changed_at;
    expect(p1).not.toBeNull();
    const { id } = (await promo.json()) as { id: string };
    expect((await call(app, "DELETE", `${base(accountId)}/promotions/${id}`, { user: "u1" })).status).toBe(204);
    expect(new Date((await changedAt(accountId)).promotions_changed_at!).getTime()).toBeGreaterThanOrEqual(new Date(p1!).getTime());

    expect((await call(app, "POST", `${base(accountId)}/reference-posts`, { user: "u1", body: { body: "伸びた投稿" } })).status).toBe(201);
    expect((await changedAt(accountId)).research_changed_at).not.toBeNull();
    await db()`UPDATE accounts SET research_changed_at = NULL WHERE id = ${accountId}`;
    expect((await call(app, "POST", `${base(accountId)}/research-keywords`, { user: "u1", body: { keyword: "AI" } })).status).toBe(201);
    expect((await changedAt(accountId)).research_changed_at).not.toBeNull();

    expect(
      (await call(app, "PUT", `${base(accountId)}/core-rules`, { user: "u1", body: { text: "敬語で書く", expectedVersion: 1 } })).status,
    ).toBe(200);
    expect((await changedAt(accountId)).core_rules_changed_at).not.toBeNull();
  });

  it("バッチの登録で、その時点の4つの日時を写す", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await db()`INSERT INTO strategy_designs (account_id, final_action, updated_at) VALUES (${accountId}, '参加', '2026-09-01T00:00:00Z')`;
    await db()`UPDATE accounts SET promotions_changed_at = '2026-09-02T00:00:00Z', research_changed_at = '2026-09-03T00:00:00Z',
      core_rules_changed_at = '2026-09-04T00:00:00Z' WHERE id = ${accountId}`;
    const { batchId } = await register(accountId, "A");
    const [b] = (await db()`SELECT strategy_updated_at, promotions_changed_at, research_changed_at, core_rules_changed_at
      FROM draft_batches WHERE id = ${batchId}`) as [Record<string, string>];
    expect(Object.values(b).map((v) => new Date(v).toISOString())).toEqual([
      "2026-09-01T00:00:00.000Z",
      "2026-09-02T00:00:00.000Z",
      "2026-09-03T00:00:00.000Z",
      "2026-09-04T00:00:00.000Z",
    ]);
  });
});

describe("公開した時点の情報（FR-002f）", () => {
  it("公開の成功で、時刻の枠・持ち越し・「次に投稿する」を記録する", async () => {
    const { accountId } = await connectedAccount("u1", app);
    const [first, second] = await approvedDrafts(accountId, ["A", "B"]);
    await db()`UPDATE post_drafts SET prioritized_at = now() WHERE id = ${second!}`;
    await setSchedule(accountId, { slotMinutes: [720] });
    await run(addMin(jst("2030-01-10 12:00"), 1));
    expect(await draftRow(second!)).toMatchObject({
      status: "published",
      published_slot_minute: 720,
      published_carryover: false,
      published_prioritized: true,
    });
    expect(await draftRow(first!)).toMatchObject({ status: "approved", published_slot_minute: null });
  });
});
