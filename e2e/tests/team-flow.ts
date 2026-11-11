// チームの操作の手順（specs/011-team-revision quickstart.md 2、SC-007）。
// E2E（team.spec.ts）と、手で確かめるための3人の画面を開くスクリプト（scripts/team-open.ts）で使う。
// テストの外でも動くよう、待つのは Playwright の waitFor・waitForURL だけにする（確かめは呼ぶ側で行う）。
import type { Page } from "@playwright/test";

const ACCOUNT_URL = /\/threads\/accounts\/([0-9a-f-]{36})$/;
const TEAM_URL = /\/threads\/teams\/([0-9a-f-]{36})$/;

/** 偽のThreadsのユーザー（tests/helpers.ts の registerFakeUsers）と、アカウントの表示名。 */
export const FAKE_ACCOUNTS = {
  admin: { id: "9002", name: "Partner Co" },
  owner: { id: "9001", name: "E2E User" },
  editor: { id: "9003", name: "Cafe B" },
} as const;

/**
 * 自分のアカウントを1つ作り、偽のThreadsのアカウントにつなぐ（specs/012：名前だけで作ってから、設定でつなぐ）。
 * アカウントの名前は、偽のThreadsの表示名にする（チームの画面などの見え方を011のときとそろえる）。
 * @param page - つなぐ人のページ
 * @param fakeUserId - 偽のThreadsのユーザー
 * @returns つないだAccountのID
 */
export async function connectThreads(page: Page, fakeUserId: string): Promise<string> {
  const name = Object.values(FAKE_ACCOUNTS).find((a) => a.id === fakeUserId)?.name ?? `アカウント ${fakeUserId}`;
  await page.goto("/threads/accounts/new");
  await page.getByLabel("アカウントの名前").fill(name);
  await page.getByRole("button", { name: "作る", exact: true }).click();
  await page.waitForURL(ACCOUNT_URL);
  const accountId = ACCOUNT_URL.exec(new URL(page.url()).pathname)![1]!;
  await page.goto(`/threads/accounts/${accountId}/settings`);
  await page.getByRole("button", { name: "Threadsで許可する" }).click();
  await page.locator(fakeUserId === FAKE_ACCOUNTS.owner.id ? "#allow" : `#allow-${fakeUserId}`).click();
  await page.waitForURL(new RegExp(`/threads/accounts/${accountId}/settings`));
  return accountId;
}

/**
 * このアカウントの設定の「チームを作る」から、チームを作る（作った人が管理者）。
 * @param page - 管理者のページ
 * @param accountId - チームに入れる自分のアカウント
 * @param name - チーム名
 * @returns 作ったチームのID
 */
export async function createTeam(page: Page, accountId: string, name: string): Promise<string> {
  await page.goto(`/threads/accounts/${accountId}/settings`);
  await page.getByRole("button", { name: "チームを作る" }).click();
  const dialog = page.getByRole("dialog", { name: "チームを作る" });
  await dialog.getByLabel("チーム名").fill(name);
  await dialog.getByRole("button", { name: "作る" }).click();
  await page.waitForURL(TEAM_URL);
  return TEAM_URL.exec(new URL(page.url()).pathname)![1]!;
}

/**
 * 管理者が「メンバーを招待」のダイアログからリンクを読み、ダイアログを閉じる。
 * @param page - 管理者のページ
 * @param teamId - チーム
 * @returns 招待リンク
 */
export async function readTeamInvite(page: Page, teamId: string): Promise<string> {
  await page.goto(`/threads/teams/${teamId}`);
  await page.getByRole("button", { name: "メンバーを招待" }).click();
  const dialog = page.getByRole("dialog", { name: /にメンバーを招待$/ });
  const input = dialog.locator('input#invite-link[value*="/invite/t_"]');
  await input.waitFor();
  const link = await input.inputValue();
  await dialog.getByRole("button", { name: "閉じる" }).last().click();
  return link;
}

/**
 * 招待リンクから、自分のアカウントを選んで参加する（入った人はメンバー）。
 * @param page - 参加する人のページ
 * @param link - 招待リンク
 * @param accountName - チームに入れる自分のアカウントの表示名
 * @param opts - shared：そのアカウントを「チームに見せる」にする
 */
export async function joinByLink(page: Page, link: string, accountName: string, opts: { shared?: boolean } = {}) {
  await page.goto(link);
  await page.getByRole("checkbox", { name: `${accountName}をチームに入れる` }).check();
  if (opts.shared) await page.getByRole("switch", { name: `${accountName}をチームに見せる` }).click();
  await page.getByRole("button", { name: "1件のアカウントで参加する" }).click();
  await page.waitForURL(TEAM_URL);
}

/**
 * 管理者が、アカウントの表示名で見つけた人のロールを編集者にする。
 * @param page - 管理者のページ
 * @param teamId - チーム
 * @param accountName - その人がチームに入れているアカウントの表示名
 */
export async function makeEditor(page: Page, teamId: string, accountName: string) {
  await page.goto(`/threads/teams/${teamId}`);
  const row = page.getByRole("list", { name: "メンバーの一覧" }).getByRole("listitem").filter({ hasText: accountName });
  await row.getByRole("button", { name: "編集者" }).click();
  await row.locator('button[aria-pressed="true"]', { hasText: "編集者" }).waitFor();
}

/**
 * 管理者が、担当の表で編集者をアカウントの担当にする。
 * @param page - 管理者のページ
 * @param teamId - チーム
 * @param accountName - 担当にするアカウントの表示名
 */
export async function assignEditor(page: Page, teamId: string, accountName: string) {
  await page.goto(`/threads/teams/${teamId}/assign`);
  // 行の名前の下に「編集者」（担当がなければ「編集者 · 担当を決めてください」）と出る
  const row = page.getByRole("row").filter({ hasText: "編集者" });
  // 読み上げの名前は「（名前）（@ユーザー名）の担当にする」（012。名前が重なっても見分けられるように）
  const cell = row.getByRole("checkbox", { name: new RegExp(`を${accountName}(（@[^）]+）)?の担当にする$`) });
  await cell.click();
  await row.locator(`[role="checkbox"][aria-checked="true"]`).first().waitFor();
}

/**
 * オーナーが、チームの画面で自分のアカウントを「チームに見せる」にする。
 * @param page - オーナーのページ
 * @param teamId - チーム
 * @param accountName - 見せるアカウントの表示名
 */
export async function shareAccount(page: Page, teamId: string, accountName: string) {
  await page.goto(`/threads/teams/${teamId}`);
  const sw = page.getByRole("switch", { name: `${accountName}をチームに見せる` });
  await sw.click();
  await page.locator(`[role="switch"][aria-checked="true"][aria-label="${accountName}をチームに見せる"]`).waitFor();
}
