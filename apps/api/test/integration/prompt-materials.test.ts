// 投稿のプロンプトに入る014の材料（specs/014-strategy-guidance FR-113〜FR-115、contracts/prompt-template.md 1）。
import { neon } from "@neondatabase/serverless";
import { beforeEach, describe, expect, it } from "vitest";
import { call, createUserWithAccount, makeApp, resetDb, testEnv } from "../helpers/app";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
});

const base = (accountId: string) => `/api/accounts/${accountId}`;
type PromptBody = { prompt: string; length: number; summary: { length: number } };

/** 今日（日本時間）から days 日後の日付。 */
function daysLater(days: number) {
  return new Date(Date.now() + 9 * 3600_000 + days * 86_400_000).toISOString().slice(0, 10);
}

async function getPrompt(accountId: string, count = 10) {
  const res = await call(app, "GET", `${base(accountId)}/prompt?count=${count}`, { user: "u1" });
  expect(res.status).toBe(200);
  return (await res.json()) as PromptBody;
}

describe("投稿のプロンプトの014の材料", () => {
  it("宣伝内容のタイトル・掲載期限と残り日数、期限なしが入る（FR-114）", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const q = neon(testEnv.DATABASE_URL);
    const until = daysLater(5);
    await q`INSERT INTO promotions (account_id, title, content, valid_until) VALUES (${accountId}, '秋の交流会', '交流会の案内', ${until})`;
    await q`INSERT INTO promotions (account_id, title, content) VALUES (${accountId}, '個別相談', 'いつでも相談')`;
    const { prompt } = await getPrompt(accountId);
    expect(prompt).toContain(`1. 【秋の交流会】(掲載期限: ${until}・残り5日) 交流会の案内`);
    expect(prompt).toContain("2. 【個別相談】(期限なし) いつでも相談");
    expect(prompt).toContain("宣伝投稿はちょうど2件");
  });

  it("目的とプロフィール・固定投稿の下書きが入る（FR-053・FR-113）", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await neon(testEnv.DATABASE_URL)`
      INSERT INTO strategy_designs (account_id, purpose_origin, profile_bio_draft, pinned_post_draft_3)
      VALUES (${accountId}, '上京して寂しかった', '東京で友だちをつくる会', '固定投稿の案')`;
    const { prompt } = await getPrompt(accountId);
    expect(prompt).toContain("- 活動を始めたきっかけ: 上京して寂しかった");
    expect(prompt).toContain("- プロフィール文:\n東京で友だちをつくる会\n- 固定投稿③:\n固定投稿の案");
    expect(prompt).toContain("・10件のうち1件は、文末で、プロフィールや固定投稿へ自然に誘う一言を添える");
  });

  it("参考投稿の媒体・数字・鮮度が入る（FR-115）", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await call(app, "POST", `${base(accountId)}/reference-posts`, {
      user: "u1",
      body: { body: "参考の本文", platform: "tiktok", postedDateMode: "week", metrics: { views: 12000 } },
    });
    const { prompt } = await getPrompt(accountId);
    expect(prompt).toContain("元の投稿(参考: 内容はコピーしない) [最新・TikTok・閲覧 12,000]\n   > 参考の本文");
  });

  it("アカウントの文字数と割合を使い、length は全文の文字数", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await neon(testEnv.DATABASE_URL)`
      UPDATE accounts SET post_length_target = 200, long_length = 200, short_ratio = 50, medium_ratio = 30, long_ratio = 20
      WHERE id = ${accountId}`;
    const body = await getPrompt(accountId);
    expect(body.prompt).toContain("10件の内訳: 短文5件・中文3件・長文2件(割合は50:30:20)。");
    expect(body.prompt).toContain("③ 1件は200文字以内(500文字は絶対に超えない)。");
    expect(body.length).toBe([...body.prompt].length);
    expect(body.summary.length).toBe(body.length);
  });
});

