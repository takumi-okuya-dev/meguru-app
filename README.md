# ThreadsGrower App

Threadsアカウントを「投稿ストック→承認→自動投稿→分析→改善」のループで育てるためのアプリ。

- 由来: Obsidian vault `Wiki/仕事/システム開発/アイデア/Threads自動投稿アプリ.md`
- 既存の[threads-grower](https://github.com/MarronTaku/threads-grower)リポジトリ（spec-kit導入済み・実装進行中）とは**別プロジェクト**として並走する（2026-10-01、ユーザー確認済み）。
- 開発方法論: [BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD)でPRD/設計の叩き台を作成し、[spec-kit](https://github.com/github/spec-kit)で仕様→計画→タスク→実装を進める。

## 現在のフェーズ

- [x] リポジトリ作成・ローカルクローン
- [x] BMAD-METHODによるPRD/設計の叩き台作成
- [x] spec-kit導入・Constitutionの制定
- [x] feature 001「ログインとThreadsアカウント登録」：仕様・計画・タスク・実装（[specs/001-login-account-setup/](specs/001-login-account-setup/)）
- [ ] 本物のGoogle・Threadsでの手動確認（[quickstart.md](specs/001-login-account-setup/quickstart.md)「手動での確認」）
- [ ] 次のfeature（戦略プロファイル、投稿ストックなど）

## 構成

pnpm workspacesのモノレポ（[plan.md](specs/001-login-account-setup/plan.md)）。

| パス | 内容 |
|---|---|
| `apps/web` | Vite + React 19のSPA（Cloudflare Pages）。Clerkでログイン、shadcn/ui |
| `apps/api` | Cloudflare Workers + HonoのAPI。Drizzle + Neon（Postgres）、日次のCron Trigger |
| `packages/shared` | プランと上限、エラーコードと日本語の文言、APIの入出力スキーマ |
| `e2e` | PlaywrightのE2E（Threadsは偽サーバーで置き換え） |

## 開発環境の用意

### 必要なもの

- Node.js 22以上、pnpm 9（`npx pnpm@9`でも可）
- Docker（ローカルのPostgres 17と`local-neon-http-proxy`を起動する）
- 本物のThreadsで試す場合：`cloudflared`（Cloudflare Tunnel）

### 1. 依存とDB

```bash
pnpm install
docker compose up -d                      # Postgres 17（:5432）+ local-neon-http-proxy（:4444）
pnpm --filter api db:migrate              # マイグレーションの適用
```

### 2. 環境変数

```bash
cp apps/api/.dev.vars.example apps/api/.dev.vars    # 各項目は contracts/api.md「環境変数・Secret」
cp apps/web/.env.example apps/web/.env.local
```

- **Clerk**：開発用インスタンスを作り、ログイン手段は**Googleだけ**を有効にする（メール＋パスワードは無効）。
  - セッショントークンにメールアドレスと名前を含めると、APIが毎回Clerkに問い合わせずに済む（任意）。Clerkダッシュボードの「Sessions → Customize session token」に`{"email": "{{user.primary_email_address}}", "name": "{{user.full_name}}"}`を設定する。
- **鍵**：`TOKEN_ENCRYPTION_KEYS`と`IDENTIFIER_HASH_KEY`は`openssl rand -base64 32`で作る。
- **DATABASE_URL**：ローカルは`postgres://postgres:postgres@db.localtest.me:5432/threads_grower`（`local-neon-http-proxy`経由）。

### 3. 起動

```bash
pnpm dev     # web（http://localhost:5173）と api（http://localhost:8787）
```

### 本物のThreads（Meta）につなぐ場合

- Threadsのredirect URIはHTTPS必須で`localhost`は登録できない。Cloudflare Tunnelで固定のホスト名をローカルのAPI（`localhost:8787`）に向け、そのURLを`THREADS_REDIRECT_URI`とMetaのアプリ設定に登録する。
- Metaのアプリ設定には、リダイレクトのほかに**アンインストール**（`/api/threads/webhooks/uninstall`）と**データ削除**（`/api/threads/webhooks/data-deletion`）のcallback URLも登録する（登録しないと保存できない）。
- Meta App Reviewの前は、アプリのテスターに追加し、Threadsアプリの「設定 → アカウント → ウェブサイトのアクセス許可 → 招待」で承認したアカウントしか接続できない。
- 手順の全体は[quickstart.md](specs/001-login-account-setup/quickstart.md)を参照。

## テスト

```bash
pnpm --filter @threads-grower/shared test   # 共通パッケージ
pnpm --filter api test                      # API：unit と integration（Workers ランタイム上、ローカルDB、偽のThreadsサーバー）
pnpm --filter web test                      # Web：ガード・再試行・上限の案内
pnpm lint
pnpm typecheck
```

- APIのintegrationテストは`docker compose up -d`が前提。開始時にマイグレーションを適用し、偽のThreadsサーバーを起動する。

### E2E

Clerkの開発用インスタンスのキー（`apps/api/.dev.vars`と`apps/web/.env.local`）と、そのインスタンスに作ったテスト用ユーザーが必要。

```bash
export CLERK_PUBLISHABLE_KEY=pk_test_...   # @clerk/testing が使う
export CLERK_SECRET_KEY=sk_test_...
export E2E_CLERK_USER_EMAIL=e2e@example.com
pnpm --filter e2e exec playwright install chromium   # 初回のみ
pnpm e2e
```

- Playwrightが偽のThreadsサーバー（:8790）・API（Threadsを偽サーバーに向けた設定）・Webを起動する。DBはテストごとに空にする。

## 運営者用のスクリプト

```bash
# プランを手動で変える（課金 feature ができるまで）。接続先は DATABASE_URL_DIRECT（既定はローカル）
pnpm --filter api admin:set-plan <accountId> multi-account

# 暗号鍵のローテーション（research.md R5 の手順）
TOKEN_ENCRYPTION_KEYS='{"1":"…","2":"…"}' TOKEN_ENCRYPTION_KEY_VERSION=2 DATABASE_URL=… \
  pnpm --filter api admin:rotate-token-key
```
