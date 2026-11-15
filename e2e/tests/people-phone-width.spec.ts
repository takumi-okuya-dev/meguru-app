// 人物メモ：スマートフォン（390px幅）の確かめ（specs/people/001-people-memo tasks.md T096、spec Edge Cases「スマートフォンでの取り込み」）。
// 取り込み（列の対応・同じ人の候補のカード）・人の一覧・人のページ・誘う候補で、
// 横にスクロールしない／押すところが44px以上／下のバーで中身の最後が隠れない、を確かめる。
// 名前はすべて作ったもの（research.md R18）。CSVはテストの中で組み立て、リポジトリに実際のアンケートは置かない。
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { worktreeDbName } from "../env";
import { resetAll, signIn, testUserEmail } from "./helpers";

const DIRECT_DB = process.env.E2E_DATABASE_URL_DIRECT ?? `postgres://postgres:postgres@localhost:5432/${worktreeDbName()}`;

test.use({ viewport: { width: 390, height: 844 } });

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

const OCT = Array.from({ length: 12 }, (_, i) => `参加者${String(i + 1).padStart(2, "0")}`);
/** 2回目：前に来た2人（同じ人の候補になる）と、新しい2人。 */
const NOV = [...OCT.slice(0, 2), "新しい人1", "新しい人2"];

/**
 * 今日から30日あとの日（日本時間。YYYY-MM-DD）。誘う会（次の自分の会）にする。
 * @returns 日
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
 * イベントを作って、CSVを取り込むところ（列の対応の段）まで進める。
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

/** 3つの確かめの結果。 */
type PhoneCheck = {
  scrollWidth: number;
  width: number;
  wide: string[];
  small: string[];
  contentBottom: number;
  lowest: string;
  barTop: number | null;
};

/**
 * 今の画面を確かめる。
 * - 横にはみ出した要素
 * - 押すところ（リンク・ボタン・入力・選ぶもの）で高さが44pxに届かないもの。
 *   ラベルのある入力・ボタンは、ラベルの大きさでも測る。文の中のリンク（WCAG 2.5.8 の「文の中」の例外）は除く。
 * - 中身を一番下まで送ったとき、中身の最後が下のバーの上にあるか
 * @param page - ページ
 * @returns 結果
 */
async function inspect(page: Page): Promise<PhoneCheck> {
  return page.evaluate(() => {
    const describe = (el: Element) => {
      const name = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 30);
      return `${el.tagName.toLowerCase()}「${name || String((el as HTMLElement).className).slice(0, 40)}」`;
    };
    const width = document.documentElement.clientWidth;
    const wide = [...document.querySelectorAll("body *")]
      .filter((el) => el.getBoundingClientRect().right > width + 1)
      .map(describe);

    const isShown = (el: Element) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const style = getComputedStyle(el);
      return style.visibility !== "hidden" && style.display !== "none" && !el.closest("[aria-hidden='true']");
    };
    const inText = (el: Element) => el.tagName === "A" && el.parentElement !== null && ["P", "LI", "SPAN", "DD"].includes(el.parentElement.tagName) && (el.parentElement.textContent ?? "").trim() !== (el.textContent ?? "").trim();
    const targets = document.querySelectorAll(
      "a[href], button, select, textarea, summary, input:not([type='hidden']), [role='button'], [role='tab'], [role='checkbox'], [role='switch']",
    );
    const small: string[] = [];
    for (const el of targets) {
      if (!isShown(el) || inText(el)) continue;
      const input = el as HTMLInputElement;
      // ラベル（<label for> や包むラベル）を押しても同じなので、要素とラベルの大きいほうで測る
      const labels = [...(input.labels ?? [])];
      const h = Math.max(el.getBoundingClientRect().height, ...labels.map((l) => l.getBoundingClientRect().height));
      if (h < 44 - 0.5) small.push(`${describe(el)} ${Math.round(h)}px`);
    }

    const scroller = document.querySelector<HTMLElement>("[data-main-scroll]");
    const bar = document.querySelector("nav[aria-label='人物メモのメニュー']");
    let contentBottom = 0;
    let lowest = "";
    if (scroller) {
      scroller.scrollTop = scroller.scrollHeight;
      for (const el of scroller.querySelectorAll("*")) {
        if (bar?.contains(el) || el.closest("[aria-hidden='true']") || !isShown(el)) continue;
        const bottom = el.getBoundingClientRect().bottom;
        if (bottom > contentBottom) {
          contentBottom = bottom;
          lowest = describe(el);
        }
      }
    }
    return {
      scrollWidth: document.documentElement.scrollWidth,
      width,
      wide: [...new Set(wide)].slice(0, 5),
      small: [...new Set(small)],
      contentBottom,
      lowest,
      barTop: bar ? bar.getBoundingClientRect().top : null,
    };
  });
}

/**
 * 今の画面で3つを確かめる。
 * @param page - ページ
 * @param label - 画面の名前（失敗の書き出しに使う）
 */
