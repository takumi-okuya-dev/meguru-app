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

1. [Clerkのダッシュボード](https://dashboard.clerk.com/)で「Create application」を選ぶ。
2. 名前（例：`ThreadsGrower`）を入れ、サインインの方法として**Googleだけ**を選んで作成する。

作成直後は**開発用インスタンス**（Development）になっています。開発用インスタンスでは、Clerkが用意した共有のGoogle認証情報が使われるので、Google Cloud側の設定は不要です（本番は「9. 本番公開時」を参照）。

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

「API keys」で次の2つを控えます。

| 名前 | 形 | 入れる先 |
|---|---|---|
| Publishable key | `pk_test_…` | `apps/web/.env.local`の`VITE_CLERK_PUBLISHABLE_KEY`、`apps/api/.dev.vars`の`CLERK_PUBLISHABLE_KEY` |
| Secret key | `sk_test_…` | `apps/api/.dev.vars`の`CLERK_SECRET_KEY`（**秘密情報。コミットしない**） |

---

## 3. Meta（Threadsアカウントの接続）

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

## 9. 本番公開時の追加作業（今は不要）

検証段階では不要です。Constitutionの`TODO(COMMERCIAL_LAUNCH_GATE)`の時点で行います。

- **Clerk**：本番インスタンスを作り、Google Cloud ConsoleでOAuthクライアント（種類は「ウェブアプリケーション」）を作成して、ClerkのGoogle接続で「Use custom credentials」をオンにする。Clerkの画面に出る「Authorized Redirect URI」を、Google側の「承認済みのリダイレクトURI」に登録する。
- **Meta**：App Review（各権限の用途の説明）と、必要に応じてビジネス認証。データ削除の状況確認ページの中身も、この時点で見直す（[research.md R7](../specs/001-login-account-setup/research.md)）。
- **Cloudflare**：APIをWorkersにデプロイし、秘密情報は`wrangler secret put`で設定する。WebはCloudflare Pagesにデプロイする。
- **Neon**：本番のDBを作り、`DATABASE_URL`を本番の接続文字列にする。
- 本番用のURLで、3-3の3つのURLと`THREADS_REDIRECT_URI`・`WEB_ORIGIN`を設定し直す。

---

## 参考（公式ドキュメント）

- [Threads API：Get Started](https://developers.facebook.com/docs/threads/get-started)
- [Threads API：Get Access Tokens and Permissions](https://developers.facebook.com/docs/threads/get-started/get-access-tokens-and-permissions)
- [Clerk：Add Google as a social connection](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/google)
- [Clerk：Customize your session token](https://clerk.com/docs/guides/sessions/customize-session-tokens)
- [Clerk：Playwright test helpers](https://clerk.com/docs/guides/development/testing/playwright/test-helpers)
- [Cloudflare：Create a locally-managed tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/create-local-tunnel/)
