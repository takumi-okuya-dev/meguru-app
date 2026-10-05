# 実装計画（Implementation Plan）：スケジュール投稿・自動投稿

**ブランチ**：`feature/005-auto-post` | **日付**：2026-10-05 | **仕様**：[spec.md](./spec.md) | **UI全体設計**：[docs/ui-design.md](../../docs/ui-design.md)

**入力**：`specs/005-auto-post/spec.md`の機能仕様

## 概要（Summary）

承認済みの下書きを、Accountごとに決めた時刻に、1件ずつThreadsへ自動で公開する（PRD FR-8、UJ-2の後半）。
- **設定**：1日に投稿する時刻（最大10件、日本時間）と、時刻を少しずらすか（前後10分）を「このアカウントの設定」で決める。
- **投稿**：時刻になったら、投稿の順の先頭の1件を、公開の直前にNGワードとThreadsの上限でもう一度確かめてから公開する。
- **失敗**：一時的な失敗はやり直し、最後は「投稿に失敗」としてアプリの中で知らせる。要再接続・上限では止めて知らせる。
- **画面**：投稿済みのタブ、承認済みのタブの投稿の順と予定、ホームの「次の投稿」。
- **プロンプト**：宣伝の件数を1日の投稿数で書く。

技術的な方針は次のとおり。

- **定期処理**：
  - 5分ごとのCron Triggerを足す。
  - Workers KVの「関所」を先に見て、用のない回はDBに触れない。Neonを止める時間を作り、無料枠（月100 CU-hours）に収めるため（research.md R3）。
  - 1回の処理で進める投稿は最大4件（Workers Freeのサブリクエストの上限50回）。扱いきれなかった数と遅れをログに出し、Workers Paidへ移す時期を判断できるようにする。
  - 一定の間隔での見直しはしない。DBを起こすのは、予定の時刻・やり直しのときと、24時間に1回だけ。誰の予定もない時間帯（深夜など）は、DBを止めたままにする。
  - 投稿の時刻は制限しない。深夜（2:00〜4:59）の時刻には、見られにくい可能性があるという案内だけを出す（FR-001b）。
  - 投稿済みの一覧は、タブを開いたときだけ50件ずつ読む。Neonの通信量（無料枠は月5GB）を増やさないため（R14）。
- **時刻**：
  - ずらした時刻は保存せず、`accountId`・日付・時刻のハッシュで毎回同じ値を求める（R2）。
  - 予定の表示と実際の投稿で、同じ関数を使う。
- **二重の公開の防止**：
  - Threadsの2段階（コンテナーの作成 → 公開）を使い、公開を送る前にコンテナーのIDを保存する。
  - 結果がわからないときは、コンテナーの状態を確かめてから決める。`PUBLISHED`かもしれない間は、新しいコンテナーを作らない（R6）。
  - 試みの行（`publish_attempts`）を`(account_id, slot_at)`で一意にし、持ち時間（`lease_until`）で同時の処理を防ぐ。
- **原則I・IIとの関係**：
  - 取り出しは、004の承認・NGワードの追加と同じ「Account × 下書き」のロックの中で、`checkPublishable`で確かめる（R7）。
  - 承認済みの下書きだけを`publishing`に移せる。処理中・投稿済みの下書きは、ユーザーの操作の対象外（R5）。
- **状態**：
  - `post_draft_status`に`publishing`・`published`・`publish_failed`を足す。
  - `post_drafts`に、投稿の記録・失敗・直前のチェック・投稿の順の列を足す。
  - 新しいテーブルは`posting_schedules`と`publish_attempts`。
- **知らせ**：保存せず、状態から求める（R8）。アプリの中だけ（投稿ストックの上部・ホーム）。
- **投稿の権限の確認**：自動投稿をオンにする保存と「接続を確かめる」で、`threads_publishing_limit`を呼んで、投稿せずに投稿の権限を確かめる。接続が切れている・権限がないときはオンにしない（R15）。
- **同じAccountの試みは1つずつ**：やり直し中に次の時刻が来たら、その時刻は前の試みが終わるまで待たせる（R6）。

## 技術コンテキスト（Technical Context）

**言語・バージョン**：TypeScript 6.0（フロントエンド・バックエンドとも）。開発ツールはNode.js 22 LTS。001〜004と同じ。

