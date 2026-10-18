// specs/002 US1：課題を入力して保存し、再読み込みで復元される。未保存のまま移動すると確認が出る
import { expect, test } from "@playwright/test";
import { createAccount, resetAll, signIn } from "./helpers";

test.beforeEach(async () => {
  await resetAll();
});

test("課題を保存すると再読み込みで復元され、未保存のまま移動すると確認が出る", async ({ page }) => {
  await signIn(page);
  // つながっていなくても課題は使える（specs/012 FR-031）
  await createAccount(page, "課題のアカウント");
  const accountUrl = page.url();

  // ホームの案内から課題の画面へ
  await expect(page.getByRole("heading", { name: "まずは「課題」から埋めましょう" })).toBeVisible();
  await page.goto(`${accountUrl}/strategy`);
  const field = page.getByLabel("最終的に読者に取ってほしい行動");
  await field.fill("一緒に活動してもらう");
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByText("保存しました")).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("最終的に読者に取ってほしい行動")).toHaveValue("一緒に活動してもらう");

  // 未保存のままサイドバーで移動すると、確認のダイアログが出る
  await page.getByLabel("最終的に読者に取ってほしい行動").fill("書きかけ");
  await page.getByRole("link", { name: "ホーム" }).click();
  await expect(page.getByText("保存していない変更があります")).toBeVisible();
  await page.getByRole("button", { name: "編集に戻る" }).click();
  await expect(page.getByLabel("最終的に読者に取ってほしい行動")).toHaveValue("書きかけ");
});

// specs/014 US1〜US3・US5：目的の5問・考えるヒント・自動チェック・AIと深掘りする（偽の答えを貼る）
test("目的の5問・考えるヒント・自動チェックが出て、AIの答えを貼って反映・保存できる", async ({ page }) => {
  await signIn(page);
  const accountId = await createAccount(page, "目的のアカウント");
  await page.goto(`/accounts/${accountId}/strategy`);

  // 目的の5問（区分の初め）
  const q1 = page.getByLabel("Q1：なぜ、この活動を始めようと思いましたか？");
  await q1.fill("上京して、友だちがいなくて寂しかったから");

  // 考えるヒントと自動チェック
  const persona = page.locator("#field-targetPersona");
  await persona.getByRole("button", { name: /考えるヒント/ }).click();
  await expect(persona.getByText("○ 良い例")).toBeVisible();
  await persona.getByRole("textbox").fill("20代");
  await expect(persona.getByText("短め")).toBeVisible();
  await expect(page.getByRole("region", { name: "進み具合" })).toBeVisible();

  // AIと深掘りする：AIの答え（偽）を貼り、目印の内側を反映する
  const worries = page.locator("#field-realWorries");
  await worries.getByRole("button", { name: "この項目をAIと深掘りする" }).click();
  await worries
    .getByLabel("AIの答えを貼り付ける")
    .fill("まとめました。\n【完成版ここから】\n会社と家の往復で、新しい出会いがない\n【完成版ここまで】\nどうですか？");
  await worries.getByRole("button", { name: "この内容を反映する" }).click();
  await expect(page.getByLabel("ターゲットの本音の悩み")).toHaveValue("会社と家の往復で、新しい出会いがない");

  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByText("保存しました")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("ターゲットの本音の悩み")).toHaveValue("会社と家の往復で、新しい出会いがない");
  await expect(page.getByLabel("Q1：なぜ、この活動を始めようと思いましたか？")).toHaveValue("上京して、友だちがいなくて寂しかったから");
});
