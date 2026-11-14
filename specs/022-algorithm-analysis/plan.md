# 実装計画（Implementation Plan）：Threadsのアルゴリズムの解析

**ブランチ**：`feature/022-algorithm-analysis` | **日付**：2026-11-05 | **仕様**：[spec.md](./spec.md) | **UI全体設計**：[docs/ui-design.md](../../docs/ui-design.md) | **モック**：https://claude.ai/artifact/5GK8yF32kwsAqPVU1SaT8A

**入力**：`specs/022-algorithm-analysis/spec.md`の機能仕様（Clarifications 2026-11-05を含む）、Constitution 4.3.0、[docs/threads-algorithm-research.md](../../docs/threads-algorithm-research.md) 5.7

## 概要（Summary）

パフォーマンス（006）で取りためた確定した投稿から、時間帯・曜日・文字数・本文の特徴・内容ごとの伸びと、おすすめに乗った目安の投稿（フォロワー数に比べた広がり・初速・後からの伸び・返信率）を出す。件数と差の決まりを満たしたものを「傾向」にし、投稿のプロンプトに入れる。

- **計算**：`packages/shared/src/analysis/` の純粋な関数で、読むたびに計算する。結果は保存しない（research.md R1）。中央値で比べ、件数10件・差1.5倍の決まりで傾向を選ぶ（R5）。
- **材料**：006の `post_metrics`（確定）・`post_metric_snapshots`（24時間）・`follower_snapshots`（投稿時点のフォロワー数）。新しくThreadsから取る値はない（R2）。
- **祝日**：祝日法の決まりで計算する関数を shared に置く（R4。新しい依存は足さない）。
- **プロンプト**：本文で変えられる傾向だけを「■伸びた傾向」の節に入れる。CORE RULESに出てくる特徴・NGワードを含む傾向は入れない（R7、原則I）。傾向がなければ文は今と同じ。
- **内容の分類**：外のAIに分類のプロンプトを渡し、答えを貼って反映する（018と同じ形。R8、原則III）。手でも直せる。
- **データ**：新しい表 `analysis_settings`（Account）と `post_classifications`（投稿）。マイグレーション `0020_algorithm_analysis`（data-model.md）。
- **判定**：`authorizeAccount` の `view`（読む）・`content`（書く）と `feature: "autopost"`（R10）。
- **画面**：サイドバーの「自動投稿」に「解析」。`/accounts/:accountId/analysis` と「内容を分類する」（contracts/ui-routes.md）。

## 技術コンテキスト（Technical Context）

**言語・バージョン**：TypeScript 6.0（フロントエンド・バックエンドとも）。Node.js 22 LTS。021と同じ。

**主な依存**：021と同じ。新しい依存は足さない。

**ストレージ**：Neon（Postgres 17）。マイグレーション `0020_algorithm_analysis` の1本（表を2つ足すだけ）。

**テスト**：021と同じ構成。
- shared：祝日・投稿ごとの値・区切り・傾向の選び方（件数・差・区切りの種類ごとに1つ）・おすすめに乗った目安・プロンプトに入れる傾向の守り・分類のプロンプトと答えの読み取り・プロンプトの節（傾向がないと今と同じ文）。
- API：解析の応答（期間・確定だけ・範囲・件数不足）・設定（衝突・テーマの削除で分類が外れる）・分類（保存・入れ替え・ほかのAccountの投稿は外す）・プロンプトの節と `trendCount`・守り（view・content・autopost・関わりのない人）・マイグレーション。
- Web：サイドバーの「解析」・画面の各部・件数不足・切り替え・分類の流れ・スマートフォンの幅の並び。
- E2E：足さない。

**対象プラットフォーム**：Web＝Cloudflare Pages、API＝Cloudflare Workers（無料プラン）。Cronは足さない。

**プロジェクトの種類**：Webアプリ（`apps/web`・`apps/api`・`packages/shared`のpnpmモノレポ）

**性能の目標**：解析の画面は問い合わせ3回（投稿と値を結合して1回・設定・投稿の時刻）。計算は900件で10ミリ秒以内（Workersの無料プランのCPU時間に収まる）。プロンプトを作るときの追加は問い合わせ2回。

**制約**：
- アプリの中でAIを呼ばない（原則III）
- 傾向がないとき・切り替えがOFFのとき、プロンプトの文を1文字も変えない（SC-004）
- 低調の投稿と却下ログの節は変えない（原則VI）
- CORE RULES・NGワードと食い違う傾向をプロンプトに入れない（原則I、SC-003）
- ほかのAccountと比べない（原則V）
- 投稿の時刻を自動で変えない（FR-040b）

