// 特定商取引法に基づく表記（specs/013-billing FR-071、contracts/ui-routes.md「特定商取引法に基づく表記」）。ログインなしで読める。
import { BILLING_BASE_PRICE_JPY, BILLING_EXTRA_PRICE_JPY } from "@threads-grower/shared";
import { Link } from "react-router";
import { SELLER_INFO } from "@/lib/seller-info";

const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;
const TBD = "（公開の前に記入）";

/**
 * 特定商取引法に基づく表記のページ。
 * @returns ページ
 */
export function LegalCommercePage() {
  const rows: [string, string][] = [
    ["販売事業者", SELLER_INFO.name || TBD],
    ["運営責任者", SELLER_INFO.manager || TBD],
    ["所在地", SELLER_INFO.address || TBD],
    ["電話番号", SELLER_INFO.phone || TBD],
    ["メールアドレス", SELLER_INFO.email || TBD],
    [
      "販売価格",
      `基本料金 月${yen(BILLING_BASE_PRICE_JPY)}（アカウント1件目を含む）、2件目以降のアカウント1件につき月${yen(BILLING_EXTRA_PRICE_JPY)}（いずれも税込み）`,
    ],
    ["商品代金以外の必要料金", "なし（インターネットへの接続の費用は利用者の負担）"],
    ["支払い方法", "クレジットカード"],
    ["支払いの時期", "無料体験（登録から1か月）の終わり、または無料体験の後に契約したとき。以後、毎月"],
    ["提供の時期", "契約の手続きが終わってすぐ"],
    ["解約・返品", "いつでも解約でき、払った期間の終わりまで使えます。日割りの返金はしません"],
    ["動作環境", "最新のChrome・Safari・Edge・Firefox（パソコン・スマートフォン）"],
  ];
  return (
    <main className="mx-auto w-full max-w-2xl space-y-8 px-4 py-10">
      <h1 className="text-2xl font-semibold">特定商取引法に基づく表記</h1>
      <dl className="divide-y rounded-xl border text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="grid gap-1 px-4 py-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <dt className="font-medium">{k}</dt>
            <dd className="text-foreground/85">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-muted-foreground">
        <Link to="/terms" className="underline underline-offset-4">
          利用規約
        </Link>
      </p>
    </main>
  );
}
