# 実装計画（Implementation Plan）：公開のためのブランチと環境

**ブランチ**：`feature/015-deploy-environments` | **日付**：2026-10-18 | **仕様**：[spec.md](./spec.md)

**入力**：`specs/015-deploy-environments/spec.md`（Clarifications 2026-10-18を含む）、Constitution 4.0.2、[docs/next-features.md](../../docs/next-features.md)「C」、[specs/013-billing/notes.md](../013-billing/notes.md)「1」

## 概要（Summary）

`main`（本番）・`develop`（ステージング）・`feature/*`（開発）の3段構成にし、GitHub Actionsでの自動デプロイと、環境ごとの設定・秘密情報の分離を作る。コードは全ブランチで同じにし、違いは設定だけに置く。

- **ブランチ**：既定のブランチを`develop`にし、`main`・`develop`は直接のpushを禁止してPRだけにする。リリースは`develop`→`main`のPR、急ぎの修正は`main`から分けて後で`develop`へ戻す（research.md R1、[contracts/deploy.md](./contracts/deploy.md)）。
- **デプロイ**：`deploy.yml`を1本足し、`develop`→ステージング、`main`→本番。**マイグレーション → API → Web**の順で、失敗したらそこで止める。同じ環境へのデプロイは1つずつ（R2・R4）。
- **環境の分離**：`wrangler.toml`に`[env.staging]`・`[env.production]`を足す（名前付きの環境は一番上の設定を**受け継がない**ので、`vars`・`kv_namespaces`・`triggers`を書き切る）。Neonはプロジェクトを2つに分け、Clerkはステージング＝開発用インスタンス（許可したメールアドレスだけ）・本番＝新しい本番インスタンス（独自ドメイン）。MetaのアプリとStripeは1つずつで、URLと鍵を環境ごとに分ける（R3・R5・R6・R9・R10）。
- **決済**：コードは013のまま。ステージングはテスト用環境の鍵でON、テストユーザーには`users.billing_exempt`（013）で料金を求めない（R10）。
- **画面**：`VITE_APP_ENV`を見て、`production`以外で「テスト環境」の帯をいちばん上に出す。ステージングは検索に載せない（R8、[contracts/ui-routes.md](./contracts/ui-routes.md)）。
- **文書**：Constitutionの「ブランチ運用」を3段構成に直し、`docs/external-services-setup.md`「9」を、上から進めれば本番の設定が済む形に書き直す。
- **費用**：増えるのはドメイン代だけ（年に数千円）。ほかは無料の枠に収める（R12）。

## 技術コンテキスト（Technical Context）

**言語・バージョン**：TypeScript 6.0、Node.js 22 LTS（001〜014と同じ）。アプリのコードの変更は、帯と設定の確認だけ。

**主な依存**：新しい実行時の依存は足さない。CI/CDで`cloudflare/wrangler-action`（公式）を使う。

**ストレージ**：Neon（Postgres 17）。**この機能でのマイグレーションはなし**（表・列を足さない）。環境ごとに別のプロジェクトを使う（R5）。

**テスト**：
- Web：Vitest＋Testing Library。帯の出し分け（`VITE_APP_ENV`ごと）と、帯の並び。
- API：Vitest＋`@cloudflare/vitest-pool-workers`。`APP_ENV`の設定の確認。`wrangler.toml`の環境の項目がそろっているかの検査（ファイルを読む単体テスト）。
- E2E：変えない（手元で今までどおり流す）。デプロイの通しは手で確かめる（[quickstart.md](./quickstart.md) 3）。

**対象プラットフォーム**：Web＝Cloudflare Pages（1プロジェクト、`main`＝本番・`develop`＝ブランチの別名）、API＝Cloudflare Workers（環境ごとに別のWorker）。

**性能の目標**：`develop`・`main`へのマージから、その環境で新しい版を確かめられるまで10分以内（SC-001・SC-002）。今のCIが約15分なので、デプロイのワークフローはCIと別にして、ビルドとデプロイだけを行う。

**制約**：
- Constitutionの運用コスト制約（月額固定の費用は$0から）。**ドメイン代だけが増える**（R12。公開に必要で、ユーザーが決定）。
- 名前付きの環境は一番上の設定を受け継がない（R3）。書き忘れを検査で止める。
- ステージングの自動投稿は本物のThreadsへ出る（ユーザーの決定）。帯で分かるようにする。

**規模**：環境3つ、ワークフロー2本（既存のCI＋新しいデプロイ）、環境ごとの設定の値が約20。

## Constitution Check

*GATE：Phase 0の前に確かめ、Phase 1の後にもう一度確かめる。*

