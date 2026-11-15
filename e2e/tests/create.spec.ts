// specs/014 US15・US10・US12：「投稿をつくる」でコピー → 貼り付け（コードブロックつき）→ 登録 → 投稿ストックで確かめる
import { expect, test } from "@playwright/test";
import { createAccount, resetAll, signIn } from "./helpers";

test.beforeEach(async () => {
  await resetAll();
});

test("サイドバーの「投稿をつくる」で開き、プロンプトをコピーして、コードブロックの答えを登録できる", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signIn(page);
  const accountId = await createAccount(page, "投稿をつくるアカウント");

  await page.getByRole("navigation", { name: "このアカウント" }).getByRole("link", { name: "投稿をつくる" }).click();
  await expect(page).toHaveURL(new RegExp(`/threads/accounts/${accountId}/create$`));
  await expect(page.getByRole("region", { name: "投稿ができるまでの5つの手順" })).toBeVisible();

  // プロンプトに014の指示が入っている
  await page.getByRole("button", { name: "コピー" }).click();
  await expect(page.getByText("コピーしました。ChatGPTやClaudeに貼り付けて送ってください")).toBeVisible();
  const prompt = await page.evaluate(() => navigator.clipboard.readText());
  expect(prompt).toContain("【最初に確認すること(最重要)】");
  expect(prompt).toContain("1つのコードブロック");
  expect(prompt).toContain("■出力する前の最終チェック");

  // AIの答え（偽）はコードブロックで囲まれている
  await page.getByPlaceholder("AIの返信をここに貼り付け…").fill("```\n朝のカフェの案\n@@@\n夜のカフェの案\n```");
  await page.getByRole("button", { name: "投稿ストックに登録する" }).click();
  await expect(page.getByText("2件を投稿ストックに登録しました")).toBeVisible();

  await page.getByRole("link", { name: "投稿ストックで確かめる" }).click();
  await expect(page).toHaveURL(new RegExp(`/threads/accounts/${accountId}/stock$`));
  await expect(page.getByText("朝のカフェの案")).toBeVisible();
  await expect(page.getByText("夜のカフェの案")).toBeVisible();
  await expect(page.getByText("```")).toHaveCount(0);
  // 投稿ストックは一覧だけ
  await expect(page.getByPlaceholder("AIの返信をここに貼り付け…")).toHaveCount(0);
});
