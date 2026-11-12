# 実装計画（Implementation Plan）：当日の集金（受付・締め・振込の確認）

**ブランチ**：`feature/collect-001-event-day-collection` | **日付**：2026-11-12 | **仕様**：[spec.md](./spec.md)

**入力**：`specs/collect/001-event-day-collection/spec.md`（Clarifications 2026-11-12・3回分を含む）、Constitution 4.8.1、[docs/app-separation.md](../../../docs/app-separation.md)、[docs/module-map.md](../../../docs/module-map.md)、[docs/parallel-development.md](../../../docs/parallel-development.md)、specs/meguru/029（Threadsをパターン①にそろえる。共通の入口の関数と出来事の仕組み）

**実装の時期**：Threadsをパターン①にそろえる作業（029。Threadsのリファクタリング）が`develop`に入るまで、**実装は始めない**（2026-11-12 ユーザーの決定。コード・マイグレーション・`wrangler.toml`・共通の変更を含め、このfeatureでは文書のほかに何も作らない）。この計画は文書まで。029のplanで入口の関数・出来事・スキーマの作り方が決まったら、この計画の該当の所（R2・R3・R12、data-model.md 5）を合わせる。

## 概要（Summary）

めぐるの2作目のアプリ「集金管理」（`collect`）を、パターン①の最初のアプリとして足す。申込は外部の媒体に任せ、当日来た人の集金（現金・PayPay・振込）を「1イベント1つの表、1人1行」で記録する。お金はアプリを通らない。

- **置き場所**：API`apps/api/src/apps/collect/`（道筋`/api/collect/…`）、Web`apps/web/src/apps/collect/`（`/collect/…`、手伝う人は`publicRoutes`の`/collect/r/:token`）、共通のパッケージ`packages/shared/src/collect/`、Postgresのスキーマ`collect`（[research.md](./research.md) R1・R2）。
- **だれが使えるか**：共通の機能のON/OFFに「既定でOFF」の項目を足し、運営者がONにした人だけ（料金なし）。`/api/me`の`available`を人ごとにする。共通の変更なので、先に小さなPR（PR0）で入れる（R3）。
  - **2026-11-13 追記**：PR0は[specs/meguru/030-app-access](../../meguru/030-app-access/spec.md)で入れた。**機能のON/OFF（019）に項目を足すのではなく、共通に「アプリの利用の許可」を作った**（029のあと、機能のON/OFFはThreadsだけが持つ仕組みになったため）。集金管理は、PR1で`APP_CATALOG`に`collect`を足し、組み立てで`registerAppAccess("collect", "granted")`を呼び、道筋に`requireAppAccess("collect")`を付ける。運営者は、設定 > 運営の「使える機能」（人）と「グループ」の「アプリの利用」で開く・閉じる。
- **会場の共有**：記録の正本はPostgres。保存のあと、イベントごとのDurable Objectが、つないでいる画面にWebSocketで知らせを配る（休止の仕組みで無料枠に収める）。抜けたら全体を読み直す（R4・R5、[contracts/realtime.md](./contracts/realtime.md)）。
- **二重にしない**：受付の記録は名簿の人1人に1行（主キー）。`clientRequestId`で送り直しも二重にしない（R6）。
- **手伝う人**：ログインのいらない受付用リンク（合言葉なし・期限・止める・出し直し）。名前を入れると端末の印を返し、同じ端末は続きから、別の端末の同じ名前は「同じ人ですか？」で合わせる（R7）。
- **PRは5つ**：PR0 共通（利用権。**029に入れるか別のPRにするかは未定**）→ PR1 イベント・名簿 → PR2 受付・手伝い・会場の共有 → PR3 締め・振込・まとめ・CSV・退会 → PR4 Threadsのイベントの候補（029とThreadsの出来事のあと）（R16）。

## 技術コンテキスト（Technical Context）

**言語・バージョン**：TypeScript 6.0。Node.js 22 LTS。今と同じ。

