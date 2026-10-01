# 実装計画（Implementation Plan）：ログインとThreadsアカウント登録

**ブランチ**：`001-login-account-setup`（作業時は`feature/001-login-account-setup`を推奨。Constitution「開発ワークフロー」）| **日付**：2026-10-01 | **仕様**：[spec.md](./spec.md)

**入力**：`specs/001-login-account-setup/spec.md`の機能仕様

## 概要（Summary）

Googleアカウントでログインし、自分のThreadsアカウントを公式OAuthで接続してAccountとして登録できるようにする。アプリの他の機能すべての土台になる。

技術的な方針は次のとおり。

- **ログイン**：Clerk（Googleのみ）に任せる。
- **Threads接続**：Workers上のHonoが公式OAuthの認可コード方式で処理する。長期トークンはAES-256-GCMで暗号化してNeonに保存し、日次のCronで更新する。
- **登録数上限**：保有Accountの最上位プランで判定する。callback時にユーザー単位のロックをかけて再判定し、同時操作でも上限を超えないようにする。
- **画面**：左サイドバー＋右メインパネルの骨格を、このfeatureで確立する。

## 技術コンテキスト（Technical Context）

**言語・バージョン**：TypeScript 5.x（フロントエンド・バックエンドとも）。開発ツールはNode.js 22 LTS。

**主な依存**：
- **Web**：React 19、Vite、React Router v7（SPAモード）、TanStack Query、`@clerk/react` v6、shadcn/ui（Tailwind CSS v4）
- **API**：Hono、ClerkのバックエンドSDK（Hono用ミドルウェア）、Drizzle ORM、`@neondatabase/serverless`、zod
- **共通**：pnpm workspaces

**ストレージ**：Neon（Postgres 17）。テーブルは`users`、`accounts`、`memberships`、`threads_connections`、`oauth_states`、`threads_deletion_requests`（[data-model.md](./data-model.md)）。

**テスト**：
- API：Vitestと`@cloudflare/vitest-pool-workers`。DBはローカルのPostgresと`local-neon-http-proxy`。
- Web：VitestとTesting Library。
- E2E：Playwrightと`@clerk/testing`。
- Threads APIは偽サーバーに差し替える（research.md R12）。

**対象プラットフォーム**：WebはCloudflare Pages、APIはCloudflare Workers（Cron Triggersを含む）。ブラウザはモダンブラウザ（PC・スマートフォン）。

**プロジェクトの種類**：Webアプリ（SPA + API）

**性能目標**：
- ログインから最初のAccountの画面まで3分以内（SC-001。外部の画面での操作時間を含む）。
- 認証済みAPIはp95で500ms以内（Threads APIを呼ぶものを除く）。
- callbackの処理（トークン交換2回とプロフィール取得を含む）は5秒以内。

**制約**：
- 月額固定費$0（Cloudflare・Neon・Clerkの無料枠）。そのためセッションの最大有効期間は7日（research.md R2）。
- Threadsのredirect URIはHTTPS必須で、`localhost`は使えない（research.md R3）。
- トークンの平文をレスポンス・ログに出さない（FR-010）。

**規模**：検証期間はユーザー数十人・1人あたりAccount最大5件。画面は5つ（ログイン、アカウント追加、Accountホーム、Account設定、データ削除の受付表示）。APIのエンドポイントは8つと、日次のCron。

「要確認」の項目はなし（すべて[research.md](./research.md)で解消済み）。

## Constitutionとの整合（Constitution Check）

*ゲート：Phase 0の前に確認し、Phase 1の設計後に再確認する。*

| 原則・制約 | 判定 | 根拠 |
|---|---|---|
| I. 人格・トーン・NGワードの一貫性 | 該当なし（合格） | 本featureはThreadsへ何も配信しない。投稿用のスコープを要求するが、使うのは後続featureで、原則Iのチェックを経る |
| II. 人間承認ゲート | 該当なし（合格） | 投稿ストックも自動投稿も扱わない |
| III. 外部LLM前提・API依存ゼロ | 合格 | LLMの呼び出しはない |
| IV. プラン／ロール分離 | 合格 | `plan`は`accounts`だけ、`role`は`memberships`だけに持つ。`member`は作らない（data-model.md） |
| V. 個人プラン起点のシンプルさ | 合格 | Clerk Organizations・招待・ロール管理画面は作らない。Clerk webhook・管理画面・KMSも見送った（research.md R2・R5・R9） |
| VI. 改善フィードバックループの忠実性 | 該当なし（合格） | 分析・プロンプト生成を扱わない |
| 技術スタック制約 | 合格 | React + Vite（Pages）、Workers + Hono、Neon + Drizzle、Clerk、Cron Triggers、shadcn/ui、TypeScript統一。Stripeは課金featureで使う |
| 運用コスト制約（固定費$0） | 合格（specを1件修正） | セッション期間を30日から7日に変更した（Clerkの無料枠の既定値）。Cronは1日1回でNeonへの負荷は小さい |
| 開発ワークフロー | 注意 | 現在`main`にいる。実装の前に`feature/001-login-account-setup`を切ること |

