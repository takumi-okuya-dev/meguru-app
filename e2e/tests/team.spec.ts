// チーム運用（specs/008-team-operations quickstart.md 手順3〜6・8）を、オーナー・パートナー・編集者の3人のブラウザで流す。
// それぞれ別の BrowserContext（Cookieが別）でログインするので、3つのウィンドウを手で用意しなくてよい。
// 役割の全体像は docs/team-roles.md。
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { resetAll, signInAs, type TeamRole } from "./helpers";
import { assignFirstEditor, connectThreads, createEditorInvite, createPartnerInvite, joinByLink } from "./team-flow";

test.describe.configure({ mode: "serial" });

const contexts: BrowserContext[] = [];
const pages = {} as Record<TeamRole, Page>;
let accountId = "";

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
  for (const role of ["owner", "partner", "editor"] as const) pages[role] = await openAs(browser, role);
});

test.afterAll(async () => {
  for (const context of contexts) await context.close();
});

test("オーナーがパートナーを招き、パートナーがチーム名を入れて参加する（US1）", async () => {
  const { owner, partner } = pages;
  accountId = await connectThreads(owner);
  const link = await createPartnerInvite(owner, accountId);
  expect(link).toMatch(/\/invite\/p_/);
  await expect(owner.getByText("パートナーを招待中（参加待ち）")).toBeVisible();

  await joinByLink(partner, link, "A社");
  await expect(partner).toHaveURL(new RegExp(`/accounts/${accountId}$`));
  await expect(partner.getByText("パートナーとして手伝っています").first()).toBeVisible();
});

test("パートナーは投稿の案を登録できるが、任されるまで承認できない（FR-041）", async () => {
  const { partner } = pages;
  await partner.goto(`/accounts/${accountId}/stock`);
  await partner.getByPlaceholder("AIの返信をここに貼り付け…").fill("一つ目の案です\n@@@\n二つ目の案です");
  await partner.getByRole("button", { name: "投稿ストックに登録する" }).click();
  await expect(partner.getByText("オーナーの確認待ち")).toHaveCount(2);
  await expect(partner.getByRole("button", { name: /を承認$/ })).toHaveCount(0);
});

test("パートナーが編集者を招いて担当を決めると、編集者がアカウントを開ける（US2）", async () => {
  const { partner, editor } = pages;
  const link = await createEditorInvite(partner);
  expect(link).toMatch(/\/invite\/e_/);

  await joinByLink(editor, link);
  await expect(editor.getByRole("heading", { name: /担当を決めるのを待っています/ })).toBeVisible();

  await assignFirstEditor(partner);
  await expect(partner.getByRole("checkbox", { name: /の担当にする$/ })).toHaveAttribute("aria-checked", "true");

  await editor.getByRole("button", { name: "読み込み直す" }).click();
  await expect(editor).toHaveURL(new RegExp(`/accounts/${accountId}$`));
  await expect(editor.getByText("編集者として担当しています").first()).toBeVisible();
});

test("オーナーが承認を任せると、パートナーが承認でき、操作の記録に残る（US3・US4）", async () => {
  const { owner, partner, editor } = pages;
  await owner.goto(`/accounts/${accountId}/settings`);
  const review = owner.getByRole("switch", { name: "投稿の承認・却下をパートナーに任せる" });
  await review.click();
  await expect(review).toBeChecked();

  await partner.goto(`/accounts/${accountId}/stock`);
  await partner.getByRole("button", { name: /を承認$/ }).first().click();
  await expect(partner.getByRole("button", { name: /を承認$/ })).toHaveCount(1);

  // 編集者には承認の操作が出ない
  await editor.goto(`/accounts/${accountId}/stock`);
  await expect(editor.getByText("オーナーの確認待ち")).toHaveCount(1);
  await expect(editor.getByRole("button", { name: /を承認$/ })).toHaveCount(0);

  await owner.goto(`/accounts/${accountId}/activity`);
  for (const text of [/パートナーとして参加しました/, /投稿の案を2件登録しました/, /の担当にしました/, /パートナーに任せる範囲を変えました/, /1件を承認しました/]) {
    await expect(owner.getByText(text).first()).toBeVisible();
  }
});

test("オーナーがパートナーを外すと、パートナーと編集者は開けなくなり、記録は残る（手順8）", async () => {
  const { owner, partner, editor } = pages;
  await owner.goto(`/accounts/${accountId}/settings`);
  await owner.getByRole("button", { name: "外す" }).click();
  await owner.getByRole("alertdialog").getByRole("button", { name: "外す" }).click();
  await expect(owner.getByRole("button", { name: "招待リンクを作る" })).toBeVisible();

  for (const page of [partner, editor]) {
    await page.goto(`/accounts/${accountId}/stock`);
    await expect(page).not.toHaveURL(new RegExp(`/accounts/${accountId}`));
  }

  await owner.goto(`/accounts/${accountId}/activity`);
  await expect(owner.getByText(/パートナーを外しました/).first()).toBeVisible();
  await expect(owner.getByText(/1件を承認しました/).first()).toBeVisible();
});
