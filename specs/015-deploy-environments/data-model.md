# データの設計（Phase 1）：公開のためのブランチと環境

**Feature**：[spec.md](./spec.md) | **調べ**：[research.md](./research.md)

この機能では、**DBの表・列を1つも足さない**（マイグレーションなし）。扱う「データ」は、環境ごとの設定と、その置き場所である。ここでは、何がどこに入るかを決める。

## 1. 環境（Environment）

| 環境 | ブランチ | WebのURL | APIのURL | 使う人 |
|---|---|---|---|---|
| 本番（production） | `main` | `app.<ドメイン>` | `api.<ドメイン>` | 一般のお客さま |
| ステージング（staging） | `develop` | `staging.<ドメイン>` | ステージングのAPIのURL | テストユーザー（許可した人だけ） |
| 開発（development） | `feature/*`・手元 | `localhost:5173` | `localhost:8787` | 開発者 |

- `<ドメイン>`は、計画の後にユーザーが買って決める（R6）。買うまでは、`*.pages.dev`・`*.workers.dev`の既定のURLで進められる（Clerkの本番インスタンスだけが、ドメインを待つ）。

## 2. 既存のデータとの関係

この機能で使う既存の仕組み（新しく作らない）。

| 既存のもの | どこ | この機能での使い方 |
|---|---|---|
| `users.billing_exempt`（013） | DB | ステージングのテストユーザーに「料金なしの印」を付ける（FR-031）。運用のスクリプトで付ける |
| `BILLING_ENABLED`（013） | 環境変数 | 両方の環境で`true`。鍵の違いで本番とテスト用環境を分ける（FR-030） |
| 自動投稿の関所（005のKV） | Cloudflare KV | 環境ごとに別のnamespace（FR-023） |
| マイグレーションの記録（Drizzle） | DB | 環境ごとのDBに、それぞれ記録が残る（R4） |

## 3. 環境ごとの設定の一覧

値の置き場所は3つ（R11）。**秘**＝秘密情報（リポジトリに置かない）。

### 3-1. APIが動くときに使う値（Cloudflare）

| 名前 | 本番 | ステージング | 置き場所 |
|---|---|---|---|
| `DATABASE_URL` | 本番のNeonのプロジェクト | ステージングのNeonのプロジェクト | 秘：`wrangler secret`（環境ごと） |
| `CLERK_SECRET_KEY` | 本番インスタンス | 開発用インスタンス | 秘：`wrangler secret` |
| `CLERK_PUBLISHABLE_KEY` | 本番インスタンス | 開発用インスタンス | `[env.*].vars` |
| `THREADS_APP_SECRET` | 同じMetaのアプリ | 同左 | 秘：`wrangler secret` |
| `THREADS_REDIRECT_URI` | `https://api.<ドメイン>/api/threads/callback` | ステージングのAPIのURL＋同じ道 | `[env.*].vars` |
| `THREADS_AUTH_BASE_URL`・`THREADS_GRAPH_BASE_URL` | 本物のThreads | 本物のThreads | `[env.*].vars` |
| `WEB_ORIGIN` | `https://app.<ドメイン>` | `https://staging.<ドメイン>` | `[env.*].vars` |
| `TOKEN_ENCRYPTION_KEY`・`TOKEN_ENCRYPTION_KEY_VERSION` | 本番の鍵 | ステージングの鍵（別の値） | 秘：`wrangler secret`／版は`vars` |
| `BILLING_ENABLED` | `true` | `true` | `[env.*].vars` |
| `STRIPE_SECRET_KEY` | `sk_live_…` | `sk_test_…` | 秘：`wrangler secret` |
| `STRIPE_WEBHOOK_SECRET` | 本番のWebhookの値 | テスト用環境のWebhookの値 | 秘：`wrangler secret` |
| `STRIPE_PRICE_ID`・`STRIPE_PORTAL_CONFIGURATION_ID`・`STRIPE_TAX_RATE_ID` | 本番のID | テスト用環境のID | `[env.*].vars` |
| `APP_ENV` | `production` | `staging` | `[env.*].vars`（記録に入れる。R8） |
| `AUTOPOST_KV` | 本番のnamespace | ステージングのnamespace | `[env.*].kv_namespaces` |
| Cron（`triggers`） | `0 18 * * *`・`*/5 * * * *` | 同じ | `[env.*].triggers` |

### 3-2. Webのビルドのときに使う値（GitHub Actions → Vite）

| 名前 | 本番 | ステージング | 置き場所 |
|---|---|---|---|
| `VITE_API_BASE_URL` | `https://api.<ドメイン>` | ステージングのAPIのURL | GitHubのEnvironmentの変数 |
| `VITE_CLERK_PUBLISHABLE_KEY` | 本番インスタンス | 開発用インスタンス | GitHubのEnvironmentの変数 |
| `VITE_APP_ENV` | `production` | `staging` | GitHubのEnvironmentの変数 |

`VITE_…`はビルドに焼き込まれるので、秘密を入れない（公開鍵だけ）。

### 3-3. デプロイのときに使う値（GitHub Actions）

| 名前 | 使い道 | 置き場所 |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | WorkersとPagesへのデプロイ | 秘：GitHubのEnvironment Secrets |
| `CLOUDFLARE_ACCOUNT_ID` | 同上 | GitHubのEnvironmentの変数 |
| `DATABASE_URL` | マイグレーションを当てる | 秘：GitHubのEnvironment Secrets |

## 4. 置き場所のきまり

- **リポジトリに秘密を置かない**（FR-024・SC-004）。`.dev.vars`・`.env.local`は今までどおり`.gitignore`の中。
- **環境の違いはコードの分岐にしない**（FR-025）。コードは環境変数を読むだけで、`if (本番)`のような分岐を増やさない。例外は、画面の帯（`VITE_APP_ENV`が`production`でないときだけ出す。R8）。
- **必要な値が欠けていたら起動を止める**（今のAPIの設定の確認と同じ）。新しく足す`APP_ENV`も、同じ確認に入れる。
