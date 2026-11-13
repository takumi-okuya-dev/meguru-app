// アプリの一覧の1行（apps/app-list.ts がまとめる。specs/meguru/031-conflict-free-composition）。
import type { AppCatalogEntry } from "../catalog";

// 人物メモ（specs/people/001-people-memo research.md R3）。運営者が開いた人だけが使える（API の registerAppAccess("people", "granted")）
/** 人物メモのアプリの一覧の1行。 */
export const PEOPLE_CATALOG_ENTRY = {
  id: "people",
  name: "めぐる 人物メモ",
  basePath: "/people",
  summary: "アンケートから会った人を覚え、次の会に誘う",
  details: [
    "イベントのアンケート（GoogleフォームのCSV）を取り込むと、会った人の一覧ができます",
    "同じ人は、イベントをまたいで1人にまとまり、来た会・答え・メモを1ページで見られます",
    "次の会に誘うときは、個別の案内に同意した人だけが候補に並びます",
  ],
  priceLabel: "テスト版（料金なし）",
  released: true,
} as const satisfies AppCatalogEntry;
