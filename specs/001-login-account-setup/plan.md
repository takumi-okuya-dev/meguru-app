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

**規模**：検証期間はユーザー数十人・1人あたりAccount最大5件。画面は5つ（ログイン、アカウント追加、Accountホーム、Account設定、データ削除の状況表示）。APIのエンドポイントは9つと、日次のCron。

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

**Phase 1の設計後の再確認**：設計（data-model.md、contracts/）で新たな違反は生じていない。

**PR #2のレビュー対応後の再確認（2026-10-01）**：データ削除要求でAccountを関連データごと削除する設計（research.md R7）、画面を開いたときの接続確認（R14）、世代番号による競合制御（R6）を追加した。いずれもConstitutionの原則・技術スタック制約の範囲内で、新たな違反はない。画面を開いたときのThreads APIの呼び出しは1回だけで、固定費$0の制約にも影響しない。

**PR #2の2回目のレビュー対応後の再確認（2026-10-01）**：世代番号を`accounts.connection_generation`へ移し（R6）、データ削除要求に`pending`のリース付き回収・Threadsユーザー単位のロックとtombstone・完了後の識別子の消去を追加した（R7・R8）。Cronは日次のまま増やしておらず、Neonの無料枠と固定費$0の制約にも影響しない。新しいSecret（`IDENTIFIER_HASH_KEY`）が1つ増えるだけで、新たな違反はない。

**PR #2の3回目のレビュー対応後の再確認（2026-10-01）**：データ削除の試行（webhook・Cronの再試行とも）を、ロック → 読み直し → 条件付きUPDATEでのclaim → 削除 → 完了の記録、という1つのトランザクションにまとめた（research.md R7）。DBの使い方が変わるだけで、構成・コスト・Constitutionへの影響はない。

**PR #2の4回目のレビュー対応後の再確認（2026-10-02）**：未完了の削除要求がある間は再接続を拒否する規則（research.md R7）、`open`の順序の保護（R10。5回目のレビューで、時刻ではなくタブごとのIDと連番に変更）、暗号鍵の鍵リングとローテーション手順（R5）を追加した。Secretが`TOKEN_ENCRYPTION_KEY`から鍵リングの`TOKEN_ENCRYPTION_KEYS`に変わり、運営者用スクリプトが1つ増える。構成・コスト・Constitutionへの影響はない。

**PR #2の5回目のレビュー対応後の再確認（2026-10-02）**：データ削除callbackの再送の重複排除（`request_fingerprint`）、AES-GCMのIVを暗号化ごとに乱数で作る規則（R5）、`open`の順序をタブごとのIDと連番で判定（R10）、接続中のAccount削除による作り直しの防止（`users.last_account_deleted_at`、R13）、上限5件のときの案内、識別用ハッシュの保持期間の正確化（R7）を反映した。DBの列が4つ増えるだけで、構成・コスト・Constitutionへの影響はない。

**PR #2の6回目のレビュー対応後の再確認（2026-10-02）**：tombstoneの規則を「未完了」か「認可の開始以降に完了」に改め、識別用ハッシュを完了から15分は残すようにした（R7）。アンインストール通知は、ユーザーが最後に認可した時刻（`threads_connections.authorized_at`）より古ければ適用しない（R7）。`open`の`clientId`はページの読み込みごとに作る（R10）。DBの列が1つ増えるだけで、構成・コスト・Constitutionへの影響はない。

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
│   ├── set-plan.ts                # 運営者がプランを手動で変える（research.md R9）
│   └── rotate-token-key.ts        # 古い鍵の暗号文を新しい鍵で暗号化し直す（research.md R5）
├── src/
│   ├── index.ts                   # Honoのアプリとscheduledハンドラー
│   ├── db/
│   │   ├── schema.ts
│   │   └── client.ts              # HTTP版とトランザクション用（WebSocket）のクライアント
│   ├── middleware/
│   │   └── auth.ts                # Clerkの検証とusers行のJIT作成
│   ├── routes/
│   │   ├── me.ts
│   │   ├── accounts.ts            # 取得・open・削除
│   │   ├── data-deletion.ts       # データ削除要求の状況確認
│   │   ├── threads-connect.ts     # connectとcallback
│   │   └── threads-webhooks.ts    # アンインストールとデータ削除
│   ├── services/
│   │   ├── account-service.ts     # 作成・更新・上限・削除・open（記録と接続確認）
│   │   ├── data-deletion.ts       # Metaのデータ削除要求の履行と再試行
│   │   ├── threads-oauth.ts       # state、認可URL、callbackの処理
│   │   └── token-refresh.ts       # 日次のCronの処理（connection_generationによる競合制御）
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
