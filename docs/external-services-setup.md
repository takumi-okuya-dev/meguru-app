# 外部サービスの準備手順

feature 001「ログインとThreadsアカウント登録」を、本物のGoogle・Threadsでローカルから動かすための準備手順です。終わったら、[quickstart.md](../specs/001-login-account-setup/quickstart.md)の「手動での確認」に進めます。

各サービスの画面の項目名は、変更されることがあります。見つからないときは、手順の末尾にある公式ドキュメントを確認してください。

## 全体像

| 順番 | サービス | 何のために使うか | 作るもの | 値を入れる先 |
|---|---|---|---|---|
| 1 | Cloudflare Tunnel | Threadsの戻り先URLにHTTPSが必須で、`localhost`を登録できないため、ローカルのAPIを固定のHTTPSのURLで公開する | トンネルとホスト名（例：`api-dev.example.com`） | Metaのアプリ設定、`apps/api/.dev.vars` |
| 2 | Clerk | Googleでのログイン | アプリケーション（開発用インスタンス） | `apps/api/.dev.vars`、`apps/web/.env.local` |
| 3 | Meta（Threads） | Threadsアカウントの接続 | Threads APIを使うアプリ、テスター | `apps/api/.dev.vars` |
| 4 | （ローカル） | トークンの暗号化など | 鍵2つ | `apps/api/.dev.vars` |

Metaの設定でHTTPSのURLが必要になるので、**Cloudflare Tunnel → Clerk → Meta の順**に進めます。

### 事前に用意するもの

- **Cloudflareのアカウントと、Cloudflareで管理しているドメイン**（ネームサーバーをCloudflareに向けたもの）。持っていない場合は「1. Cloudflare Tunnel」の補足を参照。
- **Clerkのアカウント**（無料）
- **Metaの開発者アカウント**（Facebookのアカウントで登録する）
- **接続に使うThreadsアカウント**（自分の「たくみ」アカウントなど）
- **Googleアカウント**（ログインに使う）
- macOSにHomebrew、Docker（OrbStack）、Node.js 22以上、pnpm 9（入れ方はREADMEの「必要なもの」）

---

## 1. Cloudflare Tunnel（ローカルのAPIをHTTPSで公開する）

ローカルのAPI（`http://localhost:8787`）を、`https://api-dev.<自分のドメイン>`で外から呼べるようにします。以下、ホスト名を`api-dev.example.com`として書きます。自分のドメインに読み替えてください。

### 1-1. cloudflaredを入れてログインする

```bash
brew install cloudflared
cloudflared tunnel login
```

ブラウザが開くので、使うドメインを選んで許可します。`~/.cloudflared/cert.pem`ができれば成功です。

### 1-2. トンネルを作る

```bash
cloudflared tunnel create threads-grower-dev
```

表示されたトンネルのUUIDを控えます。`~/.cloudflared/<UUID>.json`（認証情報）もできます。

### 1-3. 設定ファイルを書く

`~/.cloudflared/config.yml`を作ります。`<UUID>`と`<ユーザー名>`は自分の値に置き換えます。

```yaml
tunnel: <UUID>
credentials-file: /Users/<ユーザー名>/.cloudflared/<UUID>.json
ingress:
  - hostname: api-dev.example.com
    service: http://localhost:8787
  - service: http_status:404
```

### 1-4. DNSに登録する

```bash
cloudflared tunnel route dns threads-grower-dev api-dev.example.com
```

Cloudflareに`api-dev.example.com`のCNAMEレコード（`<UUID>.cfargotunnel.com`向け）が自動で作られます。

### 1-5. 動作を確かめる

```bash
cloudflared tunnel run threads-grower-dev   # 開発中は起動したままにする
```

APIを起動した後（「6. 起動」）に、別のターミナルで次を実行し、`{"ok":true}`が返れば成功です。

```bash
curl https://api-dev.example.com/api/health
```

> **補足：Cloudflareで管理しているドメインがない場合**
> `cloudflared tunnel --url http://localhost:8787`で、一時的なURL（`https://<ランダム>.trycloudflare.com`）を発行できます。ただし起動するたびにURLが変わり、そのたびにMetaの設定と`.dev.vars`を書き換える必要があります。継続して使うなら、ドメインを1つCloudflareに移すほうが楽です。

---

## 2. Clerk（Googleでのログイン）

### 2-1. アプリケーションを作る

