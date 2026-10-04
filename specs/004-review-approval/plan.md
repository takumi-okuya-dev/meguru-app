# 実装計画（Implementation Plan）：重複検知・承認/却下・NGワード（CORE RULES）

**ブランチ**：`feature/004-review-approval` | **日付**：2026-10-04 | **仕様**：[spec.md](./spec.md) | **UI全体設計**：[docs/ui-design.md](../../docs/ui-design.md)

**入力**：`specs/004-review-approval/spec.md`の機能仕様

## 概要（Summary）

投稿ストックの下書きに、人の承認の関門を作る。
- **承認・却下**：要確認の下書きを、1件ずつ、またはまとめて承認・却下（理由は必須）できる。承認済み・却下の下書きは、要確認に戻せる。
- **NGワード**：Accountごとに登録でき、NGワードを含む下書きは承認できない。
- **規約に注意**：Threadsの規約に触れやすい表現にラベルを付け、承認の前に確認を求める。
- **重複検知**：似ている下書きは類似度%で知らせる。
- **プロンプトへの反映**：規約上のルール・投稿ルール（CORE RULES）・NGワードと、却下した下書き（却下ログ）を、次のプロンプトに入れる。

技術的な方針は次のとおり。

- **状態**：
  - `post_draft_status`に`approved`・`rejected`を足し、`post_drafts`に`reviewed_at`・`reject_reasons`・`reject_note`を足す。
  - 状態と記録の組み合わせは、DBのCHECK制約で守る（research.md R1）。
- **状態の変更**：
  - 1本のAPI（`POST /post-drafts/review`）で、承認・却下・戻すを1件でもまとめてでも扱う。
  - 承認のチェック（NGワード・Threadsの上限・規約に注意の確認）は、サーバーのトランザクションの中で行う。
  - NGワードの追加と同じアドバイザリーロックで直列化する（R2・R3）。
- **判定**：NGワード（R4）・規約に注意（R7）・類似度（R8）・配信できるかの判定（R14）を、`packages/shared`の純粋な関数にまとめ、WebとAPI（と005）が同じ定義を使う。
  - 類似度：Workersの時間の制約を避けるため、Webで計算する。長い本文（300文字超）の組は、編集距離を省いてDice係数だけにする（research.md R8）。
  - 規約の注意の一覧：[contracts/policy-cautions.md](./contracts/policy-cautions.md)を正とする定数。
- **プロンプト**：003の`buildPrompt`に、CORE RULESの節（常に）と却下の節を足す（R12、[contracts/prompt-template.md](./contracts/prompt-template.md)）。
- **画面**：
  - 投稿ストックに、状態のタブ・ラベル・承認／却下・却下理由の入力・タブごとの選択のバーを足す。
  - 「このアカウントの設定」に「投稿のルール」の区分を足す（R13、[contracts/ui-routes.md](./contracts/ui-routes.md)）。

## 技術コンテキスト（Technical Context）

**言語・バージョン**：TypeScript 6.0（フロントエンド・バックエンドとも）。開発ツールはNode.js 22 LTS。001〜003と同じ。

**主な依存**：001〜003と同じ。本featureで新しく足す依存はない。編集距離・Dice係数は自前の小さな関数で書く（R8）。

**ストレージ**：Neon（Postgres 17）。次を変える（[data-model.md](./data-model.md)）。
- 列挙型`post_draft_status`に値を2つ足す
- `post_drafts`に列を3つ足す
- `accounts`に列を2つ足す
- テーブル`ng_words`を足す

**テスト**：003と同じ構成。
- 共通：Vitest
- API：Vitest＋`@cloudflare/vitest-pool-workers`＋ローカルのPostgres
- Web：Vitest＋Testing Library

**対象プラットフォーム**：
- Web：Cloudflare Pages
- API：Cloudflare Workers（無料プラン。1リクエストのCPU時間が短いため、類似度はWebで計算する。R8）
- ブラウザ：PC・タブレット・スマートフォンのモダンブラウザ

**プロジェクトの種類**：Webアプリ（SPA＋API）

**性能目標**：
- 本featureのAPIは、p95で500ms以内（001〜003と同じ）。まとめての状態の変更（最大500件）とNGワードの追加（承認済み最大500件の判定）も、1回のトランザクションで収める。
- 類似度の計算（Web）は、通常（要確認30件・全体300件）で数十ms以内、最大（要確認500件・全体1,500件）で1秒以内を目安にする（R8）。
- 30件の下書きの承認・却下を、読む時間を含めて10分以内（SC-002）。

**制約**：
- 月額固定費$0。定期処理は足さない。
- 承認を経ない下書きは投稿しない（Constitution原則II）。本featureは投稿そのものをしない（005）。
- NGワードのチェックを飛ばす経路を作らない（原則I）。
- アプリの中でLLM・外部のAI APIを使わない（原則III）。類似度は文字の近さ、規約の注意は表現の一覧で判定する。
- 上限：
  - 要確認・承認済み：各500件
  - NGワード：200語・1語50文字
  - 投稿ルール：2,000文字
  - 却下理由の自由記述：200文字
  - プロンプトの却下：10件

