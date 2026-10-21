// specs/014 SC-009（T093）：スマートフォンの幅（375px）で、課題・リサーチ・投稿をつくる・投稿ストック・ホームが横にはみ出さない
import { expect, test, type Page } from "@playwright/test";
import { createAccount, resetAll, signIn } from "./helpers";

test.use({ viewport: { width: 375, height: 812 } });

test.beforeEach(async () => {
  await resetAll();
});

/** ページが横にはみ出していないかを確かめる（はみ出した要素があれば、その書き出しを示す）。 */
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

test("375pxで、014で変えた画面が横にはみ出さない", async ({ page }) => {
  await signIn(page);
  const accountId = await createAccount(page, "スマートフォンのアカウント");
  const base = `/accounts/${accountId}`;

  await page.goto(base);
  await expect(page.getByRole("region", { name: "はじめに読んでほしいこと" })).toBeVisible();
  await expectNoOverflow(page, "ホーム");

  await page.goto(`${base}/strategy`);
  await expect(page.getByRole("region", { name: "進み具合" })).toBeVisible();
  const persona = page.locator("#field-targetPersona");
  await persona.getByRole("button", { name: /考えるヒント/ }).click();
  await persona.getByRole("button", { name: "この項目をAIと深掘りする" }).click();
  await expectNoOverflow(page, "課題");

  await page.goto(`${base}/research`);
  await page.getByRole("button", { name: /伸びる投稿を見つけるリサーチ/ }).click();
  await expectNoOverflow(page, "リサーチ");
  await page.getByRole("button", { name: "参考投稿を追加" }).click();
  await expect(page.getByRole("dialog", { name: "参考投稿を追加" })).toBeVisible();
  await expectNoOverflow(page, "参考投稿を追加");
  await page.keyboard.press("Escape");
  await page.goto(`${base}/research?tab=keywords`);
  await expectNoOverflow(page, "キーワード");

  await page.goto(`${base}/create`);
  await page.getByRole("button", { name: /プロンプトに入っている情報/ }).click();
  await page.getByRole("button", { name: /文字数と長さの割合/ }).click();
  await page.getByRole("radio", { name: /2つに分けて送る/ }).check();
  await expectNoOverflow(page, "投稿をつくる");

  await page.goto(`${base}/stock`);
  await expect(page.getByText("まだ投稿がありません")).toBeVisible();
  await expectNoOverflow(page, "投稿ストック");
});

// specs/015 T048：環境の帯が、375pxで横にはみ出さず、上部バーの操作に重ならない
test("375pxで、環境の帯が上部バーの操作に重ならない", async ({ page }) => {
  await signIn(page);
  const accountId = await createAccount(page, "帯のアカウント");
  await page.goto(`/accounts/${accountId}`);

  // 手元で動かすので VITE_APP_ENV は development（apps/web/.env.local）
  const banner = page.getByText("開発環境です（手元）");
  await expect(banner).toBeVisible();
  await expectNoOverflow(page, "環境の帯");

  // 帯は上部バーの下にある（メニューのボタンに重ならない）
  const menu = page.getByRole("button", { name: "メニューを開く" });
  const menuBox = await menu.boundingBox();
  const bannerBox = await banner.boundingBox();
  expect(bannerBox, "帯の位置").not.toBeNull();
  expect(menuBox, "メニューのボタンの位置").not.toBeNull();
  expect(bannerBox!.y).toBeGreaterThanOrEqual(menuBox!.y + menuBox!.height);

  // ログインの画面（骨格の外）でも、一番上に出る
  await page.goto("/terms");
  await expect(page.getByText("開発環境です（手元）")).toBeVisible();
  await expectNoOverflow(page, "利用規約");
});
