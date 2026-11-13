// 集金管理の分配と運営メンバーの招待を、主催者と招待された人の2つのブラウザで（specs/collect/003-revenue-sharing quickstart.md、tasks.md T030）。
// ① 主催者：経費を足し、運営メンバーを足して分配額を見る（紹介経由の売上も）② 招待のリンクを出す
// ③ 別の利用者（集金管理の利用の許可なし・390px）がリンクを開いて受け、読むだけの分配を見る。参加者の名前は出ない
// ④ 主催者がつながりを外すと、見られない。
// 利用の許可・イベント・名簿・受付の記録は DB に直接入れる（集金管理の表は共通の resetAll が空にする）。
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { worktreeDbName } from "../env";
import { resetAll, signIn, signInAs, testUserEmail } from "./helpers";

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
 * 主催者に集金管理を開き、イベントと名簿の4人（紹介した人つき）と受付の記録（現金 3,000円×4）を入れる。
 * @returns イベントの番号
 */
async function seedEvent(): Promise<string> {
  return withDb(async (db) => {
    const { rows: users } = await db.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [testUserEmail()]);
    const userId = users[0]!.id;
    await db.query("INSERT INTO app_access_grants (user_id, app) VALUES ($1, 'collect') ON CONFLICT DO NOTHING", [userId]);
    const { rows: events } = await db.query<{ id: string }>(
      "INSERT INTO collect.events (owner_user_id, name, starts_at, venue, next_number) VALUES ($1, 'E2Eの交流会', now() - interval '2 hour', '渋谷', 5) RETURNING id",
      [userId],
    );
    const eventId = events[0]!.id;
    const { rows: tiers } = await db.query<{ id: string }>("INSERT INTO collect.price_tiers (event_id, name, amount, position) VALUES ($1, '通常', 3000, 0) RETURNING id", [
      eventId,
    ]);
    for (const [number, name, referrer] of [
      [1, "参加者 一郎", "井上"],
      [2, "参加者 二郎", "井上"],
      [3, "参加者 三郎", null],
      [4, "参加者 四郎", null],
    ] as const) {
      const { rows } = await db.query<{ id: string }>(
        "INSERT INTO collect.roster_people (event_id, number, name, name_key, media, price_tier_id, referrer, referrer_key) VALUES ($1, $2, $3, $3, 'peatix', $4, $5, $5) RETURNING id",
        [eventId, number, name, tiers[0]!.id, referrer],
      );
      await db.query(
        "INSERT INTO collect.reception_records (roster_person_id, event_id, method, price_tier_id, amount, receiver_kind, payment_status, client_request_id) VALUES ($1, $2, 'cash', $3, 3000, 'owner', 'paid', gen_random_uuid())",
        [rows[0]!.id, eventId, tiers[0]!.id],
      );
    }
    return eventId;
  });
}

/**
 * 横にはみ出していないか。
 * @param page - ページ
 */
async function expectNoOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.beforeEach(async () => {
  await resetAll();
});

test("主催者が経費と運営メンバーを入れて分配を見て、招待した人が読むだけで見る", async ({ page, browser }) => {
  await signIn(page);
  await page.goto("/apps");
  await expect(page.getByRole("heading").first()).toBeVisible();
  const eventId = await seedEvent();

  // ① 主催者：締めから分配へ。売上 12,000円 − 経費 2,000円 ＝ 10,000円
  await page.goto(`/collect/events/${eventId}/closing`);
  await page.getByRole("link", { name: "経費を入れて、運営メンバーへの分配を見る" }).click();
  await expect(page.getByLabel("今の残る額")).toHaveText("12,000円");
  await page.getByRole("button", { name: "経費を足す" }).click();
  const expense = page.getByRole("dialog");
  await expense.getByLabel("経費の名前").fill("会場費");
  await expense.getByLabel("金額").fill("2000");
  await expense.getByLabel("立て替えた人").selectOption({ label: "主催者" });
  await expense.getByRole("button", { name: "保存する" }).click();
  await expect(page.getByLabel("今の残る額")).toHaveText("10,000円");

  for (const name of ["木村", "佐藤", "長谷川"]) {
    await page.getByRole("button", { name: "運営メンバーを足す" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("運営メンバーの名前").fill(name);
    await dialog.getByRole("button", { name: "保存する" }).click();
    await expect(page.getByRole("listitem", { name: `運営メンバー ${name}` })).toBeVisible();
  }
  // 10,000 ÷ 4 × 1.2 ＝ 3,000、メンバー floor(7,000 ÷ 3) ＝ 2,333、端数 1 は主催者
  await expect(page.getByRole("row", { name: "主催者の分配" })).toContainText("3,001円");
  await expect(page.getByRole("row", { name: "主催者の分配" })).toContainText("5,001円");
  await expect(page.getByRole("row", { name: "木村の分配" })).toContainText("2,333円");
  // 紹介経由の売上（見るだけ）
  const referrals = page.getByRole("table", { name: "紹介経由の売上" });
  await expect(referrals.getByRole("row", { name: /井上/ })).toContainText("6,000円");

  // ② 木村さんの招待のリンクを出す
  await page.getByRole("button", { name: "木村の招待のリンクを出す" }).click();
  const inviteDialog = page.getByRole("dialog", { name: "木村さんへの招待のリンク" });
  const url = (await inviteDialog.locator("code").textContent())!;
  const joinPath = new URL(url).pathname;
  expect(joinPath).toMatch(/^\/collect\/join\/ci_/);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listitem", { name: "運営メンバー 木村" })).toContainText("招待中");

  // ③ 別の利用者（集金管理の利用の許可なし・スマートフォンの幅）が受ける
  const memberContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const member = await memberContext.newPage();
  await signInAs(member, "admin");
  await member.goto(joinPath);
  await expect(member.getByRole("heading", { name: "「E2Eの交流会」の運営メンバーに招待されています" })).toBeVisible();
  await member.getByRole("button", { name: "受ける" }).click();
  await expect(member).toHaveURL(new RegExp(`/collect/shares/${eventId}$`));
  const mine = member.getByRole("row", { name: "木村の分配" });
  await expect(mine).toContainText("あなた");
  await expect(mine).toContainText("2,333円");
  await expect(member.getByText("参加者 一郎")).toHaveCount(0);
  await expect(member.getByText("井上")).toHaveCount(0);
  await expectNoOverflow(member);
  await member.goto("/collect/shares");
  await expect(member.getByRole("list", { name: "運営メンバーのイベント" })).toContainText("E2Eの交流会");

  // 主催者の画面に「つながった」
  await page.reload();
  await expect(page.getByRole("listitem", { name: "運営メンバー 木村" })).toContainText("つながった");

  // ④ つながりを外すと見られない
  await page.getByRole("listitem", { name: "運営メンバー 木村" }).getByRole("button", { name: /外す/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "外す" }).click();
  await expect(page.getByRole("listitem", { name: "運営メンバー 木村" })).not.toContainText("つながった");
  await member.goto(`/collect/shares/${eventId}`);
  await expect(member.getByRole("row", { name: "木村の分配" })).toHaveCount(0);

  await memberContext.close();
});
