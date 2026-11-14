// 集金管理をスマートフォンの幅（390px）で（specs/collect/001-event-day-collection spec Edge Cases、tasks.md T083）。
// 受付・手伝う人の受付・締めの画面が横にはみ出さず、受付で押すところ（払い方のボタン・始める・締める）が44px以上であること。
import { expect, test, type Locator, type Page } from "@playwright/test";
import { seedEvent } from "./collect-helpers";
import { resetAll, signIn } from "./helpers";

test.use({ viewport: { width: 390, height: 844 } });

test.beforeEach(async () => {
  await resetAll();
});

/**
 * ページが横にはみ出していないかを確かめる（はみ出した要素があれば、その書き出しを示す）。
 * @param page - ページ
 * @param label - 画面の名前
 */
async function expectNoOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const wide = [...document.querySelectorAll("body *")]
      .filter((el) => el.getBoundingClientRect().right > width + 1)
      .map((el) => `${el.tagName.toLowerCase()}.${String((el as HTMLElement).className).slice(0, 60)}`);
    return { scroll: document.documentElement.scrollWidth, width, wide: wide.slice(0, 5) };
  });
  expect(overflow.scroll, `${label}：${overflow.wide.join(" / ")}`).toBeLessThanOrEqual(overflow.width);
}

/**
 * 押すところの高さが44px以上かを確かめる。
 * @param target - ボタン
 * @param label - 名前
 */
async function expectTapTarget(target: Locator, label: string) {
  const box = await target.boundingBox();
  expect(box?.height ?? 0, `${label}の高さ`).toBeGreaterThanOrEqual(44);
}

test("390pxで、受付・手伝う人の受付・締めが横にはみ出さず、押すところが44px以上", async ({ page, browser }) => {
  await signIn(page);
  await page.goto("/apps");
  await expect(page.getByRole("heading").first()).toBeVisible();
  const eventId = await seedEvent();

  // 受付（主催者）
  await page.goto(`/collect/events/${eventId}/reception`);
  const row = page.getByRole("listitem", { name: /松本 れい/ });
  await expect(row).toBeVisible();
  await expectNoOverflow(page, "受付");
  for (const name of ["現金", "PayPay", "振込", "来場のみ"]) await expectTapTarget(row.getByRole("button", { name }), `受付の「${name}」`);
  await expectTapTarget(page.getByRole("textbox", { name: "名前・ふりがな・受付番号で探す" }), "受付の検索");
  // PayPay のシートも
  await row.getByRole("button", { name: "PayPay" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expectNoOverflow(page, "PayPayのシート");
  await expectTapTarget(page.getByRole("dialog").getByRole("button", { name: "受け取った" }), "「受け取った」");
  await page.getByRole("dialog").getByRole("button", { name: "受け取った" }).click();
  await expect(page.getByRole("listitem", { name: /松本 れい（受付済み）/ })).toBeVisible();

  // 受付の手伝い（リンクを出す）
  await page.goto(`/collect/events/${eventId}/helpers`);
  await page.getByRole("button", { name: "受付用リンクを出す" }).click();
  const url = (await page.locator("code").filter({ hasText: "/collect/r/cr_" }).textContent())!;
  await expectNoOverflow(page, "受付の手伝い");

  // 手伝う人の受付
  const helperContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const helper = await helperContext.newPage();
  await helper.goto(new URL(url).pathname);
  await expectNoOverflow(helper, "手伝う人の名前を入れる画面");
  await expectTapTarget(helper.getByRole("button", { name: "受付を始める" }), "「受付を始める」");
  await helper.getByRole("textbox", { name: "あなたの名前" }).fill("井上");
  await helper.getByRole("button", { name: "受付を始める" }).click();
  const helperRow = helper.getByRole("listitem", { name: /井上 そら/ });
  await expect(helperRow).toBeVisible();
  await expectNoOverflow(helper, "手伝う人の受付");
  await expectTapTarget(helperRow.getByRole("button", { name: "現金" }), "手伝う人の受付の「現金」");
  await helperRow.getByRole("button", { name: "現金" }).click();
  await expect(helper.getByRole("listitem", { name: /井上 そら（受付済み）/ })).toBeVisible();
  await helperContext.close();

  // 締め
  await page.goto(`/collect/events/${eventId}/closing`);
  await expect(page.getByRole("heading", { name: /現金（受け取った人ごと）/ })).toBeVisible();
  await expectNoOverflow(page, "締め");
  await expectTapTarget(page.getByRole("button", { name: "締める" }), "「締める」");
});