**主な依存**：今と同じ（Web：React 19・React Router 8・TanStack Query 5・Clerk・shadcn/ui。API：Hono・Drizzle・zod）。新しいnpmの依存は足さない。Cloudflareの機能として**Durable Objects（SQLite型・保存は使わない）**を足す（Complexity Tracking）。

**ストレージ**：Neon（Postgres 17）の新しいスキーマ`collect`に12の表（[data-model.md](./data-model.md)）。マイグレーションを新しく足す（番号は作るときの`develop`の次）。PayPayのQRの画像もPostgres（bytea・300KB以内。R10）。

**テスト**：
- 共通のパッケージ（vitest）：`nameKey`・`cleanPastedLine`・`looksLikeNonName`・`buildTransferMessage`・媒体の対応表。
- API（vitestのWorkersの中の結合テスト。`apps/api/test/integration/collect/`）：イベントと料金の区分・名簿（番号を使い回さない・同じ名前の知らせ・まとめて足す）・前回の参加者・受付（同時の2つの呼び出しで1件・`clientRequestId`の送り直し・金額の直し）・手伝う人（参加・同じ名前・端末の印・取り消しの権限・止めたリンクの410・期限）・会場の共有（版の番号・Durable Objectへの知らせ・入場券の署名と期限）・締めと精算・振込・CSV・まとめ（名前が入らない）・利用権がない人の403・ほかの主催者の404・退会の出来事を2回受け取る。
- Web（vitest）：受付の行の状態（未受付・受付済み・保存できなかった）、知らせで1行が変わる・版が飛んだら読み直す、手伝う人の画面に名簿の編集や締めが出ない、貼り付けの確かめの一覧、候補。
- E2E（Playwright）：主催者と手伝う人の2つのブラウザで、受付が5秒以内に両方に出ること・同じ人を同時に押して1件になること・リンクを止めると手伝う人の画面が止まること。
- 境界：今のESLintの規則（APIとWeb）が`apps/collect`に当たること。`routes.snapshot.txt`に道筋を足す。

**対象プラットフォーム**：Web＝Cloudflare Pages、API＝Cloudflare Workers（同じデプロイにDurable Objectを足す）。受付はスマートフォンのブラウザが主。

**プロジェクトの種類**：Webアプリ（pnpmモノレポ：`apps/web`・`apps/api`・`packages/shared`・`e2e`）。

**性能の目標**：
- 受付の1人：3回の操作・10秒以内（SC-001）。記録の呼び出しは1回。
- 会場の共有：記録から5秒以内にほかの画面へ（SC-006。目安は1秒以内）。
- 名簿50人の受付のスナップショットは1回の呼び出し。絞り込みは画面の中。

**制約**：
- パターン①：共通の表を読まない・外部キーを張らない・アプリ同士は使わない（Constitution「アプリのデータの分け方」）。
- 運用コスト：月額固定のインフラ費用$0から（Workers Free・Neon Free・Clerk Free）。高い頻度のポーリングをしない（R4）。Durable Objectsは無料枠（1日10万リクエスト）に収める。
- モバイル化を見込む：判断（正規化・貼り付けの整え方・連絡文・数字の数え方）はAPIと`@meguru/shared`に置く。
- お金を預からない（FR-001）：決済・送金のAPIを使わない。

**規模**：1主催者あたりイベントは月に数件、1イベントの名簿は数十〜数百人、受付をする人は1〜5人を見込む。テスト版の利用者は数人〜数十人。新しいファイルは、API約25・Web約30・共通約6・テスト約25を見込む。

## Constitution Check

*GATE：Phase 0の前に確かめ、Phase 1の後にもう一度確かめた。Constitution 4.8.1。*

