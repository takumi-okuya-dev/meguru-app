// 集金管理の名簿なしの受付を、主催者と参加者の2つのブラウザで（specs/collect/004-rosterless-check-in quickstart.md 1〜3、tasks.md T036）。
// 主催者が名簿なし（作る画面の初めの値）で区分2つのイベントを作る → セルフ受付の画面へ → QR を出す →
// 参加者（390px・ログインなし）が名前と媒体を入れて現金を選ぶ → 主催者の受付の画面に5秒以内に確かめ待ち → 区分を選んで受け取る →
// 参加者の画面が「受付が済みました」。参加者の画面は横にはみ出さない。
import { expect, test, type Page } from "@playwright/test";
import { withDb } from "./collect-helpers";
import { resetAll, signIn, testUserEmail } from "./helpers";

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

test("名簿なしで作り、参加者が名前と媒体を入れて受付し、主催者が区分を決めて受け取る", async ({ page, browser }) => {
  await signIn(page);
  await page.goto("/apps");
  await expect(page.getByRole("heading").first()).toBeVisible();
  await withDb(async (db) => {
    const { rows } = await db.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [testUserEmail()]);
    await db.query("INSERT INTO app_access_grants (user_id, app) VALUES ($1, 'collect') ON CONFLICT DO NOTHING", [rows[0]!.id]);
  });

  // 主催者：名簿なし（初めの値）・区分2つでイベントを作る → セルフ受付の画面へ
  await page.goto("/collect/events/new");
  await expect(page.getByRole("radio", { name: /名簿なし/ })).toHaveAttribute("aria-checked", "true");
  await page.getByLabel("イベント名").fill("E2Eの名簿なしの会");
  await page.getByLabel("開催日").fill("2026-12-20");
  await page.getByLabel("区分1の金額").fill("3000");
  await page.getByRole("button", { name: "区分を足す" }).click();
  await page.getByLabel("区分2の名前").fill("早割");
  await page.getByLabel("区分2の金額").fill("2500");
  await page.getByRole("button", { name: "作る" }).click();
  await expect(page).toHaveURL(/\/collect\/events\/[^/]+\/self$/);
  const eventId = page.url().split("/collect/events/")[1]!.split("/")[0]!;
  await page.getByRole("button", { name: "セルフ受付のQRを出す" }).click();
  const url = (await page.locator("code").filter({ hasText: "/collect/s/cs_" }).textContent())!;
  const selfPath = new URL(url).pathname;
  await page.goto(`/collect/events/${eventId}/reception`);
  await expect(page.getByText("会場で共有中")).toBeVisible();

  // 参加者（スマートフォンの幅）：名前と媒体を入れる → 払い方 → 現金
  const participantContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const participant = await participantContext.newPage();
  await participant.goto(selfPath);
  await expect(participant.getByRole("heading", { name: "E2Eの名簿なしの会" })).toBeVisible();
  await expect(participant.getByRole("textbox", { name: "名前か受付番号" })).toHaveCount(0);
  await participant.getByRole("textbox", { name: "名前", exact: true }).fill("松本 れい");
  await participant.getByRole("radio", { name: "Peatix" }).click();
  await expectNoOverflow(participant);
  await participant.getByRole("button", { name: "受付をする" }).click();
  await expect(participant.getByRole("heading", { name: "払い方を選んでください" })).toBeVisible();
  await expect(participant.getByText("通常 3,000円・早割 2,500円")).toBeVisible();
  await participant.getByRole("button", { name: "現金" }).click();
  await expect(participant.getByRole("heading", { name: "受付で払ってください（通常 3,000円・早割 2,500円）" })).toBeVisible();
  await expectNoOverflow(participant);

  // 主催者：5秒以内に確かめ待ち（区分を確かめる）→ 受け取った → 区分を選ぶ
  const awaiting = page.getByRole("listitem", { name: "No.1 松本 れい（確かめ待ち）" });
  await expect(awaiting).toBeVisible({ timeout: 5_000 });
  await expect(awaiting).toContainText("区分を確かめる");
  await awaiting.getByRole("button", { name: "受け取った", exact: true }).click();
  await page.getByRole("group", { name: "料金の区分" }).getByRole("button", { name: /早割/ }).click();
  await expect(page.getByRole("listitem", { name: "No.1 松本 れい（受付済み）" })).toContainText("2,500円");

  // 参加者の画面が「受付が済みました」（3秒ごとに読む）
  await expect(participant.getByRole("heading", { name: "受付が済みました" })).toBeVisible({ timeout: 8_000 });
  await participantContext.close();
});
