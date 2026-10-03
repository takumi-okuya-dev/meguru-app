# 実装計画（Implementation Plan）：AIプロンプトの生成と投稿案の一括登録

**ブランチ**：`feature/003-prompt-bulk-register` | **日付**：2026-10-03 | **仕様**：[spec.md](./spec.md) | **UI全体設計**：[docs/ui-design.md](../../docs/ui-design.md)

**入力**：`specs/003-prompt-bulk-register/spec.md`の機能仕様

## 概要（Summary）

002で入力した戦略プロファイル（課題・宣伝内容・リサーチ）から、外部LLMに投稿案を作ってもらうプロンプトを組み立ててコピーできるようにする。外部LLMの回答を投稿ストックの画面に貼り付けると、「@@@」の行で分割した下書きを「要確認」として一括登録する。登録した下書きは、確認・編集・削除・取り消しができる。

技術的な方針は次のとおり。

- **プロンプト**：`packages/shared`の純粋な関数`buildPrompt`で、参考プロダクトの型を土台にした文面（[contracts/prompt-template.md](./contracts/prompt-template.md)）を組み立てる。APIが材料を集めて呼び、全文と要約を返す（research.md R1・R2）。
- **分割と長さ**：`splitDrafts`（区切りの揺れを受け付ける）と、公式ドキュメントに合わせた`threadsLength`・`countLinks`を`packages/shared`に置き、WebとAPIで同じ判定にする（R3・R4）。
- **登録**：送信ごとのIDで二重送信を防ぎ（R5）、アドバイザリーロックの中で上限を確かめて、全件を登録するか何もしないかにする（R6）。登録のまとまり（`draft_batches`）で並び順と取り消しを扱う（R7・R8）。
- **プラン**：プロンプトの生成だけをgrower機能にし、下書きの操作は全プランで使えるようにする（R10）。
- **画面**：docs/ui-design.mdの型C（作業画面型）で投稿ストックの画面を作り、002の部品（上部バー、未保存の警告、追加・編集のダイアログ、競合のダイアログ）を使い回す（R14）。

## 技術コンテキスト（Technical Context）

**言語・バージョン**：TypeScript 6.0（フロントエンド・バックエンドとも）。開発ツールはNode.js 22 LTS。001・002と同じ。

**主な依存**：001・002と同じ。本featureで新しく足す依存はない（`Intl.Segmenter`はES2022の標準。WorkersとモダンブラウザとNode.js 22で使える）。

**ストレージ**：Neon（Postgres 17）。テーブル`draft_batches`・`post_drafts`と、`accounts.prompt_post_count`列を足す（[data-model.md](./data-model.md)）。

**テスト**：002と同じ構成（共通：Vitest、API：Vitest + `@cloudflare/vitest-pool-workers` + ローカルのPostgres、Web：Vitest + Testing Library）。

**対象プラットフォーム**：WebはCloudflare Pages、APIはCloudflare Workers。ブラウザはPC・タブレット・スマートフォンのモダンブラウザ。クリップボードへの書き込みはHTTPSの環境を前提にし、できない場合の代わりの手段を用意する（R13）。

**プロジェクトの種類**：Webアプリ（SPA + API）

**性能目標**：
- 本featureのAPIは、p95で500ms以内（001・002と同じ）。プロンプトの組み立ては、材料の取得（DBへの問い合わせ）を並べて行う。
- 50件・50,000文字の一括登録も、1回のトランザクションで500ms以内に終える。
- アプリ内の操作は、プロンプトのコピーから一括登録まで2分以内（SC-001）。

**制約**：
- 月額固定費$0。本featureは定期処理を足さない。
- 1回の登録は50件・50,000文字・1件2,000文字まで、要確認の下書きはAccountあたり500件まで（FR-014）。プロンプトは30,000文字を目安に収める（R12）。
- 投稿文の生成はアプリの中で行わない（Constitution原則III）。
- 下書きは「要確認」のまま、Threadsに投稿しない（Constitution原則II。承認は004）。

**規模**：画面は1つ追加（投稿ストック）と、サイドバー・ホームの手直し。APIのエンドポイントは7個（プロンプト1、作る件数1、下書きの一覧1、一括登録1、取り消し1、編集1、まとめての削除1）。

「要確認」の項目はなし（すべて[research.md](./research.md)で解消済み）。

## Constitutionとの整合（Constitution Check）

*ゲート：Phase 0の前に確認し、Phase 1の設計後に再確認する。*

| 原則・制約 | 判定 | 根拠 |
|---|---|---|
| I. 人格・トーン・NGワードの一貫性 | 合格 | grower機能を使えるAccountでは、プロンプトに戦略プロファイル（課題の人柄・ターゲットなど）を必ず反映する（FR-002、v1.1.0の原則Iの要求）。本featureは配信しないので、NGワードのチェックは配信を扱う004・005で入れる |
| II. 人間承認ゲート | 合格 | 登録した下書きは「要確認」で、承認の操作を本featureでは作らない。Threadsへの投稿もしない（FR-012、SC-005） |
| III. 外部LLM前提・API依存ゼロ | 合格 | プロンプトをコピーして外部LLMに貼り付ける運用だけを作る。参考プロダクトの「APIキーでアプリ内で自動生成する」機能は取り込まない（spec Assumptions） |
| IV. プラン／ロール分離 | 合格 | プロンプトの生成の可否は002と同じく`accounts.plan`と無料体験で判定し、`role`は使わない（R10） |
| V. 個人プラン起点のシンプルさ | 合格 | 画像の添付、宣伝内容と投稿の対応の記録、プロンプトの保存・履歴は作らない |
| VI. 改善フィードバックループの忠実性 | 合格（004・006の前提を用意） | 本featureは却下・分析を扱わない。プロンプトの組み立てを1つの関数にまとめ、004の「却下された投稿」・006の「改善フィードバック」の節を、その関数に足すだけで済む形にする（R1、FR-027） |
| 技術スタック制約 | 合格 | 001・002と同じ構成のまま。新しい依存なし |
| 運用コスト制約（固定費$0） | 合格 | 定期処理なし。下書きはAccountあたり最大500件（要確認）で、Neonの無料枠に影響しない |
| 開発ワークフロー | 合格 | `feature/003-prompt-bulk-register`で作業している |

