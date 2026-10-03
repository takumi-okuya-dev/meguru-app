# 実装計画（Implementation Plan）：戦略プロファイル（課題・宣伝内容・リサーチ）

**ブランチ**：`feature/002-strategy-profile` | **日付**：2026-10-02 | **仕様**：[spec.md](./spec.md) | **UI全体設計**：[docs/ui-design.md](../../docs/ui-design.md)

**入力**：`specs/002-strategy-profile/spec.md`の機能仕様

## 概要（Summary）

Accountごとに、投稿づくりの材料になる「課題」「宣伝内容」「リサーチ（参考投稿・キーワード）」を入力・保存できるようにする。あわせて、docs/ui-design.mdで決めたChatGPT風の画面の骨格（Accountの切り替えのドロップダウン、機能を移動するサイドバー、上部バー、スマートフォン対応）を001の画面に当てはめる。

技術的な方針は次のとおり。

- **保存の形**：課題はAccountと1対1のテーブルに項目ごとの列で持ち、全項目をまとめて保存する（research.md R1）。宣伝内容・参考投稿・キーワードはAccountに複数紐づくテーブルにする。
- **別のタブとの競合**：各行に`version`を持たせ、保存時に一致しなければ`409`と最新の値を返す（R3）。画面は「読み込み直す」か「上書き」を選ばせる。
- **件数の上限**：追加はAccount×種類単位のロックを取ったトランザクションで行い、同時の追加でも上限を超えない（R4）。
- **入力の検証**：文字数（コードポイントで数える）・必須・URL・キーワードの正規化を`packages/shared`にまとめ、Web・API・DBの制約で同じ判定にする（R2・R5・R8）。
- **画面**：課題は型A（フォーム型）、宣伝内容とリサーチは型B（一覧＋追加型）。未保存の変更は、ルーターの`useBlocker`と`beforeunload`で警告する（R9・R10）。
- **grower機能の判定**（2026-10-02に追加）：編集はプラン2以上か無料体験中（登録から1か月）のAccountだけに許可し、APIで必ず判定する。表示は止めず、使えないAccountでは読むだけにする（R14）。
- **Threads連携の公開範囲**（2026-10-03に追加）：APIの環境変数`THREADS_ACCESS_MODE`で、アカウント追加画面の検証期間の案内を出す・出さないを切り替える（R15）。

## 技術コンテキスト（Technical Context）

**言語・バージョン**：TypeScript 6.0（フロントエンド・バックエンドとも）。開発ツールはNode.js 22 LTS。001と同じ。

**主な依存**：001と同じ（Web：React 19、Vite 8、React Router 8、TanStack Query、shadcn/ui。API：Hono、Drizzle ORM、`@neondatabase/serverless`、zod）。本featureで足すのは`@radix-ui/react-tabs`（リサーチのタブ）だけ。

**ストレージ**：Neon（Postgres 17）。テーブル`strategy_designs`・`promotions`・`reference_posts`・`research_keywords`と、`accounts.promotion_ratio_percent`列を足す（[data-model.md](./data-model.md)）。

**テスト**：001と同じ構成（API：Vitest + `@cloudflare/vitest-pool-workers` + ローカルのPostgres。Web：Vitest + Testing Library。E2E：Playwright）。`packages/shared`の判定関数の単体テストを足す（research.md R12）。

**対象プラットフォーム**：WebはCloudflare Pages、APIはCloudflare Workers。ブラウザはPC・タブレット・スマートフォンのモダンブラウザ（docs/ui-design.md「5. 画面幅ごとの振る舞い」）。

**プロジェクトの種類**：Webアプリ（SPA + API）

**性能目標**：
- 本featureのAPIは、p95で500ms以内（001と同じ）。Threads APIは呼ばない。
- 課題の全項目の入力・保存が20分以内、宣伝内容1件の登録が3分以内、参考投稿1件の保存が1分以内（SC-002。主に画面の操作のしやすさで決まる）。

**制約**：
- 月額固定費$0（Neonの無料枠）。本featureは定期処理を足さない。期限切れは日付の比較で求める（research.md R6）。
- 1つのAccountあたりの件数の上限：宣伝内容50件、参考投稿200件、キーワード100件（FR-022）。一覧はページ分けせずに全件返す。
- 入力内容を文字として表示するだけにし、HTMLとして解釈しない（research.md R13）。

**規模**：画面は3つ追加（課題・宣伝内容・リサーチ）と、ホーム・サイドバー・設定画面の手直し。APIのエンドポイントは17個（入力状況1、課題2、宣伝投稿の割合2、宣伝内容4、参考投稿4、キーワード4）。

「要確認」の項目はなし（すべて[research.md](./research.md)で解消済み）。

## Constitutionとの整合（Constitution Check）

*ゲート：Phase 0の前に確認し、Phase 1の設計後に再確認する。*

