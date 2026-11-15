// アプリの一覧の1行（apps/app-list.ts がまとめる。specs/meguru/031-conflict-free-composition）。
import type { AppCatalogEntry } from "../catalog";

// 集金管理（specs/collect/001-event-day-collection）。運営者が開いた人だけに出す（利用の許可。specs/meguru/030-app-access）
/** 集金管理のアプリの一覧の1行。 */
export const COLLECT_CATALOG_ENTRY = {
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
} as const satisfies AppCatalogEntry;
