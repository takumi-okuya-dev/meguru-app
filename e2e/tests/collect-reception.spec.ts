// 集金管理の受付を、主催者と手伝う人の2つのブラウザで（specs/collect/001-event-day-collection quickstart.md 2、tasks.md T053）。
// ① 手伝う人の記録が5秒以内に主催者の画面に出る ② 同じ人を同時に押して1件 ③ 手伝う人に主催者の記録の「取り消す」が出ない
// ④ リンクを止めると手伝う人の画面が止まる ⑤ 受付の1人が「探す → 払い方 →（シートの1回）」で終わる（SC-001）
// ⑥ 手伝う人がリンクを開いてから受付の画面までの操作が、名前の入力と「受付を始める」だけ（SC-007）。
// 利用の許可・イベント・名簿は DB に直接入れる（集金管理の表は共通の resetAll が空にする）。
import { expect, test, type Page } from "@playwright/test";
import { seedEvent, withDb } from "./collect-helpers";
import { resetAll, signIn } from "./helpers";

/**
 * 受付の名簿の1行。
 * @param page - ページ
 * @param name - 名前
 * @returns 行
 */
const row = (page: Page, name: string) => page.getByRole("listitem", { name: new RegExp(name) });

test.beforeEach(async () => {
  await resetAll();
});

test("主催者と手伝う人の2つのブラウザで受付をする", async ({ page, browser }) => {
  // 主催者：ログインして（利用者の行ができる）、集金管理を開いてもらう
  await signIn(page);
  await page.goto("/apps");
  await expect(page.getByRole("heading").first()).toBeVisible();
  const eventId = await seedEvent();

  // 受付用リンクを出す
  await page.goto(`/collect/events/${eventId}/helpers`);
  await page.getByRole("button", { name: "受付用リンクを出す" }).click();
  const url = (await page.locator("code").filter({ hasText: "/collect/r/cr_" }).textContent())!;
  const helperPath = new URL(url).pathname;

  // 主催者の受付の画面
  await page.goto(`/collect/events/${eventId}/reception`);
  await expect(page.getByText("会場で共有中")).toBeVisible();

  // ⑥ 手伝う人：リンクを開いて、名前を入れて「受付を始める」だけで受付の画面になる
  const helperContext = await browser.newContext();
  const helper = await helperContext.newPage();
  await helper.goto(helperPath);
  await helper.getByRole("textbox", { name: "あなたの名前" }).fill("井上");
  await helper.getByRole("button", { name: "受付を始める" }).click();
  await expect(helper.getByRole("heading", { name: "E2Eの交流会の受付" })).toBeVisible();
  await expect(helper.getByText("会場で共有中")).toBeVisible();

  // ⑤ 探す → 払い方 の2回で1人の受付が終わる。① 主催者の画面に5秒以内に出る
  await helper.getByRole("textbox", { name: "名前・ふりがな・受付番号で探す" }).fill("松本");
  await row(helper, "松本 れい").getByRole("button", { name: "現金" }).click();
  await expect(row(page, "松本 れい（受付済み）")).toBeVisible({ timeout: 5_000 });
  await expect(row(page, "松本 れい（受付済み）")).toContainText("受け取り：井上");

  // PayPay はシートの1回が足される（探す → 払い方 → 受け取った）
  await page.getByRole("textbox", { name: "名前・ふりがな・受付番号で探す" }).fill("3");
  await row(page, "木村 ゆうき").getByRole("button", { name: "PayPay" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "受け取った" }).click();
  await expect(row(page, "木村 ゆうき（受付済み）")).toBeVisible();
  // ③ 手伝う人の画面に、主催者の記録の「取り消す」は出ない（自分の記録には出る）
  await helper.getByRole("textbox", { name: "名前・ふりがな・受付番号で探す" }).fill("");
  await expect(row(helper, "木村 ゆうき（受付済み）")).toBeVisible({ timeout: 5_000 });
  await expect(row(helper, "木村 ゆうき（受付済み）").getByRole("button", { name: "取り消す" })).toHaveCount(0);
  await expect(row(helper, "松本 れい（受付済み）").getByRole("button", { name: "取り消す" })).toHaveCount(1);

  // ② 同じ人を同時に押しても1件
  await page.getByRole("textbox", { name: "名前・ふりがな・受付番号で探す" }).fill("");
  await Promise.all([
    row(page, "井上 そら").getByRole("button", { name: "現金" }).click(),
    row(helper, "井上 そら").getByRole("button", { name: "現金" }).click(),
  ]);
  await expect(row(page, "井上 そら（受付済み）")).toBeVisible({ timeout: 5_000 });
  await expect(row(helper, "井上 そら（受付済み）")).toBeVisible({ timeout: 5_000 });
  const count = await withDb(async (db) => {
    const { rows } = await db.query<{ n: string }>(
      "SELECT count(*) AS n FROM collect.reception_records r JOIN collect.roster_people p ON p.id = r.roster_person_id WHERE p.name = '井上 そら'",
    );
    return Number(rows[0]!.n);
  });
  expect(count).toBe(1);

  // ④ リンクを止めると、手伝う人の画面が止まる
  await page.goto(`/collect/events/${eventId}/helpers`);
  await page.getByRole("button", { name: "止める" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "止める" }).click();
  await expect(helper.getByRole("heading", { name: "このリンクは止められました" })).toBeVisible({ timeout: 5_000 });

  await helperContext.close();
});