**主な依存**：001〜004と同じ。足すものは次の2つ。
- `@radix-ui/react-switch`：shadcn/uiの`Switch`。自動投稿と、時刻をずらすかの切り替えに使う
- Workers KV（Cloudflareのバインディング。npmの依存ではない）

時刻の計算（日本時間）は固定の差（UTC＋9）で行い、日付のライブラリは足さない。

**ストレージ**：
- Neon（Postgres 17）。次を変える（[data-model.md](./data-model.md)）。
  - 列挙型`post_draft_status`に値を3つ足す
  - 列挙型`publish_attempt_state`を足す
  - テーブル`posting_schedules`・`publish_attempts`を足す
  - `post_drafts`に列を10個足し、CHECK制約を置き換える
- Workers KV：`autopost:gate`・`autopost:wake`の2つのキーだけ（R3）。

**テスト**：004と同じ構成。
- 共通：Vitest
- API：Vitest＋`@cloudflare/vitest-pool-workers`＋ローカルのPostgres＋偽のThreadsサーバー（投稿のエンドポイントと、失敗・応答の喪失の注入を足す）
- Web：Vitest＋Testing Library

**対象プラットフォーム**：
- Web：Cloudflare Pages
- API：Cloudflare Workers（無料プラン）
  - 1回の呼び出しのCPU時間は10ms、サブリクエストは50回、Cronの実時間は15分まで
  - Cron Triggerは`0 18 * * *`（001）と`*/5 * * * *`（新規）の2つ
- ブラウザ：PC・タブレット・スマートフォンのモダンブラウザ

**プロジェクトの種類**：Webアプリ（SPA＋API）＋定期処理

**性能目標**：
- 本featureのAPIは、p95で500ms以内（001〜004と同じ）。
- 投稿できる状態のAccountでは、99%以上の時刻で、予定の時刻から10分以内に公開する（SC-004）。5分ごとの処理と、1回4件の上限で満たす。
- 定期処理の1回のCPU時間は10ms未満。用のない回は、KVの読み込みだけで終える（1ms前後）。

**制約**：
- 月額固定費$0（Constitution）。
  - Neonが止まる時間を作る（R3）
  - Neonの通信量（月5GB）を増やさない。投稿済みは一覧に入れない（R14）
  - KVの書き込みは1日1,000回未満
  - 外部の通知サービスは使わない（FR-019）
- 承認を経ない下書きは投稿しない（原則II）。
- 配信の直前にNGワードのチェックを必ず行い、飛ばす経路を作らない（原則I）。管理者用・テスト用の抜け道も作らない。
- 同じ下書きを二重に公開しない（FR-010・SC-003）。
- アプリの中でLLMを使わない（原則III）。
- 上限：
  - 時刻：10件
  - 1つの時刻の中のやり直し：3回
  - 遅れて投稿してよい幅：60分
  - 24時間の投稿：250件
  - 承認済み（処理中を含む）：500件（004）

**規模**：
- 画面：新しい画面はない。設定・投稿ストック・ホームを広げる。
- API：
  - 新規7本：投稿のスケジュールの取得・保存、自動投稿の状態と知らせ、知らせを閉じる、次に投稿する、投稿済みの一覧、接続を確かめる
  - 004の変更5本：一覧・件数・編集・状態の変更・プロンプト
- 定期処理：1つ（`runAutoPost`）。日次の処理に、古い試みの削除を足す。

「要確認」の項目はなし（すべて[research.md](./research.md)で解消済み）。

## Constitutionとの整合（Constitution Check）

*ゲート：Phase 0の前に確認し、Phase 1の設計後に再確認する。*

