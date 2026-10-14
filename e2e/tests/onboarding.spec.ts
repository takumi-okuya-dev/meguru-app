// はじめての人の流れ（specs/012-accounts-before-connect quickstart.md 2 の1・2、SC-001・SC-002）。
// 名前だけでアカウントを作る → 課題 → 案の登録 → 承認 → ホームの「次にやること」 → 設定でトークンでつなぐ → 「自動投稿を始める」。
// あわせて、001の「ログアウト → 再ログインで同じアカウントに戻る」と、許可の画面でのキャンセルを確かめる。
import { expect, test } from "@playwright/test";
import { connectWithToken, createAccount, makeToken, resetAll, signIn, signOut } from "./helpers";

test.beforeEach(async () => {
  await resetAll();
});

test("名前だけで作り、つながずに課題・案の登録・承認まで進め、設定でトークンでつなぐ", async ({ page }) => {
  await signIn(page);
  await page.goto("/");
  await expect(page).toHaveURL(/\/accounts\/new$/);
  await expect(page.getByRole("heading", { name: "アカウントを作る" })).toBeVisible();
  // Threadsへの接続の操作は、この画面に出さない（FR-001）
  await expect(page.getByRole("button", { name: /Threadsで許可する|Threadsアカウントを接続/ })).toHaveCount(0);

  const startedAt = Date.now();
  const accountId = await createAccount(page, "カフェの公式");
  // SC-001：ログインから1分以内に作れる（ここでは作るまで）
  expect(Date.now() - startedAt).toBeLessThan(60_000);
  await expect(page.getByRole("heading", { name: "カフェの公式" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Threadsとの接続" })).toContainText("未接続：");

  // 課題（つながっていなくても使える。FR-031）
  await page.goto(`/accounts/${accountId}/strategy`);
  await page.getByLabel("最終的に読者に取ってほしい行動").fill("来店してもらう");
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByText("保存しました")).toBeVisible();

  // 案の登録と承認
  await page.goto(`/accounts/${accountId}/stock`);
  await page.getByPlaceholder("AIの返信をここに貼り付け…").fill("つなぐ前の案1\n@@@\nつなぐ前の案2");
  await page.getByRole("button", { name: "投稿ストックに登録する" }).click();
  await expect(page.getByText("つなぐ前の案1")).toBeVisible();
  await page.getByRole("button", { name: "「つなぐ前の案1」を承認" }).click();
  await expect(page.getByText("承認しました")).toBeVisible();
  // 投稿ストックの知らせ（FR-033）
  await expect(page.getByText("承認した案は、Threadsにつないで自動投稿をオンにすると投稿されます")).toBeVisible();

  // ホームの「次にやること」が「つなぐ」になる（Clarifications 2026-10-14）
  await page.goto(`/accounts/${accountId}`);
  await expect(page.getByRole("heading", { name: "Threadsにつないで自動投稿を始めましょう" })).toBeVisible();

  // 設定でトークンでつなぐ（US2-3）
  const token = await makeToken(page, "9003");
  await connectWithToken(page, accountId, token);
  await expect(page.getByText("カフェの公式をThreadsにつなぎました（@cafe_b）")).toBeVisible();
  await page.getByRole("button", { name: "自動投稿を始める" }).click();
  const dialog = page.getByRole("dialog", { name: "投稿のスケジュール" });
  await expect(dialog).toBeVisible();
  // 自動投稿はオフのまま（FR-014）
  await expect(dialog.getByRole("switch", { name: "自動投稿" })).not.toBeChecked();
  await dialog.getByRole("button", { name: /キャンセル|閉じる/ }).first().click();

  // つないでも、主の名前は変わらず、案は残っている（SC-003）
  await page.goto(`/accounts/${accountId}/stock`);
  await expect(page.getByText("つなぐ前の案2")).toBeVisible();
  await page.goto(`/accounts/${accountId}/stock?tab=approved`);
  await expect(page.getByText("つなぐ前の案1")).toBeVisible();
  await expect(page.getByRole("button", { name: "Accountを切り替える" })).toContainText("カフェの公式");

  // 001：ログアウト → 再ログインで同じアカウントに戻る
  await signOut(page);
  await page.goto(`/accounts/${accountId}`);
  await expect(page).toHaveURL(/\/sign-in/);
  await signIn(page);
  await page.goto("/");
  await expect(page).toHaveURL(new RegExp(`/accounts/${accountId}$`));
});

test("許可の画面でキャンセルすると、設定の「Threadsとの接続」に戻ってキャンセルの案内が出る", async ({ page }) => {
  await signIn(page);
  const accountId = await createAccount(page, "カフェの公式");
  await page.goto(`/accounts/${accountId}/settings`);
  await page.getByRole("button", { name: "Threadsで許可する" }).click();
  await page.locator("#deny").click();
  await expect(page).toHaveURL(new RegExp(`/accounts/${accountId}/settings`));
  await expect(page.getByText("Threadsとの接続がキャンセルされました。")).toBeVisible();
  await expect(page.getByRole("button", { name: "Threadsで許可する" })).toBeVisible();
});
