// チーム運用の操作の手順（specs/008-team-operations quickstart.md 手順3・4）。
// E2E（team.spec.ts）と、手で確かめるための3人の画面を開くスクリプト（scripts/team-open.ts）で使う。
// テストの外でも動くよう、待つのは Playwright の waitFor・waitForURL だけにする（確かめは呼ぶ側で行う）。
import type { Page } from "@playwright/test";

const ACCOUNT_URL = /\/accounts\/([0-9a-f-]{36})$/;

/**
 * オーナーが偽のThreadsのアカウントを接続する。
 * @param page - オーナーのページ
 * @param fakeUserId - 偽のThreadsのユーザー（省略すると既定の @e2e_user）
 * @returns 接続したAccountのID
 */
export async function connectThreads(page: Page, fakeUserId?: string): Promise<string> {
  await page.goto("/accounts/new");
  await page.getByRole("button", { name: "Threadsアカウントを接続" }).click();
  await page.locator(fakeUserId ? `#allow-${fakeUserId}` : "#allow").click();
  await page.waitForURL(ACCOUNT_URL);
  return ACCOUNT_URL.exec(new URL(page.url()).pathname)![1]!;
}

/**
 * 招待のダイアログからリンクを読み、ダイアログを閉じる。
 * @param page - ページ
 * @param title - ダイアログの見出し
 * @param prefix - リンクの種類（p_ または e_）
 * @returns 招待リンク
 */
async function readInviteLink(page: Page, title: string, prefix: "p_" | "e_"): Promise<string> {
  const dialog = page.getByRole("dialog", { name: title });
  const input = dialog.locator(`input#invite-link[value*="/invite/${prefix}"]`);
  await input.waitFor();
  const link = await input.inputValue();
  await dialog.getByRole("button", { name: "閉じる" }).last().click();
  return link;
}

/**
 * オーナーがパートナーの招待リンクを作る。
 * @param page - オーナーのページ
 * @param accountId - Account
 * @returns 招待リンク
 */
export async function createPartnerInvite(page: Page, accountId: string): Promise<string> {
  await page.goto(`/accounts/${accountId}/settings`);
  await page.getByRole("button", { name: "招待リンクを作る" }).click();
  return readInviteLink(page, "パートナーを招待", "p_");
}

/**
 * 招待リンクから参加する。
 * @param page - 参加する人のページ
 * @param link - 招待リンク
 * @param teamName - 初めてのパートナーのチーム名
 */
export async function joinByLink(page: Page, link: string, teamName?: string) {
  await page.goto(link);
  if (teamName) await page.getByLabel(/チーム名（会社名）/).fill(teamName);
  await page.getByRole("button", { name: "参加する" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/invite/"));
}

/**
 * パートナーが編集者の招待リンクを出す。
 * @param page - パートナーのページ
 * @returns 招待リンク
 */
export async function createEditorInvite(page: Page): Promise<string> {
  await page.goto("/partner/editors");
  await page.getByRole("button", { name: "編集者を招待" }).first().click();
  return readInviteLink(page, "編集者を招待", "e_");
}

/**
 * パートナーが、表の最初の「担当にする」のチェックを付ける（編集者1人・Account1件のとき）。
 * @param page - パートナーのページ
 */
export async function assignFirstEditor(page: Page) {
  await page.goto("/partner/editors");
  const assign = page.getByRole("checkbox", { name: /の担当にする$/ }).first();
  await assign.click();
  await page.locator('[role="checkbox"][aria-checked="true"]').first().waitFor();
}