**Phase 1の設計後の再確認**：設計（data-model.md、contracts/）で新たな違反は生じていない。データ削除callbackの厳密な対応は、`TODO(COMMERCIAL_LAUNCH_GATE)`の時点で見直す（research.md R7）。

## プロジェクト構成（Project Structure）

### ドキュメント（このfeature）

```text
specs/001-login-account-setup/
├── spec.md              # 機能仕様（/speckit-specify）
├── plan.md              # このファイル（/speckit-plan）
├── research.md          # Phase 0の出力
├── data-model.md        # Phase 1の出力
├── quickstart.md        # Phase 1の出力
├── contracts/           # Phase 1の出力
│   ├── api.md           #   HTTP APIとMetaのcallback、Cron
│   └── ui-routes.md     #   画面・遷移・表示文言
├── checklists/
│   └── requirements.md  # 仕様品質チェックリスト
└── tasks.md             # Phase 2の出力（/speckit-tasks。本コマンドでは作らない）
```

### ソースコード（リポジトリのルート）

```text
pnpm-workspace.yaml
package.json
docker-compose.yml                 # Postgres 17 + local-neon-http-proxy（開発・テスト用）

packages/shared/
└── src/
    ├── plans.ts                   # プランの順位・上限、上限の計算
    ├── errors.ts                  # エラーコードと日本語の表示文言
    └── schemas.ts                 # APIの入出力スキーマ（zod）

apps/api/                          # Cloudflare Workers + Hono
├── wrangler.toml                  # Cron Trigger（毎日 18:00 UTC）
├── drizzle/                       # マイグレーション
├── scripts/
│   └── set-plan.ts                # 運営者がプランを手動で変える（research.md R9）
├── src/
│   ├── index.ts                   # Honoのアプリとscheduledハンドラー
│   ├── db/
│   │   ├── schema.ts
│   │   └── client.ts              # HTTP版とトランザクション用（WebSocket）のクライアント
│   ├── middleware/
│   │   └── auth.ts                # Clerkの検証とusers行のJIT作成
│   ├── routes/
│   │   ├── me.ts
│   │   ├── accounts.ts
│   │   ├── threads-connect.ts     # connectとcallback
│   │   └── threads-webhooks.ts    # アンインストールとデータ削除
│   ├── services/
│   │   ├── account-service.ts     # 作成・更新・上限・削除
│   │   ├── threads-oauth.ts       # state、認可URL、callbackの処理
│   │   └── token-refresh.ts       # 日次のCronの処理
│   └── lib/
│       ├── threads-client.ts      # Threads APIの呼び出し（ベースURLを差し替えられる）
│       ├── crypto.ts              # AES-256-GCM
│       ├── signed-request.ts      # Metaのsigned_requestの検証
│       └── logger.ts              # 秘密情報をマスクするロガー
└── test/
    ├── fake-threads/              # 偽のThreadsサーバー（Hono）
    ├── integration/               # ルート単位（DBあり）
    └── unit/                      # crypto・plans・signed-requestなど

apps/web/                          # Vite + React SPA（Cloudflare Pages）
├── src/
│   ├── main.tsx
│   ├── router.tsx                 # ルートとガード（contracts/ui-routes.md）
│   ├── components/
│   │   ├── ui/                    # shadcn/ui
│   │   └── layout/                # AppShell、Sidebar、AccountSwitcher
│   ├── pages/
│   │   ├── sign-in.tsx
│   │   ├── landing.tsx            # 「/」の振り分け
│   │   ├── account-new.tsx
│   │   ├── account-home.tsx
│   │   ├── account-settings.tsx
│   │   └── data-deletion.tsx
│   └── lib/
│       ├── api-client.ts          # HonoのRPCクライアント + Clerkのトークン付与
│       └── query.ts
└── test/

e2e/                               # Playwright
```

**構成の決定**：Webアプリ型（SPA + API）を、pnpm workspacesのモノレポ（`apps/web`、`apps/api`、`packages/shared`）で構成する。理由はresearch.md R1を参照。

## 複雑さの記録（Complexity Tracking）

Constitutionの違反はないため記載なし。