| 原則・制約 | 判定 | 根拠 |
|---|---|---|
| I. 人格・トーン・NGワードの一貫性 | 合格 | 公開の直前に、その時点のNGワードとThreadsの上限で`checkPublishable`を行い、当たれば公開せずに要確認に戻す（FR-007、R7）。<br>チェックは004と同じロックの中で行い、NGワードの追加と直列化する。<br>全プランに適用する。<br>チェックを飛ばす設定・管理者の操作・テスト用の経路はない |
| II. 人間承認ゲート | 合格 | 取り出しの対象は`approved`の下書きだけ（FR-006）。<br>`publishing`に移せるのは定期処理の取り出しだけで、APIから直接移す経路はない。<br>`requeue`は、一度承認した下書きを承認済みに戻すだけで、要確認・却下からは移せない。<br>状態の組み合わせはDBのCHECK制約でも守る（data-model.md） |
| III. 外部LLM前提・API依存ゼロ | 合格 | アプリの中でAIを呼ばない。Threads APIは投稿の公開に使うだけ |
| IV. プラン／ロール分離 | 合格 | 自動投稿は全プランで使える（FR-004）。`owner`の判定は001のまま。`plan`と`role`は混ぜない |
| V. 個人プラン起点のシンプルさ | 合格 | アプリの外への通知・曜日ごとの時刻・ドラッグの並べ替え・画像の投稿・監査ログは作らない（FR-027） |
| VI. 改善フィードバックループの忠実性 | 対象外（006） | 本featureは、006の分析の材料（投稿のID・URL・日時）を記録するだけ（FR-009）。分析とプロンプトへの反映は006で、原則VIのとおり一緒に作る |
| 技術スタック制約 | 合格 | スケジューラーはCron Triggersを基本にし、KVを関所として足す（Constitutionの「既知のリスク」への対応。R3）。<br>QStashは、規模が大きくなったときの候補として記録した。<br>UIはshadcn/uiの`Switch`を足すだけ |
| 運用コスト制約（固定費$0） | 合格（測って確かめる） | 見積もりはresearch.md R3・R14、利用者の数ごとの試算は[docs/cost-estimate.md](../../docs/cost-estimate.md)。<br>定期処理の計算時間は、無料枠の2割程度に収まる見込み。<br>本featureで増えるNeonの通信量は、投稿済みを別のAPIにして、ほぼ0にする。<br>Neonの計算時間・通信量、KVの書き込み、WorkersのCPU時間を、quickstartの手順7で週に1回見る。<br>規模の限界（同じ時間帯に48件を超える）と、移行先（Workers Paid）を記録した。遅れはログで気づける |
| 開発ワークフロー | 合格 | `feature/005-auto-post`で作業している |

**Phase 1の設計後の再確認**：data-model.md・contracts/で、新たな違反は生じていない。
- マイグレーションは後方互換。既存の下書きは新しい列がNULLで、新しい状態を使っていないので、置き換えたCHECK制約を満たす。
- 列挙型の値を足すマイグレーションは、004と同じく、値を使うマイグレーションと分ける（同じトランザクションで使えないため）。
- `GET /post-drafts`の`approved`の並びが変わるが、Webと同時に変えるので、外部の利用者はいない。
- 原則Iの「配信の直前」：取り出しから公開までの数秒の間に足したNGワードは、その公開には効かない（R7）。取り出しの時点のNGワードでチェック済みの本文を公開するので、原則を満たすと判断した。

## プロジェクト構成（Project Structure）

### ドキュメント（このfeature）

```text
specs/005-auto-post/
├── spec.md                  # 機能仕様（/speckit-specify・/speckit-clarify）
├── plan.md                  # このファイル（/speckit-plan）
├── research.md              # Phase 0の出力
├── data-model.md            # Phase 1の出力
├── quickstart.md            # Phase 1の出力
├── contracts/               # Phase 1の出力
│   ├── api.md               #   HTTP API・Threads APIの呼び出し・バインディング
│   ├── auto-post-job.md     #   定期処理の手順
│   ├── prompt-template.md   #   プロンプトの文面（004からの差分）
│   └── ui-routes.md         #   画面・表示文言
├── checklists/
│   └── requirements.md      # 仕様品質チェックリスト
└── tasks.md                 # Phase 2の出力（/speckit-tasks。本コマンドでは作らない）
```

### ソースコード（リポジトリのルート）

004までの構成に、次のファイルを足す・変える（★は新規、✎は変更）。

