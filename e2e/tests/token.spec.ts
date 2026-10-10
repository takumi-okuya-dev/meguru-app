// 自分のMetaアプリのトークンでの追加と、接続し直しの方法の切り替え（specs/010-token-account-add quickstart.md 2）。
// トークンは、偽のThreadsの「ユーザートークン生成ツール」の画面で作る。
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { FAKE_THREADS, resetAll, signInAs } from "./helpers";

test.describe.configure({ mode: "serial" });

const DIRECT_DB = process.env.E2E_DATABASE_URL_DIRECT ?? "postgres://postgres:postgres@localhost:5432/threads_grower";
const ACCOUNT_URL = /\/accounts\/([0-9a-f-]{36})(?:\?|$)/;
let page: Page;
let accountId = "";

/**
 * 偽のThreadsでトークンを作る。
 * @param appScope - Metaアプリの見分け（違うとユーザーIDが変わる）
 * @returns トークン
 */
async function makeToken(appScope: string): Promise<string> {
  const tool = await page.context().newPage();
  await tool.goto(`${FAKE_THREADS}/__control/token-page?user=9003&appScope=${appScope}&lifetime=long&debug=1`);
  const token = (await tool.locator("#token").textContent())!.trim();
  await tool.close();
  return token;
}

async function sql(query: string) {
  const client = new pg.Client({ connectionString: DIRECT_DB });
  await client.connect();
  try {
    await client.query(query);
  } finally {
    await client.end();
  }
}

test.beforeAll(async ({ browser }) => {
  await resetAll();
  page = await (await browser.newContext()).newPage();
  await signInAs(page, "owner");
});

test("トークンを貼り付けてアカウントを追加する（US1）", async () => {
  const token = await makeToken("myapp");
  await page.goto("/accounts/new");
  await page.getByRole("button", { name: "自分のMetaアプリのトークンで追加する" }).click();
  await page.getByLabel("アクセストークン").fill(token);
  await page.getByRole("button", { name: "追加する" }).click();
  await page.waitForURL(ACCOUNT_URL);
  accountId = ACCOUNT_URL.exec(page.url())![1]!;

  await page.goto(`/accounts/${accountId}/settings`);
  await expect(page.getByText(/今の接続：自分のMetaアプリのトークン/)).toBeVisible();

  await page.goto(`/accounts/${accountId}/stock`);
  await page.getByPlaceholder("AIの返信をここに貼り付け…").fill("トークンの案1\n@@@\nトークンの案2");
  await page.getByRole("button", { name: "投稿ストックに登録する" }).click();
  await expect(page.getByText("トークンの案1")).toBeVisible();
});

test("同じアカウントの別のアプリのトークンは「すでに登録されています」（US2）", async () => {
  // 上限（1件）だと入力欄が出ないので、上限を上げておく
  await sql("UPDATE accounts SET plan = 'multi-account'");
  const token = await makeToken("another");
  await page.goto("/accounts/new");
  await page.getByRole("button", { name: "自分のMetaアプリのトークンで追加する" }).click();
  await page.getByLabel("アクセストークン").fill(token);
  await page.getByRole("button", { name: "追加する" }).click();
  await expect(page.getByText(/このアカウントはすでに登録されています/)).toBeVisible();
  await page.getByRole("link", { name: "そのアカウントの設定を開く" }).click();
  await expect(page).toHaveURL(new RegExp(`/accounts/${accountId}/settings$`));
});

test("接続し直しで「Threadsで許可する」に切り替えても、投稿ストックが残る（US3）", async () => {
  await page.goto(`/accounts/${accountId}/settings`);
  await page.getByRole("button", { name: "接続し直す" }).click();
  const dialog = page.getByRole("dialog", { name: "Threadsとの接続し直し" });
  await expect(dialog.getByRole("button", { name: /トークンを貼り付ける/ })).toContainText("今の接続");
  await dialog.getByRole("button", { name: /Threadsで許可する/ }).click();
  await page.locator("#allow-9003").click();
  await page.waitForURL(new RegExp(`/accounts/${accountId}/settings`));
  await expect(page.getByText(/今の接続：このアプリで許可/)).toBeVisible();

  await page.goto(`/accounts/${accountId}/stock`);
  await expect(page.getByText("トークンの案1")).toBeVisible();
  await expect(page.getByText("トークンの案2")).toBeVisible();
});

test("トークンを貼り付けて接続し直すと、今の接続がトークンに戻る（US3）", async () => {
  const token = await makeToken("myapp");
  await page.goto(`/accounts/${accountId}/settings`);
  await page.getByRole("button", { name: "接続し直す" }).click();
  const dialog = page.getByRole("dialog", { name: "Threadsとの接続し直し" });
  await dialog.getByRole("button", { name: /トークンを貼り付ける/ }).click();
  await dialog.getByLabel("アクセストークン").fill(token);
  await dialog.getByRole("button", { name: "接続し直す" }).click();
  await expect(page.getByText("接続し直しました")).toBeVisible();
  await expect(page.getByText(/今の接続：自分のMetaアプリのトークン/)).toBeVisible();
});
