// 決済の流れ（specs/013-billing quickstart.md 1・2、T060。specs/024 で無料体験をなくした）。決済ONのAPI（8788）と偽のStripe（8791）で流す。
// 契約前の画面 → 契約（偽のCheckoutからすぐに戻る）→ アカウントを2件作る → 支払いの失敗で読むだけ → 戻る。
import { expect, test } from "@playwright/test";
import { createAccount, resetAll, setStripeStatus, signIn, stripeControl } from "./helpers";

test.beforeEach(async () => {
  await resetAll();
  await stripeControl("reset", {});
});

test("契約してから使い始め、支払いの失敗で読むだけになり、払うと戻る", async ({ page }) => {
  await signIn(page);

  // 契約前（無料体験なし。specs/024 US6）：料金と「契約する」だけが出る
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "契約してから使い始めます" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/無料体験/)).toHaveCount(0);
  await page.getByRole("button", { name: "契約する" }).click();
  await page.waitForURL(/\/settings\/billing/);
  await expect(page.getByText("契約中", { exact: true })).toBeVisible({ timeout: 15_000 });

  // 契約したので、アカウントを作れる。2件目は1件1,000円の案内（specs/024 FR-030）
  await page.goto("/");
  const accountId = await createAccount(page, "1件目");
  await page.goto("/threads/accounts/new");
  await expect(page.getByText("アカウント1件につき月1,000円です。次の請求から反映されます。")).toBeVisible();
  await page.getByLabel("アカウントの名前").fill("2件目");
  await page.getByRole("button", { name: "作る", exact: true }).click();
  await page.waitForURL(/\/threads\/accounts\/[0-9a-f-]{36}$/);
  expect(((await stripeControl("subscriptions")) as { subscriptions: { items: { data: { quantity: number }[] } }[] }).subscriptions[0]!.items.data[0]!.quantity).toBe(2);

  // 支払いの失敗（US3-4）：「契約と支払い」を開くと読み直して、読むだけになる
  await setStripeStatus("past_due");
  await page.goto("/settings/billing");
  await expect(page.getByText("支払いに失敗しました", { exact: true })).toBeVisible();
  await page.goto(`/threads/accounts/${accountId}/strategy`);
  await expect(page.getByText("支払いに失敗しました。カードを更新してください。更新するまで読むだけです。")).toBeVisible();
  await expect(page.getByRole("button", { name: "保存" })).toHaveCount(0);

  // 払うと戻る
  await setStripeStatus("active");
  await page.goto("/settings/billing");
  await expect(page.getByText("契約中", { exact: true })).toBeVisible();
  await page.goto(`/threads/accounts/${accountId}/strategy`);
  await expect(page.getByText(/更新するまで読むだけです/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "保存" })).toBeVisible();
});
