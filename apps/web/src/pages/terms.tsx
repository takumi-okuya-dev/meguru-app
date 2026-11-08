// 利用規約（specs/010-token-account-add FR-052、contracts/ui-routes.md「利用規約」）。ログインなしで読める。
// 本featureでは最小限の下書き。運営者が公開の前に文面を確かめ、運営者の名前・連絡先を書き足す。
// 料金・無料体験・解約・未払い・退会の節は specs/013-billing（FR-070）で足した。金額は共通の定数から出す。
import { BILLING_UNIT_PRICE_JPY } from "@threads-grower/shared";
import type { ReactNode } from "react";
import { Link } from "react-router";

const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;

/**
 * 見出しと本文の節。
 * @param props - title：見出し、children：本文
 * @returns 節
 */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="font-semibold">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-foreground/85">{children}</div>
    </section>
  );
}

/**
 * 利用規約のページ。
 * @returns ページ
 */
export function TermsPage() {
  return (
    <main className="mx-auto w-full max-w-2xl space-y-8 px-4 py-10">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">利用規約</h1>
        <p className="text-sm text-muted-foreground">
          この規約は、ThreadsGrower（以下「本サービス」）を使うときの約束ごとです。本サービスを使った時点で、この規約に同意したものとします。
        </p>
      </div>

      <Section title="1. サービスの内容">
        <p>
          本サービスは、Threadsアカウントの運用（戦略の整理、投稿の案の管理と承認、承認した投稿の自動投稿、反応数の分析）を手伝うサービスです。投稿の本文は、利用者が外部のAIなどで作り、本サービスに登録します。
        </p>
      </Section>

      <Section title="2. アカウントとログイン">
        <p>本サービスにはGoogleアカウントでログインします。ログインの情報は、利用者が自分で管理してください。</p>
      </Section>

      <Section title="3. トークンでの接続の扱い">
        <p>
          利用者が自分のMetaアプリで作ったアクセストークンを貼り付けて接続した場合、本サービスはそのトークンを、あなたの代わりに、そのThreadsアカウントの運用のためだけに使います（投稿、プロフィールと反応数の取得）。本サービスは、その利用者のためだけにデータを処理するサービスとして動きます。
        </p>
        <p>トークンは暗号化して保存し、画面に再び表示しません。トークンとThreadsから受け取ったデータを、第三者に渡しません。</p>
        <p>
          本サービスでそのアカウントを削除すると、保存しているトークンも削除します。トークンは、Metaの開発者サイトやThreadsの設定から、いつでも取り消せます。取り消した後は、本サービスからそのアカウントに投稿できなくなります。
        </p>
      </Section>

      <Section title="4. 禁止事項">
        <ul className="list-disc space-y-1 pl-5">
          <li>他人のThreadsアカウントやトークンを、その人の許可なく接続すること</li>
          <li>法令、Threadsの利用規約、Metaの開発者向けの規約に反する投稿や使い方</li>
          <li>本サービスや他の利用者に、不正なアクセスや過度な負荷をかけること</li>
        </ul>
      </Section>

      <Section title="5. データの削除">
        <p>
          アカウントは、そのアカウントの設定からいつでも削除できます。削除すると、接続の情報と、そのアカウントに関わるデータを削除します。Threadsの設定で本サービスとの連携を解除した場合も、データの削除の要求として受け付けます。
        </p>
      </Section>

      <Section title="6. 料金と支払い">
        <p>
          料金は、アカウント1件につき月{yen(BILLING_UNIT_PRICE_JPY)}です（税込み）。Threadsにつないでいないアカウントも数えます。本サービスは、契約してから使い始めます。
        </p>
        <p>
          支払いはクレジットカードで、毎月請求します。アカウントを足す・削除すると、次の請求からアカウントの数が反映されます。今の期間の分の日割りの請求・返金はしません。カードの情報は決済代行会社（Stripe）が扱い、本サービスは持ちません。
        </p>
      </Section>

      <Section title="7. 無料体験">
        <p>無料体験はありません。契約の手続きが終わると、その場で最初の請求をし、すぐに使えます。</p>
        <p>
          無料体験を廃止する前に始めた無料体験は、終わる日まで使えます（その間に作れるアカウントは1件まで）。その間に契約した場合、無料体験が終わる日から請求を始めます。
        </p>
      </Section>

      <Section title="8. 解約">
        <p>契約は、「契約と支払い」の支払いの画面からいつでも解約できます。払った期間の終わりまでは、すべての機能を使えます。残りの期間の返金はしません。</p>
      </Section>

      <Section title="9. 未払いのとき">
        <p>
          無料体験が終わって契約がないとき、支払いに失敗したとき、解約して期間が終わったときは、データを残したまま読むだけになり、自動投稿とパフォーマンスの取得を止めます。チームで手伝っている人・見せてもらっている人も、そのアカウントでは読むだけになります。契約する（支払いが済む）と、すぐに元どおり使えます。
        </p>
      </Section>

      <Section title="10. 退会">
        <p>
          「設定」の「アカウント」からいつでも退会できます。退会すると、あなたのアカウントとそのデータ（Threadsとのつながりを含む）はすぐにすべて消え、元に戻せません。契約はすぐに止まり、残りの期間の返金はしません。入っているチームからは外れます（管理者なら、いちばん長くいる人に管理者を引き継ぎます）。
        </p>
      </Section>

      <Section title="11. 規約の変更">
        <p>本サービスは、必要に応じてこの規約を変えることがあります。大切な変更（料金の変更を含む）は、本サービスの画面でお知らせします。</p>
      </Section>

      <p className="text-sm text-muted-foreground">
        <Link to="/legal/commerce" className="underline underline-offset-4">
          特定商取引法に基づく表記
        </Link>
      </p>
      <p className="text-sm text-muted-foreground">最終更新日：2026年10月16日</p>
    </main>
  );
}
