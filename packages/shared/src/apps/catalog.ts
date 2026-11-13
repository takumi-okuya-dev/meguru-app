// スイート「めぐる」のアプリの一覧（specs/028-meguru-shell data-model.md 2、research.md R7）。
// 名前・パス・説明・料金を1か所に置き、API・Web・将来のモバイルの画面で食い違わないようにする。
import { z } from "zod";
import { BILLING_UNIT_PRICE_JPY } from "../billing";

/** アプリの一覧の1行。 */
export type AppCatalogEntry = {
  /** アプリのID（URLのパス・users.last_app_id・/api/me の apps で使う） */
  id: string;
  /** すべてのアプリの画面とアプリの切り替えに出す名前 */
  name: string;
  /** 画面のURLの頭（Web の AppModule.basePath と同じ。Web のテストで確かめる） */
  basePath: string;
  /** すべてのアプリの画面の1行の説明 */
  summary: string;
  /** 「詳しく見る」で開く説明 */
  details: readonly string[];
  /** 料金の文言 */
  priceLabel: string;
  /** 利用者に出してよいか。false のアプリは API の available に入れず、Web の組み立て（app-registry.ts）も登録しない */
  released: boolean;
};

/** アプリの一覧（並びは、すべてのアプリの画面とアプリの切り替えの順）。 */
export const APP_CATALOG = [
  {
    id: "threads",
    name: "めぐる Threads",
    basePath: "/threads",
    summary: "Threadsの投稿を、人格を保ったまま育てる",
    details: [
      "戦略（課題・宣伝内容・リサーチ）を書くと、投稿の案を作るためのプロンプトができます",
      "投稿の案は、承認したものだけを、決めた時刻に自動で投稿します",
      "投稿の反応を取り込み、伸びた投稿・伸びなかった投稿を次の案に生かせます",
      "チームで、ほかの人のアカウントの運用を手伝えます",
    ],
    priceLabel: `アカウント1件につき月${BILLING_UNIT_PRICE_JPY.toLocaleString("ja-JP")}円`,
    released: true,
  },
  {
    // 集金管理（specs/collect/001-event-day-collection）。運営者が開いた人だけに出す（利用の許可。specs/meguru/030-app-access）
    id: "collect",
    name: "めぐる 集金",
    basePath: "/collect",
    summary: "イベント当日の集金（現金・PayPay・振込）を、1人1タップで記録する",
    details: [
      "申込は今の媒体のまま。名簿は手で続けて入れるか、申込の一覧を貼ってまとめて入れます",
      "前に来た人は、名前を入れ始めると候補に出ます",
      "PayPayの受け取り用QRと振込先を登録しておくと、受付ですぐ出せます",
      "お金はアプリを通りません。払い方と金額の記録だけを持ちます",
    ],
    priceLabel: "テスト版（料金なし）",
    released: true,
  },
] as const satisfies readonly AppCatalogEntry[];

/** アプリのID。 */
export type AppId = (typeof APP_CATALOG)[number]["id"];

/**
 * アプリの利用の決まり（specs/meguru/030-app-access FR-001）。open：だれでも使える。granted：運営者・人ごとの許可がある人・
 * 閉じていないテストのグループの許可がある人だけが使える。アプリは API の組み立てで登録し、登録しないアプリは open。
 */
export const APP_ACCESS_MODES = ["open", "granted"] as const;
/** アプリの利用の決まり。 */
export type AppAccessMode = (typeof APP_ACCESS_MODES)[number];

/**
 * 利用者に出してよいアプリの一覧（released のもの。一覧の順）。
 * @returns アプリの一覧
 */
export function releasedApps(): readonly AppCatalogEntry[] {
  return APP_CATALOG.filter((a) => a.released);
}

/**
 * IDからアプリを引く。
 * @param id - アプリのID
 * @returns アプリ（なければ undefined）
 */
export function appById(id: string): AppCatalogEntry | undefined {
  return APP_CATALOG.find((a) => a.id === id);
}

/**
 * 出してよいアプリのIDか。
 * @param id - 調べる値
 * @returns 出してよいアプリのIDなら true
 */
export function isReleasedAppId(id: unknown): id is AppId {
  return typeof id === "string" && releasedApps().some((a) => a.id === id);
}

/** PUT /api/me/last-app の入力（contracts/api.md 2）。出してよいアプリのIDだけを受ける。 */
export const lastAppRequestSchema = z.object({
  app: z.string().refine(isReleasedAppId, { message: "unknown app" }),
});

/** GET /api/me の apps（contracts/api.md 1）。 */
export const meAppsSchema = z.object({
  /** その人に出せるアプリ */
  available: z.array(z.string()),
  /** 使っているアプリ */
  using: z.array(z.string()),
  /** 最後に使ったアプリ（出せなければ null） */
  last: z.string().nullable(),
  /** 入口の行き先（使っているアプリがなければ null） */
  landing: z.string().nullable(),
});
/** GET /api/me の apps。 */
export type MeApps = z.infer<typeof meAppsSchema>;

/**
 * 入口の行き先を決める。最後に使ったアプリを使っていればそれ、なければ使っているアプリの最初、なければ null。
 * @param using - 使っているアプリ
 * @param last - 最後に使ったアプリ
 * @returns 行き先のアプリのID
 */
export function resolveLandingApp(using: readonly string[], last: string | null): string | null {
  if (last && using.includes(last)) return last;
  return using[0] ?? null;
}
