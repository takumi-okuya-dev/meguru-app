# 実装計画（Implementation Plan）：運営者がすべてのアカウントを接続方法ごとに確かめられる一覧

**ブランチ**：`feature/026-operator-accounts` | **日付**：2026-11-09 | **仕様**：[spec.md](./spec.md) | **モック**：[026 アカウント一覧 モック](https://claude.ai/artifact/BgQqyj6fDtY6KeNYYFQm4W)

**入力**：`specs/026-operator-accounts/spec.md`（Clarifications 2026-11-09を含む）、Constitution 4.4.0

## 概要（Summary）

トークンでつないだアカウントは運営者の画面に出ず、「テスター招待」には申し込みの記録があるアカウントしか出ない。そこで、設定の「運営」に「アカウント一覧」を足し、すべてのアカウントを接続方法ごとに見られるようにする。見るだけで、データは足さない。

- **API**：`GET /api/operator/accounts`（運営者だけ）。接続方法の絞り込み・検索・続きの読み込みを受け、接続方法ごとの件数と1ページ分の行を返す（[contracts/api.md](./contracts/api.md)）。
- **画面**：`/settings/operator-accounts`。検索欄、接続方法の下線のタブ（件数つき）、行の一覧（PCは表、スマートフォンは2〜4段の行）、「もっと見る」（[contracts/ui-routes.md](./contracts/ui-routes.md)）。
- **テスター招待の状態**：生きている申し込みの状態、なければ枠を使ったまま残っている「外してよい」を、申し込みの記録から読む（research.md R4）。

## 技術コンテキスト（Technical Context）

**言語・バージョン**：TypeScript 6.0（フロントエンド・バックエンドとも）。Node.js 22 LTS。025と同じ。

**主な依存**：025と同じ。新しい依存は足さない。

**ストレージ**：Neon（Postgres 17）。表・列・索引は足さない（今ある`accounts`・`memberships`・`users`・`tester_applications`を読むだけ。[data-model.md](./data-model.md)）。

**テスト**：025と同じ構成。
- **API**：Vitest＋ローカルのPostgres。
  - 行の中身：接続方法・接続の状態・オーナー・テスター招待の状態（生きている申し込み／外してよい／なし）
  - 件数：方法ごと、要再接続は接続方法の側、検索しても変わらない
  - 絞り込み・検索（名前・@ユーザー名・オーナーの名前・メールアドレス、大文字・小文字を問わない、`%`・`_`をそのまま探す）
  - 並び（作った日の新しい順）と続きの読み込み
  - 運営者でなければ`403 OPERATOR_ONLY`
- **Web**：Vitest＋Testing Library。
  - 区分が運営者にだけ出る（「運営」の中、「テスター招待」の次）
  - タブの件数と絞り込み、検索、「ありません」、「もっと見る」
  - 行の表示（つなぐ前は「未接続」、テスター招待がなければ「—」）
- **E2E**：足さない。

**対象プラットフォーム**：Web＝Cloudflare Pages、API＝Cloudflare Workers。

**プロジェクトの種類**：Webアプリ（`apps/web`・`apps/api`・`packages/shared`のpnpmモノレポ）

**性能の目標**：1回の読み込みは、件数の問い合わせ1回と、1ページ（50件）の問い合わせ1回。今の規模（数十〜数百件）で、運営者の画面がすぐ出る。

**制約**：
- **運営者だけ**：今の`operatorOnly`を通す（`Cache-Control: no-store`）。画面の区分も運営者にだけ出す（FR-012）。
- **見るだけ**：書き込むAPIは作らない（FR-005・SC-005）。
- **中身を出さない**：投稿・戦略・結果は読まない（FR-006）。
- **見た目**：「テスター招待」の下線のタブと行の枠にそろえる。新しい強調の色や形は使わない（FR-013）。スマートフォンの幅では表をやめて行を段に分ける。

**規模**：API 1本、画面1つ、共有のスキーマ。

## Constitution Check

*GATE：Phase 0の前に確かめ、Phase 1の後にもう一度確かめた。Constitution 4.4.0。*

| 原則 | 確かめたこと | 結果 |
|---|---|---|
| I. NGワードの一貫性 | 変更なし（投稿に触れない） | 合格 |
| II. 人間承認ゲート | 変更なし | 合格 |
| III. 外部LLM前提 | 変更なし | 合格 |
| IV. 契約／ロール分離 | オーナーはアカウントの持ち主として出すだけ。契約・ロール・機能の設定を読まない・変えない | 合格 |
| V. 個人運用起点のシンプルさ | 利用者の画面は変えない。運営者の画面に、見るだけの区分を1つ足す | 合格 |
| VI. 改善フィードバック | 変更なし | 合格 |
| 技術スタック・運用コスト | 新しい依存・サービス・表を足さない | 合格 |
| 開発ワークフロー | spec-kitの順、計画の前にモックを作った。`feature/026-operator-accounts`→`develop`。マイグレーションなし | 合格 |

**Phase 1の後の確認**：data-model・contractsに、原則に反するものはない。

## プロジェクトの構成（Project Structure）

### 文書（このfeature）

```text
specs/026-operator-accounts/
├── spec.md
├── plan.md              # この文書
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   ├── api.md           # Phase 1
│   └── ui-routes.md     # Phase 1
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks で作る
```

### ソースコード（変更する主なところ）

```text
packages/shared/src/
├── operator-accounts.ts         # 新規：接続方法・テスター招待の状態の表示名、1ページの件数、検索語の長さ
└── schemas.ts                   # operatorAccountsQuerySchema・operatorAccountsSchema

apps/api/
├── src/services/operator-account-service.ts   # 新規：一覧・件数・続き
├── src/routes/operator-accounts.ts            # 新規：GET /api/operator/accounts
├── src/app.ts                                 # ルートをつなぐ
└── test/integration/operator-accounts.test.ts # 新規

apps/web/src/
├── pages/settings/operator-accounts.tsx       # 新規：アカウント一覧
├── pages/settings/sections.ts                 # 「運営」に「アカウント一覧」を足す
├── router.tsx                                 # /settings/operator-accounts
├── lib/api-client.ts・lib/query.ts            # operatorAccounts
└── test/operator-accounts.test.tsx            # 新規
```

**構成の判断**：
- 一覧は新しいサービスに置く（アカウント・オーナー・申し込みをまたいで読むため。申し込みのサービスは書き込みが主）。
- 件数と行は1本のAPIで返す（どのタブ・検索でも、同じ応答から件数を出せる。research.md R1）。

## 複雑さの記録（Complexity Tracking）

Constitutionの違反はないので、記録はない。
