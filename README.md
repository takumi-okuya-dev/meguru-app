# ThreadsGrower App

Threadsアカウントを「投稿ストック→承認→自動投稿→分析→改善」のループで育てるためのアプリ。

- 由来: Obsidian vault `Wiki/仕事/システム開発/アイデア/Threads自動投稿アプリ.md`
- 既存の[threads-grower](https://github.com/MarronTaku/threads-grower)リポジトリ（spec-kit導入済み・実装進行中）とは**別プロジェクト**として並走する（2026-10-01、ユーザー確認済み）。
- 開発方法論: [BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD)でPRD/設計の叩き台を作成し、[spec-kit](https://github.com/github/spec-kit)で仕様→計画→タスク→実装を進める。

Claude CodeとCodexで開発スキルを共用する手順と、利用制限時の引き継ぎ方法は[AIスキルの共用](docs/ai-skills.md)を参照。

## 現在のフェーズ

- [x] リポジトリ作成・ローカルクローン
- [x] BMAD-METHODによるPRD/設計の叩き台作成
- [x] spec-kit導入・Constitutionの制定
- [x] feature 001「ログインとThreadsアカウント登録」：仕様・計画・タスク・実装（[specs/001-login-account-setup/](specs/001-login-account-setup/)）
- [ ] 本物のGoogle・Threadsでの手動確認（[quickstart.md](specs/001-login-account-setup/quickstart.md)「手動での確認」）
- [x] UI全体設計（ChatGPT風。[docs/ui-design.md](docs/ui-design.md)）
- [x] feature 002「戦略プロファイル（課題・宣伝内容・リサーチ）」：仕様・計画・タスク・実装（[specs/002-strategy-profile/](specs/002-strategy-profile/)）
- [ ] 次のfeature（003：AIプロンプト生成と投稿案の一括登録）

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

- Node.js 22以上
- pnpm 9。入っていなければ、次のどちらかで入れる（`pnpm -v`でバージョンが出ればよい）
  - `npm install -g pnpm@9.15.9`（`package.json`の`packageManager`と同じバージョン）
  - `brew install pnpm`
  - 入れずに試すだけなら、`pnpm`の代わりに`npx pnpm@9`と書いても動く
- Docker（ローカルのPostgres 17と`local-neon-http-proxy`を起動する）
- [Clerk](https://clerk.com/)のアカウント（無料。ログインに使うので、ローカルで動かすときも**必須**）
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

- **Clerk**：[Clerkのダッシュボード](https://dashboard.clerk.com/)で開発用インスタンスを作り、ログイン手段は**Googleだけ**を有効にする（メール＋パスワードは無効）。詳しい手順は[docs/external-services-setup.md](docs/external-services-setup.md)の「2. Clerk」。
  - ダッシュボードの「API keys」で、Publishable key（`pk_test_…`）を`apps/web/.env.local`の`VITE_CLERK_PUBLISHABLE_KEY`と`apps/api/.dev.vars`の`CLERK_PUBLISHABLE_KEY`に、Secret key（`sk_test_…`）を`apps/api/.dev.vars`の`CLERK_SECRET_KEY`に入れる。見本の値のままだと、画面が真っ白になる。
  - セッショントークンにメールアドレスと名前を含めると、APIが毎回Clerkに問い合わせずに済む（任意）。Clerkダッシュボードの「Sessions → Customize session token」に`{"email": "{{user.primary_email_address}}", "name": "{{user.full_name}}"}`を設定する。
- **鍵**：`TOKEN_ENCRYPTION_KEYS`と`IDENTIFIER_HASH_KEY`は`openssl rand -base64 32`で作る。
- **DATABASE_URL**：ローカルは`postgres://postgres:postgres@db.localtest.me:5432/threads_grower`（`local-neon-http-proxy`経由）。

### 3. 起動

```bash
pnpm dev     # web（http://localhost:5173）と api（http://localhost:8787）
```

- アプリは`http://localhost:5173`を開く。`http://localhost:8787`は画面を持たないAPIなので、ブラウザで開くと404になる（動作確認は`/api/health`）。
- `.env.local`や`.dev.vars`を書き換えたら、`pnpm dev`を止めて起動し直す。

### Metaなしで試す（偽のThreadsで動かす）

Metaのアプリ・Cloudflare Tunnelを用意する前でも、偽のThreadsサーバーで、接続・再接続・削除などの画面の流れを一通り試せる。必要なのはClerkだけ。

```bash
pnpm dev:fake    # 偽のThreads（:8790）・api（:8787）・web（:5173）をまとめて起動
```

- 「Threadsアカウントを接続」を押すと、「偽のThreads認可画面」が出る。「許可する」を押すと、テスト用のアカウント（`@e2e_user`）が接続済みになる。パスワードの入力はない。
- APIのThreadsの接続先と戻り先URLは、起動時に偽のサーバーへ切り替わる（`.dev.vars`に本物の値が入っていても上書きされる）。
- 偽のサーバーの中身は、起動し直すたびに消える。前回つないだAccountを開くと「要再接続」になるので、設定画面から再接続する。
- `pnpm dev`と同時には起動できない（ポートが重なる）。どちらか一方を止めてから起動する。
- 「要再接続」を試すには、別のターミナルで`curl -X POST localhost:8790/__control/invalidate -H 'Content-Type: application/json' -d '{"userId":"9001"}'`を実行してから、Accountの画面を開き直す。

### 本物のThreads（Meta）につなぐ場合

> Clerk・Meta・Cloudflare Tunnelの具体的な準備手順は[docs/external-services-setup.md](docs/external-services-setup.md)にまとめています。
>
> 利用者が自分のMetaアプリのトークンでアカウントを追加する機能（010）の、画面の手順の元とMetaの画面が変わったときの直し方は[docs/threads-token-guide.md](docs/threads-token-guide.md)。

- Threadsのredirect URIはHTTPS必須で`localhost`は登録できない。Cloudflare Tunnelで固定のホスト名をローカルのAPI（`localhost:8787`）に向け、そのURLを`THREADS_REDIRECT_URI`とMetaのアプリ設定に登録する。
- Metaのアプリ設定には、リダイレクトのほかに**アンインストール**（`/api/threads/webhooks/uninstall`）と**データ削除**（`/api/threads/webhooks/data-deletion`）のcallback URLも登録する（登録しないと保存できない）。
- Meta App Reviewの前は、アプリのテスターに追加し、Threadsアプリの「設定 → アカウント → ウェブサイトのアクセス許可 → 招待」で承認したアカウントしか接続できない。
- その間は`apps/api/.dev.vars`の`THREADS_ACCESS_MODE`を`testers`（既定）のままにする。アカウント追加画面に「招待されたアカウントのみ接続できます」の案内が出る。App Reviewに通り、Metaのアプリを公開したら`public`にすると案内が消える（[research.md R15](specs/002-strategy-profile/research.md)）。
- 手順の全体は[quickstart.md](specs/001-login-account-setup/quickstart.md)を参照。
- チーム運用（パートナー・編集者の招待と担当）の役割は[docs/team-roles.md](docs/team-roles.md)。流れはE2Eで自動で確かめられる（`pnpm e2e -- team`。下の「E2E」）。手で触るときは、`pnpm dev:fake`を起動した後に`pnpm team:open`で、3人がログインしたブラウザを並べて開ける（`--setup`を付けると、DBを空にしてパートナー・編集者の参加と担当まで済ませる）。3人のメールアドレスは`e2e/.env.local`に書く（`e2e/.env.example`）。自分のブラウザで手で開くときは、Cookieが分かれるように開く（Chromeの別のプロファイル・別のブラウザ。シークレットウィンドウ同士はログインを共有するので不可）。パートナー・編集者はThreadsに接続しないので、Metaのテスターの招待は要らない。偽のThreadsの認可画面では「@partner_co で許可する」などで2件目・3件目のアカウントを接続できる。手順は[008 quickstart.md](specs/008-team-operations/quickstart.md)。

## テスト

```bash
pnpm --filter @threads-grower/shared test   # 共通パッケージ
pnpm --filter api test                      # API：unit と integration（Workers ランタイム上、ローカルDB、偽のThreadsサーバー）
pnpm --filter web test                      # Web：ガード・再試行・上限の案内
pnpm lint
pnpm typecheck
```

- APIのintegrationテストは`docker compose up -d`が前提。開始時にマイグレーションを適用し、偽のThreadsサーバーを起動する。
- テスト用のDBは、作ったときに`docker/postgres-init/`でSCRAMの反復回数を1回にする（local-neon-http-proxyが1クエリごとに認証し直すため。既定のままでは結合テストが数倍遅い）。以前に作ったコンテナでは`docker compose exec -T postgres psql -U postgres -d threads_grower < docker/postgres-init/01-cheap-scram.sql`を1回実行する。

### E2E

Clerkの開発用インスタンスのキー（`apps/api/.dev.vars`と`apps/web/.env.local`）と、そのインスタンスに作ったテスト用ユーザーが必要。

```bash
export CLERK_PUBLISHABLE_KEY=pk_test_...   # @clerk/testing が使う
export CLERK_SECRET_KEY=sk_test_...
export E2E_CLERK_USER_EMAIL=e2e@example.com
pnpm --filter e2e exec playwright install chromium   # 初回のみ
pnpm e2e
```

- Playwrightが偽のThreadsサーバー（:8790）・API（Threadsを偽サーバーに向けた設定）・Webを起動する（`pnpm dev:fake`で起動中なら、それを使う）。DBはテストごとに空にする。ローカルの開発用のDBと同じなので、手で作ったデータも消える。
- チーム運用（`pnpm e2e -- team`）は、オーナー・パートナー・編集者の3人を別々のブラウザ（Cookieが別）でログインさせる。3人には、Clerk の開発用インスタンスに一度Googleでログインしたことのあるアカウントを使い、メールアドレスを`e2e/.env.local`の`E2E_OWNER_EMAIL`・`E2E_PARTNER_EMAIL`・`E2E_EDITOR_EMAIL`に書く（`e2e/.env.example`をコピー）。`@clerk/testing`がメールアドレスからユーザーを探し、ログイン用のチケットで入るので、Googleのパスワードは使わない（Googleだけでログインする設定では、APIで作ったユーザーはチケットでログインできないため）。
- Clerk のキーは、環境変数になければ`apps/api/.dev.vars`から読む。画面を見ながら流すときは`pnpm e2e -- team --headed`。
- `pnpm team:open`（`e2e/scripts/team-open.ts`）は、同じ3人でログインしたブラウザを左から並べて開き、そのまま手で操作できる（右下に役割の印）。`--setup`でDBを空にして、接続・パートナーの参加・編集者の参加と担当まで済ませてから開く。付けなければ今のデータのまま開く。`pnpm dev:fake`の起動が前提。

## コードの書き方

- 外部に公開している関数・クラス・型・定数には、JSDoc形式のドキュメントコメント（`/** … */`）を付ける。説明に加えて、引数は`@param`、戻り値は`@returns`、投げる例外は`@throws`で書く。
- TypeScriptなので、JSDocには型（`{string}`など）を書かない（[TypeScriptのハンドブック](https://www.typescriptlang.org/ja/docs/handbook/jsdoc-supported-types.html)）。
- `pnpm lint`（`eslint-plugin-jsdoc`）が付け忘れや`@param`の名前のずれを検出し、CIでも止まる。shadcn/uiから取り込んだ部品（`apps/web/src/components/ui/`）とテストは対象外。

## 運営者用のスクリプト

```bash
# プランを手動で変える（課金 feature ができるまで）。接続先は DATABASE_URL_DIRECT（既定はローカル）
pnpm --filter api admin:set-plan <accountId> multi-account

# 暗号鍵のローテーション（research.md R5 の手順）
TOKEN_ENCRYPTION_KEYS='{"1":"…","2":"…"}' TOKEN_ENCRYPTION_KEY_VERSION=2 DATABASE_URL=… \
  pnpm --filter api admin:rotate-token-key
```