**規模**：
- 画面：新しい画面はない。投稿ストックと「このアカウントの設定」を広げ、サイドバーに件数を足す。
- API：新規6本（状態の変更、件数、投稿のルールの取得、NGワードの追加・削除、投稿ルールの保存）と、003の4本の変更（一覧、編集、まとめての削除、プロンプト）。

「要確認」の項目はなし（すべて[research.md](./research.md)で解消済み）。

## Constitutionとの整合（Constitution Check）

*ゲート：Phase 0の前に確認し、Phase 1の設計後に再確認する。*

| 原則・制約 | 判定 | 根拠 |
|---|---|---|
| I. 人格・トーン・NGワードの一貫性 | 合格 | NGワードの設定とチェックを全プランで提供する（FR-017）。<br>承認のチェックはサーバーで行い、Webの判定に頼らない（R3）。<br>NGワードの追加で、該当する承認済みを要確認に戻す（FR-016a）ので、承認済みは常にその時点のNGワードを通ったものだけになる。<br>配信の直前のチェック（005）に使う`checkPublishable`を用意する（R14）。<br>管理者用の抜け道は作らない |
| II. 人間承認ゲート | 合格 | 承認済みになるのは、`approve`の操作だけ。<br>承認済みの編集は要確認に戻す（FR-007）。<br>却下理由は必須で、DBのCHECK制約でも守る（R1）。<br>本featureは投稿しない（FR-011） |
| III. 外部LLM前提・API依存ゼロ | 合格 | 類似度は文字の近さ（R8）、規約の注意は表現の一覧（R7）で判定し、アプリの中でAIを呼ばない。<br>外部のModeration APIも使わない |
| IV. プラン／ロール分離 | 合格 | 投稿ルールの編集の可否は、`accounts.plan`と無料体験で判定し（002と同じ）、`role`は使わない |
| V. 個人プラン起点のシンプルさ | 合格 | 承認・却下の監査ログ、二段階承認、類似度の閾値の設定、規約の注意の一覧の管理画面は作らない |
| VI. 改善フィードバックループの忠実性 | 合格 | 却下ログ（却下の下書き＋理由）を、次のプロンプトの「過去に却下された投稿」に必ず入れる（FR-023、R12）。<br>テストで確かめる（SC-004） |
| 技術スタック制約 | 合格 | 001〜003と同じ構成のまま。新しい依存なし |
| 運用コスト制約（固定費$0） | 合格 | 定期処理なし。<br>類似度をWebで計算し、WorkersのCPU時間を使わない。<br>NGワード・却下の行は小さく、Neonの無料枠に影響しない |
| 開発ワークフロー | 合格 | `feature/004-review-approval`で作業している |

**Phase 1の設計後の再確認**：data-model.md・contracts/で新たな違反は生じていない。
- マイグレーションは後方互換。既存の下書きはすべて`needs_review`で、新しい列はNULLのため、CHECK制約を満たす。
- `GET /post-drafts`のレスポンスの形が変わる（`items` → `needsReview`）が、Webと同時に変えるので、外部の利用者はいない。

## プロジェクト構成（Project Structure）

### ドキュメント（このfeature）

```text
specs/004-review-approval/
├── spec.md                 # 機能仕様（/speckit-specify・/speckit-clarify）
├── plan.md                 # このファイル（/speckit-plan）
├── research.md             # Phase 0の出力
├── data-model.md           # Phase 1の出力
├── quickstart.md           # Phase 1の出力
├── contracts/              # Phase 1の出力
│   ├── api.md              #   HTTP API
│   ├── prompt-template.md  #   プロンプトの文面（003からの差分）
│   ├── policy-cautions.md  #   規約上のルールと「規約に注意」の一覧
│   └── ui-routes.md        #   画面・表示文言
├── checklists/
│   └── requirements.md     # 仕様品質チェックリスト
└── tasks.md                # Phase 2の出力（/speckit-tasks。本コマンドでは作らない）
```

### ソースコード（リポジトリのルート）

003までの構成に、次のファイルを足す・変える（★は新規、✎は変更）。

