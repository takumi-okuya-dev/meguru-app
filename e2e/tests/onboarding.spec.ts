// US1・US2：初回ログイン → 接続 → Accountの画面 → ログアウト → 再ログインで同じAccountに戻る
import { expect, test } from "@playwright/test";
import { resetAll, signIn, signOut } from "./helpers";

test.beforeEach(async () => {
  await resetAll();
});

test("初回ログインからAccountの画面まで進み、再ログインで同じAccountに戻る", async ({ page }) => {
  await signIn(page);
  await page.goto("/");
  await expect(page).toHaveURL(/\/accounts\/new$/);
  await expect(page.getByText("招待されたThreadsアカウントのみ接続できます", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "Threadsアカウントを接続" }).click();
  // 偽のThreadsの認可画面で許可する
  await page.locator("#allow").click();

  await expect(page).toHaveURL(/\/accounts\/[0-9a-f-]{36}$/);
  await expect(page.getByText("@e2e_user を追加しました")).toBeVisible();
  await expect(page.getByRole("heading", { name: "E2E User" })).toBeVisible();
  const accountUrl = page.url();

  await signOut(page);
  await page.goto(accountUrl);
  await expect(page).toHaveURL(/\/sign-in/);

  await signIn(page);
  await page.goto("/");
  await expect(page).toHaveURL(accountUrl);
});

test("Threads側でキャンセルすると、アカウント追加画面に戻ってキャンセルの案内が出る", async ({ page }) => {
  await signIn(page);
  await page.goto("/accounts/new");
  await page.getByRole("button", { name: "Threadsアカウントを接続" }).click();
  await page.locator("#deny").click();
  await expect(page).toHaveURL(/\/accounts\/new$/);
  await expect(page.getByText("Threadsとの接続がキャンセルされました。")).toBeVisible();
});
