# 確かめ方（quickstart）：公開のためのブランチと環境

**Feature**：[spec.md](./spec.md) | **契約**：[deploy.md](./contracts/deploy.md)・[environments.md](./contracts/environments.md)・[ui-routes.md](./contracts/ui-routes.md)

この機能は設定とワークフローが中心なので、「1回だけの準備」と「毎回の確かめ」に分ける。

## 1. 一度だけの準備（人がやる。順番どおりに）

実装の前後どちらでもよいが、**1-1〜1-3はデプロイを試す前に必要**。手順の詳しい画面の操作は、[docs/external-services-setup.md](../../docs/external-services-setup.md)の「9. 本番公開時の追加作業」に書き直す（T0xx）。

1. **ドメイン**：ドメインを1つ買い、CloudflareのDNSに載せる（ネームサーバーをCloudflareに向ける）。
2. **Neon**：プロジェクトを2つ作る（本番・ステージング）。それぞれの接続文字列を控える。ステージングにマイグレーションをすべて当てる。
3. **Cloudflare**：
   - **置き場所を作る**（このリポジトリはまだ一度もデプロイしていないので、実体がない）：Pagesのプロジェクトを作る（`pnpm --filter web exec wrangler pages project create threads-grower-web`。本番のブランチは`main`）。Workerは、最初の`wrangler deploy --env staging`／`--env production`で作られる。
   - デプロイ用のAPIトークンを作る（Workersの編集・Pagesの編集・KVの編集）。アカウントIDも控える。
   - Workersの環境ごとのKVを作る（`wrangler kv namespace create AUTOPOST_KV --env staging` / `--env production`）。出た`id`を`wrangler.toml`に入れる。
   - Pagesのプロジェクトに独自ドメインを当てる（本番＝`app.<ドメイン>`、ステージング＝`staging.<ドメイン>`をブランチの別名`develop`へ。DNSはproxy＝オレンジの雲）。
   - PagesのGit連携は使わない（Actionsからだけ出す）。Git連携で作っていたら切る。
4. **Clerk**：本番インスタンスを作り、`clerk.`・`accounts.`のCNAMEをDNSに足す。GoogleのOAuthを自分の認証情報に差し替える。ステージング（開発用インスタンス）は、許可したメールアドレスだけ登録できる設定にする。
5. **Meta**：今のアプリに、本番とステージングのコールバックのURLを両方登録する。
6. **Stripe**：本番の設定を「10. Stripe」の手順で作る（料金・Webhook・ポータル）。テスト用環境はそのまま使う。両方のWebhookのURLを、それぞれの環境のAPIに向ける。
7. **GitHub**：
   - Environmentを2つ作る（`staging`・`production`）。[data-model.md](./data-model.md) 3-3の値を入れる。
   - rulesetで`main`と`develop`を保護する（直接のpush禁止・PR必須・CI必須）。
   - 既定のブランチを`develop`にする。
8. **Cloudflareのシークレット**：`wrangler secret put <名前> --env staging|production`で、[data-model.md](./data-model.md) 3-1の「秘」の値を入れる。

## 2. 自動で確かめること（`pnpm test`に入る）

| 確かめること | どこ |
|---|---|
| `VITE_APP_ENV`が`staging`・`development`なら帯が出て、`production`なら出ない | `apps/web/test/env-banner.test.tsx` |
| 帯が、ほかの帯（無料体験・読むだけ・要再接続）より上に出る | 同上 |
| `APP_ENV`が無い・知らない値なら、APIが`CONFIG_ERROR`で止まる | `apps/api/test/integration/config.test.ts`（既存に足す） |
| `wrangler.toml`の`[env.staging]`・`[env.production]`に、`vars`・`kv_namespaces`・`triggers`がそろっている | `apps/api/test/unit/wrangler-config.test.ts`（新規） |

**SC-001・SC-002（10分以内）**は自動では測らない。3-2・3-3でマージからの時間を測り、[verification.md](./verification.md)（T050で作る）に記録する。

## 3. 手で確かめること

### 3-1. 設定の抜けがないか（デプロイの前）

- `pnpm --filter api exec wrangler deploy --env staging --dry-run`が通る。
- `pnpm --filter api exec wrangler deploy --env production --dry-run`が通る。

### 3-2. ステージングへのデプロイ（US1）

1. `feature/…`から`develop`へPRを出してマージする。
2. Actionsの`deploy.yml`（staging）が、マイグレーション → API → Webの順で成功する。
3. `staging.<ドメイン>`を開く。**テスト環境の帯**が出る。
4. 許可していないメールアドレスでは、ログイン（登録）できない。
5. テストユーザーでログインし、アカウントを作る → Threadsにつなぐ → 投稿を作る → 承認 → 時刻になると**実際に投稿される**。
6. ステージングで作ったデータが、本番のDBに入っていない。

### 3-3. 本番へのデプロイ（US2）

1. `develop`→`main`のPRを作ってマージする。
2. Actionsの`deploy.yml`（production）が成功する。
3. `app.<ドメイン>`を開く。**帯が出ない**。ログインできる。
4. 新しいマイグレーションがあれば、本番のDBに当たっている。

### 3-4. 失敗したときの振る舞い（SC-005）

- わざと失敗するマイグレーション（存在しない表を触るSQL）を`develop`に入れて流し、**APIとWebが入れ替わらない**ことを確かめる。確かめたら戻す。

### 3-5. ステージングの決済（US4）

1. ステージングで、テスト用のカード（`4242…`）で契約する → 「契約中」になる。
2. Stripeの**テスト用環境**に記録が残り、本番には何も起きていない。
3. 別のテストユーザーに「料金なしの印」を付ける → 契約なしで全機能を使える。

### 3-6. 急ぎの修正（US5）

1. `main`から`fix/…`を作り、`main`へのPRでマージする → 本番に出る。
2. 同じ修正を`develop`に入れる → `git log --oneline main ^develop`が空になる。

### 3-7. 文書（US6）

- Constitutionの「開発ワークフロー」を読み、PRの行き先・リリース・急ぎの修正が分かる。
- `docs/external-services-setup.md`の「9」を上から進めると、本番に必要な設定が抜けなく済む。

## 4. 公開の判断（この機能の外）

ここまで終われば「公開できる状態」になる。実際に公開する（本番のURLを配る）かは、ユーザーが決める。公開の前に、この機能の外で次が要る。

- MetaのApp Review（一般のお客さまが接続するため）
- 事業者としての手続き（適格請求書の登録の判断、特定商取引法に基づく表記の中身）
- 今の利用者（開発者・テストユーザー）への「料金なしの印」