| 原則 | 確かめたこと | 結果 |
|---|---|---|
| I. 人格・トーン・NGワードの一貫性 | 投稿を作らないアプリ。Threadsの投稿の処理には触らない | 合格（当てはまらない） |
| II. 人間承認ゲート | 自動で投稿・送信する処理を持たない。連絡文もコピーだけで、アプリからは送らない（FR-052） | 合格 |
| III. 外部LLM前提・API依存ゼロ | AIを呼ばない。画面写真の文字は、スマートフォンの文字の読み取りでコピーしてもらう（アプリの中で画像を読まない） | 合格 |
| IV. 契約／ロール分離 | 利用権（使えるか）は共通の入口で確かめ、手伝う人の権限（受付だけ・自分の記録だけ取り消す）は集金管理の中で判定する。2つを混ぜない。原則IVの「契約するまではアプリを使えない」は、Threadsのアカウント単位の料金を前提にした書き方で、2作目の料金はまだ決まっていない（product-structure.md 3）。001の集金管理は、運営者が人ごと・グループごとに開いた人だけが使う「料金なし」として扱う（原則IVの「有料の契約中（料金なしを含む）」の料金なしと同じ考え方。利用の数を伝えず、請求しない）。手伝う人は料金に数えない。**2作目以降の利用権と料金の書き方は、Constitutionの改定として別に行う**（このfeatureでは改定しない） | 合格（根拠つき） |
| V. 個人運用起点のシンプルさ | 001の範囲を当日の集金に絞り、申込・決済・自動の照らし合わせ・参加者の自己受付は外した。手伝う人の仕組みは、受付用リンク1本だけ（チーム・ロールの仕組みは作らない）。権限の判定は1か所（集金管理の`access.ts`）に集める | 合格 |
| VI. 改善フィードバックループ | 当てはまらない | 合格 |
| 技術スタック | React＋Vite（Pages）・Workers＋Hono・Neon＋Drizzle・Clerk（ログインだけ）・shadcn/ui。新しいnpmの依存なし（QRはWebにある`uqr`。R18）。Durable Objectsは同じWorkerの機能で、別のバックエンドサービスではない（Complexity Tracking）。Constitutionの技術スタックの一覧にはまだないので、次にConstitutionを改定するときに足す | 合格（記録あり） |
| モジュール構成・データの分け方 | `apps/collect`（API・Web）に閉じる。共通は入口の関数と出来事だけ。表は専用のスキーマ。Threadsとは出来事だけでつなぐ | 合格 |
| 運用コスト | ポーリングをしない。Durable Objectsは無料枠の中（R4）。画像はPostgresに置き、新しい置き場所を増やさない | 合格 |
| 開発ワークフロー | `specs/collect/001-…`・`feature/collect-001-…`。共通の変更はPR0に分けて先に入れる | 合格 |

**Phase 1の後の見直し**：データの形・取り決めを書いたあとも、上の判定は変わらない。共通の変更（PR0：既定でOFFの機能のON/OFF・人ごとの`available`）は、集金管理のPRに混ぜないことを、tasksでも分けて書く。

## プロジェクトの構成（Project Structure）

### 文書（このfeature）

```text
specs/collect/001-event-day-collection/
├── spec.md
├── plan.md              # この文書
├── research.md          # 調べて決めたこと（R1〜R18）
├── data-model.md        # 表・状態の移り変わり・数え方
├── quickstart.md        # 確かめ方
├── contracts/
│   ├── api.md           # /api/collect の道筋
│   ├── realtime.md      # 会場の共有（WebSocket・Durable Object）
│   ├── events.md        # 受け取る出来事（退会・Threads）
│   └── ui-routes.md     # 画面のURL
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks で作る
```

### ソースコード