**Phase 1の設計後の再確認**：data-model.md・contracts/で新たな違反は生じていない。`accounts`への列の追加は既定値つきの後方互換の変更で、`post_draft_status`は004で値を足す前提の列挙型である。

## プロジェクト構成（Project Structure）

### ドキュメント（このfeature）

```text
specs/003-prompt-bulk-register/
├── spec.md               # 機能仕様（/speckit-specify・/speckit-clarify）
├── reference-prompt.md   # 参考プロダクトのプロンプトの型（ユーザーのデータは伏せ字）
├── plan.md               # このファイル（/speckit-plan）
├── research.md           # Phase 0の出力
├── data-model.md         # Phase 1の出力
├── quickstart.md         # Phase 1の出力
├── contracts/            # Phase 1の出力
│   ├── api.md            #   HTTP API
│   ├── prompt-template.md #  プロンプトの文面
│   └── ui-routes.md      #   画面・遷移・表示文言
├── checklists/
│   └── requirements.md   # 仕様品質チェックリスト
└── tasks.md              # Phase 2の出力（/speckit-tasks。本コマンドでは作らない）
```

### ソースコード（リポジトリのルート）

002までの構成に、次のファイルを足す・変える（★は新規、✎は変更）。

```text
packages/shared/src/
├── ★ drafts.ts                    # splitDrafts（区切りの判定と分割）
├── ★ threads-text.ts              # threadsLength・countLinks、THREADS_TEXT_LIMIT・THREADS_LINK_LIMIT
├── ★ prompt.ts                    # buildPrompt（contracts/prompt-template.md の文面）
├── ✎ limits.ts                    # 一括登録・下書き・プロンプトの上限
├── ✎ schemas.ts                   # 本featureの入出力スキーマ
└── ✎ errors.ts                    # PASTE_TOO_LARGE と文言
packages/shared/test/
├── ★ drafts.test.ts
├── ★ threads-text.test.ts
└── ★ prompt.test.ts

apps/api/
├── drizzle/★ 0002_post_drafts.sql
└── src/
    ├── db/✎ schema.ts             # post_draft_status、draft_batches、post_drafts、accounts.prompt_post_count
    ├── ✎ app.ts                    # ルートの登録
    ├── routes/
    │   ├── ★ prompt.ts            # GET /prompt、PUT /prompt-settings
    │   └── ★ post-drafts.ts       # 一覧・一括登録・取り消し・編集・まとめての削除
    └── services/
        ├── ★ prompt-service.ts    # 材料を集めて buildPrompt を呼ぶ
        └── ★ draft-service.ts     # 一括登録（ロック・上限・二重送信）、取り消し、まとめての削除
apps/api/test/integration/
├── ★ prompt.test.ts
├── ★ post-drafts.test.ts
└── ✎ profile-cascade.test.ts      # Account削除で下書きも消える

apps/web/src/
├── ✎ router.tsx                   # /stock
├── components/
│   ├── layout/✎ Sidebar.tsx       # 「投稿をつくる」「投稿ストック」
│   └── stock/
│       ├── ★ PromptCard.tsx       # 要約・件数・コピー・全文の表示
│       ├── ★ DraftList.tsx        # 要確認の一覧（まとまりの見出し、長さのバー、選択）
│       ├── ★ ThreadsLengthBar.tsx # 文字数と使用量のバー
│       ├── ★ PasteComposer.tsx    # 下部の貼り付け欄、登録直後の案内、選択のバー
│       └── ★ DraftEditDialog.tsx  # 下書きの編集
├── pages/
│   ├── ★ stock.tsx
│   └── ✎ account-home.tsx         # 「次にやること」の最後の文言
└── lib/✎ api-client.ts、✎ query.ts
apps/web/test/
└── ★ stock.test.tsx
```

**構成の決定**：001・002と同じWebアプリ型。プロンプト・分割・長さの判定を`packages/shared`に集め、WebとAPI（と後続の004〜006）が同じ定義を使う。

## 実装の進め方

tasks.mdで細かく分けるが、大きな順番は次のとおりとする。

1. **土台**：`packages/shared`の`splitDrafts`・`threadsLength`・`countLinks`・上限・スキーマ・エラーコード、DBのマイグレーション。
2. **US1 プロンプト**（P1）：`buildPrompt`、プロンプトのAPI、プロンプトのカード、サイドバーと投稿ストックの画面の骨組み。
3. **US2 一括登録**（P1）：一括登録・取り消しのAPI、貼り付け欄、登録直後の案内、一覧。
4. **US3 確認・修正・削除**（P2）：編集・まとめての削除のAPI、長さのバー、選択のバー、編集のダイアログ。
5. **仕上げ**：ホームの「次にやること」、Account削除との関係のテスト、4つの画面幅での確認。

## 複雑さの記録（Complexity Tracking）

Constitutionの違反はないため記載なし。
