// 集金管理のセルフ受付を、参加者と主催者の2つのブラウザで（specs/collect/002-self-check-in quickstart.md、tasks.md T021）。
// ① 参加者が探して PayPay を選ぶ → 5秒以内に主催者の「確かめ待ち」→「受け取った」→ 参加者の画面が「受付が済みました」
// ② 名簿にいない人が申し出る → 主催者が名簿に入れる → 参加者が払い方を選べる ③ 参加者の画面は 390px ではみ出さない
// 利用の許可・イベント・名簿は DB に直接入れる（集金管理の表は共通の resetAll が空にする）。
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { worktreeDbName } from "../env";
import { resetAll, signIn, testUserEmail } from "./helpers";

const DIRECT_DB = process.env.E2E_DATABASE_URL_DIRECT ?? `postgres://postgres:postgres@localhost:5432/${worktreeDbName()}`;

/**
 * DB に直接つないで処理する。
 * @param run - 処理
 * @returns 処理の結果
 */
async function withDb<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: DIRECT_DB });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

/**
 * ログインした人に集金管理を開き、イベント（区分1つ・払い方は現金とPayPayと振込）と名簿の2人を入れる。
 * name_key は集金管理の nameKey と同じ形（空白を除いた名前）。
 * @returns イベントの番号
 */
async function seedEvent(): Promise<string> {
  return withDb(async (db) => {
    const { rows: users } = await db.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [testUserEmail()]);
    const userId = users[0]!.id;
    await db.query("INSERT INTO app_access_grants (user_id, app) VALUES ($1, 'collect') ON CONFLICT DO NOTHING", [userId]);
    const { rows: events } = await db.query<{ id: string }>(
      "INSERT INTO collect.events (owner_user_id, name, starts_at, venue, next_number) VALUES ($1, 'E2Eの交流会', now() + interval '1 hour', '渋谷', 3) RETURNING id",
      [userId],
    );
    const eventId = events[0]!.id;
    const { rows: tiers } = await db.query<{ id: string }>(
      "INSERT INTO collect.price_tiers (event_id, name, amount, position) VALUES ($1, '通常', 3000, 0) RETURNING id",
      [eventId],
    );
    for (const [number, name, key, kana] of [
      [1, "松本 れい", "松本れい", "まつもとれい"],
      [2, "井上 そら", "井上そら", "いのうえそら"],
    ] as const) {
      await db.query(
        "INSERT INTO collect.roster_people (event_id, number, name, name_key, kana, kana_key, media, price_tier_id) VALUES ($1, $2, $3, $4, $5, $5, 'peatix', $6)",
        [eventId, number, name, key, kana, tiers[0]!.id],
      );
    }
    return eventId;
  });
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

test("参加者が自分で受付し、主催者が確かめる。名簿にいない人は申し出る", async ({ page, browser }) => {
  await signIn(page);
  await page.goto("/apps");
  await expect(page.getByRole("heading").first()).toBeVisible();
  const eventId = await seedEvent();

  // 主催者：セルフ受付のQRを出す
  await page.goto(`/collect/events/${eventId}/self`);
  await page.getByRole("button", { name: "セルフ受付のQRを出す" }).click();
  const url = (await page.locator("code").filter({ hasText: "/collect/s/cs_" }).textContent())!;
  const selfPath = new URL(url).pathname;
  await page.goto(`/collect/events/${eventId}/reception`);
  await expect(page.getByText("会場で共有中")).toBeVisible();

  // ① 参加者（スマートフォンの幅）：ふりがなで探して PayPay を選ぶ
  const participantContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const participant = await participantContext.newPage();
  await participant.goto(selfPath);
  await expect(participant.getByRole("heading", { name: "E2Eの交流会" })).toBeVisible();
  await expectNoOverflow(participant);
  await participant.getByRole("textbox", { name: "名前か受付番号" }).fill("マツモト レイ");
  await participant.getByRole("button", { name: "探す" }).click();
  await expect(participant.getByText("通常 3,000円")).toBeVisible();
  await participant.getByRole("button", { name: "PayPay" }).click();
  await expect(participant.getByRole("heading", { name: "PayPayで3,000円を送ってください" })).toBeVisible();
  await expectNoOverflow(participant);

  // 主催者の画面に、5秒以内に確かめ待ち → 受け取った
  const awaiting = page.getByRole("listitem", { name: "No.1 松本 れい（確かめ待ち）" });
  await expect(awaiting).toBeVisible({ timeout: 5_000 });
  await awaiting.getByRole("button", { name: "受け取った", exact: true }).click();
  await expect(page.getByRole("listitem", { name: "No.1 松本 れい（受付済み）" })).toContainText("本人の申告→主催者");

  // 参加者の画面が「受付が済みました」（3秒ごとに読む）
  await expect(participant.getByRole("heading", { name: "受付が済みました" })).toBeVisible({ timeout: 8_000 });

  // ② 名簿にいない人（別の端末）：申し出る → 主催者が名簿に入れる → 払い方を選べる
  const walkInContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const walkIn = await walkInContext.newPage();
  await walkIn.goto(selfPath);
  await walkIn.getByRole("textbox", { name: "名前か受付番号" }).fill("飛び入り 花子");
  await walkIn.getByRole("button", { name: "探す" }).click();
  await walkIn.getByRole("button", { name: "名簿にないので、受付の人に知らせる" }).click();
  await walkIn.getByRole("button", { name: "送る" }).click();
  await expect(walkIn.getByRole("heading", { name: "受付の人が確かめています" })).toBeVisible();

  const request = page.getByRole("listitem", { name: "申し出 飛び入り 花子" });
  await expect(request).toBeVisible({ timeout: 5_000 });
  await request.getByRole("button", { name: "名簿に入れる" }).click();
  await expect(page.getByRole("listitem", { name: "No.3 飛び入り 花子" })).toBeVisible();

  await walkIn.getByRole("button", { name: "払い方を選ぶ" }).click({ timeout: 8_000 });
  await walkIn.getByRole("button", { name: "現金" }).click();
  await expect(walkIn.getByRole("heading", { name: "受付で3,000円を払ってください" })).toBeVisible();
  await expect(page.getByRole("listitem", { name: "No.3 飛び入り 花子（確かめ待ち）" })).toBeVisible({ timeout: 5_000 });

  await participantContext.close();
  await walkInContext.close();
});
