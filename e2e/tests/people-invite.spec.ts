// 人物メモ：誘う候補と声かけ（specs/people/001-people-memo tasks.md T083、quickstart.md 4、SC-003・SC-005）。
// 名前はすべて作ったもの（research.md R18）。CSVはテストの中で組み立て、リポジトリに実際のアンケートは置かない。
// 「前に来た」（自分の会に1回以上）で人が減るのを確かめるため、11月の会は参加者として出た会（自分の会ではない）にする。
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { worktreeDbName } from "../env";
import { resetAll, signIn, testUserEmail } from "./helpers";

const DIRECT_DB = process.env.E2E_DATABASE_URL_DIRECT ?? `postgres://postgres:postgres@localhost:5432/${worktreeDbName()}`;

/** フォームの見出し（初めから当てる質問文と、当たらない「満足度」「自由記述」）。 */
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

/** 1人の答え。 */
type Answer = { name: string; next: string; consent: string };

/**
 * CSVの文字を組み立てる。
 * @param day - 回答の日（YYYY/MM/DD）
 * @param answers - 人ごとの答え
 * @returns CSVの文字
 */
function csv(day: string, answers: Answer[]): string {
  const rows = answers.map((a, i) =>
    [`${day} 21:${String(i).padStart(2, "0")}:00`, a.name, "5", a.next, "エンジニアやSES企業とつながりたい", "副業・業務委託", a.consent, ""].map((v) => `"${v}"`).join(","),
  );
  return [HEADERS.join(","), ...rows].join("\n");
}

const INVITE = "交流会・勉強会の案内";
const DECLINE = "個別の案内は希望しない";

/** 10月（自分の会）：20人。01〜10は「参加できそう」、11〜19は「未定」、20は「個別の案内は希望しない」。 */
const OCT: Answer[] = Array.from({ length: 20 }, (_, i) => ({
  name: `参加者${String(i + 1).padStart(2, "0")}`,
  next: i < 10 ? "参加できそう" : "未定",
  consent: i === 19 ? DECLINE : INVITE,
}));
/** 11月（参加者として出た会）：10月の5人（つなぐ）と、新しい5人。 */
const NOV: Answer[] = [
  ...OCT.slice(0, 5).map((a) => ({ ...a, next: "参加できそう" })),
  ...Array.from({ length: 5 }, (_, i) => ({ name: `新しい人${i + 1}`, next: "参加できそう", consent: INVITE })),
];

/**
 * 今日から30日あとの日（日本時間）。誘う会（次の自分の会）にする。
 * @returns YYYY-MM-DD と、文に入る「M月D日」
 */