```text
packages/shared/src/
├── ★ schedule.ts               # 時刻の変換、validatePostingSchedule、plannedSlotTime、projectSchedule、日本時間の日付
├── ★ queue.ts                  # compareQueueOrder（投稿の順）
├── ✎ prompt.ts                 # dailyPostCount と宣伝の節の見出し
├── ✎ limits.ts                 # AUTOPOST_* の定数
├── ✎ schemas.ts                # 状態・PostDraft の項目・PostingSchedule・AutoPost・SkipReason・requeue
└── ✎ errors.ts                 # DRAFT_PUBLISHING・THREADS_NOT_READY と失敗の理由の文言
packages/shared/test/
├── ★ schedule.test.ts、★ queue.test.ts
└── ✎ prompt.test.ts

apps/api/
├── ✎ wrangler.toml                     # Cron */5、[[kv_namespaces]] AUTOPOST_KV
├── drizzle/★ 0005_auto_post_enum.sql、★ 0006_auto_post.sql
├── src/
│   ├── ✎ index.ts                      # scheduled の振り分け（controller.cron）
│   ├── ✎ env.ts                        # AUTOPOST_KV
│   ├── ✎ app.ts                        # ルートの登録
│   ├── db/✎ schema.ts                  # 列挙型・posting_schedules・publish_attempts・post_drafts の列
│   ├── lib/
│   │   ├── ✎ threads-client.ts         # 投稿の6つの呼び出し（権限の確認を含む）、ThreadsRateLimitError・ThreadsTransientError、タイムアウト
│   │   └── ✎ config.ts                 # AUTOPOST_KV の確認
│   ├── routes/
│   │   ├── ★ posting-schedule.ts       # GET・PUT /posting-schedule
│   │   ├── ★ auto-post.ts              # GET /auto-post、POST /auto-post/notices/blocked/dismiss
│   │   ├── ★ threads-check.ts          # POST /threads-check（接続を確かめる）
│   │   └── ✎ post-drafts.ts            # 一覧の形、published（50件ずつ）、prioritize、DRAFT_PUBLISHING
│   └── services/
│       ├── ★ posting-schedule-service.ts # 設定の読み書き（effective_from・投稿の権限の確認）、KVの wake
│       ├── ★ threads-check-service.ts  # 投稿の権限の確認（threads_publishing_limit。R15）
│       ├── ★ auto-post-gate.ts         # KVの関所（読む・判定・書く）
│       ├── ★ auto-post-runner.ts       # runAutoPost：続きの処理・時刻の処理・関所の書き込み
│       ├── ★ publish-claim.ts          # 取り出し（ロック・直前のチェック・skipped）
│       ├── ★ publish-executor.ts       # コンテナー・公開・結果の確認・成功と失敗の記録
│       ├── ★ auto-post-status.ts       # 予定（projectSchedule の材料）と知らせ
│       ├── ✎ draft-service.ts          # 投稿の順、投稿済み・失敗の一覧、件数、編集の DRAFT_PUBLISHING、blocked の消去
│       ├── ✎ review-service.ts         # requeue、reopen の元の状態、PUBLISHING
│       ├── ✎ posting-rules-service.ts  # NGワードの追加で戻すとき prioritized_at・carryover を消す
│       ├── ✎ account-service.ts        # 再接続（writeConnection）で effective_from を今に
│       ├── ✎ prompt-service.ts         # dailyPostCount
│       └── ✎ daily-jobs.ts             # 古い publish_attempts の削除
└── test/
    ├── fake-threads/✎ server.ts        # 投稿のエンドポイント、失敗・応答の喪失の注入、投稿の一覧
    └── integration/
        ├── ★ posting-schedule.test.ts
        ├── ★ threads-check.test.ts
        ├── ★ auto-post-runner.test.ts  # US1〜US3、二重の公開の防止、遅れ・停止・上限・日の件数
        ├── ★ auto-post-gate.test.ts
        ├── ★ auto-post-status.test.ts
        ├── ✎ post-drafts.test.ts、✎ review.test.ts、✎ prompt.test.ts
        └── ✎ profile-cascade.test.ts   # Account削除で設定・試みも消える

apps/web/src/
├── components/
│   ├── ui/★ switch.tsx
│   ├── ★ AutoPostNotices.tsx           # 知らせ（投稿ストック・ホーム）
│   ├── settings/
│   │   ├── ★ PostingScheduleSection.tsx  # 3つの行と「接続を確かめる」
│   │   └── ★ PostingScheduleDialog.tsx  # 時刻の入力・検証・深夜の案内（FR-001b）
│   └── stock/
│       ├── ✎ StatusTabs.tsx            # 投稿済みのタブ、横スクロール
│       ├── ✎ DraftList.tsx             # 承認済みの失敗のまとまり、投稿済みの一覧
│       ├── ✎ DraftCard.tsx             # 予定・処理中・持ち越し・直前のチェックの表示、「次に投稿する」
│       ├── ★ PublishedCard.tsx
│       ├── ★ use-published.ts          # 投稿済みを50件ずつ（タブを開いたときだけ）
│       ├── ✎ use-review.ts             # requeue・PUBLISHING
│       └── ✎ messages.ts
├── pages/
│   ├── ✎ stock.tsx
│   ├── ✎ account-home.tsx              # 「次の投稿」のカード
│   └── ✎ account-settings.tsx
└── lib/✎ api-client.ts、✎ query.ts、✎ format.ts（今日・明日の日時）
apps/web/test/
├── ✎ stock.test.tsx、✎ account-home.test.tsx、✎ account-settings.test.tsx

docs/✎ ui-design.md                     # 投稿済みのタブ、ホームの「次の投稿」、設定の区分
```

