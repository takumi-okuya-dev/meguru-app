// specs/002 US1：課題を入力して保存し、再読み込みで復元される。未保存のまま移動すると確認が出る
import { expect, test } from "@playwright/test";
import { resetAll, signIn } from "./helpers";

test.beforeEach(async () => {
  await resetAll();
});

test("課題を保存すると再読み込みで復元され、未保存のまま移動すると確認が出る", async ({ page }) => {
  await signIn(page);
  await page.goto("/accounts/new");
  await page.getByRole("button", { name: "Threadsアカウントを接続" }).click();
  await page.locator("#allow").click();
  await expect(page).toHaveURL(/\/accounts\/[0-9a-f-]{36}$/);
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
