# ステージングの構築記録

2026-10-31に、テストユーザー向けのステージングを立てたときの記録です。**何を作り、どこに何があり、どう確かめたか**を残します。

- これからやる手順は[外部サービスの準備手順](./external-services-setup.md) 9章（9-0-1）にあります。この文書は、実際にやった結果の記録です。
- 秘密の値はここに書きません。**どこに置いたか**だけを書きます。
- 本番を立てるときは、7章の「本番で違うところ」から読みます。

## 1. いまの状態

| | URL |
|---|---|
| Web | https://develop.threads-grower-web.pages.dev |
| API | https://threads-grower-api-staging.marron-taku.workers.dev |

- `develop`へのマージで自動でデプロイされる（`.github/workflows/deploy.yml`）。
- ログインの画面のいちばん上に「テスト環境です」の帯が出る。ログインしたあとのアプリの画面では、左下のユーザー名の横に「テスト版」と出る（2026-10-31に変更）。ログインはGoogle（Clerkの開発用インスタンス）。
- 決済はON。Stripeのテスト環境なので、お金は動かない。テストユーザーには料金なしの印を付ける（10-7）。
- Threadsへの接続は**トークンを貼る方法だけ**（`THREADS_CONNECT_METHODS = "token"`）。Metaの審査が通るまでの運用で、審査後もこの方法は残す。
- ClerkのAllowlistは**付けていない**。テストユーザーにバグを探してもらう段階のため（2026-10-31に決めた）。URLを知っていれば誰でもログインできる。広く招く前か本番の前に、見直す。

## 2. 作ったものの一覧

秘密ではない値（IDやURL）は、そのまま書いています。

| サービス | もの | 値・場所 |
|---|---|---|
| GitHub | リポジトリ | Organization `takumi-okuya-dev`（Teamのプラン）の`meguru-app`（2026-11-11に`threads-grower-app`から名前を変えた） |
| GitHub | ブランチ | `main`（本番）・`develop`（ステージング。既定のブランチ） |
| GitHub | Environment | `staging`は`develop`だけ、`production`は`main`だけが使える |
| GitHub | ルールセット | `main と develop を守る`（削除禁止・強制push禁止・PR必須・CIの`check`必須。管理者はPRからだけ例外にできる）。`main・develop という名前のタグを作らせない` |
| Cloudflare | アカウント | ID `6e6cd992a630d82ef7c0ef470cf16891`。workers.devのサブドメインは`marron-taku` |
| Cloudflare | Worker（API） | `threads-grower-api-staging`。定期実行は毎日18:00 UTCと5分ごと |
| Cloudflare | Pages（Web） | `threads-grower-web`（本番のブランチは`main`。ステージングは`develop`の別名） |
| Cloudflare | KV | ステージング`8721878c58494198ae62714a771f8829`、本番`e5fd38abb2a847b9a02588d9f2842d0b`（本番は箱だけ） |
| Neon | プロジェクト | `threads-grower-staging`（ID `autumn-salad-26780833`）。組織`org-bold-sky-22246902`。AWSシンガポール・Postgres 17。マイグレーション16件適用済み |
| Stripe | サンドボックス | 「アプリ開発サンドボックス」（`acct_1UWQTi450ulOJK91`） |
| Stripe | 料金 | `price_1UWWzr450ulOJK91LcANS5Ae`（毎月・JPY・段階制1,000円／2件目から500円・税込み） |
| Stripe | Webhook | `we_1UWX0b450ulOJK91aGfaumOL`（ステージングのAPIの`/api/stripe/webhook`へ8種類の知らせ） |
| Stripe | カスタマーポータル | `bpc_1UWX10450ulOJK91y7GJpDox`（サンドボックスの既定） |
| Clerk | インスタンス | 開発用インスタンス（`patient-lynx-8972`）。手元の開発・E2Eと同じもの |
| Meta | アプリ | ステージングでは使っていない（トークンを貼る方法だけのため） |

## 3. 秘密の値の置き場所

| 名前 | 置き場所 | 元 |
|---|---|---|
| `DATABASE_URL` | Cloudflareのシークレット（`--env staging`）・GitHubの`staging`のSecret | Neonの直接つなぐ接続文字列（`-pooler`なし） |
| `TOKEN_ENCRYPTION_KEYS`・`IDENTIFIER_HASH_KEY` | Cloudflareのシークレット | ステージング用に新しく作った。**控えはMacのキーチェーン**（アカウント名`threads-grower-staging`。「キーチェーンアクセス」で「threads-grower staging」と検索） |
| `CLERK_SECRET_KEY` | Cloudflareのシークレット | 手元の`apps/api/.dev.vars`と同じ（開発用インスタンス） |
| `STRIPE_SECRET_KEY` | Cloudflareのシークレット | Stripeのサンドボックスのシークレットキー（運営者が入れた） |
| `STRIPE_WEBHOOK_SECRET` | Cloudflareのシークレット | Webhookを作ったときの応答から、表示せずに入れた |
| `CLOUDFLARE_API_TOKEN` | GitHubの`staging`のSecret | Cloudflareのトークン`threads-grower-deploy`（Workers Scripts・Cloudflare Pages・Workers KV Storageの編集）。運営者が「パスワード」アプリにも控えた |
| `THREADS_APP_SECRET` | Cloudflareのシークレット（`--env staging`） | Metaアプリ「ThreadsAutomation」のシークレット。2026-11-08に入れた（specs/024。テスト版も「Threadsで許可する」を出すため要る） |
| `OPERATOR_CLERK_USER_IDS` | Cloudflareのシークレット（**016をマージするときに入れる**） | 運営者のClerkのユーザーID（`user_…`）。グループを作る・管理し、機能のまとまりをON/OFFする人（specs/016・019） |

