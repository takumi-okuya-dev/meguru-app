// specs/014 US7・US8：参考投稿をためてまとめて登録し、解説がまだのものをまとめてAIに解説してもらう（偽の答えを貼る）
import { expect, test } from "@playwright/test";
import { createAccount, resetAll, signIn } from "./helpers";

test.beforeEach(async () => {
  await resetAll();
});

test("ためてまとめて登録し、まとめての解説を【ID】で結び付けて保存する", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signIn(page);
  const accountId = await createAccount(page, "リサーチのアカウント");
  await page.goto(`/accounts/${accountId}/research`);

  // リサーチのやり方（初めは閉じる）
  await expect(page.getByRole("button", { name: /伸びる投稿を見つけるリサーチ/ })).toHaveAttribute("aria-expanded", "false");

  // ためてまとめて登録
  await page.getByRole("button", { name: "参考投稿を追加" }).click();
  const dialog = page.getByRole("dialog", { name: "参考投稿を追加" });
  await dialog.getByLabel("本文").fill("1件目の伸びていた投稿");
  await dialog.getByRole("button", { name: "＋この投稿をためて、次の投稿を入力する" }).click();
  await expect(dialog.getByRole("region", { name: "ためた投稿（1件）" })).toBeVisible();
  await dialog.getByLabel("本文").fill("2件目の伸びていた投稿");
  await dialog.getByRole("button", { name: "2件を登録する" }).click();
  await expect(page.getByText("2件を登録しました")).toBeVisible();

  // まとめての解説：プロンプトをコピーし、【ID】ごとに偽の答えを作って貼る
  const panel = page.getByRole("region", { name: "まとめてAIに解説してもらう" });
  await expect(panel.getByText("解説がまだの参考投稿：2件")).toBeVisible();
  await panel.getByRole("button", { name: "まとめてAIに解説してもらう（2件）" }).click();
  // プロンプトはAPIから読んでからコピーするので、コピーできたと出るまで待つ
  await expect(panel.getByText(/2件分のプロンプトをコピーしました/)).toBeVisible();
  const prompt = await page.evaluate(() => navigator.clipboard.readText());
  const ids = [...prompt.matchAll(/【ID:([0-9a-z]+)】/g)].map((m) => m[1]!);
  expect(ids).toHaveLength(2);
  const answer = ids
    .map((id, i) => `【ID:${id}】\n【型の名前】あるある × 共感型${i}\n【なぜ伸びたか】自分ごとになる\n【判定】○ 真似してOK`)
    .join("\n@@@\n");
  await panel.getByLabel("AIの答えを貼り付ける").fill(answer);
  await panel.getByRole("button", { name: "2件の解説を保存する" }).click();
  await expect(page.getByText("2件の解説を保存しました")).toBeVisible();
  await expect(page.getByRole("region", { name: "まとめてAIに解説してもらう" })).toHaveCount(0);
});