| 原則 | 確認 | 結果 |
|---|---|---|
| I. 人格・トーン・NGワードの一貫性 | 投稿の経路を変えない。ステージングでも同じNGワードの確認を通る | ✅ 影響なし |
| II. 人間承認ゲート | 承認の仕組みを変えない。ステージングでも承認なしには投稿されない | ✅ 影響なし |
| III. 外部LLM前提・API依存ゼロ | LLMの呼び出しを足さない | ✅ 影響なし |
| IV. 契約／ロール分離 | 権限の判定を変えない。決済の判定（013）もコードは変えず、鍵だけ環境で分ける | ✅ 影響なし |
| V. 個人運用起点のシンプルさ（YAGNI） | 画面に増えるのは帯1本だけ。個人運用の操作の手数を増やさない。環境の数は3つに留める | ✅ 適合 |
| VI. 改善フィードバックループ | 分析と改善の流れを変えない | ✅ 影響なし |
| 技術スタックの制約 | 新しいサービス・新しい実行時の依存を足さない（Cloudflare・Neon・Clerk・Stripe・GitHubのまま） | ✅ 適合 |
| 運用コスト制約（月額固定$0から） | ドメイン代（年に数千円）が増える | ⚠️ 下の「複雑さの記録」に記す |
| 開発ワークフロー（ブランチ運用） | Constitutionが「公開・課金の開始時に3段構成へ切り替える」と定めており、この機能がその切り替えそのもの。Constitutionの文面を今の形に直す（FR-050） | ✅ 適合（文面の更新を含む） |

**Phase 1の後の再確認**：設計（research.md・data-model.md・contracts/）を書いた後も、上の結果は変わらない。新しい表・新しい外部サービス・新しい権限の判定は増えていない。

## プロジェクトの構成

### この機能の文書

```text
specs/015-deploy-environments/
├── plan.md              # このファイル
├── research.md          # Phase 0：決めたことと理由（R1〜R13）
├── data-model.md        # Phase 1：環境ごとの設定と置き場所（DBの変更なし）
├── quickstart.md        # Phase 1：一度だけの準備と、確かめ方
├── contracts/
│   ├── deploy.md        # デプロイのワークフローとブランチのきまり
│   ├── environments.md  # wrangler.tomlの形・設定の確認・外部サービスのURL
│   └── ui-routes.md     # ステージングの帯と、検索に載せない指定
├── checklists/
│   └── requirements.md  # 仕様の品質チェック（specifyで作成）
└── tasks.md             # Phase 2（/speckit-tasksで作る。このコマンドでは作らない）
```

### 触るところ（リポジトリ）

```text
.github/workflows/
├── ci.yml                      # 直す：PRの行き先に develop を足す
└── deploy.yml                  # 新規：マイグレーション → API → Web

apps/api/
├── wrangler.toml               # 直す：[env.staging]・[env.production]
├── src/env.ts                  # 直す：Env に APP_ENV を足す
├── src/app.ts                  # 直す：設定の確認に APP_ENV を足す
├── src/lib/logger.ts           # 直す：記録に APP_ENV を入れる
├── .dev.vars.example           # 直す：APP_ENV を足す
└── test/
    ├── unit/wrangler-config.test.ts    # 新規：環境の項目がそろっているか
    └── integration/config.test.ts      # 直す：APP_ENV の確認

apps/web/
├── .env.example                # 直す：VITE_APP_ENV を足す
├── index.html                  # 直す：noindex の差し込み（ステージングのみ）
├── vite.config.ts              # 直す：VITE_APP_ENV による noindex の差し込み
├── src/components/layout/EnvBanner.tsx   # 新規：環境の帯
├── src/components/layout/AppShell.tsx    # 直す：帯をいちばん上に置く
├── src/pages/…（AppShellの外の画面）      # 直す：帯を出す
└── test/env-banner.test.tsx    # 新規

docs/
├── external-services-setup.md  # 直す：「9. 本番公開時の追加作業」を実際に使える形に
├── cost-estimate.md            # 直す：ドメイン代と2環境の見込み
└── next-features.md            # 直す：「C」をこのfeatureに移したと記す

.specify/memory/constitution.md # 直す：開発ワークフローのブランチ運用（MINOR改定）
README.md                       # 直す：ブランチの運用とデプロイの説明
```

**構成の判断**：新しいパッケージやサービスを足さない。変更は「設定・ワークフロー・文書」と、画面の帯1つ。

## 複雑さの記録（Complexity Tracking）

| 逸脱 | なぜ必要か | 退けた簡単な案 |
|---|---|---|
| 固定費が$0から増える（ドメイン代、年に数千円） | 商用公開にはClerkの本番インスタンスが要り、それには自分のドメインが要る（R6）。`*.accounts.dev`のままでは本番にできない | 既定のURL（`*.pages.dev`）のまま公開する案。Clerkが開発用インスタンス（利用者100人まで・開発用の鍵の警告）のままになり、商用公開に耐えない |
| 環境ごとにDBのプロジェクトを分ける（Neonのプロジェクトが2つ） | 本番の枠（CU-hours）と安全を、ステージングの実験と混ぜないため（R5） | 1つのプロジェクトのブランチで分ける案。保存は有利だが、枠を分け合い、接続先の取り違えも起きやすい |

## 次の段階

`/speckit-tasks`で、この計画から作業の一覧（tasks.md）を作る。作業は、(1)文書とConstitution、(2)`wrangler.toml`と設定の確認、(3)帯、(4)`deploy.yml`、(5)外部サービスの準備（人の手順）、の順に並べる見込み。