GitHubの`staging`の変数は、`CLOUDFLARE_ACCOUNT_ID`・`VITE_API_BASE_URL`（APIのURL、`/api`なし）・`VITE_CLERK_PUBLISHABLE_KEY`・`VITE_APP_ENV`（`staging`）の4つです。

## 4. やったこと（順番どおり）

秘密の値は、どの作業でも画面とチャットに出していません。コマンドの出力から直接、次のコマンドへ渡しています。

### 4-1. GitHub

- リポジトリを個人のアカウントからOrganization`takumi-okuya-dev`へ移した（無料のプランでは、非公開のリポジトリでEnvironmentの秘密の値やブランチの保護が使えないため）。
- `develop`を`main`から作った。Environmentの値が空のうちは、`deploy.yml`は警告だけ出して成功で終わるので、早く作ってよい。
- Environmentの「Deployment branches and tags」と、ルールセット・既定のブランチは、`gh api`で設定した。

### 4-2. Cloudflare

```bash
pnpm --filter api exec wrangler login                 # ブラウザで許可
pnpm --filter api exec wrangler kv namespace create AUTOPOST_KV --env staging
pnpm --filter api exec wrangler kv namespace create AUTOPOST_KV --env production

# Pagesのプロジェクトは、設定ファイルのない空のフォルダーで --force を付けて作る（9-4）
cd /tmp/empty && <リポジトリ>/apps/api/node_modules/.bin/wrangler \
  pages project create threads-grower-web --production-branch main --force

pnpm --filter api deploy:staging                      # 最初のWorkerのデプロイ
```

### 4-3. Neon

ブラウザを操作する道具がないので、Neonの公式のコマンドラインツールで作った。

```bash
npx -y neonctl@8.15.1 auth                            # ブラウザで許可
npx -y neonctl@8.15.1 projects create --org-id org-bold-sky-22246902 \
  --name threads-grower-staging --region-id aws-ap-southeast-1 --pg-version 17 --set-context=false
URL=$(npx -y neonctl@8.15.1 connection-string --project-id autumn-salad-26780833)
DATABASE_URL_DIRECT="$URL" pnpm --filter api db:migrate
```

### 4-4. Stripe

アカウントは運営者が作った（「サブスクを作成」・「必要なものを選択」・「ダッシュボードで設定」を選んだ。Managed Paymentsは手数料が3.5%増えるので選ばない）。そのあとは、Stripe CLIでサンドボックスに作った。

```bash
brew install stripe/stripe-cli/stripe
stripe login                                          # 表示されたURLで「アプリ開発サンドボックス」だけを承認
stripe login --complete-device
stripe prices create -d currency=jpy -d "product_data[name]=ThreadsGrower" \
  -d "recurring[interval]=month" -d billing_scheme=tiered -d tiers_mode=graduated \
  -d "tiers[0][up_to]=1" -d "tiers[0][unit_amount]=1000" \
  -d "tiers[1][up_to]=inf" -d "tiers[1][unit_amount]=500" -d tax_behavior=inclusive
stripe webhook_endpoints create -d "url=<APIのURL>/api/stripe/webhook" \
  -d "enabled_events[]=checkout.session.completed" …（10-3の8種類）
stripe billing_portal configurations create \
  -d "features[payment_method_update][enabled]=true" -d "features[invoice_history][enabled]=true" \
  -d "features[subscription_cancel][enabled]=true" -d "features[subscription_cancel][mode]=at_period_end" \
  -d "features[subscription_update][enabled]=false" -d "features[customer_update][enabled]=false"
```

- Webhookの署名の秘密は、作成の応答から`wrangler secret put STRIPE_WEBHOOK_SECRET --env staging`へ直接渡した。
- 支払いの失敗の設定（10-5）は画面で確かめた。Smart Retries（2週間で最大8回）、すべて失敗したらサブスクリプションをキャンセル、最新の請求が払われたらアクティブ。メールは「有効期限が近いカード」「カード決済の失敗」をオン。
- 領収書のメール（設定 → ビジネス → 顧客へのメール → 成功した支払い）は、**サンドボックスでは自動で送られない**ので、本番で設定する。

### 4-5. 設定とシークレット

