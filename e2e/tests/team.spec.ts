// チーム（specs/011-team-revision quickstart.md 2、SC-007）を、管理者・オーナー（メンバー）・編集者の3人のブラウザで流す。
// それぞれ別の BrowserContext（Cookieが別）でログインするので、3つのウィンドウを手で用意しなくてよい。
// 管理者がチームを作る → 2人が自分のアカウントを入れて参加 → 1人を編集者にして担当 → オーナーが見せる → 管理者が読む
// → 編集者が案を登録・承認できない → 管理者が引き継いで抜ける。ロールの全体像は docs/team-roles.md。
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { resetAll, signInAs, type TeamRole } from "./helpers";
import {
  FAKE_ACCOUNTS,
  assignEditor,
  connectThreads,
  createTeam,
  joinByLink,
  makeEditor,
  readTeamInvite,
  shareAccount,
} from "./team-flow";

test.describe.configure({ mode: "serial" });

const contexts: BrowserContext[] = [];
const pages = {} as Record<TeamRole, Page>;
const accounts = {} as Record<TeamRole, string>;
let teamId = "";

/**
 * 役割ごとに新しいブラウザ（Cookieが別）を開いてログインする。
 * @param browser - ブラウザ
 * @param role - 役割
 * @returns ログイン済みのページ
 */
async function openAs(browser: Browser, role: TeamRole): Promise<Page> {
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  await signInAs(page, role);
  return page;
}

test.beforeAll(async ({ browser }) => {
  await resetAll();
  for (const role of ["admin", "owner", "editor"] as const) {
    pages[role] = await openAs(browser, role);
    accounts[role] = await connectThreads(pages[role], FAKE_ACCOUNTS[role].id);
  }
});

test.afterAll(async () => {
  for (const context of contexts) await context.close();
});

test("管理者がチームを作り、2人が招待リンクから自分のアカウントを入れて参加する（US1）", async () => {
  const { admin, owner, editor } = pages;
  teamId = await createTeam(admin, accounts.admin, "飲食チーム");
  const link = await readTeamInvite(admin, teamId);
  expect(link).toMatch(/\/invite\/t_/);

  await joinByLink(owner, link, FAKE_ACCOUNTS.owner.name);
  await joinByLink(editor, link, FAKE_ACCOUNTS.editor.name);

  // 3人とも、サイドバーの「チーム」の見出しの下に「飲食チーム」が出る（US4）
  for (const page of [admin, owner, editor]) {
    await page.goto(`/teams/${teamId}`);
    const nav = page.getByRole("navigation", { name: "このアカウント" });
    await expect(nav.getByRole("link", { name: /飲食チーム/ })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("list", { name: "メンバーの一覧" }).getByRole("listitem")).toHaveCount(3);
  }
  // 参加の知らせは管理者だけ
  await admin.goto(`/teams/${teamId}`);
  await expect(admin.getByText(/さんが参加しました$/)).toHaveCount(2);
});

test("管理者が1人を編集者にして担当を決める。メンバーには表とロールの切り替えが出ない（US2）", async () => {
  const { admin, owner } = pages;
  await makeEditor(admin, teamId, FAKE_ACCOUNTS.editor.name);
  await assignEditor(admin, teamId, FAKE_ACCOUNTS.owner.name);

  await owner.goto(`/teams/${teamId}`);
  await expect(owner.getByText(/あなたのロール：メンバー/)).toBeVisible();
  await expect(owner.getByRole("link", { name: "担当を決める" })).toHaveCount(0);
  await expect(owner.getByRole("group", { name: /のロール$/ })).toHaveCount(0);
});

test("オーナーが見せると、管理者が投稿ストックと戦略を読むだけで開ける（US3）", async () => {
  const { admin, owner } = pages;
  // 見せる前は、管理者には点線の「見せていません」
  await admin.goto(`/teams/${teamId}`);
  await expect(admin.getByText(`${FAKE_ACCOUNTS.owner.name} · 見せていません`)).toBeVisible();

  await shareAccount(owner, teamId, FAKE_ACCOUNTS.owner.name);

  await admin.goto(`/teams/${teamId}`);
  await admin.getByRole("link", { name: new RegExp(`${FAKE_ACCOUNTS.owner.name}を見る$`) }).click();
  await expect(admin).toHaveURL(new RegExp(`/teams/${teamId}/accounts/${accounts.owner}$`));
  await expect(admin.getByRole("status").filter({ hasText: "読むだけ" })).toBeVisible();
  await expect(admin.getByRole("button", { name: /を承認$/ })).toHaveCount(0);
  await admin.getByRole("button", { name: "戦略" }).click();
  await expect(admin.getByRole("heading", { name: "課題" })).toBeVisible();
  // 設定・パフォーマンスはAPIでも拒まれ、Accountの画面には入れない（読むだけの画面へ戻される）
  await admin.goto(`/accounts/${accounts.owner}/settings`);
  await expect(admin).toHaveURL(new RegExp(`/teams/${teamId}/accounts/${accounts.owner}$`));
});

test("編集者は担当のアカウントで案を登録でき、承認のボタンは出ない（オーナーの確認待ち）", async () => {
  const { editor, owner } = pages;
  await editor.goto(`/accounts/${accounts.owner}`);
  await expect(editor.getByText(`${FAKE_ACCOUNTS.owner.name}の担当になりました。投稿の案を作れます。`)).toBeVisible();
  await expect(editor.getByText("担当しています").first()).toBeVisible();
  // 案は「投稿をつくる」で登録し、投稿ストックで確かめる（specs/014 US15）
  await editor.goto(`/accounts/${accounts.owner}/create`);
  await editor.getByPlaceholder("AIの返信をここに貼り付け…").fill("一つ目の案です\n@@@\n二つ目の案です");
  await editor.getByRole("button", { name: "投稿ストックに登録する" }).click();
  await editor.getByRole("link", { name: "投稿ストックで確かめる" }).click();
  await expect(editor.getByText("オーナーの確認待ち")).toHaveCount(2);
  await expect(editor.getByRole("button", { name: /を承認$/ })).toHaveCount(0);

  // 承認はオーナーだけ
  await owner.goto(`/accounts/${accounts.owner}/stock`);
  await expect(owner.getByRole("button", { name: /を承認$/ })).toHaveCount(2);
});

test("管理者は引き継ぎ先を選ぶまで抜けられない。オーナーへ引き継いで抜けると、オーナーが管理者になる（US5）", async () => {
  const { admin, owner } = pages;
  await admin.goto(`/teams/${teamId}`);
  await admin.getByRole("button", { name: "チームを抜ける" }).click();
  const dialog = admin.getByRole("dialog", { name: "飲食チームを抜けますか？" });
  const go = dialog.getByRole("button", { name: "引き継いで抜ける" });
  await expect(go).toBeDisabled();
  await dialog.locator("label").filter({ hasText: "メンバー" }).getByRole("radio").check();
  await go.click();
  await admin.waitForURL((url) => !url.pathname.startsWith(`/teams/${teamId}`));

  await owner.goto(`/teams/${teamId}`);
  await expect(owner.getByRole("button", { name: "メンバーを招待" })).toBeVisible();
  await expect(owner.getByRole("list", { name: "メンバーの一覧" }).getByRole("listitem")).toHaveCount(2);

  // 抜けた管理者には、チームが出なくなる
  await admin.goto(`/accounts/${accounts.admin}`);
  await expect(admin.getByRole("navigation", { name: "このアカウント" }).getByRole("link", { name: /飲食チーム/ })).toHaveCount(0);
});
