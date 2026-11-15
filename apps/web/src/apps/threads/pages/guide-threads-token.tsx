// トークンの作り方の詳しい手順（specs/010-token-account-add FR-030、contracts/ui-routes.md「トークンの作り方」）。
// ログインなしで読める。Metaの画面の名前は変わることがあるので、手順ごとに目的を書き、画面の写真は使わない。
// 文面の元・直し方は docs/threads-token-guide.md。
import type { ReactNode } from "react";
import { Link } from "react-router";

/**
 * 手順の節。
 * @param props - title：見出し、purpose：この手順の目的（手順のときだけ）、children：本文
 * @returns 節
 */
function Step({ title, purpose, children }: { title: string; purpose?: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="font-semibold">{title}</h2>
      {purpose && <p className="text-sm font-medium text-foreground/80">この手順の目的：{purpose}</p>}
      <div className="space-y-2 text-sm leading-relaxed text-foreground/85">{children}</div>
    </section>
  );
}

/**
 * トークンの作り方のページ。
 * @returns ページ
 */
export function GuideThreadsTokenPage() {
  return (
    <main className="mx-auto w-full max-w-2xl space-y-8 px-4 py-10">
      <h1 className="text-2xl font-semibold">自分のMetaアプリで、Threadsのトークンの作り方</h1>

      <Step title="はじめに">
        <p>
          ThreadsGrowerのアカウントに、自分で作ったMetaアプリのアクセストークンを貼り付けて、Threadsアカウントをつなぐ手順です。Metaアプリを持っていなくても、この手順どおりに進めれば作れます。かかる時間の目安は30分です。
        </p>
        <p>すでにMetaアプリとトークンをお持ちなら、「5. 長期トークンを作る」から読んでください。</p>
      </Step>

      <Step title="1. Metaの開発者アカウントを用意する" purpose="Metaアプリを作れるようにします。">
        <p>
          Metaの開発者サイト（developers.facebook.com）を開き、Facebookのアカウントでログインして、開発者として登録します。電話番号やメールアドレスの確認を求められたら、画面の案内に従います。
        </p>
      </Step>

      <Step title="2. アプリを作る" purpose="トークンを発行する、自分だけのアプリを作ります。">
        <p>
          開発者サイトの「マイアプリ」から「アプリを作成」を選びます。使い方（ユースケース）を選ぶ画面では、Threads APIへのアクセスを選びます。アプリの名前は自由です（例：自分の名前＋Threads）。
        </p>
        <p>作ったアプリは「開発モード」のままで構いません。自分のアカウントで使うだけなら、Metaの審査（App Review）は要りません。</p>
      </Step>

      <Step title="3. 権限を加える" purpose="ThreadsGrowerが使う4つの権限を、トークンに含められるようにします。">
        <ul className="list-disc space-y-1 pl-5">
          <li>threads_basic：プロフィール（ユーザー名・表示名・画像）を読む。必ず要ります</li>
          <li>threads_content_publish：承認した投稿を自動投稿する</li>
          <li>threads_manage_insights：投稿の反応数とフォロワー数を読み、パフォーマンスを出す</li>
          <li>threads_manage_replies：時間差のメンションの返信を出す</li>
        </ul>
        <p>アプリのThreadsの使い方の設定で、この4つを加えます。後の3つがないと、自動投稿・パフォーマンス・時間差のメンションが使えません。</p>
      </Step>

      <Step title="4. 自分をテスターに加える" purpose="開発モードのアプリで、自分のThreadsアカウントのトークンを作れるようにします。">
        <p>
          アプリの「役割」（またはThreadsの使い方の設定）で、自分のThreadsアカウントをテスターに加えます。その後、Threadsのアプリの「設定」→「アカウント」→「ウェブサイトのアクセス許可」（またはそれに近い項目）で、届いた招待を承認します。
        </p>
      </Step>

      <Step title="5. 長期トークンを作る" purpose="60日間使えるトークンを作ります（ThreadsGrowerが期限の前に自動で延長します）。">
        <p>
          アプリのThreadsの使い方の設定にある「ユーザートークン生成ツール」で、自分のThreadsアカウントの「アクセストークンを生成」を押し、表示されたトークンをコピーします。このツールで作るトークンは長期トークンです。
        </p>
        <p>トークンはパスワードと同じように扱い、他の人に見せたり、チャットに貼ったりしないでください。</p>
      </Step>

      <Step title="6. 貼り付ける" purpose="ThreadsGrowerのアカウントを、Threadsにつなぎます。">
        <p>
          ThreadsGrowerで、つなぎたいアカウントの「このアカウントの設定」を開き、「Threadsとの接続」の「自分のMetaアプリのトークンでつなぐ」を開きます。コピーしたトークンを貼り付けて「つなぐ」を押し、「つながりました」と出れば完了です。アカウントがまだなければ、先に「アカウントを作る」で名前だけを入れて作ります。
        </p>
        <p>
          トークンは暗号化して保存し、画面に再び表示しません。扱いは<Link className="underline" to="/terms">利用規約</Link>のとおりです。
        </p>
      </Step>

      <Step title="トークンを取り消すには">
        <p>
          Metaの開発者サイトでアプリを削除するか、Threadsのアプリの「ウェブサイトのアクセス許可」で、そのアプリを削除します。取り消すと、ThreadsGrowerのそのアカウントは「要再接続」になり、自動投稿が止まります。ThreadsGrowerからも消したいときは、そのアカウントの設定で削除してください。
        </p>
      </Step>

      <Step title="うまくいかないとき">
        <ul className="list-disc space-y-1 pl-5">
          <li>「短期のトークンのようです」：ユーザートークン生成ツールで作ったトークンを貼り付けてください。他の方法で作ったトークンは1時間で切れることがあります。</li>
          <li>「このアカウントはすでに登録されています」：そのアカウントの設定の「接続し直す」から、新しいトークンを貼り付けてください。</li>
          <li>「別のThreadsアカウントのトークンです」：接続し直すアカウントと同じThreadsアカウントで、トークンを作り直してください。</li>
          <li>「しばらく待ってから、もう一度お試しください」：確認に続けて失敗したため、10分ほど待ってからお試しください。</li>
          <li>投稿の権限・反応数の権限がないと出たとき：「3. 権限を加える」を見直し、トークンを作り直して接続し直してください。</li>
        </ul>
      </Step>

      <p className="text-sm text-muted-foreground">この手順は2026年10月10日時点の内容です。Metaの画面の名前は変わることがあります。</p>
    </main>
  );
}