type Materials = {
  strategy: { items: { key: string; status: string | null; chars: number }[]; done: number; review: number; purposeDone: number };
  drafts: { profileBio: boolean; pinned: boolean[] };
  promotions: { included: number; missingCta: number };
  research: { total: number; included: number; explained: number; pending: number };
};

describe("GET /prompt の materials（FR-121・FR-123、SC-017）", () => {
  it("材料が空なら、すべて0・なし。課題は目的の5問・活動の軸・16項目の順", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const { materials } = (await getPrompt(accountId)) as PromptBody & { materials: Materials };
    expect(materials.strategy.items.map((i) => i.key).slice(0, 7)).toEqual([
      "purposeOrigin",
      "purposeSelf",
      "purposeOthers",
      "purposeFuture",
      "purposeStance",
      "activityAxis",
      "finalAction",
    ]);
    expect(materials.strategy.items).toHaveLength(22);
    expect(materials.strategy.items[5]).toEqual({ key: "activityAxis", status: null, chars: 0 });
    expect(materials).toMatchObject({
      strategy: { done: 0, review: 0, purposeDone: 0 },
      drafts: { profileBio: false, pinned: [false, false, false] },
      promotions: { included: 0, missingCta: 0 },
      research: { total: 0, included: 0, explained: 0, pending: 0 },
    });
  });

  it("課題の判定と文字数、下書きのあり・なし、宣伝（公開中で期限内・行動喚起が空）、リサーチの件数", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const q = neon(testEnv.DATABASE_URL);
    await q`INSERT INTO strategy_designs (account_id, target_persona, purpose_origin, activity_axis, pinned_post_draft_2)
      VALUES (${accountId}, '20代', ${"上京して寂しかった。".repeat(10)}, 'ひとりにしない', '固定投稿の案')`;
    await q`INSERT INTO promotions (account_id, title, content, cta) VALUES (${accountId}, 'A', 'A', 'DMで')`;
    await q`INSERT INTO promotions (account_id, title, content) VALUES (${accountId}, 'B', 'B')`;
    await q`INSERT INTO promotions (account_id, title, content, status) VALUES (${accountId}, 'C', 'C', 'paused')`;
    await q`INSERT INTO promotions (account_id, title, content, valid_until) VALUES (${accountId}, 'D', 'D', '2020-01-01')`;
    for (let i = 0; i < 12; i++) {
      await q`INSERT INTO reference_posts (account_id, body, why_good) VALUES (${accountId}, ${`参考${i}`}, ${i < 4 ? "解説" : null})`;
    }
    const { materials } = (await getPrompt(accountId)) as PromptBody & { materials: Materials };
    const item = (key: string) => materials.strategy.items.find((i) => i.key === key);
    expect(item("targetPersona")).toEqual({ key: "targetPersona", status: "short", chars: 3 });
    expect(item("purposeOrigin")).toMatchObject({ status: "ok", chars: 100 });
    expect(item("activityAxis")).toEqual({ key: "activityAxis", status: null, chars: 7 });
    expect(materials.strategy).toMatchObject({ done: 0, review: 1, purposeDone: 1 });
    expect(materials.drafts).toEqual({ profileBio: false, pinned: [false, true, false] });
    expect(materials.promotions).toEqual({ included: 2, missingCta: 1 });
    expect(materials.research).toEqual({ total: 12, included: 10, explained: 4, pending: 8 });
  });

  it("宣伝の割合が0%なら、宣伝はプロンプトに入らないので0件", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const q = neon(testEnv.DATABASE_URL);
    await q`UPDATE accounts SET promotion_ratio_percent = 0 WHERE id = ${accountId}`;
    await q`INSERT INTO promotions (account_id, title, content) VALUES (${accountId}, 'A', 'A')`;
    const { materials } = (await getPrompt(accountId)) as PromptBody & { materials: Materials };
    expect(materials.promotions).toEqual({ included: 0, missingCta: 0 });
  });
});
