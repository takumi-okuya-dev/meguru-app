# 契約：環境ごとの設定

**Feature**：[spec.md](../spec.md) | **値の一覧**：[data-model.md](../data-model.md) 3

## 1. `apps/api/wrangler.toml`の形

```toml
name = "threads-grower-api"          # 手元（wrangler dev）で使う
main = "src/index.ts"
compatibility_date = "…"
compatibility_flags = ["nodejs_compat"]

# 手元の設定（今までどおり）
[triggers]
crons = ["0 18 * * *", "*/5 * * * *"]
[[kv_namespaces]]
binding = "AUTOPOST_KV"
id = "0000…"
[vars]
…

# ステージング（develop）
[env.staging]
name = "threads-grower-api-staging"
[env.staging.triggers]
crons = ["0 18 * * *", "*/5 * * * *"]
[[env.staging.kv_namespaces]]
binding = "AUTOPOST_KV"
id = "<ステージングのnamespaceのid>"
[env.staging.vars]
APP_ENV = "staging"
…

# 本番（main）
[env.production]
name = "threads-grower-api"
[env.production.triggers]
crons = ["0 18 * * *", "*/5 * * * *"]
[[env.production.kv_namespaces]]
binding = "AUTOPOST_KV"
id = "<本番のnamespaceのid>"
[env.production.vars]
APP_ENV = "production"
…
```

**きまり**：名前付きの環境は一番上の設定を受け継がない（R3）。`triggers`・`kv_namespaces`・`vars`は、**両方の環境に書き切る**。書き忘れを見つけるため、検査のスクリプトを置く（[quickstart.md](../quickstart.md) 3-1）。

## 2. 設定の確認（APIの起動時）

今ある設定の確認に`APP_ENV`を足す。

- 値は`production`・`staging`・`development`のどれか。ほかの値や未設定なら`CONFIG_ERROR`で止める（手元は`development`を既定にする）。
- `BILLING_ENABLED`が`true`なら、Stripeの4つの値がそろっていることを確かめる（013の今のまま）。

## 3. Webのビルドの値

| 名前 | 使い方 |
|---|---|
| `VITE_API_BASE_URL` | APIのURL（今のまま） |
| `VITE_CLERK_PUBLISHABLE_KEY` | Clerkの公開鍵（今のまま） |
| `VITE_APP_ENV` | `production`・`staging`・`development`。帯の出し分けに使う（新規） |

`apps/web/.env.example`に`VITE_APP_ENV`を足し、手元の既定は`development`にする。

## 4. 外部サービスに登録するURL

| サービス | 本番 | ステージング |
|---|---|---|
| Clerk | 本番インスタンス（`app.<ドメイン>`。CNAMEは`clerk.`・`accounts.`） | 開発用インスタンス（許可したメールアドレスだけ） |
| Meta（Threads） | `https://api.<ドメイン>/api/threads/callback` | ステージングのAPIのURL＋同じ道（同じMetaのアプリに両方登録） |
| Stripe Webhook | 本番：`https://api.<ドメイン>/api/billing/webhook` | テスト用環境：ステージングのAPIのURL＋同じ道 |
| Cloudflare Pages | `app.<ドメイン>`（`main`） | `staging.<ドメイン>`（`develop`のブランチの別名。DNSはproxy（オレンジの雲）） |