```text
packages/shared/src/
├── ★ normalize.ts              # 1文字ずつのNFKC＋小文字と、元の位置への対応表（R4）
├── ★ ng-words.ts               # findNgWords
├── ★ policy.ts                 # POLICY_LIST_VERSION、POLICY_PROMPT_RULES、POLICY_CAUTIONS、findPolicyCautions
├── ★ similarity.ts             # computeSimilarities（Dice係数＋編集距離。R8）
├── ★ review.ts                 # checkPublishable、REJECT_REASONS（コードと表示名）
├── ✎ prompt.ts                 # CORE RULESの節、却下の節、減らす順、要約
├── ✎ limits.ts                 # 承認済み・NGワード・投稿ルール・却下理由・プロンプトの却下の上限、類似度の閾値
└── ✎ schemas.ts                # 状態・却下理由・review・NGワード・投稿ルール・件数のスキーマ
packages/shared/test/
├── ★ normalize.test.ts、★ ng-words.test.ts、★ policy.test.ts、★ similarity.test.ts、★ review.test.ts
└── ✎ prompt.test.ts

apps/api/
├── drizzle/★ 0003_review_approval.sql
└── src/
    ├── db/✎ schema.ts               # 列挙型の値、post_drafts・accounts の列、ng_words
    ├── ✎ app.ts                      # ルートの登録
    ├── routes/
    │   ├── ✎ post-drafts.ts         # 一覧の形、編集、削除の対象、review、counts
    │   └── ★ posting-rules.ts       # GET /posting-rules、POST・DELETE /ng-words、PUT /core-rules
    └── services/
        ├── ✎ draft-service.ts       # 3つの状態の一覧、承認済みの編集、削除の対象
        ├── ★ review-service.ts      # 状態の変更（ロック・判定・上限・二重の記録の防止）
        ├── ★ posting-rules-service.ts # NGワードの追加（承認済みの戻し）・削除、投稿ルールの保存
        └── ✎ prompt-service.ts      # 投稿ルール・NGワード・却下・承認済みの下書きを材料に足す
apps/api/test/integration/
├── ★ review.test.ts
├── ★ posting-rules.test.ts
├── ✎ post-drafts.test.ts、✎ prompt.test.ts
└── ✎ profile-cascade.test.ts        # Account削除でNGワードも消える

apps/web/src/
├── components/
│   ├── layout/✎ Sidebar.tsx         # 要確認の件数
│   ├── stock/
│   │   ├── ★ StatusTabs.tsx         # 3つのタブ（URLのクエリ）
│   │   ├── ✎ DraftList.tsx          # タブごとの一覧、空の状態
│   │   ├── ★ DraftCard.tsx          # 本文の強調、ラベルの行、承認・却下、「⋯」
│   │   ├── ★ DraftLabels.tsx        # 類似度・NGワード・規約に注意・上限のラベルとポップオーバー
│   │   ├── ★ RejectDialog.tsx       # 却下理由の入力
│   │   ├── ★ PolicyConfirmDialog.tsx # 規約に注意の確認
│   │   ├── ✎ PasteComposer.tsx      # タブごとの選択のバー
│   │   ├── ✎ DraftEditDialog.tsx    # 承認済みの編集の案内、入力中のラベル
│   │   ├── ✎ PromptCard.tsx         # 要約の追加
│   │   ├── ★ use-review.ts          # 状態の変更と「元に戻す」、skipped の文言
│   │   ├── ★ use-similarities.ts    # 類似度の計算（必要ならアイドル時に分けて）
│   │   └── ✎ messages.ts
│   └── settings/
│       ├── ★ PostingRulesSection.tsx # 「投稿のルール」の3つの行
│       ├── ★ NgWordsDialog.tsx
│       ├── ★ CoreRulesDialog.tsx
│       └── ★ PolicyInfoDialog.tsx
├── pages/
│   ├── ✎ stock.tsx
│   └── ✎ account-settings.tsx
└── lib/✎ api-client.ts、✎ query.ts
apps/web/test/
├── ✎ stock.test.tsx
└── ★ account-settings.test.tsx

docs/✎ ui-design.md                 # 7. 画面のURL、10. まだ決めていないこと（research.md R13）
```

**構成の決定**：001〜003と同じWebアプリ型。判定（NGワード・規約に注意・類似度・配信できるか）とプロンプトを`packages/shared`に集め、WebとAPI（と005）が同じ定義を使う。

## 実装の進め方

tasks.mdで細かく分けるが、大きな順番は次のとおりとする。

1. **土台**：
   - `packages/shared`の正規化・NGワード・規約の注意・却下理由・`checkPublishable`・上限・スキーマ
   - DBのマイグレーション
   - 一覧のAPIの形の変更とWebの追従（003の動作を保つ）
2. **US1 承認・却下**（P1）：
   - 状態の変更のAPI（ロック・判定・二重の記録の防止）
   - タブ、承認・却下のボタン、却下理由の入力、選択のバー、「元に戻す」
   - 承認済みの編集
   - サイドバーの件数
3. **US2 NGワード**（P1）：
   - NGワードのAPI（追加で承認済みを戻す）
   - 設定の画面の「投稿のルール」とNGワードのダイアログ
   - 一覧のラベルと強調
4. **US3 重複検知**（P2）：`computeSimilarities`、類似度のラベルとポップオーバー、却下の候補の初期選択。
5. **US4 プロンプトへの反映**（P2）：
   - 投稿ルールのAPIとダイアログ
   - `buildPrompt`のCORE RULES・却下の節
   - プロンプトのカードの要約
6. **US5 規約への備え**（P2）：
   - 規約の注意のラベルと確認のダイアログ
   - APIの`POLICY_CONFIRM_REQUIRED`
   - 規約の備えのダイアログ
7. **仕上げ**：
   - docs/ui-design.mdの更新
   - Account削除との関係のテスト
   - 類似度の計算の性能の確認（最大の件数）
   - 4つの画面幅での確認

US5の規約上のルールは、US4のCORE RULESの節と同じ場所に入るため、プロンプトの変更はUS4でまとめて行う。

## 複雑さの記録（Complexity Tracking）

Constitutionの違反はないため記載なし。