| 原則・制約 | 判定 | 根拠 |
|---|---|---|
| I. 人格・トーン・NGワードの一貫性 | 合格（Constitutionを改定） | 本featureはThreadsへ何も配信しない。戦略プロファイルをgrower機能にしたため、プラン1には戦略プロファイルがない。原則Iを「配信前のNGワードのチェックは全プラン、戦略プロファイルによる一貫性の担保はgrower機能を使えるAccount」と読める文言に改定する（2026-10-03、`/speckit-constitution`）。NGワードは自動投稿のfeatureより前に別途仕様化する |
| II. 人間承認ゲート | 該当なし（合格） | 投稿ストック・自動投稿を扱わない |
| III. 外部LLM前提・API依存ゼロ | 合格 | LLMの呼び出しはない。リサーチの「なぜ良いか」は、ユーザーが外部LLMの回答を貼り付ける運用にとどめる |
| IV. プラン／ロール分離 | 合格 | 編集できるかは`accounts.plan`（契約）と無料体験（ユーザーの登録日）で判定し、`role`は使わない（R14）。アクセスは001の`owner`のMembershipだけで判定し、`member`は扱わない |
| V. 個人プラン起点のシンプルさ | 合格 | 変更履歴・複数の課題の切り替え・AIアシスト用プロンプト・プラン4の権限を作らない（spec Assumptions） |
| VI. 改善フィードバックループの忠実性 | 該当なし（合格） | 分析・プロンプト生成を扱わない。課題・宣伝内容・参考投稿を項目ごとに参照できる形で持ち、後続のプロンプト生成（FR-4・FR-10）が使えるようにする（FR-027） |
| 技術スタック制約 | 合格 | 001と同じ構成のまま。足す依存は`@radix-ui/react-tabs`（shadcn/uiの部品の元）だけ |
| 運用コスト制約（固定費$0） | 合格 | 定期処理を足さない。テーブルの行数はAccountあたり最大約350行で、Neonの無料枠に影響しない |
| 開発ワークフロー | 合格 | `feature/002-strategy-profile`で作業している。spec-kitの手順（specify → plan → tasks → implement）に従う |

**Phase 1の設計後の再確認**：data-model.md・contracts/で新たな違反は生じていない。`accounts`への列の追加は、001のテーブルを壊さない後方互換の変更（既定値つき）である。

**料金の見直し後の再確認（2026-10-03）**：戦略プロファイルをgrower機能にし、全ユーザーに1か月の無料体験を設けた（PRD FR-12、spec FR-024）。判定に必要な列は足さず、001の`users.created_at`と`accounts.plan`から求める（R14）。原則Iとの食い違いは、Constitutionの改定で解消する。`THREADS_ACCESS_MODE`（R15）は環境変数が1つ増えるだけで、構成・コストへの影響はない。

## プロジェクト構成（Project Structure）

### ドキュメント（このfeature）

```text
specs/002-strategy-profile/
├── spec.md              # 機能仕様（/speckit-specify）
├── plan.md              # このファイル（/speckit-plan）
├── research.md          # Phase 0の出力
├── data-model.md        # Phase 1の出力
├── quickstart.md        # Phase 1の出力
├── contracts/           # Phase 1の出力
│   ├── api.md           #   HTTP API
│   └── ui-routes.md     #   画面・遷移・表示文言
├── checklists/
│   └── requirements.md  # 仕様品質チェックリスト
└── tasks.md             # Phase 2の出力（/speckit-tasks。本コマンドでは作らない）

docs/ui-design.md        # UI全体設計（本featureの前に決定。画面の前提）
```

### ソースコード（リポジトリのルート）

001の構成に、次のファイルを足す・変える（★は新規、✎は変更）。