1. [Clerk](https://clerk.com/)にサインアップし、[Clerkのダッシュボード](https://dashboard.clerk.com/)を開く。
   - Clerkの管理画面に入るアカウントは、GitHub・Google・メールのどれで作ってもかまいません。アプリの利用者がログインする手段（次の手順で選ぶもの）とは別物です。
2. アプリケーションの作成画面で、次のように選んで「Create application」を押す。

| 項目 | 選ぶもの | 理由 |
|---|---|---|
| Select a project type | **Consumer** | B2Bを選ぶとClerkのOrganizations（組織・ロール）が有効になる。Organizationsは使わない。チーム運用のチーム・役割は、アプリのDBで管理する（2026-10-08決定。addendum「契約と役割の設計」） |
| Application name | `ThreadsGrower`など | 後から変えられる |
| Sign in options：Email | **オフ** | 初期状態はオン。オフにできなければ、作成後に2-2でオフにする |
| Sign in options：Phone number | オフ | |
| Sign in options：Username | オフ | |
| Sign in options：Google | **オン** | アプリのログイン手段はGoogleだけ（FR-001） |

作成直後は**開発用インスタンス**（Development）になっています。開発用インスタンスでは、Clerkが用意した共有のGoogle認証情報が使われるので、Google Cloud側の設定は不要です（本番は「9. 本番公開時」を参照）。

3. 作成すると「Add authentication to your app」という画面（Next.js・Reactなどを選び、AIエージェント向けのプロンプトをコピーする画面）が出ますが、**この画面の手順は飛ばします**。
   - このリポジトリにはClerkを組み込み済みです（Webは`@clerk/react`、APIは`@clerk/backend`）。
   - 「Copy prompt」でAIエージェントに貼ると、今の実装を書き換えてしまうおそれがあります。
   - 画面にある`http://localhost:3000`はNext.jsの既定のポートで、このアプリは`http://localhost:5173`です。
   - 必要なのはキーだけなので、左のメニューから「API keys」に進みます（2-4）。

### 2-2. ログイン手段をGoogleだけにする

1. 「SSO connections」でGoogleが有効になっていることを確かめる（なければ「Add connection」→「For all users」→「Google」）。
2. 「User & authentication」で、**メールアドレスでのサインイン（パスワード、メールの確認コード・リンク）をすべてオフ**にする。
   - メールアドレス自体は、Googleから受け取ってユーザーに保存されるので、項目として残しておいてかまいません。
   - 電話番号・ユーザー名でのサインインもオフにします。

`http://localhost:5173/sign-in`を開いたとき、「Googleで続ける」ボタンだけが出ていれば正しい設定です。

### 2-3. セッショントークンにメールアドレスと名前を含める（任意・推奨）

APIは、セッショントークンにメールアドレスが含まれていればそれを使い、なければClerkのAPIに問い合わせます。含めておくと問い合わせが減ります。

1. 「Sessions」を開き、「Customize session token」のClaimsに次を入れて保存する。

```json
{
  "email": "{{user.primary_email_address}}",
  "name": "{{user.full_name}}"
}
```

### 2-4. キーを控える

ダッシュボードの左のメニューの「**API keys**」（見つからなければ「Configure」の中）で、次の2つを控えます。

| 名前 | 形 | 入れる先 |
|---|---|---|
| Publishable key | `pk_test_…` | `apps/web/.env.local`の`VITE_CLERK_PUBLISHABLE_KEY`、`apps/api/.dev.vars`の`CLERK_PUBLISHABLE_KEY` |
| Secret key | `sk_test_…` | `apps/api/.dev.vars`の`CLERK_SECRET_KEY`（**秘密情報。コミットしない**） |

キーを入れたら`pnpm dev`を起動し直し、`http://localhost:5173`を開いてGoogleでログインします。最初にログインしたユーザーがClerkに登録され、作成直後の画面の「Watching for users」もそれを検知します。

---

## 3. Meta（Threadsアカウントの接続）

> ここは、このアプリのMetaアプリ（OAuthの「Threadsで許可する」）の準備です。利用者が自分のMetaアプリのトークンを貼り付ける方法（010）では、このアプリ側の準備は要りません。利用者向けの手順は`/guide/threads-token`、運営者向けの説明は[threads-token-guide.md](threads-token-guide.md)。

### 3-1. アプリを作る

1. [Meta for Developers](https://developers.facebook.com/apps/)で「アプリを作成」を選ぶ。
2. ユースケースで「**Threads APIにアクセス**」（Access the Threads API）を選ぶ。
3. アプリ名（例：`ThreadsGrower Dev`）と連絡先メールアドレスを入れて作成する。

作成後のアプリは**開発モード**です。この状態では、テスターとして招待したThreadsアカウントだけが接続できます（App Reviewは不要）。

### 3-2. 権限（スコープ）を追加する

「ユースケース」→「Threads APIにアクセス」の「カスタマイズ」→「アクセス許可」で、次の3つを追加します（[research.md R3](../specs/001-login-account-setup/research.md)）。

- `threads_basic`（必須）
- `threads_content_publish`（自動投稿で使う）
- `threads_manage_insights`（分析で使う）

### 3-3. 戻り先URLと通知先URLを登録する

同じ「カスタマイズ」の「設定」で、次の3つを登録して保存します。**3つとも登録しないと保存できません。**

| 項目 | 値 |
|---|---|
| リダイレクトコールバックURL（Redirect Callback URLs） | `https://api-dev.example.com/api/threads/callback` |
| アンインストールコールバックURL（Uninstall Callback URL） | `https://api-dev.example.com/api/threads/webhooks/uninstall` |
| 削除コールバックURL（Delete Callback URL） | `https://api-dev.example.com/api/threads/webhooks/data-deletion` |

- リダイレクトコールバックURLは、入力した後に**URLをクリックして確定**させないと保存されないことがあります。
- ここに入れた値と、`.dev.vars`の`THREADS_REDIRECT_URI`は、**1文字も違わずに一致**させます（末尾の`/`の有無も含めて）。

### 3-4. ThreadsのアプリIDとアプリシークレットを控える

同じ「設定」の画面に、**ThreadsアプリID**と**Threadsアプリシークレット**があります。

- Metaのアプリには、**FacebookのアプリIDとThreadsのアプリIDの2種類**があります。使うのは**Threadsのほう**です（ダッシュボード上部の「アプリID」ではありません）。

| 名前 | 入れる先 |
|---|---|
| ThreadsアプリID | `apps/api/.dev.vars`の`THREADS_APP_ID` |
| Threadsアプリシークレット | `apps/api/.dev.vars`の`THREADS_APP_SECRET`（**秘密情報。コミットしない**） |

### 3-5. テスターを招待し、承認する

1. Metaのダッシュボードで「アプリの役割」→「役割」→「メンバーを追加」→「**Threadsテスター**」を選び、接続したいThreadsアカウントのユーザー名を入れて招待する。
2. そのThreadsアカウントでThreadsアプリにログインし、「設定」→「アカウント」→「ウェブサイトのアクセス許可」→「招待」で、**招待を承認**する。

2件目のAccount（例：「AI部」アカウント）も試す場合は、そのアカウントも同じ手順でテスターにします。

---

## 4. 鍵を作る

トークンの暗号化（[research.md R5](../specs/001-login-account-setup/research.md)）と、データ削除のtombstone（R7）に使う鍵を作ります。

```bash
# トークンの暗号化の鍵（32バイト）
openssl rand -base64 32
# データ削除・取り消しのtombstone用の鍵（32バイト）
openssl rand -base64 32
```

| 名前 | 入れ方 |
|---|---|
| `TOKEN_ENCRYPTION_KEYS` | 1つ目の値を`{"1":"<値>"}`の形のJSONにして入れる |
| `TOKEN_ENCRYPTION_KEY_VERSION` | `1` |
| `IDENTIFIER_HASH_KEY` | 2つ目の値をそのまま入れる |

- 鍵を失うと、保存したThreadsのトークンを復号できなくなり、全Accountの再接続が必要になります。パスワードマネージャーなどに保管してください。
- 鍵を替えるときは、README「運営者用のスクリプト」の鍵のローテーションの手順に従います（いきなり置き換えない）。

---

## 5. 環境変数を入れる

### apps/api/.dev.vars

```bash
cp apps/api/.dev.vars.example apps/api/.dev.vars
```

| 名前 | 値 | どこで得たか |
|---|---|---|
| `CLERK_SECRET_KEY` | `sk_test_…` | 2-4 |
| `CLERK_PUBLISHABLE_KEY` | `pk_test_…` | 2-4 |
| `THREADS_APP_ID` | ThreadsアプリID | 3-4 |
| `THREADS_APP_SECRET` | Threadsアプリシークレット | 3-4 |
| `THREADS_REDIRECT_URI` | `https://api-dev.example.com/api/threads/callback` | 3-3と完全一致 |
| `TOKEN_ENCRYPTION_KEYS` | `{"1":"…"}` | 4 |
| `TOKEN_ENCRYPTION_KEY_VERSION` | `1` | 4 |
| `IDENTIFIER_HASH_KEY` | `…` | 4 |
| `DATABASE_URL` | `postgres://postgres:postgres@db.localtest.me:5432/threads_grower` | ローカルのDB（`local-neon-http-proxy`経由） |
| `WEB_ORIGIN` | `http://localhost:5173` | Webの開発サーバー |
| `BILLING_ENABLED` | `false`（決済を試すときは`true`） | 必須。10 |

`THREADS_AUTH_BASE_URL`と`THREADS_GRAPH_BASE_URL`は、本物のThreadsにつなぐ場合は書きません（`wrangler.toml`の既定値が使われます）。

### apps/web/.env.local

```bash
cp apps/web/.env.example apps/web/.env.local
```

| 名前 | 値 |
|---|---|
| `VITE_CLERK_PUBLISHABLE_KEY` | `pk_test_…`（2-4） |
| `VITE_API_BASE_URL` | `http://localhost:8787` |

- `VITE_API_BASE_URL`は`localhost`のままで問題ありません。トンネルを通すのは、Threadsからの戻り先（callback）とMetaからの通知だけです。
- ただしcallbackの後、APIは`WEB_ORIGIN`（`http://localhost:5173`）へリダイレクトします。**Threadsの認可は、Webを開いているのと同じPCのブラウザで行ってください。**

---

## 6. 起動して確かめる

```bash
docker compose up -d                    # ローカルのDB
pnpm install
pnpm --filter api db:migrate            # 初回とスキーマ変更時
pnpm dev                                # web（:5173）と api（:8787）
# 別のターミナルで
cloudflared tunnel run threads-grower-dev
```

1. `curl https://api-dev.example.com/api/health`が`{"ok":true}`を返すことを確かめる。
2. `http://localhost:5173`を開き、Googleでログインする。
3. 「Threadsアカウントを接続」→ Threadsの画面で許可 → Accountの画面に戻れば、準備は完了です。

続きは[quickstart.md](../specs/001-login-account-setup/quickstart.md)の「手動での確認」（US1〜US4）に沿って進めます。

---

## 7. E2Eテストを動かす場合（任意）

E2Eでは、Threadsは偽のサーバーに置き換わるので、Metaの設定は不要です。必要なのはClerkだけです。

1. Clerkのダッシュボードの「Users」→「Create user」で、テスト用のユーザーを作る（メールアドレスだけでよい。例：`e2e@example.com`）。
2. 次の環境変数を設定して実行する。

```bash
export CLERK_PUBLISHABLE_KEY=pk_test_...
export CLERK_SECRET_KEY=sk_test_...
export E2E_CLERK_USER_EMAIL=e2e@example.com
pnpm --filter e2e exec playwright install chromium   # 初回のみ
pnpm e2e
```

- テスト用ユーザーへのログインは、Clerkの`@clerk/testing`がメール確認などを経ずに行います。Googleのアカウントは不要です。
- E2EはDBを毎回空にします。手動確認で作ったデータも消えるので注意してください。

---

## 8. うまくいかないとき

まず`curl http://localhost:8787/api/health`を実行してください。設定に誤りがあれば、`"configErrors"`に誤っている項目名が出ます（値は出ません）。画面にも「サーバーの設定に誤りがあります（項目名）」と表示されます。

| 症状 | よくある原因 | 対処 |
|---|---|---|
| Threadsの画面で「リダイレクトURIが一致しない」などのエラー | 3-3の値と`THREADS_REDIRECT_URI`が1文字でも違う | 両方を見比べ、末尾の`/`やhttp/httpsも含めてそろえる |
| Threadsの画面でエラーになり、アプリに戻ってこない | 接続しようとしたThreadsアカウントがテスターでない、または招待を承認していない | 3-5をやり直す（Threadsアプリ側の承認を忘れやすい） |
| 戻ってきたら「Threadsとの接続に失敗しました」 | アプリIDやシークレットがFacebookのほうになっている | 3-4の**Threads**のアプリID・シークレットを使う |
| ログイン後、APIが401を返し続ける | `WEB_ORIGIN`と実際に開いているURLが違う（例：`127.0.0.1`で開いている） | `http://localhost:5173`で開く。`WEB_ORIGIN`と一致させる |
| ブラウザのコンソールにCORSのエラー | `WEB_ORIGIN`が違う、またはAPIが起動していない | `.dev.vars`を直し、`pnpm dev`を再起動する |
| `curl …/api/health`がつながらない | トンネルが起動していない、または`config.yml`のポートが違う | `cloudflared tunnel run`を起動し、`service: http://localhost:8787`を確かめる |
| APIの起動時に鍵のエラー | `TOKEN_ENCRYPTION_KEYS`がJSONになっていない、`TOKEN_ENCRYPTION_KEY_VERSION`の鍵がない | `{"1":"…"}`の形にし、バージョンを`1`にする |
| DBのエラー（テーブルがない） | マイグレーションが未適用、DBが起動していない | `docker compose up -d`の後に`pnpm --filter api db:migrate` |
| ログイン画面にGoogle以外の手段が出る | Clerkでメールアドレスでのサインインがオンのまま | 2-2をやり直す |

---

## 9. 公開のための準備（ステージングと本番）

**これは[specs/015-deploy-environments](../specs/015-deploy-environments/)の【人】の作業（全19件）の手順です。上から順に進めれば、ステージングと本番がそろいます。**

- 入れる値の一覧と置き場所は[data-model.md](../specs/015-deploy-environments/data-model.md) 3の表。
- 確かめ方は[quickstart.md](../specs/015-deploy-environments/quickstart.md) 3。
- 作業のIDは`specs/015-deploy-environments/tasks.md`のもの。終わったらそこに印を付けます。

### 9-0. 先に知っておくこと

- **このリポジトリは、まだ一度もデプロイしていません**。Cloudflare上にWorkerもPagesのプロジェクトも「ありません」。9-3で作ります。
- `apps/api/wrangler.toml`の`[env.staging]`・`[env.production]`には、**見本の値**（`pk_test_xxx`・`https://api.example.com`など）が入っています。本物に差し替えるまで、デプロイできてもAPIは`CONFIG_ERROR`で止まります（入れ忘れに気づくための仕掛けです）。
- **ドメインが決まるまで**は、Cloudflareの既定のURL（`*.pages.dev`・`*.workers.dev`）でステージングまで進められます。独自ドメインが要るのは、Clerkの本番インスタンス（9-7）だけです。
- 増える固定費は**ドメイン代（年に数千円）だけ**です（[docs/cost-estimate.md](./cost-estimate.md)）。

### 9-1. ドメインを買い、Cloudflareに載せる（T027）

1. ドメインを1つ買います（お名前.com・Cloudflare Registrarなど）。
2. CloudflareにサイトとしてSite（ゾーン）を追加し、**ネームサーバーをCloudflareに向けます**（買った先の管理画面で変更。反映に数時間かかることがあります）。
3. 名前を決めます。以降の`<ドメイン>`はこれです。

| 使い道 | 名前の例 |
|---|---|
| 本番のWeb | `app.<ドメイン>` |
| 本番のAPI | `api.<ドメイン>` |
| ステージングのWeb | `staging.<ドメイン>` |
| ステージングのAPI | `api-staging.<ドメイン>` |
| Clerkの本番インスタンス | `clerk.<ドメイン>`・`accounts.<ドメイン>`（CNAMEはClerkが指示） |

> ドメインを後回しにする場合は、9-1と9-7を飛ばし、ステージングまでを既定のURLで進めてください。

### 9-2. CloudflareのAPIトークンとアカウントID（T010）

1. Cloudflareのダッシュボード → 右上のアカウント → **API Tokens** → Create Token → Create Custom Token。
2. 権限（Permissions）を3つ付けます。

| 種類 | 対象 | 権限 |
|---|---|---|
| Account | Workers Scripts | Edit |
| Account | Cloudflare Pages | Edit |
| Account | Workers KV Storage | Edit |

3. 「Account Resources」は自分のアカウントだけに絞ります。作った**トークンの文字列は一度しか表示されません**。控えてください。
4. ダッシュボードの右側（またはWorkersの画面）にある**Account ID**も控えます。

### 9-3. KVを作る（T020・T029）

自動投稿の関所（specs/005）のKVを、環境ごとに作ります。**Workerを出す前に作ります**（`wrangler.toml`に書いた`id`のnamespaceが無いと、デプロイが拒まれます）。

```bash
# 最初に一度 `pnpm --filter api exec wrangler login`（ブラウザが開きます）
pnpm --filter api exec wrangler kv namespace create AUTOPOST_KV --env staging
pnpm --filter api exec wrangler kv namespace create AUTOPOST_KV --env production
```

表示された`id`を、`apps/api/wrangler.toml`の`[[env.staging.kv_namespaces]]`・`[[env.production.kv_namespaces]]`の`id`に入れます（`00000000000000000000000000000000`を差し替える）。変更はPRでマージします。

### 9-4. Cloudflareに置き場所を作る（T022）

ここで初めて、Cloudflare上に実体ができます。**9-3のKVの`id`を入れ終えてから**行います。

```bash
# 1) Pagesのプロジェクト（Webの置き場所）。本番のブランチは main
#    wrangler は apps/api の開発用の依存なので、--filter api から呼びます
pnpm --filter api exec wrangler pages project create threads-grower-web --production-branch main

# 2) ステージングのWorker（APIの置き場所）。最初のデプロイで作られる
pnpm --filter api deploy:staging
```

- 2)の時点では、環境変数が見本の値のままなので、APIを開いても`CONFIG_ERROR`になります。9-5以降で直します。
- **PagesのGit連携は使いません**（GitHub Actionsからだけ出します）。画面から作ってGit連携を付けてしまった場合は、Pagesの Settings → Builds & deployments で切ってください。

### 9-5. Neonのプロジェクトを2つ作る（T019・T028）

1. Neonで**プロジェクトを2つ**作ります（例：`threads-grower-staging`・`threads-grower-production`）。1つのプロジェクトのブランチで分けず、プロジェクトを分けます（枠と安全を分けるため。[research.md R5](../specs/015-deploy-environments/research.md)）。
2. それぞれの接続文字列（`DATABASE_URL`）を控えます。
3. ステージングにマイグレーションを当てます。

```bash
# drizzle-kit が読むのは DATABASE_URL_DIRECT（apps/api/drizzle.config.ts）
DATABASE_URL_DIRECT='<ステージングの接続文字列>' pnpm --filter api db:migrate
```

> 本番のマイグレーションは、`main`へのマージで`deploy.yml`が当てます（手で当てなくてよい）。

### 9-6. Cloudflareのシークレットを入れる（T021・T030）

[data-model.md](../specs/015-deploy-environments/data-model.md) 3-1の「秘」の値を、環境ごとに入れます。

```bash
cd apps/api
for name in DATABASE_URL CLERK_SECRET_KEY THREADS_APP_SECRET TOKEN_ENCRYPTION_KEYS IDENTIFIER_HASH_KEY STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET; do
  pnpm exec wrangler secret put "$name" --env staging      # 本番は --env production
done
```

- `TOKEN_ENCRYPTION_KEYS`・`IDENTIFIER_HASH_KEY`は、**環境ごとに別の値**を作ります（作り方は「4. 鍵を作る」）。
- 秘密でない値（`WEB_ORIGIN`・`THREADS_REDIRECT_URI`・`CLERK_PUBLISHABLE_KEY`・`THREADS_APP_ID`・`STRIPE_PRICE_ID`など）は、`wrangler.toml`の`[env.*].vars`を直してPRでマージします。

### 9-7. Clerk（T024・T031）

**ステージング（開発用インスタンス。T024）**

1. 今使っている開発用インスタンスの **Restrictions** で「Allowlist」を有効にし、テストユーザーのメールアドレスだけを許可します（許可していない人は登録できません）。
2. テストユーザーを登録（招待）します。

**本番（本番インスタンス。T031）**

1. Clerkで Production インスタンスを作ります。
2. Clerkが示す CNAME（`clerk.`・`accounts.`など）を、CloudflareのDNSに足します。
3. **GoogleのOAuthを自分の認証情報にします**：Google Cloud ConsoleでOAuthクライアント（種類は「ウェブアプリケーション」）を作り、ClerkのGoogle接続で「Use custom credentials」をオンにします。Clerkの画面に出る「Authorized Redirect URI」を、Google側の「承認済みのリダイレクトURI」に登録します。
4. 本番の`CLERK_SECRET_KEY`（9-6）と`CLERK_PUBLISHABLE_KEY`（`wrangler.toml`とGitHubの変数）を、本番インスタンスのものにします。

### 9-8. Meta（Threads）のコールバックURL（T025・T032）

**Metaのアプリは1つのまま**で、戻り先URLを両方登録します（アプリの設定 → Threads API → Redirect Callback URLs）。

| 環境 | 登録するURL |
|---|---|
| ステージング | `https://<ステージングのAPIのURL>/api/threads/callback` |
| 本番 | `https://api.<ドメイン>/api/threads/callback` |

同じ値を、`wrangler.toml`の各環境の`THREADS_REDIRECT_URI`にも入れます（**完全一致**でないとMetaが拒否します）。

### 9-9. Pagesに独自ドメインを当てる（T023・T032）

Pagesのプロジェクト → Custom domains。

| 環境 | 当てる名前 | 向き先 |
|---|---|---|
| 本番 | `app.<ドメイン>` | 本番（`main`） |
| ステージング | `staging.<ドメイン>` | ブランチの別名`develop` |

- **ステージングは、Pagesに名前を足すだけでは本番の版が出ます**。足した後に、CloudflareのDNSでその`staging`のCNAMEの**向き先を`develop.threads-grower-web.pages.dev`に書き換えます**（[Cloudflareの手順](https://developers.cloudflare.com/pages/how-to/custom-branch-aliases/)）。書き換えないと、ステージングのURLで本番のWeb（本番のAPIにつながる版）が出てしまいます。
- DNSは**proxy（オレンジの雲）**にします。
- APIのWorkerにも、Workers → 対象のWorker → Settings → Domains & Routes で`api.<ドメイン>`・`api-staging.<ドメイン>`を当てます。
- 当てたURLに合わせて、`wrangler.toml`の`WEB_ORIGIN`と、GitHubの変数`VITE_API_BASE_URL`を直します。

### 9-10. Stripe（T039・T040）

1. 本番の設定を「10. Stripe」の手順で作ります（料金・Webhook・ポータル）。テスト用環境はそのまま使います。
2. Webhookの送り先を、環境ごとに向けます。

| Stripeの環境 | Webhookの送り先 |
|---|---|
| テスト用環境 | `https://<ステージングのAPIのURL>/api/stripe/webhook` |
| 本番 | `https://api.<ドメイン>/api/stripe/webhook` |

3. `wrangler.toml`の`[env.staging].vars`・`[env.production].vars`の`STRIPE_PRICE_ID`（必要なら`STRIPE_PORTAL_CONFIGURATION_ID`・`STRIPE_TAX_RATE_ID`）を、それぞれの環境のIDにします。
4. 公開の前に、今の利用者（開発者・テストユーザー）に料金なしの印を付けます（10-7）。

### 9-11. GitHubのEnvironmentと変数（T011）

Settings → Environments で`staging`と`production`を作り、それぞれに入れます（[data-model.md](../specs/015-deploy-environments/data-model.md) 3-2・3-3）。

| 名前 | 種類 | staging | production |
|---|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Secret | 9-2のトークン | 同じ |
| `DATABASE_URL` | Secret | ステージングのNeon | 本番のNeon |
| `CLOUDFLARE_ACCOUNT_ID` | 変数 | 9-2のアカウントID | 同じ |
| `VITE_API_BASE_URL` | 変数 | ステージングのAPIのURL | `https://api.<ドメイン>` |
| `VITE_CLERK_PUBLISHABLE_KEY` | 変数 | 開発用インスタンスの公開鍵 | 本番インスタンスの公開鍵 |
| `VITE_APP_ENV` | 変数 | `staging` | `production` |

`VITE_…`はビルドに焼き込まれるので、**秘密を入れない**（公開鍵だけ）。

### 9-12. ブランチを守る（T012・T013）

1. `develop`ブランチを`main`から作ってpushします。

```bash
git checkout main && git pull && git checkout -b develop && git push -u origin develop
```

2. Settings → General → Default branch を**`develop`**にします（新しいPRの行き先が既定で`develop`になります）。
3. Settings → Rules → Rulesets で、`main`と`develop`に同じ規則を付けます。

- Restrict deletions
- Require a pull request before merging（直接のpushを禁止）
- Require status checks to pass → `check`（`ci.yml`のジョブ）

### 9-13. 確かめる

[quickstart.md](../specs/015-deploy-environments/quickstart.md) 3の手順を、上から行います（デプロイの通し・帯・許可していない人が入れないこと・決済・急ぎの修正）。**マージからその環境で見えるまでの時間**も測り、10分以内であることを記録します（SC-001・SC-002）。

### 9-14. 公開の判断（この機能の外）

ここまでで「公開できる状態」になります。実際に公開する（本番のURLを配る）前に、次が要ります。

- **Meta**：App Review（各権限の用途の説明）と、必要に応じてビジネス認証。データ削除の状況確認ページの中身も見直す（[001 research.md R7](../specs/001-login-account-setup/research.md)）。通ったら、`wrangler.toml`の本番の`THREADS_ACCESS_MODE`を`public`にします。
- **適格請求書（インボイス）**：適格請求書発行事業者に登録するかを決めます。登録したら、Stripeの本番の領収書・請求書の設定に登録番号（T＋13桁）を入れ、税率ごとの消費税の額が出ることを、テスト用環境の領収書で確かめます。登録しないなら、登録番号は載せません。どちらでも、アプリのコードと料金（税込み）は変わりません。
- **特定商取引法に基づく表記**：販売者の名前・住所・連絡先などを決め、`apps/web/src/lib/seller-info.ts`に入れます（013 FR-071）。住所・電話番号は「請求があれば遅滞なく開示します」と書く形も選べます。

---

## 10. Stripe（決済。specs/013-billing）

決済のON/OFFは、コードではなく環境の設定で切り替えます（research.md R11）。手元はふだん`BILLING_ENABLED=false`で、決済を試すときだけ`true`にします。

| 環境 | `BILLING_ENABLED` | Stripeのキー | Webhookの秘密 |
|---|---|---|---|
| 本番（`main`） | `true` | `sk_live_…` | 本番の宛先の`whsec_…` |
| ステージング（`develop`） | `true` | `sk_test_…`（テスト用環境） | ステージングの宛先の`whsec_…` |
| 手元・PRの確認 | `false`（試すときは`true`） | `sk_test_…` | `stripe listen`が出す`whsec_…` |

テストユーザーには、決済を止めるのではなく、料金なしの印を付けて払わずに使ってもらいます（10-7）。

### 10-1. テスト用環境と本番を分ける

Stripeのダッシュボードの左上で「テスト環境」（sandbox）と本番を切り替えます。10-2〜10-6は、テスト用環境と本番のそれぞれで行います。

### 10-2. 料金を作る

「商品カタログ」→「商品を追加」で、商品「ThreadsGrower」を作り、料金を次のとおりにします（research.md R3）。

- 料金体系：**段階制（graduated）**、毎月、JPY
- 1段目：1〜1件 **1,000円**
- 2段目：2件〜 **1件につき500円**
- 税：**内税（税込み）**

できた料金のID（`price_…`）を`STRIPE_PRICE_ID`に入れます。金額は`packages/shared/src/billing.ts`の`BILLING_BASE_PRICE_JPY`・`BILLING_EXTRA_PRICE_JPY`と同じ値にします。金額を変えるときは、両方と利用規約を直し、利用者に告知します。

### 10-3. Webhookの宛先を登録する

「開発者」→「Webhook」→「エンドポイントを追加」で、宛先を`<APIのURL>/api/stripe/webhook`にし、次の8つの知らせを選びます（research.md R5）。

`checkout.session.completed`・`customer.subscription.created`・`customer.subscription.updated`・`customer.subscription.deleted`・`customer.subscription.paused`・`customer.subscription.resumed`・`invoice.paid`・`invoice.payment_failed`

表示された署名の秘密（`whsec_…`）を`STRIPE_WEBHOOK_SECRET`に入れます。

手元では、Stripe CLIで転送します（表示された`whsec_…`を`.dev.vars`に入れる）。

```bash
stripe listen --forward-to localhost:8787/api/stripe/webhook
```

### 10-4. カスタマーポータルを設定する

「設定」→「Billing」→「カスタマーポータル」で、次のとおりにします（research.md R7）。

- 許す：支払い方法の変更、請求書・領収書の履歴、解約（**請求期間の終わりに**）、解約の取り消し
- 許さない：数量の変更、料金（プラン）の変更（数はアプリが決める）

別の設定を作ったときは、そのID（`bpc_…`）を`STRIPE_PORTAL_CONFIGURATION_ID`に入れます（なければ既定の設定が使われます）。

### 10-5. 支払いの失敗とメール

- 「設定」→「Billing」→「サブスクリプションとメール」→「支払いの再試行（Smart Retries）」をオンにし、**すべての再試行が失敗したらサブスクリプションをキャンセルする**にします。失敗した時点でアプリは読むだけになり、払えればすぐに戻ります（Clarifications 2026-10-15）。
- 同じ画面で、顧客へのメール（領収書・支払いの失敗・カードの期限切れ）をオンにします。アプリからはメールを送りません。

### 10-6. 環境変数を入れる

`apps/api/.dev.vars`（本番・ステージングは`wrangler secret put`）に入れます。

| 名前 | 値 | 必須 |
|---|---|---|
| `BILLING_ENABLED` | `true` | いつも（`true`か`false`） |
| `STRIPE_SECRET_KEY` | `sk_test_…`／`sk_live_…` | 決済ONのとき |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` | 決済ONのとき |
| `STRIPE_PRICE_ID` | `price_…` | 決済ONのとき |
| `STRIPE_PORTAL_CONFIGURATION_ID` | `bpc_…` | いいえ |
| `STRIPE_TAX_RATE_ID` | `txr_…`（10%・内税。適格請求書の登録をしたとき） | いいえ |

決済ONで鍵が欠けていると、APIは`CONFIG_ERROR`を返して止まります（黙って全員を無料にしません）。

偽のStripeで試すときは、`pnpm --filter api fake-stripe`で起動し（ポート8791）、`STRIPE_API_BASE_URL=http://localhost:8791`と、見本の形の値（`sk_test_`で始まる10文字以上など）を入れます。

### 10-7. 料金なしの印

開発者・テストユーザー・公開の前からの利用者には、料金なしの印を付けます（登録から1か月を過ぎた人は、印がないと読むだけになります）。

```bash
DATABASE_URL=… pnpm --filter api admin:set-billing-exempt <email> on   # 外すときは off
```

終わっていない契約がある人には、重ねて請求しないよう止まります。支払いの画面で解約してもらってから付けるか、`--force`を付けます。

### 10-8. 確かめる

[specs/013-billing/quickstart.md](../specs/013-billing/quickstart.md)の「手で確かめる」を、テスト用環境で行います（テスト用のカード`4242 4242 4242 4242`、支払いの失敗は`4000 0000 0000 0341`）。

---

## 参考（公式ドキュメント）

- [Threads API：Get Started](https://developers.facebook.com/docs/threads/get-started)
- [Threads API：Get Access Tokens and Permissions](https://developers.facebook.com/docs/threads/get-started/get-access-tokens-and-permissions)
- [Clerk：Add Google as a social connection](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/google)
- [Clerk：Customize your session token](https://clerk.com/docs/guides/sessions/customize-session-tokens)
- [Clerk：Playwright test helpers](https://clerk.com/docs/guides/development/testing/playwright/test-helpers)
- [Stripe：Create a Checkout Session](https://docs.stripe.com/api/checkout/sessions/create)
- [Stripe：Customer portal](https://docs.stripe.com/customer-management)
- [Cloudflare：Create a locally-managed tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/create-local-tunnel/)
