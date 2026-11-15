// 人物メモ：2回の取り込みと同じ人の候補（specs/people/001-people-memo tasks.md T043、quickstart.md 1・2）。
// 名前はすべて作ったもの（research.md R18）。CSVはテストの中で組み立て、リポジトリに実際のアンケートは置かない。
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { worktreeDbName } from "../env";
import { resetAll, signIn, testUserEmail } from "./helpers";

const DIRECT_DB = process.env.E2E_DATABASE_URL_DIRECT ?? `postgres://postgres:postgres@localhost:5432/${worktreeDbName()}`;

/** 2026-10-11の回のフォームの見出し（初めから当てる質問文と、当たらない「満足度」「自由記述」）。 */
const HEADERS = [
  "タイムスタンプ",
  "あなたのLINE名を教えて下さい",
  "今日の満足度",
  "次回のIT交流会は参加できそうか",
  "今後どんなつながりがあると嬉しいか",
  "今後のキャリアや働き方で興味があること",
  "今後、情報や機会があれば個別に案内してよいか",
  "もっとこうだったら嬉しいこと",
];

/**
 * CSVの文字を組み立てる。
 * @param day - 回答の日（YYYY/MM/DD）
 * @param names - LINE名
 * @returns CSVの文字
 */
function csv(day: string, names: string[]): string {
  const rows = names.map((n, i) =>
    [`${day} 21:${String(i).padStart(2, "0")}:00`, n, "5", "参加できそう", "エンジニアやSES企業とつながりたい", "副業・業務委託", "交流会・勉強会の案内", ""].map((v) => `"${v}"`).join(","),
  );
  return [HEADERS.join(","), ...rows].join("\n");
}

const OCT = Array.from({ length: 20 }, (_, i) => `参加者${String(i + 1).padStart(2, "0")}`);
/** 11/25：前に来た5人（うち4人をつなぐ・1人は別の人）と、新しい5人。 */
const NOV = [...OCT.slice(0, 5), ...Array.from({ length: 5 }, (_, i) => `新しい人${i + 1}`)];

/**
 * テスト用の利用者に人物メモを開く（運営者の画面の代わりに、許可の表へ直に書く）。
 * @param page - ページ（ログインして、利用者の行ができたあと）
 */
async function grantPeople(page: Page) {
  await page.goto("/apps");
  await expect(page.getByRole("heading").first()).toBeVisible();
  const client = new pg.Client({ connectionString: DIRECT_DB });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO app_access_grants (app, user_id) SELECT 'people', id FROM users WHERE email = $1 ON CONFLICT DO NOTHING`,
      [testUserEmail()],
    );
  } finally {
    await client.end();
  }
}

/**
 * イベントを作って、CSVを取り込むところ（確かめの段）まで進める。
 * @param page - ページ
 * @param eventName - イベントの名前
 * @param heldOn - 開催日
 * @param text - CSVの文字
 */
async function startImport(page: Page, eventName: string, heldOn: string, text: string) {
  await page.goto("/people/import");
  await page.getByLabel(/CSVのファイルを選ぶ/).setInputFiles({ name: "answers.csv", mimeType: "text/csv", buffer: Buffer.from(text, "utf-8") });
  await page.getByRole("button", { name: /新しいイベントを作る/ }).click();
  await page.getByLabel("イベントの名前").fill(eventName);
  await page.getByLabel(/開催日/).fill(heldOn);
  await page.getByRole("button", { name: "作る" }).click();
  await expect(page.getByLabel("どのイベントのアンケートですか")).not.toHaveValue("");
  await page.getByRole("button", { name: "次へ" }).click();
}

test.beforeEach(async () => {
  await resetAll();
});

test("10/11のCSVで20人、11/25のCSVで候補5組 → 4組つなぐ・1組は別の人", async ({ page }) => {
  await signIn(page);
  await grantPeople(page);

  // ① 1回目：満足度と自由記述の列だけ選ぶ（ほかは初めから当たる）
  await startImport(page, "10月の交流会", "2026-10-11", csv("2026/10/11", OCT));
  await page.getByLabel("「今日の満足度」の項目").selectOption("other");
  await page.getByLabel("「もっとこうだったら嬉しいこと」の項目").selectOption("other");
  await page.getByRole("button", { name: "次へ" }).click();
  await expect(page.getByRole("heading", { name: "取り込む前に確かめてください" })).toBeVisible();
  await page.getByRole("button", { name: "取り込む" }).click();
  await expect(page.getByRole("heading", { name: "取り込みました" })).toBeVisible();
  await expect(page.getByText("新しく入った人").locator("xpath=following-sibling::*[1]")).toHaveText("20人");

  // ② 2回目：列の対応は覚えている。候補5組のうち4組をつなぎ、1組は別の人
  await startImport(page, "11月の交流会", "2026-11-25", csv("2026/11/25", NOV));
  await page.getByRole("button", { name: "次へ" }).click();
  const cards = page.getByTestId("candidate-card");
  await expect(cards).toHaveCount(5);
  for (let i = 0; i < 4; i++) await cards.nth(i).getByRole("button", { name: "つなぐ" }).click();
  await cards.nth(4).getByRole("button", { name: "別の人" }).click();
  await page.getByRole("button", { name: "取り込む" }).click();
  await expect(page.getByRole("heading", { name: "取り込みました" })).toBeVisible();

  // ③ イベントのページの参加者数
  await page.getByRole("link", { name: "イベントのページを見る" }).click();
  await expect(page.getByText(/参加者\s*10人/)).toBeVisible();
  await page.goto("/people/events");
  await expect(page.getByText("10月の交流会")).toBeVisible();
});