**構成の決定**：
- 001〜004と同じWebアプリ型に、定期処理を足す。
- 時刻・予定・投稿の順の計算は、`packages/shared`の純粋な関数にまとめる。APIの取り出し・予定の表示・テストで同じ定義を使う。
- 定期処理は「関所」「時刻の処理（runner）」「取り出し（claim）」「公開（executor）」に分ける。それぞれを単独でテストできるようにするため。

## 実装の進め方

tasks.mdで細かく分けるが、大きな順番は次のとおりとする。

1. **土台**：
   - `packages/shared`の時刻・予定・投稿の順・上限・スキーマ
   - DBのマイグレーション（2つ）
   - 偽のThreadsサーバーの投稿のエンドポイント
   - `threads-client`の投稿の呼び出しとエラーの分類
   - `GET /post-drafts`の形の変更とWebの追従（004の動作を保つ）
2. **US1 設定と自動投稿**（P1）：
   - 投稿のスケジュールのAPIと、設定の区分・ダイアログ
   - 関所・runner・取り出し・公開（成功の経路）
   - Cronの振り分けとKV
   - 投稿済みのタブ
3. **US2 直前のチェック**（P1）：
   - 取り出しでの`checkPublishable`と要確認への戻し
   - 要確認のタブの理由の表示
   - `blocked`の知らせと「閉じる」
4. **US3 失敗と停止**（P1）：
   - やり直し・持ち越し・失敗
   - 結果がわからないときの確認（二重の公開の防止）
   - 認証・上限での停止と再開、再接続での`effective_from`
   - 失敗のまとまり、`requeue`・`reopen`、知らせ
5. **US4 投稿の順と予定**（P2）：
   - `projectSchedule`と`GET /auto-post`
   - 承認済みのタブの予定と「次に投稿する」
   - ホームの「次の投稿」のカード
6. **US5 プロンプト**（P3）：`buildPrompt`の宣伝の節。
7. **仕上げ**：
   - docs/ui-design.mdの更新
   - Account削除との関係のテスト、日次の処理での古い試みの削除
   - 4つの画面幅での確認
   - 本物のThreadsでの1回の確認と、費用・制限の確認（quickstart 6・7）

US1の成功の経路だけで、承認済みの下書きが実際に公開されるようになる。ただし、US2（直前のチェック）とUS3（二重の公開の防止）が揃うまでは、本番で自動投稿をオンにしない。この3つはすべてP1なので、同じPRで出す。

## 複雑さの記録（Complexity Tracking）

Constitutionの違反はないため、違反の記録はない。原則より重い設計を選んだ点を、参考として残す。

| 設計 | 必要な理由 | より単純な案を採らなかった理由 |
|---|---|---|
| Workers KVの関所（R3） | 5分ごとにDBへ問い合わせると、Neonが止まらず無料枠を超える（約182 CU-hours/月） | Cronの間隔を延ばすと、予定から10分以内（SC-004）を満たせない |
| 試みの行と、コンテナーのIDの先の保存（R6） | Threadsの公開には、二重の送信を防ぐキーがない | 1段階の公開（`auto_publish_text`）では、応答が失われたときに公開したかを確かめられない |