```text
packages/shared/src/
├── ★ strategy.ts                  # STRATEGY_FIELDS（項目の定義と文言）、入力済み項目数の数え方
├── ★ text.ts                      # 文字数の数え方、空欄の判定、キーワードの正規化
├── ★ promotions.ts                # 日本時間の今日、宣伝の対象・期限切れの判定、並び順
├── ★ limits.ts                    # 文字数・件数の上限の定数
├── ★ access.ts                    # grower機能の判定（hasGrowerAccess）、無料体験の終了時刻（trialEndsAt）
├── ✎ schemas.ts                   # 本featureの入出力スキーマ（zod）
└── ✎ errors.ts                    # STALE_UPDATE・GROWER_FEATURE_REQUIRED など5つのエラーコードと文言

apps/api/
├── drizzle/★ 0001_strategy_profile.sql   # マイグレーション
└── src/
    ├── db/✎ schema.ts             # 列挙型2つ、テーブル4つ、accounts の列
    ├── ✎ app.ts                    # ルートの登録
    ├── ✎ env.ts                    # THREADS_ACCESS_MODE
    ├── lib/✎ config.ts             # THREADS_ACCESS_MODE の値の確認
    ├── lib/✎ errors.ts             # 403 を足す、409 STALE_UPDATE に latest を載せる形
    ├── routes/✎ me.ts              # threadsAccessMode を返す
    ├── routes/
    │   ├── ★ strategy.ts          # 課題と入力状況
    │   ├── ★ promotions.ts        # 宣伝内容と宣伝投稿の割合
    │   └── ★ research.ts          # 参考投稿とキーワード
    └── services/
        ├── ★ strategy-service.ts  # 条件付きの保存（version）、入力済み項目数
        ├── ★ item-service.ts      # 子の行の共通処理（上限つきの追加、条件付きの更新、削除）
        ├── ★ grower-access.ts     # 編集の前の判定（403 GROWER_FEATURE_REQUIRED）
        └── ★ profile-status.ts    # ホームの入力状況
apps/api/test/integration/
├── ★ strategy.test.ts
├── ★ promotions.test.ts
├── ★ research.test.ts
└── ★ profile-cascade.test.ts      # Account削除で関連行が消える

apps/web/src/
├── ✎ index.css                    # 色の変数（docs/ui-design.md「4. 見た目の約束」）
├── ✎ router.tsx                   # /strategy、/promotions、/research
├── components/
│   ├── layout/
│   │   ├── ✎ AppShell.tsx         # サイドバーの開閉（localStorage）、タブレットの重ねて開く表示
│   │   ├── ✎ Sidebar.tsx          # 機能の移動（見出し「戦略」）
│   │   ├── ✎ AccountSwitcher.tsx  # ドロップダウンに変更
│   │   └── ★ PageHeader.tsx       # 上部バー（画面名と主な操作）
│   ├── ui/★ textarea.tsx、★ tabs.tsx、✎ dialog.tsx（狭い画面で全画面にする）
│   ├── ★ FieldWithCounter.tsx     # ラベル・説明・未入力・文字数つきの入力欄
│   ├── ★ ConflictDialog.tsx       # 「他の場所で更新されています」
│   └── ★ UnsavedChangesDialog.tsx # 「保存していない変更があります」
├── pages/
│   ├── ✎ account-home.tsx         # 入力状況のカード、「次にやること」、無料体験の終了日
│   ├── ✎ account-new.tsx          # threadsAccessMode が testers のときだけ検証期間の案内
│   ├── ★ strategy.tsx
│   ├── ★ promotions.tsx           # 一覧・宣伝投稿の割合・追加/編集のダイアログ
│   ├── ★ research.tsx             # タブ（参考投稿・キーワード）
│   └── settings/✎ settings-layout.tsx  # 狭い画面で「一覧 → 中身」の2段
└── lib/
    ├── ✎ api-client.ts            # 本featureのエンドポイント、409 の latest の受け取り
    └── ★ use-unsaved-changes.ts   # useBlocker + beforeunload
apps/web/test/
├── ★ strategy.test.tsx            # 未保存の警告、競合のダイアログ
├── ★ account-home.test.tsx        # 「次にやること」の切り替え
└── ★ layout-responsive.test.tsx   # ドロワー、設定の2段

e2e/★ strategy.spec.ts              # 課題の保存と復元
```

**構成の決定**：001と同じWebアプリ型（`apps/web`、`apps/api`、`packages/shared`のモノレポ）。項目の定義・判定の関数を`packages/shared`に集め、画面・API・後続のプロンプト生成が同じ定義を使う。

## 実装の進め方

tasks.mdで細かく分けるが、大きな順番は次のとおりとする。各段階の終わりで、quickstart.mdの該当する確認ができる状態にする。

1. **土台**：`packages/shared`の判定関数と定数（grower機能の判定を含む）、DBのマイグレーション、エラーコード、`THREADS_ACCESS_MODE`。
2. **001の画面の手直し**（docs/ui-design.md「001からの変更点」）：色の変数、Accountの切り替えのドロップダウン、サイドバーの開閉と機能の移動、`PageHeader`、設定画面の2段。この段階では「課題」「宣伝内容」「リサーチ」はまだサイドバーに出さない。
3. **US1 課題**（P1）：API、画面、未保存の警告、競合のダイアログ。サイドバーに「課題」を出す。
4. **US2 宣伝内容**（P2）：API、画面、追加・編集のダイアログ（狭い画面で全画面）。
5. **US3 リサーチ**（P3）：API、タブの画面。
6. **US4 ホーム**（P4）：入力状況のAPIとカード、「次にやること」、無料体験の終了日。grower機能を使えないAccountの案内（課題・宣伝内容・リサーチの読むだけの表示を含む）。
7. **仕上げ**：E2E、4つの画面幅での確認（quickstart.md「6. 画面幅」）。

## 複雑さの記録（Complexity Tracking）

Constitutionの違反はないため記載なし。
