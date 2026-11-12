// 自分のMetaアプリのトークンでつなぐ・接続し直しの方法の切り替え（specs/010-token-account-add quickstart.md 2）。
// specs/012 で、名前だけで作ったアカウントに「このアカウントの設定」からトークンでつなぐ形になった（US2・US3）。
// トークンは、偽のThreadsの「ユーザートークン生成ツール」の画面で作る。
import { expect, test, type Page } from "@playwright/test";
import { connectWithToken, createAccount, makeToken as makeTokenFor, resetAll, signInAs } from "./helpers";

test.describe.configure({ mode: "serial" });

let page: Page;
let accountId = "";

/**
 * 偽のThreadsで、@cafe_b（9003）のトークンを作る。
 * @param appScope - Metaアプリの見分け（違うとユーザーIDが変わる）
 * @returns トークン
 */
const makeToken = (appScope: string) => makeTokenFor(page, "9003", appScope);

test.beforeAll(async ({ browser }) => {
  await resetAll();
  page = await (await browser.newContext()).newPage();
  await signInAs(page, "owner");
});

test("名前で作ったアカウントに、トークンを貼り付けてつなぐ（010 US1、012 US2）", async () => {
  accountId = await createAccount(page, "カフェ本店");
  await connectWithToken(page, accountId, await makeToken("myapp"));
  await expect(page.getByText("カフェ本店をThreadsにつなぎました（@cafe_b）")).toBeVisible();
  await expect(page.getByText(/今の接続：自分のMetaアプリのトークン/)).toBeVisible();

  // 案は「投稿をつくる」で登録し、投稿ストックで確かめる（specs/014 US15）
  await page.goto(`/threads/accounts/${accountId}/create`);
  await page.getByPlaceholder("AIの返信をここに貼り付け…").fill("トークンの案1\n@@@\nトークンの案2");
  await page.getByRole("button", { name: "投稿ストックに登録する" }).click();
  await page.getByRole("link", { name: "投稿ストックで確かめる" }).click();
  await expect(page.getByText("トークンの案1")).toBeVisible();
});

test("自分の別のアカウントを、同じThreadsアカウントにつなごうとすると止まり、そのアカウントを示す（012 US3-1）", async () => {
  // E2E は決済OFFで流すので、上限はない（specs/013 research.md R9）
  const second = await createAccount(page, "カフェ2");
  await connectWithToken(page, second, await makeToken("another"));
  await expect(page.getByText("@cafe_bは、あなたのアカウント『カフェ本店』につながっています。")).toBeVisible();
  await page.getByRole("link", { name: "『カフェ本店』を開く" }).click();
  await expect(page).toHaveURL(new RegExp(`/threads/accounts/${accountId}/settings$`));
  // 2つ目は未接続のまま残る
  await page.goto(`/threads/accounts/${second}/settings`);
  await expect(page.getByRole("button", { name: "Threadsで許可する" })).toBeVisible();
});

test("接続し直しで「Threadsで許可する」に切り替えても、投稿ストックが残る（US3）", async () => {
  await page.goto(`/threads/accounts/${accountId}/settings`);
  await page.getByRole("button", { name: "接続し直す", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Threadsとの接続し直し" });
  await expect(dialog.getByRole("button", { name: /トークンを貼り付ける/ })).toContainText("今の接続");
  await dialog.getByRole("button", { name: /Threadsで許可する/ }).click();
  await page.locator("#allow-9003").click();
  await page.waitForURL(new RegExp(`/threads/accounts/${accountId}/settings`));
  await expect(page.getByText(/今の接続：このアプリで許可/)).toBeVisible();

  await page.goto(`/threads/accounts/${accountId}/stock`);
  await expect(page.getByText("トークンの案1")).toBeVisible();
  await expect(page.getByText("トークンの案2")).toBeVisible();
});

test("トークンを貼り付けて接続し直すと、今の接続がトークンに戻る（US3）", async () => {
  const token = await makeToken("myapp");
  await page.goto(`/threads/accounts/${accountId}/settings`);
  await page.getByRole("button", { name: "接続し直す", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Threadsとの接続し直し" });
  await dialog.getByRole("button", { name: /トークンを貼り付ける/ }).click();
  await dialog.getByLabel("アクセストークン").fill(token);
  await dialog.getByRole("button", { name: "接続し直す", exact: true }).click();
  await expect(page.getByText("接続し直しました")).toBeVisible();
  await expect(page.getByText(/今の接続：自分のMetaアプリのトークン/)).toBeVisible();
});