function inviteDay(): { ymd: string; monthDay: string } {
  const ymd = new Date(Date.now() + 9 * 3600_000 + 30 * 86400_000).toISOString().slice(0, 10);
  const [, m, d] = ymd.split("-").map(Number);
  return { ymd, monthDay: `${m}月${d}日` };
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
 * イベントを作って、CSVを取り込むところ（列の対応の段）まで進める。
 * @param page - ページ
 * @param eventName - イベントの名前
 * @param heldOn - 開催日
 * @param isOwn - 自分の会か
 * @param text - CSVの文字
 */
async function startImport(page: Page, eventName: string, heldOn: string, isOwn: boolean, text: string) {
  await page.goto("/people/import");
  await page.getByLabel(/CSVのファイルを選ぶ/).setInputFiles({ name: "answers.csv", mimeType: "text/csv", buffer: Buffer.from(text, "utf-8") });
  await page.getByRole("button", { name: /新しいイベントを作る/ }).click();
  await page.getByLabel("イベントの名前").fill(eventName);
  await page.getByLabel(/開催日/).fill(heldOn);
  if (!isOwn) await page.getByLabel(/自分の会/).uncheck();
  await page.getByRole("button", { name: "作る" }).click();
  await expect(page.getByLabel("どのイベントのアンケートですか")).not.toHaveValue("");
  await page.getByRole("button", { name: "次へ" }).click();
}

/**
 * 候補の行（名前のリンクを持つ行）。
 * @param page - ページ
 * @param name - 名前
 * @returns 行
 */
function row(page: Page, name: string) {
  return page.getByRole("listitem").filter({ has: page.getByRole("link", { name: new RegExp(name) }) });
}

/**
 * クリップボードの文を読む。
 * @param page - ページ
 * @returns 文
 */
async function clipboardText(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}

test.beforeEach(async () => {
  await resetAll();
});

test("誘う候補：絞り込み・同意のない人は出ない・文をコピー → 興味を聞いたにする・390px幅で2回のタップでコピー", async ({ page, context }) => {
  test.setTimeout(180_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signIn(page);
  await grantPeople(page);
  const day = inviteDay();

  // 準備：10月（自分の会）と11月（参加者として出た会）を取り込み、次の自分の会を作る
  await startImport(page, "10月の交流会", "2026-10-11", true, csv("2026/10/11", OCT));
  await page.getByLabel("「今日の満足度」の項目").selectOption("other");
  await page.getByLabel("「もっとこうだったら嬉しいこと」の項目").selectOption("other");
  await page.getByRole("button", { name: "次へ" }).click();
  await page.getByRole("button", { name: "取り込む" }).click();
  await expect(page.getByRole("heading", { name: "取り込みました" })).toBeVisible();

  await startImport(page, "11月のもくもく会", "2026-11-25", false, csv("2026/11/25", NOV));
  await page.getByRole("button", { name: "次へ" }).click();
  const cards = page.getByTestId("candidate-card");
  await expect(cards).toHaveCount(5);
  for (let i = 0; i < 5; i++) await cards.nth(i).getByRole("button", { name: "つなぐ" }).click();
  await page.getByRole("button", { name: "取り込む" }).click();
  await expect(page.getByRole("heading", { name: "取り込みました" })).toBeVisible();

  await page.goto("/people/events/new");
  await page.getByLabel("イベントの名前").fill("次の交流会");
  await page.getByLabel(/開催日/).fill(day.ymd);
  await page.getByRole("button", { name: "作る" }).click();
  await expect(page.getByRole("heading", { name: "次の交流会" })).toBeVisible();

  // ① 誘う候補を開く：誘う会は初めから次の自分の会。同意した24人（「個別の案内は希望しない」の参加者20は出ない）
  await page.goto("/people");
  await expect(page.getByText("個別の案内に同意した人だけを出しています")).toBeVisible();
  await expect(page.getByLabel("誘う会").locator("option:checked")).toHaveText(/次の交流会/);
  await expect(page.getByText("候補 24人")).toBeVisible();
  await expect(page.getByText("参加者20", { exact: true })).toHaveCount(0);

  // ② 「前に来た」で11月だけの5人が外れ、「次回参加：参加できそう」で10人になる。どの絞り込みでも参加者20は出ない
  await page.getByRole("button", { name: /絞り込み/ }).click();
  await page.getByRole("button", { name: "前に来た", exact: true }).click();
  await expect(page.getByText("当てはまる人 19人")).toBeVisible();
  await expect(page.getByText("新しい人1", { exact: true })).toHaveCount(0);
  await expect(page.getByText("参加者20", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "参加できそう", exact: true }).click();
  await expect(page.getByText("当てはまる人 10人")).toBeVisible();
  await expect(page.getByText("参加者20", { exact: true })).toHaveCount(0);
  await expect(page.getByText("参加者11", { exact: true })).toHaveCount(0);

  // ③ 文をコピー → 興味を聞いたにする → 行と人のページに「興味を聞いた」
  const first = row(page, "参加者01");
  await first.getByRole("button", { name: "文をコピー" }).click();
  const text = await clipboardText(page);
  expect(text).toContain("参加者01さん");
  expect(text).toContain(day.monthDay);
  expect(text).toContain("次の交流会");
  await first.getByRole("button", { name: "興味を聞いたにする" }).click();
  await expect(first.getByRole("group", { name: "進み具合" }).getByRole("button", { name: "興味を聞いた" })).toHaveAttribute("aria-pressed", "true");
  await first.getByRole("link", { name: /参加者01/ }).click();
  await expect(page.getByRole("heading", { name: "声かけの記録" })).toBeVisible();
  await expect(page.getByText(/次の交流会への誘い/)).toBeVisible();
  await expect(page.getByText("あなたが記録")).toBeVisible();

  // ④ 390px幅：下のバーの「誘う候補」→ 行の「文をコピー」の2回で文がコピーされる（3回以内。SC-005）
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/people/events");
  await page.evaluate(() => navigator.clipboard.writeText(""));
  await page.getByRole("navigation", { name: "人物メモのメニュー" }).getByRole("link", { name: "誘う候補" }).click(); // 1回目
  await expect(page.getByLabel("誘う会").locator("option:checked")).toHaveText(/次の交流会/);
  await page.getByRole("button", { name: "文をコピー" }).first().click(); // 2回目
  await expect.poll(() => clipboardText(page)).toContain("次の交流会");
  // 横にスクロールしない
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
