// 決済の流れ（specs/013-billing quickstart.md 1・2、T060）。決済ONのAPI（8788）と偽のStripe（8791）で流す。
// 無料体験 → 2件目で上限の案内 → 契約（偽のCheckoutからすぐに戻る）→ 2件目を作る → 支払いの失敗で読むだけ → 戻る。
import { expect, test } from "@playwright/test";
import { createAccount, resetAll, setStripeStatus, signIn, stripeControl } from "./helpers";

test.beforeEach(async () => {
  await resetAll();
  await stripeControl("reset", {});
});

test("無料体験から契約し、支払いの失敗で読むだけになり、払うと戻る", async ({ page }) => {
  await signIn(page);
  await page.goto("/");
  const accountId = await createAccount(page, "1件目");

  // 無料体験中は1件まで（US1-2）
  await page.goto("/accounts/new");
  await expect(page.getByText("無料体験中に作れるアカウントは1件までです。契約すると、2件目から1件につき月500円で足せます。")).toBeVisible();

  // 契約（US2）：偽のCheckoutはすぐに完了して戻る
  await page.goto("/settings/billing");
  await expect(page.getByText(/無料体験中：.*まで（あと\d+日）/)).toBeVisible();
  await page.getByRole("button", { name: "契約する" }).click();
  await page.waitForURL(/\/settings\/billing/);
  await expect(page.getByText("無料体験中（契約済み）")).toBeVisible({ timeout: 15_000 });

  // 2件目からは料金の案内を出して作れる（FR-031）
  await page.goto("/accounts/new");
  await expect(page.getByText("2件目からは1件につき月500円です。次の請求から反映されます。")).toBeVisible();
  await page.getByLabel("アカウントの名前").fill("2件目");
  await page.getByRole("button", { name: "作る", exact: true }).click();
  await page.waitForURL(/\/accounts\/[0-9a-f-]{36}$/);
  expect(((await stripeControl("subscriptions")) as { subscriptions: { items: { data: { quantity: number }[] } }[] }).subscriptions[0]!.items.data[0]!.quantity).toBe(2);

  // 支払いの失敗（US3-4）：「契約と支払い」を開くと読み直して、読むだけになる
  await setStripeStatus("past_due");
  await page.goto("/settings/billing");
  await expect(page.getByText("支払いに失敗しました", { exact: true })).toBeVisible();
  await page.goto(`/accounts/${accountId}/strategy`);
  await expect(page.getByText("支払いに失敗しました。カードを更新してください。更新するまで読むだけです。")).toBeVisible();
  await expect(page.getByRole("button", { name: "保存" })).toHaveCount(0);

  // 払うと戻る
  await setStripeStatus("active");
  await page.goto("/settings/billing");
  await expect(page.getByText("契約中", { exact: true })).toBeVisible();
  await page.goto(`/accounts/${accountId}/strategy`);
  await expect(page.getByText(/更新するまで読むだけです/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "保存" })).toBeVisible();
});