async function expectPhoneFriendly(page: Page, label: string) {
  const r = await inspect(page);
  expect.soft(r.scrollWidth, `${label}：横にはみ出す ${r.wide.join(" / ")}`).toBeLessThanOrEqual(r.width);
  expect.soft(r.small, `${label}：押すところが44pxに届かない`).toEqual([]);
  expect.soft(r.barTop, `${label}：下のバーがない`).not.toBeNull();
  expect.soft(r.contentBottom, `${label}：中身の最後（${r.lowest}）が下のバーで隠れる`).toBeLessThanOrEqual((r.barTop ?? 0) + 1);
}

test.beforeEach(async () => {
  await resetAll();
});

test("390px幅：取り込み・人の一覧・人のページ・誘う候補（とそのほかの画面）が、はみ出さず、押しやすく、下のバーで隠れない", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page);
  await grantPeople(page);

  // ① 取り込み：ファイルを選ぶ段 → 列の対応 → 確かめ → 取り込んだ
  await page.goto("/people/import");
  await expect(page.getByLabel(/CSVのファイルを選ぶ/)).toBeAttached();
  await expectPhoneFriendly(page, "取り込み（ファイルを選ぶ）");
  await startImport(page, "10月の交流会", "2026-10-11", csv("2026/10/11", OCT));
  await expect(page.getByLabel("「今日の満足度」の項目")).toBeVisible();
  await expectPhoneFriendly(page, "取り込み（列の対応）");
  await page.getByLabel("「今日の満足度」の項目").selectOption("other");
  await page.getByLabel("「もっとこうだったら嬉しいこと」の項目").selectOption("other");
  await page.getByRole("button", { name: "次へ" }).click();
  await expect(page.getByRole("heading", { name: "取り込む前に確かめてください" })).toBeVisible();
  await expectPhoneFriendly(page, "取り込み（確かめ）");
  await page.getByRole("button", { name: "取り込む" }).click();
  await expect(page.getByRole("heading", { name: "取り込みました" })).toBeVisible();
  await expectPhoneFriendly(page, "取り込み（取り込んだ）");

  // ② 2回目：同じ人の候補のカード（狭い画面では1組ずつ。決めると次の組へ進む）
  await startImport(page, "11月の交流会", "2026-11-01", csv("2026/11/01", NOV));
  await page.getByRole("button", { name: "次へ" }).click();
  const cards = page.getByTestId("candidate-card");
  await expect(cards).toHaveCount(1);
  await expect(page.getByText("1組目 / 全2組")).toBeVisible();
  await expectPhoneFriendly(page, "取り込み（同じ人の候補のカード）");
  await cards.first().getByRole("button", { name: "つなぐ" }).click();
  await expect(page.getByText("2組目 / 全2組")).toBeVisible();
  await cards.first().getByRole("button", { name: "つなぐ" }).click();
  await expect(page.getByText("決めた組 2 / 2")).toBeVisible();
  await page.getByRole("button", { name: "取り込む" }).click();
  await expect(page.getByRole("heading", { name: "取り込みました" })).toBeVisible();

  // ③ 人の一覧（行が多く、一番下まで送る）
  await page.goto("/people/list");
  await expect(page.getByRole("link", { name: /参加者01/ })).toBeVisible();
  await expectPhoneFriendly(page, "人の一覧");

  // ④ 人のページ
  await page.getByRole("link", { name: /参加者01/ }).click();
  await expect(page.getByRole("heading", { name: /参加者01/ }).first()).toBeVisible();
  await expectPhoneFriendly(page, "人のページ");

  // ⑤ 誘う候補（次の自分の会を作ってから）
  await page.goto("/people/events/new");
  await page.getByLabel("イベントの名前").fill("次の交流会");
  await page.getByLabel(/開催日/).fill(inviteDay());
  await page.getByRole("button", { name: "作る" }).click();
  await expect(page.getByRole("heading", { name: "次の交流会" })).toBeVisible();
  await page.getByRole("navigation", { name: "人物メモのメニュー" }).getByRole("link", { name: "誘う候補" }).click();
  await expect(page.getByLabel("誘う会").locator("option:checked")).toHaveText(/次の交流会/);
  await expect(page.getByRole("button", { name: "文をコピー" }).first()).toBeVisible();
  await expectPhoneFriendly(page, "誘う候補");
  await page.getByRole("button", { name: /絞り込み/ }).click();
  await expectPhoneFriendly(page, "誘う候補（絞り込みを開いた）");

  // ⑥ そのほかの画面（T096 の4つの画面のほか）：イベントの一覧・イベントのページ・会ごとの声かけの一覧・設定・人を足す
  await page.goto("/people/events");
  await expect(page.getByRole("link", { name: /次の交流会/ })).toBeVisible();
  await expectPhoneFriendly(page, "イベントの一覧");
  await page.getByRole("link", { name: /次の交流会/ }).click();
  await expect(page.getByRole("heading", { name: "次の交流会" })).toBeVisible();
  await expectPhoneFriendly(page, "イベントのページ");
  await page.goto(page.url().replace(/\/?$/, "/outreach"));
  await expect(page.getByRole("heading").first()).toBeVisible();
  await expectPhoneFriendly(page, "会ごとの声かけの一覧");
  await page.goto("/people/settings");
  await expect(page.getByRole("heading").first()).toBeVisible();
  await expectPhoneFriendly(page, "設定");
  await page.goto("/people/list/new");
  await expect(page.getByRole("heading").first()).toBeVisible();
  await expectPhoneFriendly(page, "人を足す");
});
