// 利用規約（specs/010-token-account-add FR-052、contracts/ui-routes.md「利用規約」）。ログインなしで読める。
// 本featureでは最小限の下書き。運営者が公開の前に文面を確かめ、運営者の名前・連絡先を書き足す。
// 料金・解約・特定商取引法に基づく表示は 011（決済）で足す。
import type { ReactNode } from "react";

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

      <Section title="6. 規約の変更">
        <p>本サービスは、必要に応じてこの規約を変えることがあります。大切な変更は、本サービスの画面でお知らせします。</p>
      </Section>

      <p className="text-sm text-muted-foreground">最終更新日：2026年10月10日</p>
    </main>
  );
}
