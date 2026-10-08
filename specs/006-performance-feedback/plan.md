# 実装計画（Implementation Plan）：パフォーマンス分析と改善フィードバック

**ブランチ**：`feature/006-performance-feedback` | **日付**：2026-10-08 | **仕様**：[spec.md](./spec.md) | **UI全体設計**：[docs/ui-design.md](../../docs/ui-design.md) | **画面案**：[006 パフォーマンス画面案](https://claude.ai/artifact/57YMJcqBj1o8Y5AsQGvqBA)（非公開）

**入力**：`specs/006-performance-feedback/spec.md`の機能仕様

## 概要（Summary）

自動投稿した投稿の反応数を取り込み、Accountのいつもの閲覧数と比べて判定する（PRD FR-9）。伸びなかった投稿を、傾向メモと一緒に次のAI用のプロンプトに入れる（PRD FR-10、Constitution原則VI）。あわせて、Threadsのアルゴリズムの解析に使えるよう、ノイズを減らした形で反応数を記録し、CSVで書き出す。

- **取り込み**：投稿から24時間・3日・7日の3つの時点だけ。005の自動投稿の処理（5分ごと、KVの関所）の最後に「反応数の段階」を足し、1日前・3日前・7日前の同じ時刻の投稿を取る。取りそこねた時点・本featureより前の投稿・フォロワー数は、日本時間3:00の回に補う（research.md R2）。
- **回数の上限**：Workers Freeの1回50件の外部への呼び出しに収めるため、反応数に使える呼び出しを「24 − 8 × その回の公開の数」にし、DBの読み書きは1回ずつにまとめる（R3）。
- **判定**：7日の値が確定したときに1回だけ行い、保存する。基準値は確定した直近30件の閲覧数の中央値（遅れて確定を除く）。5件未満・基準値0なら判定しない（R5）。
- **画面**：サイドバーの「分析 > パフォーマンス」。基準値の欄、アイコンのタブ（好調・普通・低調・確定待ち）、投稿のカード、低調のタブでの傾向メモと「プロンプトに入れる」、CSVのメニュー（[contracts/ui-routes.md](./contracts/ui-routes.md)）。
- **プロンプト**：「■過去に却下された投稿」の後ろに「■反応が低かった投稿」の節。長さの調整で減らさない（[contracts/prompt-template.md](./contracts/prompt-template.md)）。
- **CSV**：投稿ごと（37列）と取り込みごと（13列）。APIは行のデータを200件ずつJSONで返し、ブラウザでCSVにする（R7、[contracts/csv.md](./contracts/csv.md)）。
- **分析のための記録**：取り込みの履歴、フォロワー数、本文を人が直したか、公開した時刻の枠・持ち越し・「次に投稿する」、バッチ登録時のプロンプトの材料の版（R9）。

## 技術コンテキスト（Technical Context）

**言語・バージョン**：TypeScript 6.0（フロントエンド・バックエンドとも）。開発ツールはNode.js 22 LTS。001〜005と同じ。

**主な依存**：001〜005と同じ。新しい依存は足さない（アイコンは既存の`lucide-react`、CSVの組み立ては自前の小さな関数）。

**ストレージ**：Neon（Postgres 17）。[data-model.md](./data-model.md)のとおり。
- 列挙型3つ（`metrics_state`・`metrics_kind`・`judgment`）
- テーブル3つ（`post_metrics`・`post_metric_snapshots`・`follower_snapshots`）
- 列を足す：`post_drafts`（5列）、`draft_batches`（4列）、`accounts`（4列）
- Workers KV：`metrics:catchup`（その日の補いを終えた日付）を足す。

**テスト**：005と同じ構成。
- 共通：Vitest（判定・中央値・CSVの整形・プロンプトの節）
- API：Vitest＋`@cloudflare/vitest-pool-workers`＋ローカルのPostgres＋偽のThreadsサーバー（反応数・フォロワー数・削除・権限・上限を足す）。1回の定期処理の外部への呼び出しを数えるテストを足す
- Web：Vitest＋Testing Library

**対象プラットフォーム**：
- Web：Cloudflare Pages
- API：Cloudflare Workers（無料プラン。1回の呼び出しでCPU 10ms・外部へのサブリクエスト50回）。Cron Triggerは005の2つのまま（足さない）
- ブラウザ：PC・タブレット・スマートフォンのモダンブラウザ

**プロジェクトの種類**：Webアプリ（SPA＋API）＋定期処理

**性能目標**：
- 本featureのAPIは、p95で500ms以内（001〜005と同じ）。
- パフォーマンスの画面の最初の表示は2秒以内（投稿済み500件のAccount。SC-007）。1回のAPIで、集計と50件を返す。
- 24時間・3日・7日の値を、時点の±1時間で95%以上取る（SC-009）。
- 定期処理の1回のCPU時間は10ms前後（反応数のJSONの解析は小さい）。CSVの組み立てはブラウザで行う。

**制約**：
- 月額固定費$0（Constitution）。Cronは足さない。DBの起動は005の時刻の処理と3:00の回に相乗りする（SC-006）。
- Threadsへの問い合わせは1投稿あたり最大3回（遅れて確定は1回）と、Accountごとに1日1回のフォロワー数。
- アプリの中でLLMを使わない（原則III）。
- 上限・暫定値：取り込む時点（24時間・3日・7日）、時点の幅（±1時間）、遅れて確定の境目（192時間）、基準値の件数（30件）、判定を始める件数（5件）、しきい値（2倍・0.5倍）、プロンプトに入れる件数（5件）、傾向メモ（200文字）、一覧（50件ずつ）、書き出し（200件ずつ）。`packages/shared/src/limits.ts`に定数として置く。

**規模**：
- 画面：1つ（パフォーマンス）。投稿ストックのプロンプトのカードに材料の表示を1つ足す。
- API：新規3本（画面、傾向メモ、書き出し）。変更：プロンプト、下書きの編集、バッチの登録、宣伝内容・リサーチ・投稿ルールの保存、再接続、公開の成功の記録。
- 定期処理：005の`runAutoPost`に反応数の段階を足す。

「要確認」の項目はなし（[research.md](./research.md)で解消済み。実機でのエラーの応答の確認は、quickstart.md 手順6）。

## Constitutionとの整合（Constitution Check）

*ゲート：Phase 0の前に確認し、Phase 1の設計後に再確認する。Constitution 2.0.0。*

| 原則・制約 | 判定 | 根拠 |
|---|---|---|
| I. 人格・トーン・NGワードの一貫性 | 合格 | 本featureはThreadsに配信しない。プロンプトに入れる低調の投稿は公開済みの本文で、プロンプトは配信されないので、NGワードのチェックの対象外（spec 前提）。005の配信の直前のチェックは変えない |
| II. 人間承認ゲート | 合格 | 承認の流れ・自動投稿の対象を変えない。公開の成功の記録に列を足すだけ |
| III. 外部LLM前提・API依存ゼロ | 合格 | アプリの中でAIを呼ばない。改善案を作るのは、外部のAIに渡すプロンプト（既存）だけ。Threads APIは反応数とフォロワー数を読むだけ |
| IV. 契約／ロール分離 | 合格 | grower機能の判定は既存の`hasGrowerAccess`（契約の判定。課金のfeatureで置き換える）。操作はAccountの`owner`だけ（FR-032）。契約とロールを混ぜない |
| V. 個人運用起点のシンプルさ | 合格 | チーム運用・曜日や時間帯の傾向の分析・表での表示・AIの改善案・勝ちパターンは作らない（PRD §6.3） |
| VI. 改善フィードバックループの忠実性 | 合格 | 低調と判定された投稿は自動で改善フィードバックになり（FR-020）、外していない新しい5件がメモ付きで次のプロンプトに必ず入る（FR-025〜FR-027）。長さの調整で減らさない。却下ログの節（004）はそのまま。分析の表示だけで終わる状態にしない（US1とUS2を同じP1） |
| 技術スタック制約 | 合格 | 既存のスタックのまま。Cron Triggerを足さず、005の関所を使う。Clerk Organizationsは使わない |
| 運用コスト制約（固定費$0） | 合格（測って確かめる） | 時点の取り込みは、もともとDBが起きている時刻の処理の中で行う。補いは3:00の回で、残りがあれば関所で5分後に続ける。Threadsへの問い合わせは1投稿最大3回。見積もりはresearch.md R12。`metrics: deferred`のログで、Workers Paidへ移す時期を判断できる |
| 開発ワークフロー | 合格 | `feature/006-performance-feedback`で作業している |

**Phase 1の設計後の再確認**：data-model.md・contracts/で、新たな違反は生じていない。
- マイグレーションは後方互換。新しい列はNULLか既定値で、005までのコードは読まない。`body_edit_tracked`は、既存の行を`false`にしてから既定を`true`に変える。
- 005の`runAutoPost`への差し込みは、005の公開の処理の後ろに置き、公開の枠（1回4件）を先に使う。反応数の段階の失敗は、005の公開に影響しない（例外は段階の中で受け止め、ログに出す）。
- 原則VI：プロンプトの長さの調整で、この節を減らさないことをcontracts/prompt-template.mdに書いた。

## プロジェクト構成（Project Structure）

### ドキュメント（このfeature）

```text
specs/006-performance-feedback/
├── spec.md                  # 機能仕様（/speckit-specify・/speckit-clarify）
├── plan.md                  # このファイル（/speckit-plan）
├── research.md              # Phase 0の出力
├── data-model.md            # Phase 1の出力
├── quickstart.md            # Phase 1の出力
├── contracts/               # Phase 1の出力
│   ├── api.md               #   HTTP API・Threads APIの呼び出し・偽のThreadsサーバー
│   ├── metrics-job.md       #   反応数の段階（定期処理）の手順
│   ├── prompt-template.md   #   プロンプトの文面（005からの差分）
│   ├── csv.md               #   CSVの形式と列
│   └── ui-routes.md         #   画面・表示文言
├── checklists/
│   └── requirements.md      # 仕様品質チェックリスト
└── tasks.md                 # Phase 2の出力（/speckit-tasks。本コマンドでは作らない）
```

### ソースコード（リポジトリのルート）

005までの構成に、次のファイルを足す・変える（★は新規、✎は変更）。

```text
packages/shared/src/
├── ★ performance.ts            # 時点の判定（経過→種類）、補いの種類、判定（倍率→好調・普通・低調）、中央値、表示の倍率
├── ★ csv.ts                    # CSVの整形（BOM・CRLF・引用）、列の定義、曜日・時・日時の書式
├── ✎ prompt.ts                 # poorPosts と「■反応が低かった投稿」の節（長さの調整で減らさない）
├── ✎ limits.ts                 # METRICS_* ・PERFORMANCE_* ・PROMPT_POOR_POSTS の定数
├── ✎ schemas.ts                # Performance の型（Summary・Item・Feedback・Export の行）
└── ✎ errors.ts                 # 文言（権限がない・計測できません など）
packages/shared/test/
├── ★ performance.test.ts、★ csv.test.ts
└── ✎ prompt.test.ts

apps/api/
├── drizzle/★ 0008_performance.sql
├── scripts/★ seed-performance.ts     # 手動確認のデータ（投稿した日時をずらした投稿済み・反応数・低調。500件も作れる）
├── ✎ package.json                    # seed:performance
├── src/
│   ├── ✎ app.ts                        # ルートの登録
│   ├── db/✎ schema.ts                  # 列挙型・3つのテーブル・post_drafts / draft_batches / accounts の列
│   ├── lib/✎ threads-client.ts         # getMediaInsights・getFollowersCount、ThreadsNotFoundError・ThreadsPermissionError
│   ├── routes/★ performance.ts         # GET /performance、PATCH /performance/:draftId/feedback、GET /performance/export
│   └── services/
│       ├── ★ metrics-runner.ts         # 反応数の段階（対象の読み込み・呼び出し・まとめた書き込み・判定・補いの印）
│       ├── ★ performance-service.ts    # 画面の集計と一覧、傾向メモ、書き出しの行、次のプロンプトに入る5件
│       ├── ✎ auto-post-runner.ts       # 反応数の段階の呼び出し、公開の数を渡す、関所の候補に3:00、残りで immediate
│       ├── ✎ auto-post-gate.ts         # metrics:catchup の読み書き
│       ├── ✎ publish-executor.ts       # 公開の成功で published_slot_minute・published_carryover・published_prioritized
│       ├── ✎ prompt-service.ts         # 低調の投稿の材料
│       ├── ✎ draft-service.ts          # 編集で body_edited_at、バッチの登録で材料の版
│       ├── ✎ strategy-service.ts ほか   # 宣伝内容・リサーチ・投稿ルールの保存で accounts.*_changed_at
│       └── ✎ account-service.ts        # 再接続で insights_denied_at を消す
└── test/
    ├── fake-threads/✎ server.ts        # insights・threads_insights、削除・権限・上限・5xx の注入
    └── integration/
        ├── ★ metrics-runner.test.ts    # 時点・補い・確定・遅れて確定・計測できない・判定・失敗・呼び出しの回数
        ├── ★ performance.test.ts       # 画面・タブ・カーソル・メモ・書き出し・grower機能・owner
        ├── ✎ prompt.test.ts            # 反応が低かった投稿の節
        ├── ✎ post-drafts.test.ts       # 編集の記録・バッチの材料の版
        └── ✎ auto-post-runner.test.ts  # 公開の記録の3列、反応数の段階が公開に影響しないこと

apps/web/src/
├── ✎ router.tsx                        # /accounts/:accountId/performance
├── components/layout/✎ Sidebar.tsx     # 「分析 > パフォーマンス」
├── pages/★ performance.tsx
├── components/performance/
│   ├── ★ BaselineCard.tsx              # 基準値・説明・アイコンの意味・5件未満・基準値0
│   ├── ★ PerformanceTabs.tsx           # アイコンのタブと件数
│   ├── ★ JudgmentBadge.tsx             # 矢印のアイコン・倍率・文字での説明
│   ├── ★ PerformanceCard.tsx           # 投稿のカード（反応数・確定待ち・遅れて確定・計測できません）
│   ├── ★ FeedbackEditor.tsx            # 傾向メモと「プロンプトに入れる」（保存ボタンなし）
│   ├── ★ CsvExportMenu.tsx             # 投稿ごと・取り込みごと、続きを読みながら保存
│   ├── ★ InsightsDeniedBanner.tsx
│   └── ★ use-performance.ts            # 読み込み・タブ・カーソル・メモの保存
├── components/stock/✎ PromptCard.tsx   # 材料に「反応が低かった投稿 {n}件」
├── ✎ index.css                         # 判定の色のトークン（ライト・ダーク）
└── test/★ performance.test.tsx
```

**構成の判断**：001〜005と同じモノレポ（`packages/shared`・`apps/api`・`apps/web`）。反応数の段階は、005の自動投稿の処理と関所を共有するので、`auto-post-runner.ts`から`metrics-runner.ts`を呼ぶ形にし、処理の本体は別のファイルに分ける。判定・中央値・CSVの整形は、APIとWebで同じ結果にするため`packages/shared`に置く。

## 複雑さの記録（Complexity Tracking）

Constitution Checkに違反はないため、記録なし。