```text
packages/shared/src/collect/
├── index.ts             # 入口
├── schemas.ts           # 入力と出力の形（zod）
├── names.ts             # nameKey・cleanPastedLine・looksLikeNonName
├── media.ts             # 媒体の値と表示名・021の媒体との対応
└── messages.ts          # buildTransferMessage

apps/api/src/apps/collect/
├── index.ts             # 入口（道筋・Durable Objectの書き出し・出来事の受け取りの登録）
├── schema.ts            # pgSchema("collect") の表
├── access.ts            # 主催者・手伝う人の確かめと権限（1か所）
├── events/              # イベント・料金の区分・まとめ
├── roster/              # 名簿・まとめて足す・前回の参加者
├── reception/           # 受付・飛び入り・スナップショット・数字
├── helpers/             # 受付用リンク・手伝う人・端末の印・手伝う人の道筋
├── live/                # 入場券・CollectLiveRoom（Durable Object）・知らせを送る
├── closing/             # 締め・精算・CSV
├── transfers/           # 振込待ち
├── settings/            # 既定値・QRの画像
└── inbox/               # 出来事の受け取り（退会・Threadsの候補）

apps/api/src/db/schema.ts          # export * from "../apps/collect/schema" を1行足す
apps/api/src/app.ts / index.ts     # 道筋の登録と Durable Object の書き出し（組み立て）
apps/api/wrangler.toml             # COLLECT_LIVE の結びつけとマイグレーション（3つの環境すべて）
apps/api/test/integration/collect/ # 結合テスト

apps/web/src/apps/collect/
├── index.ts             # AppModule（collectApp）
├── routes.tsx
├── sidebar/             # CollectShell・AppSidebar の中身
├── pages/               # events・event-new・roster・reception・helpers・closing・transfers・summaries・settings・helper-reception（公開）
├── components/          # 受付の行・払い方のシート・QRの表示・貼り付けの確かめ・候補
└── lib/                 # api.ts（集金管理の呼び出し）・live.ts（WebSocketと読み直し）・paths.ts
apps/web/src/app-registry.ts       # 1行足す

e2e/tests/collect-*.spec.ts        # 主催者と手伝う人の2つのブラウザ
```

**構成の決め方**：docs/module-map.md 6章（APIにアプリを足す手順）と7-6（Webにアプリを足す手順）のとおり。外枠・共通のほかの場所は直さない（PR0を除く）。

## 複雑さの記録（Complexity Tracking）

| 増えるもの | なぜ要るか | もっと単純な案を選ばなかった理由 |
|---|---|---|
| Durable Objects（`CollectLiveRoom`）と秘密`COLLECT_LIVE_SECRET` | 受付の記録を、会場のほかの画面に5秒以内に出す（FR-038・SC-006） | 数秒ごとのポーリングは、受付の間ずっとNeonの計算機を起こし、Constitutionの既知のリスク（無料枠を超えうる）に当たる。KVは書き込みの無料枠が小さい。Durable Objectsは同じWorkerの機能で、無料プランで使え、別のサービスは増えない（R4） |
| 手伝う人の端末の印（`helper_devices`） | ログインなしで、同じ端末なら続きから始め、ほかの人の記録を取り消させない（FR-039・FR-075） | 名前だけで見分けると、だれでも他人として振る舞える。Clerkで登録させると30秒以内に始められない（SC-007） |
| 共通の変更（PR0：既定でOFFの機能のON/OFF・人ごとの`available`） | 001を「運営者が開いた人だけ」に出す（Clarifications・FR-003） | `released: false`ではテストのグループの人に開けない。集金管理の中に許可の表を持つと、利用権を共通が持つ決まりに反する（R3） |

## 次の段階

- **決めること**：PR0（共通の利用権）を029に入れるか、`specs/meguru/NNN`の小さなPRにするか（ユーザーが決める）。

- `/speckit-tasks`：PR0〜PR4に分けて、テストを先に書く形で作業の一覧を作る。PR0は`specs/meguru`の作業として分けて書く（または029に入れるよう申し送る）。
- 029のplanができたら、入口の関数の名前・出来事の名前と形・スキーマの作り方を、research.md R2・R3・R12と data-model.md 5 に合わせて直す。