- `apps/api/wrangler.toml`の`[env.staging.vars]`に、Clerkの公開鍵・Stripeの料金ID・URL2つ・`THREADS_CONNECT_METHODS = "token"`を入れた（PR #24・#27・#28・#29）。
- Cloudflareのシークレットは`printf '%s' "$値" | wrangler secret put <名前> --env staging`の形で入れた。
- GitHubの`staging`のSecretは`gh secret set <名前> --env staging`、変数は`gh variable set`。**値は全部そろえてから入れる**（一部だけだと`deploy.yml`が止まる）。

### 4-6. Web

最初は手元からビルドして出した。今は`deploy.yml`が出す。

```bash
VITE_API_BASE_URL=<APIのURL> VITE_CLERK_PUBLISHABLE_KEY=<公開鍵> VITE_APP_ENV=staging \
  pnpm --filter web build
cd apps/api && pnpm exec wrangler pages deploy ../web/dist --project-name threads-grower-web --branch develop
```

## 5. 確かめたこと

| 確かめたこと | 結果 |
|---|---|
| `GET /api/me`（ログインなし） | 401 `AUTH_REQUIRED`（設定の誤りなら500 `CONFIG_ERROR`になる） |
| Webの場所からのCORSの事前確認 | 許可される。知らない場所からは許可されない |
| 署名のないStripeのWebhook | 400 |
| Threadsのアンインストールの通知（シークレットなし） | 400（PR #29の守り） |
| Webのトップ・`/accounts`などを直接開く | 200。`frame-ancestors 'none'`などのヘッダーが付く |
| ブラウザ（Playwright）で開く | 帯とGoogleのログイン画面が出る。コンソールのエラーなし |
| 本番のURL（`threads-grower-web.pages.dev`） | 404（まだ何も出していない） |

## 6. つまずいたところ

| 起きたこと | 対応 |
|---|---|
| 無料のプランでは、`deploy.yml`がEnvironmentの値を空と見て、何もせず成功で終わる | Organization（Team）に移した（9-0） |
| 手順書に「`develop`を先に作ると自動デプロイが失敗する」とあったが、誤りだった | 9-0-1の順番を直した（PR #25） |
| `apps/api`で`pages project create`を動かしたら、APIのコードをWebの名前で出そうとした（wrangler 4.146から新しいPagesはWorkersへ回される） | 空のフォルダーで`--force`（PR #26） |
| Neonに東京のリージョンがない。`--pg-version`を付けないと18になる | シンガポール・17で作り直した |
| トークンを貼る方法だけでも、MetaアプリのID・シークレットが必須になっていた | `app`を出すときだけ求めるようにした。シークレットが空のとき、偽のデータ削除の通知が通る穴も一緒に塞いだ（PR #29） |
| `deploy.yml`の「Webを出す」が、`wrangler`のない一番上で動いて失敗した | `apps/api`で動かすようにした（PR #31） |
| 費用の見積もりに、Stripe Billingの0.7%が抜けていた | 約4.3%に直した（PR #28） |
| whois.comは、空いているドメインにも「購入の申し出」を出す | ドメインの空きは、RDAP（`https://rdap.verisign.com/com/v1/domain/<名前>`。404なら空き）で確かめる |

## 7. 本番で違うところ

本番を立てるときは、9章を上から通します。ステージングと違うのは次の点です。

- **ドメイン**を買う（Clerkの本番インスタンスに要る）。名前に「Threads」を入れない（商標のため）。2026-10-31の時点では`postgrower.com`が空いていた。
- **Neon**：`threads-grower-production`を作る。無料のプランでは、**DBを戻せるのは6時間前まで**（[リリースの手順書](./release-runbook.md) 6-3）。足りるかを決める。
- **鍵**：`TOKEN_ENCRYPTION_KEYS`・`IDENTIFIER_HASH_KEY`は、本番用に新しく作る（ステージングと分ける）。控えをキーチェーンなどに残す。
- **Clerk**：本番インスタンス（`pk_live_`・`sk_live_`）。アプリ名を「My Application」から直す。
- **Stripe**：本番に切り替え、事業者の情報を入れる。料金・Webhook・ポータル・支払いの失敗の設定・**領収書のメール**を、本番側で作り直す。
- **GitHub**：Environment`production`に同じ6つの値を入れる（`CLOUDFLARE_API_TOKEN`は同じものを使える）。
- **`main`へ出す前に**、`develop`→`main`のリリースのPRで、ここまでの設定を`main`に追いつかせる（`main`の`wrangler.toml`は見本の値のまま）。
- **テスト用のグループ**：本番は`TEST_GROUPS_ENABLED = "false"`（誰でも登録できる。specs/016）。本番でもグループは作れるが、機能の設定にだけ使う（誰でも登録でき、入っても料金なしにならない。specs/019）。`OPERATOR_CLERK_USER_IDS`は、本番でグループや機能のまとまりのON/OFFを使うときだけ入れる。本番では、運営者になっても料金なしにはならない。
- **Threads**：審査前は`THREADS_CONNECT_METHODS = "token"`。審査が通ったら`app,token`にし、MetaアプリのID・シークレット・戻り先URLを入れ、Metaにコールバックの3つのURLを登録する（3-3・9-8）。
