// アプリの一覧の1行（apps/app-list.ts がまとめる。specs/meguru/031-conflict-free-composition）。
import { BILLING_UNIT_PRICE_JPY } from "../../billing";
import type { AppCatalogEntry } from "../catalog";

/** Threadsのアプリの一覧の1行。 */
export const THREADS_CATALOG_ENTRY = {
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
} as const satisfies AppCatalogEntry;
