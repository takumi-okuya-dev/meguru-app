# 画面のルートの取り決め：集金管理

**対象**：spec User Story 1〜6 | **画面イメージ**：[めぐる 集金モック](https://claude.ai/artifact/79kh44mkMhAE8Dg7oi9xsB) | **Webの境界**：docs/module-map.md 7章

`apps/web/src/apps/collect/index.ts`が`AppModule`（`id: "collect"`・`basePath: "/collect"`・`startPath: "/collect/events/new"`）を出し、`app-registry.ts`に1行足す。外枠のほかの場所は直さない。

## 1. ログインの要る画面（サイドバーの中）

| URL | 画面 | モックの場面 |
|---|---|---|
| `/collect` | イベントの一覧（開催日時の近い順）。下に消したイベントのまとめへの入口 | イベント |
| `/collect/events/new` | イベントを作る（一から作る・Threadsのイベントから選ぶ） | イベントを作る |
| `/collect/events/:eventId/roster` | 名簿（続けて入れる・候補・まとめて貼る） | 名簿 |
| `/collect/events/:eventId/reception` | 受付 | 受付 |
| `/collect/events/:eventId/helpers` | 受付の手伝い（リンク・QR・受付をしている人） | 受付の手伝い |
| `/collect/events/:eventId/closing` | 締め | 締め |
| `/collect/events/:eventId/edit` | イベントを直す・消す | （モックなし） |
| `/collect/transfers` | 振込待ち（すべてのイベント） | 振込待ち |
| `/collect/summaries` | 消したイベントのまとめ | （モックなし） |
| `/collect/settings` | PayPayのQR・振込先の案内 | 設定 |

- サイドバー（`AppSidebar`）：アプリの切り替え／イベント・イベントを作る・振込待ち（数）・まとめ／下に「このアプリの設定」（PayPay の受け取り用 QR・振込先の案内。Threads の「このアカウントの設定」とそろえる）。
- 開いているイベントの画面（名簿・受付・受付の手伝い・セルフ受付・締め・分配）は、メインパネルの下のタブバー（`EventTabBar`）で切り替える。イベントを開いたときにサイドバーの項目が増えると不自然なので、サイドバーには出さない（2026-11-15 にユーザーの確認で変えた）。
- イベントの中の画面は、上に「名簿・受付・手伝い・締め」の切り替えを出す。
- 集金管理の利用権がない人には、`/collect/*`を外枠の「使えない」画面にする（`/api/me`の`available`に`collect`がないとき）。

## 2. ログインのいらない画面（`publicRoutes`・サイドバーの外）

| URL | 画面 |
|---|---|
| `/collect/r/:token` | 手伝う人の受付。名前を入れる → 受付。止められた・期限切れなら、その案内だけ |

- 端末の印は、ブラウザの保存（`localStorage`。キーはリンクのトークンのハッシュの先頭）に置く。読めないとき（プライベートブラウズなど）は、開き直すたびに名前を入れる（同じ名前なら「同じ人ですか？」で続きにできる）。
- 画面はスマートフォンで片手で使え、横にスクロールしない（spec Edge Cases）。

## 3. 画面の決まり

- 押せるところは、指で押しやすい大きさ（受付の払い方のボタンは高さ44px以上）。
- 保存できなかった操作は、その行に「保存できませんでした・もう一度送る」を出し、受付済みに見せない（FR-037）。
- 見た目は docs/ui-design.md の今の約束（ChatGPT風・ニュートラルなグレー）と、モックにそろえる。