**規模**：Accountごとに直近90日の確定した投稿（1日10件で900件まで）。

## Constitution Check

*GATE：Phase 0の前に確かめ、Phase 1の後にもう一度確かめた。Constitution 4.3.0。*

| 原則 | 確かめたこと | 結果 |
|---|---|---|
| I. NGワードの一貫性 | 傾向はCORE RULESの後に置き、「人柄とCORE RULESを優先する」を添える。CORE RULESに出てくる特徴の傾向と、NGワードを含む傾向は入れない（R7） | 合格 |
| II.人間承認ゲート | 投稿の流れ・承認・自動投稿の時刻に触れない。時刻は参考を出すだけ | 合格 |
| III.外部LLM前提 | 解析は決まった計算。内容の分類は、外のAIにプロンプトをコピーして頼み、答えを貼る | 合格 |
| IV.契約／ロール分離 | 判定は今の `view`・`content` と機能のまとまり「自動投稿」。新しいロールや区分を作らない | 合格 |
| V.個人運用起点のシンプルさ | 判定は `authorizeAccount` の1か所。そのAccountのデータだけで、Accountをまたいで比べない。見せてもらっている人には出さない（パフォーマンスと同じ） | 合格 |
| VI.改善フィードバック | 低調の投稿と却下ログの節はそのまま。伸びた傾向を足して、改善が次に活きる形を強める | 合格 |
| 技術スタック・運用コスト | 新しい依存・サービス・Cronを足さない | 合格 |
| 開発ワークフロー | spec-kitの順。`feature/022-algorithm-analysis`→`develop`。マイグレーションは足すだけ。環境の違いはない | 合格 |

Phase 1の後の確認：data-model・contractsに、原則に反するものはない。Constitutionの改定は要らない。

## プロジェクトの構成（Project Structure）

### 文書（このfeature）

```text
specs/022-algorithm-analysis/
├── spec.md
├── plan.md              # この文書
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   ├── api.md           # Phase 1
│   ├── analysis.md      # Phase 1（計算・傾向の文・分類のプロンプトと答え）
│   └── ui-routes.md     # Phase 1
├── checklists/
│   └── requirements.md
└── tasks.md             # /speckit-tasks で作る
```

### ソースコード（変更する主なところ）

```text
packages/shared/src/
├── analysis/
│   ├── types.ts         # OPENING_TYPES・TIME_BUCKETS・TEXT_FEATURES・AnalysisPost・BucketRow・Trend など
│   ├── holidays.ts      # isJapaneseHoliday
│   ├── values.ts        # postValues・lengthBuckets
│   ├── analyze.ts       # analyzePosts（区切り・傾向・おすすめに乗った目安）
│   ├── prompt.ts        # trendsForPrompt・classifyPrompt・parseClassifyAnswer
│   └── index.ts
├── limits.ts            # ANALYSIS_* の定数
├── schemas.ts           # 解析のAPIの入出力
└── prompt.ts            # PromptInput.trends と「■伸びた傾向」の節

apps/api/
├── drizzle/0020_algorithm_analysis.sql
├── src/db/schema.ts                     # analysis_settings・post_classifications
├── src/services/analysis-service.ts     # 新規：材料の読み出し・解析・設定・分類
├── src/routes/analysis.ts               # 新規
├── src/services/prompt-service.ts       # 傾向を求めて buildPrompt に渡す
├── src/app.ts
└── test/integration/analysis.test.ts・migration/migration-0020.test.ts

apps/web/src/
├── pages/analysis.tsx                   # 新規
├── components/analysis/                 # 新規：TrendCard・RecommendedCard・BucketTable・FeatureTable・ScheduleHint・ContentCard・ClassifyDialog
├── components/layout/Sidebar.tsx        # 自動投稿に「解析」
├── lib/api-client.ts・query.ts
└── router.tsx

docs/ui-design.md・user-guide.md・architecture.md・next-features.md
```

**構成の判断**：計算は `packages/shared` にだけ置き、APIの解析の画面とプロンプトの両方がそこを呼ぶ（決まりを2か所に書かない）。分類のプロンプトと答えの読み取りも shared に置き、Webが呼ぶ（018と同じ）。

## 複雑さの記録（Complexity Tracking）

Constitutionの違反はないので、記録はない。
