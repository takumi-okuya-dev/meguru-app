# 実装計画（Implementation Plan）：Threadsアプリをモジュラーモノリスに整理する

**ブランチ**：`feature/027-modular-monolith` | **日付**：2026-11-10 | **仕様**：[spec.md](./spec.md)

**入力**：`specs/027-modular-monolith/spec.md`（Clarifications 2026-11-10を含む）、Constitution 4.4.0、構想ノート（personal-knowledge-base「個人開発版Google Workspace構想（スイート型SaaS）」4・5・8章）

## 概要（Summary）

APIのコード（`apps/api/src`）を、土台・窓口・共通・アプリ（Threads）・組み立ての5つに分け、モジュールの入口と依存の向きをESLintの規則で守る。表の定義も持ち主のモジュールごとに分ける。利用者から見える動き・データベースの形・APIの入口は変えない。

- **モジュール地図**：42表の持ち主（共通17・Threads25）、処理とAPIの入口の行き先、`accounts`・`operator_settings`の例外の列を、`docs/module-map.md`にまとめる（[data-model.md](./data-model.md)が下書き）。
- **境界のチェック**：このリポジトリの中だけのESLintの規則`module-boundaries`で、入口の外・共通 → アプリ・アプリ同士・窓口と土台 → 上の4つを止める（[contracts/module-boundaries.md](./contracts/module-boundaries.md)）。
- **逆向きの依存の解消**：共通からThreadsを呼んでいる5か所のうち、接続の処理と確かめ待ちの件数の入口はThreadsへ移し、残りの3か所は共通の「知らせ」にする（同じ場所・同じトランザクションで呼ぶ。[research.md](./research.md) R4）。
- **動きを変えない確かめ**：今のテストを中身を変えずに通す、`db:generate`で変更なし、APIの入口の一覧のテスト（R7）。

## 技術コンテキスト（Technical Context）

**言語・バージョン**：TypeScript 6.0。Node.js 22 LTS。026と同じ。

**主な依存**：026と同じ。新しい依存は足さない（ESLintの規則はリポジトリの中に書く。R3）。

**ストレージ**：Neon（Postgres 17）。表・列・制約は変えない。マイグレーションなし（`db:generate`で変更なしを確かめる）。

**テスト**：
- 今あるテスト（共有512件・Web 751件・API 1,266件）を、読みこみ先だけ直してそのまま通す。
- 足すテスト：
  - ESLintの規則のテスト（`RuleTester`）：4つの違反の型と、通る例。新しいアプリのフォルダーにも当たること
  - 知らせのテスト：登録した順に呼ぶ・例外を返す・登録がなければ何もしない
  - APIの入口の一覧のテスト（`test/repo/routes-snapshot.test.ts`）
- **E2E**：足さない。

**対象プラットフォーム**：Web＝Cloudflare Pages、API＝Cloudflare Workers（デプロイの単位は変えない）。

**プロジェクトの種類**：Webアプリ（`apps/web`・`apps/api`・`packages/shared`のpnpmモノレポ）。今回触るのは`apps/api`と、ルートの`eslint.config.js`・`eslint-rules/`・文書だけ。

**性能の目標**：変えない（同じ処理を同じ順で呼ぶ。知らせは関数の呼び出しが1段増えるだけ）。

**制約**：
- **動きを変えない**：画面・APIの入口と応答・料金・データ・定期処理（spec FR-011〜FR-014）。
- **小さく安全に動かす**：ファイルの移動は`git mv`で行い、読みこみ先の直しは機械的に行う（移動の前後で中身を変えない）。中身を変えるのは、接続の処理の移動（R4-1）と、知らせへの置き換え（R4-2〜5）と、`readOperatorSettings`の移動だけ。
- **各コミットで全部通る**：並べ替えのPRの中の3つの段階（土台・窓口 → 逆向きの依存の解消と共通 → Threads）ごとに、型の確認・ESLint（境界の規則を含む）・テストを通す。境界の規則はPR1で入れ、モジュールのフォルダーができた順に効き始める。
- **テストは境界の外**：テストと`scripts/`は、新しい置き場所を直接読んでよい。

**規模**：移動するファイル約90、テストの読みこみ先の直し約64ファイル、新しいファイル（入口・知らせ・規則・地図）約10。

## Constitution Check

*GATE：Phase 0の前に確かめ、Phase 1の後にもう一度確かめた。Constitution 4.4.0。*

