// 人物メモ：Threads のイベントの候補から作る（specs/people/003-threads-event-candidates spec.md US1、tasks.md T011）。
// Threads の出来事が候補に写るところは API の結合テスト（apps/api/test/integration/people/threads-candidates.test.ts）で確かめる。
// ここでは候補の行をDBに置いて、スマートフォンの幅（390px）で「選ぶ → 作る → 作ったと出る」を画面から通す。
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { worktreeDbName } from "../env";
import { resetAll, signIn, testUserEmail } from "./helpers";

const DIRECT_DB = process.env.E2E_DATABASE_URL_DIRECT ?? `postgres://postgres:postgres@localhost:5432/${worktreeDbName()}`;

test.use({ viewport: { width: 390, height: 844 } });

/**
 * DB に直に書く。
 * @param sql - SQL
 * @param params - 値
 */
async function query(sql: string, params: unknown[]): Promise<void> {
  const client = new pg.Client({ connectionString: DIRECT_DB });
  await client.connect();
  try {
    await client.query(sql, params);
  } finally {
    await client.end();
  }
}

/**
 * 横にはみ出していないか（ページの幅が画面の幅を超えない）。
 * @param page - ページ
 */
async function expectNoOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.beforeEach(async () => {
  await resetAll();
});

test("Threadsのイベントを選んで人物メモのイベントを作ると、候補に「作った」と出る", async ({ page }) => {
  await signIn(page);
  await page.goto("/apps");
  await expect(page.getByRole("heading").first()).toBeVisible();
  // 人物メモを開き、Threads の出来事で写った候補を置く（日本時間の 2099-12-20 19:00）
  await query(`INSERT INTO app_access_grants (app, user_id) SELECT 'people', id FROM users WHERE email = $1 ON CONFLICT DO NOTHING`, [testUserEmail()]);
  await query(
    `INSERT INTO people.threads_event_candidates (promotion_id, user_id, name, starts_at, details_occurred_at)
     SELECT 'e2e-promo-1', id, 'E2Eの12月の交流会', '2099-12-20T10:00:00Z', now() FROM users WHERE email = $1`,
    [testUserEmail()],
  );

  await page.goto("/people/events/new");
  const candidate = page.getByRole("button", { name: /E2Eの12月の交流会/ });
  await expect(candidate).toBeVisible();
  await expectNoOverflow(page);
  expect((await candidate.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await candidate.click();
  await expect(page.getByLabel("イベントの名前")).toHaveValue("E2Eの12月の交流会");
  await expect(page.getByLabel("開催日")).toHaveValue("2099-12-20");
  await page.getByRole("button", { name: "作る" }).click();
  await expect(page).toHaveURL(/\/people\/events\/[0-9a-f-]+$/);
  await expect(page.getByRole("heading", { name: "E2Eの12月の交流会" })).toBeVisible();

  // もう一度開くと、作った候補は選べない
  await page.goto("/people/events/new");
  const used = page.getByRole("button", { name: /E2Eの12月の交流会/ });
  await expect(used).toContainText("作った");
  await expect(used).toBeDisabled();
});
