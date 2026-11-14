// 人物メモ：声かけリスト（specs/people/002-sales-list tasks.md T222）。
// 取り込み → タグを付けて一覧で絞る → 次にやることを今日にしてホームに出る → 会ごとの声かけの一覧で1人を進める → 書き出す。
// 名前はすべて作ったもの（001 research.md R18）。CSVはテストの中で組み立てる。
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { worktreeDbName } from "../env";
import { resetAll, signIn, testUserEmail } from "./helpers";

const DIRECT_DB = process.env.E2E_DATABASE_URL_DIRECT ?? `postgres://postgres:postgres@localhost:5432/${worktreeDbName()}`;

/** フォームの見出し（初めから当てる質問文と、当たらない「満足度」）。 */
const HEADERS = [
  "タイムスタンプ",
  "あなたのLINE名を教えて下さい",
  "今日の満足度",
  "次回のIT交流会は参加できそうか",
  "今後どんなつながりがあると嬉しいか",
  "今後のキャリアや働き方で興味があること",
  "今後、情報や機会があれば個別に案内してよいか",
];

const NAMES = ["参加者01", "参加者02", "参加者03", "参加者04", "参加者05"];

/**
 * CSVの文字を組み立てる（全員が交流会の案内に同意）。
 * @returns CSVの文字
 */
function csv(): string {
  const rows = NAMES.map((n, i) =>
    [`2026/10/11 21:0${i}:00`, n, "5", "参加できそう", "エンジニアとつながりたい", "副業・業務委託", "交流会・勉強会の案内"].map((v) => `"${v}"`).join(","),
  );
  return [HEADERS.join(","), ...rows].join("\n");
}

/**
 * 今日から30日あとの日（日本時間）。誘う会（次の自分の会）にする。
 * @returns YYYY-MM-DD
 */
function inviteDay(): string {
  return new Date(Date.now() + 9 * 3600_000 + 30 * 86400_000).toISOString().slice(0, 10);
}

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
 * 人の一覧から人のページを開く。
 * @param page - ページ
 * @param name - 名前
 */
async function openPerson(page: Page, name: string) {
  await page.goto("/people/list");
  await page.getByRole("link", { name: new RegExp(name) }).click();
  await expect(page.getByRole("heading", { name: "タグ", level: 2 })).toBeVisible();
}

/**
 * 人のページのタグの段。
 * @param page - ページ
 * @returns 段
 */
function tagSection(page: Page) {
  return page.locator("section").filter({ has: page.getByRole("heading", { name: "タグ", level: 2 }) });
}

test.beforeEach(async () => {
  await resetAll();
});

test("声かけリスト：タグで絞る → 次にやることがホームに出る → 会ごとの声かけの一覧で進める → 書き出す", async ({ page, context }) => {
  test.setTimeout(180_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signIn(page);
  await grantPeople(page);

  // 準備：10月の自分の会を取り込み、次の自分の会を作る
  await page.goto("/people/import");
  await page.getByLabel(/CSVのファイルを選ぶ/).setInputFiles({ name: "answers.csv", mimeType: "text/csv", buffer: Buffer.from(csv(), "utf-8") });
  await page.getByRole("button", { name: /新しいイベントを作る/ }).click();
  await page.getByLabel("イベントの名前").fill("10月の交流会");
  await page.getByLabel(/開催日/).fill("2026-10-11");
  await page.getByRole("button", { name: "作る" }).click();
  await expect(page.getByLabel("どのイベントのアンケートですか")).not.toHaveValue("");
  await page.getByRole("button", { name: "次へ" }).click();
  await page.getByLabel("「今日の満足度」の項目").selectOption("other");
  await page.getByRole("button", { name: "次へ" }).click();
  await page.getByRole("button", { name: "取り込む" }).click();
  await expect(page.getByRole("heading", { name: "取り込みました" })).toBeVisible();

  await page.goto("/people/events/new");
  await page.getByLabel("イベントの名前").fill("次の交流会");
  await page.getByLabel(/開催日/).fill(inviteDay());
  await page.getByRole("button", { name: "作る" }).click();
  await expect(page.getByRole("heading", { name: "次の交流会" })).toBeVisible();

  // ① タグ：参加者01に新しいタグ「常連」を作って付け、参加者02には選んで付ける → 一覧で「常連」で絞ると2人
  await openPerson(page, "参加者01");
  await tagSection(page).getByLabel("タグを付ける").fill("常連");
  await tagSection(page).getByRole("button", { name: "付ける", exact: true }).click();
  await expect(tagSection(page).getByRole("list", { name: "付いているタグ" })).toContainText("#常連");
  await openPerson(page, "参加者02");
  await tagSection(page).getByRole("button", { name: "＋#常連" }).click();
  await expect(tagSection(page).getByRole("list", { name: "付いているタグ" })).toContainText("#常連");
  await page.goto("/people/list");
  await expect(page.getByText("全 5人")).toBeVisible();
  await page.getByRole("button", { name: /絞り込み/ }).click();
  await page.getByRole("button", { name: "#常連" }).click();
  await expect(page.getByText("当てはまる人 2人")).toBeVisible();

  // ② 次にやること：参加者01に今日（初めの値）の次にやることを決める → ホームの「今日やること」に出る
  await openPerson(page, "参加者01");
  await page.getByLabel("何をするか").fill("12月の会の案内を送る");
  await page.getByRole("button", { name: "次にやることを保存" }).click();
  await expect(page.getByText(/12月の会の案内を送る/).first()).toBeVisible();
  await page.goto("/people");
  const today = page.getByRole("region", { name: "今日やること" });
  await expect(today.getByRole("link", { name: /参加者01/ })).toContainText("12月の会の案内を送る");

  // ③ 会ごとの声かけの一覧：参加者01に声をかけ（文をコピー → 興味を聞いたにする）、一覧で「参加リンクを送った」に進める
  await expect(page.getByLabel("誘う会").locator("option:checked")).toHaveText(/次の交流会/);
  const row = page.getByRole("listitem").filter({ has: page.getByRole("link", { name: /参加者01/ }) }).filter({ has: page.getByRole("button", { name: "文をコピー" }) });
  await row.getByRole("button", { name: "文をコピー" }).click();
  await row.getByRole("button", { name: "興味を聞いたにする" }).click();
  await expect(row.getByRole("group", { name: "進み具合" }).getByRole("button", { name: "興味を聞いた" })).toHaveAttribute("aria-pressed", "true");
  await page.goto("/people/events");
  await page.getByRole("link", { name: /次の交流会/ }).click();
  await page.getByRole("link", { name: /声かけの一覧/ }).click();
  await expect(page.getByRole("region", { name: "興味を聞いた" })).toContainText("参加者01");
  await page.getByRole("group", { name: "進み具合：参加者01" }).getByRole("button", { name: "参加リンクを送った" }).click();
  await expect(page.getByRole("region", { name: "参加リンクを送った" })).toContainText("参加者01");
  await expect(page.getByRole("region", { name: "興味を聞いた" })).not.toContainText("参加者01");

  // ④ 書き出す：ダウンロードが起き、CSV（BOMつき）に人が入っている
  await page.goto("/people/list");
  await expect(page.getByText("全 5人")).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /書き出す/ }).click()]);
  expect(download.suggestedFilename()).toMatch(/^people-\d{8}\.csv$/);
  const path = await download.path();
  const text = await readFile(path, "utf-8");
  expect(text.charCodeAt(0)).toBe(0xfeff);
  expect(text).toContain("参加者01");
  expect(text).toContain("常連");
});
