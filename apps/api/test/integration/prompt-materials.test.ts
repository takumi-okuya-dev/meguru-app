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