| 原則 | 確かめたこと | 結果 |
|---|---|---|
| I. NGワードの一貫性 | 投稿の処理は場所が変わるだけで、中身を変えない | 合格 |
| II. 人間承認ゲート | 確かめる・承認の処理は場所が変わるだけ | 合格 |
| III. 外部LLM前提 | 変更なし | 合格 |
| IV. 契約／ロール分離 | 契約（billing）とロール（access・teams）は、共通の中で別の小分けのまま | 合格 |
| V. 個人運用起点のシンプルさ | 利用者から見える変化はない。汎用の基盤は作り込まず（新しい表・仕組みなし）、Threadsの中で責務を分けるだけ | 合格 |
| VI. 改善フィードバック | 変更なし | 合格 |
| 技術スタック・運用コスト | 新しい依存・サービスを足さない。Workers・Hono・Neon・Drizzle・Clerk・Stripeのまま | 合格 |
| 開発ワークフロー | spec-kitの順。`feature/027-modular-monolith`→`develop`。モジュールの決まりを技術スタック制約に書き足す（spec FR-017）ため、Constitutionを改める（PATCHまたはMINOR。実装の中で`/speckit-constitution`の手順で行う） | 合格（改定を伴う） |

**Phase 1の後の確認**：data-model・contractsに、原則に反するものはない。Constitutionへの書き足しは、決まりを記録するもので、原則を変えない。

## プロジェクトの構成（Project Structure）

### 文書（このfeature）

```text
specs/027-modular-monolith/
├── spec.md
├── plan.md              # この文書
├── research.md          # Phase 0
├── data-model.md        # Phase 1（モジュール地図の下書き）
├── quickstart.md        # Phase 1
├── contracts/
│   └── module-boundaries.md   # Phase 1
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks で作る
```

### ソースコード（並べ替えのあと）

```text
eslint-rules/
└── module-boundaries.js           # 新規：境界の規則（R3）
eslint.config.js                   # apps/api/src に規則をかける

apps/api/src/
├── index.ts・app.ts               # 組み立て（registerThreads() を呼ぶ）
├── jobs/daily-jobs.ts             # 組み立て（共通とThreadsの毎日の処理）
├── db/schema.ts                   # 共通とThreadsの schema を読み直して出すだけ
├── kernel/                        # 土台：env・config・errors・logger・validate・crypto・identifier-hash・db/client・db/locks
├── adapters/
│   ├── stripe/                    # index.ts・stripe-client.ts
│   └── threads-api/               # index.ts・threads-client.ts・signed-request.ts
├── platform/
│   ├── index.ts                   # 共通の入口
│   ├── schema.ts                  # 共通の17表
│   ├── hooks.ts                   # 知らせ（R4）
│   ├── identity/・access/・accounts/・teams/・billing/・features/
│   ├── test-groups/・operator/・referrals/・activity/・withdrawal/
│   └── （各小分けに services と routes）
└── apps/
    └── threads/
        ├── index.ts               # Threadsの入口（routes と registerThreads）
        ├── schema.ts              # Threadsの25表
        └── connection/・strategy/・drafts/・publish/・metrics/・mention/
            external-media/・tester-invites/・operator/

docs/
├── module-map.md                  # 新規：モジュール地図の正本（FR-001〜FR-005・FR-015）
└── architecture.md                # モジュールの決まりを書き足す（FR-017）
```

**構成の判断**：
- 入口は共通全体・アプリごと・窓口ごとに1つ（R2）。共通の中の小分けの区切りは、2作目で見直す。
- `db/schema.ts`は残して、drizzle-kitの設定とテストの読みこみ先を変えない（R6）。
- PRは2つ（R8）：PR1＝地図・決まり・規則・入口の一覧のテスト、PR2＝並べ替え（3つの段階ごとのコミット）。

## 複雑さの記録（Complexity Tracking）

| 違反・複雑さ | 必要な理由 | もっと簡単な案を取らない理由 |
|---|---|---|
| 「知らせ」の仕組み（関数を登録して呼ぶ） | 共通 → アプリの依存の向きを守り、同じトランザクションで呼ぶ動きを変えないため | 共通からThreadsの入口を直接呼ぶと、向きの違反が残る。非同期のイベントにすると動きが変わる |
| リポジトリの中だけのESLintの規則 | アプリを足しても設定を変えずに、4つの型の違反を止めるため | 標準の`no-restricted-imports`では「自分以外のアプリ」を書き分けにくい。外部のプラグインは依存が増える |
