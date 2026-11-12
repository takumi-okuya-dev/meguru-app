// US4：トークンの無効化 → 画面を開くと「要再接続」 → 再接続 → 削除（specs/012 で、作ってからつなぐ・名前で削除の確認にした）
import { expect, test } from "@playwright/test";
import { connectWithApp, control, createAccount, resetAll, signIn } from "./helpers";

test.beforeEach(async () => {
  await resetAll();
});

test("接続が切れたら要再接続になり、再接続で戻り、削除できる", async ({ page }) => {
  await signIn(page);
  const accountId = await createAccount(page, "E2Eのアカウント");
  await connectWithApp(page, accountId);
  const accountUrl = new URL(`/threads/accounts/${accountId}`, page.url()).toString();

  // Threads側でトークンが無効になる → 画面を開いた時点で検知される（SC-007）
  await control("invalidate", { userId: "9001" });
  await page.goto(accountUrl);
  await expect(page.getByText("Threadsとの接続が切れています。", { exact: false })).toBeVisible();

  // 要再接続のバナーの「再接続」（ホームの自動投稿の知らせにも同じ名前のボタンが出ることがあるので、バナーのものを押す）
  await page.getByRole("link", { name: "再接続" }).first().click();
  await expect(page).toHaveURL(`${accountUrl}/settings`);
  await page.locator("#threads").getByRole("button", { name: "再接続" }).click();
  const dialog = page.getByRole("dialog", { name: "Threadsとの接続し直し" });
  await dialog.getByRole("button", { name: /Threadsで許可する/ }).click();
  await page.locator("#allow").click();
  await expect(page.getByText("E2Eのアカウントを再接続しました")).toBeVisible();
  await expect(page.getByText("Threadsとの接続が切れています。", { exact: false })).toHaveCount(0);

  // 削除：アカウントの名前で確かめる（specs/012 FR-043）。ユーザー名では消せない
  await page.getByRole("button", { name: "Accountを削除" }).click();
  const confirmButton = page.getByRole("button", { name: "削除する" });
  await page.getByLabel("確認のためのアカウントの名前").fill("e2e_user");
  await expect(confirmButton).toBeDisabled();
  await page.getByLabel("確認のためのアカウントの名前").fill(" E2Eのアカウント ");
  await confirmButton.click();
  await expect(page).toHaveURL(/\/threads\/accounts\/new$/);
});
