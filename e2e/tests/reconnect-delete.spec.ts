// US4：トークンの無効化 → 画面を開くと「要再接続」 → 再接続 → 削除
import { expect, test } from "@playwright/test";
import { control, resetAll, signIn } from "./helpers";

test.beforeEach(async () => {
  await resetAll();
});

test("接続が切れたら要再接続になり、再接続で戻り、削除できる", async ({ page }) => {
  await signIn(page);
  await page.goto("/accounts/new");
  await page.getByRole("button", { name: "Threadsアカウントを接続" }).click();
  await page.locator("#allow").click();
  await expect(page).toHaveURL(/\/accounts\/[0-9a-f-]{36}$/);
  const accountUrl = page.url();

  // Threads側でトークンが無効になる → 画面を開いた時点で検知される（SC-007）
  await control("invalidate", { userId: "9001" });
  await page.goto(accountUrl);
  await expect(page.getByText("Threadsとの接続が切れています。", { exact: false })).toBeVisible();

  await page.getByRole("link", { name: "再接続" }).click();
  await expect(page).toHaveURL(`${accountUrl}/settings`);
  await page.getByRole("button", { name: "再接続" }).click();
  await page.locator("#allow").click();
  await expect(page.getByText("@e2e_user を再接続しました")).toBeVisible();
  await expect(page.getByText("Threadsとの接続が切れています。", { exact: false })).toHaveCount(0);

  // 削除：@付きで入力しても一致する
  await page.getByRole("button", { name: "Accountを削除" }).click();
  const confirmButton = page.getByRole("button", { name: "削除する" });
  await expect(confirmButton).toBeDisabled();
  await page.getByLabel("確認のためのユーザー名").fill("@E2E_user");
  await confirmButton.click();
  await expect(page).toHaveURL(/\/accounts\/new$/);
});
