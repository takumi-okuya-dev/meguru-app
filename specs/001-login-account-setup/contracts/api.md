# API契約：ログインとThreadsアカウント登録

**対象feature**：[spec.md](../spec.md) ／ **データモデル**：[data-model.md](../data-model.md)

`apps/api`（Cloudflare Workers + Hono）が公開するHTTPエンドポイントの契約。リクエストとレスポンスの形は`packages/shared`のスキーマで定義し、Webと共有する。

## 共通事項

- **ベースパス**：`/api`
- **認証**：「認証」欄が「必要」のエンドポイントは、`Authorization: Bearer <Clerkのセッショントークン>`を必須とする。検証に失敗したら`401 AUTH_REQUIRED`を返す。認証済みのリクエストでは、`users`行がなければ作る（data-model.md）。
- **CORS**：WebのオリジンだけをAllowする。
- **エラーの形**：

  ```json
  { "error": { "code": "ACCOUNT_LIMIT_REACHED", "message": "…" } }
  ```

  `message`は開発者向けの英文。画面に出す日本語の文言は、Webが`code`から引く（[ui-routes.md](./ui-routes.md)）。
- **秘密情報**：アクセストークン・認可コード・`state`の平文は、どのレスポンスにも含めない（FR-010）。

## 型

```ts
type Plan = "auto-only" | "auto-grower" | "multi-account" | "team";
type ConnectionStatus = "connected" | "needs_reconnect";

type AccountSummary = {
  id: string;
  username: string;            // Threadsのユーザー名（@なし）
  displayName: string | null;
  profilePictureUrl: string | null;
  plan: Plan;
  connectionStatus: ConnectionStatus;
  lastUsedAt: string | null;   // ISO 8601
};

type AccountLimit = {
  max: number;                 // 保有Accountの最上位プランから計算した上限
  used: number;                // ownerとして保有するAccount数
};
```

## エンドポイント

### GET /api/me

ログイン中のユーザーと、ログイン後の遷移先を返す（FR-004、FR-005）。

- **認証**：必要
- **200**：

  ```json
  {
    "user": { "id": "…", "email": "…", "displayName": "…" },
    "accounts": [ /* AccountSummary[]、last_used_atの新しい順 */ ],
    "landingAccountId": "…",
    "accountLimit": { "max": 1, "used": 1 }
  }
  ```

- `landingAccountId`は、Accountが0件のとき`null`になる。決め方はresearch.md R10を参照。

### PUT /api/me/last-account

Accountを切り替えたことを記録する（FR-007）。

- **認証**：必要
- **リクエスト**：`{ "accountId": "…" }`
- **204**：`users.last_account_id`と`accounts.last_used_at`を更新した
- **404 `ACCOUNT_NOT_FOUND`**：Accountがない、または自分のものではない

### GET /api/accounts/:accountId

Account 1件の詳細を返す。

- **認証**：必要
- **200**：`AccountSummary`
- **404 `ACCOUNT_NOT_FOUND`**

### POST /api/threads/connect

Threads接続フローを始め、認可URLを返す（FR-008、FR-017、FR-020）。

- **認証**：必要
- **リクエスト**：
  - 新規：`{ "mode": "new" }`
  - 再接続：`{ "mode": "reconnect", "accountId": "…" }`
- **200**：`{ "authorizeUrl": "https://threads.com/oauth/authorize?…" }`
  - WebはこのURLへ`window.location.assign`で遷移する。
  - `state`は有効期限10分、1回限り（research.md R4）。
- **409 `ACCOUNT_LIMIT_REACHED`**：`mode = new`で、上限に達している。認可には進ませない。
- **404 `ACCOUNT_NOT_FOUND`**：`mode = reconnect`で、Accountがない、または自分のものではない

### GET /api/threads/callback

Threadsの認可画面から戻ってくる先。ブラウザのトップレベル遷移で呼ばれるため、Clerkの認証は伴わない。本人の確認は`state`で行う（research.md R4）。

- **認証**：不要（`state`で検証）
- **クエリ**：
  - 許可されたとき：`code`、`state`
  - 拒否されたとき：`error`、`error_reason`、`state`
- **処理**：research.md R3・R8の手順で処理し、成功・失敗のどちらでもWebへ`302`でリダイレクトする。

| 結果 | リダイレクト先 |
|---|---|
| 新規作成に成功 | `{WEB_ORIGIN}/accounts/:accountId?connected=new` |
| 自分の既存Accountを更新（FR-013） | `{WEB_ORIGIN}/accounts/:accountId?connected=updated` |
| 再接続に成功 | `{WEB_ORIGIN}/accounts/:accountId/settings?connected=reconnect` |
| 失敗（新規フロー） | `{WEB_ORIGIN}/accounts/new?error=<code>` |
| 失敗（再接続フロー） | `{WEB_ORIGIN}/accounts/:accountId/settings?error=<code>` |
| `state`が無効で、どちらのフローか不明 | `{WEB_ORIGIN}/accounts/new?error=OAUTH_STATE_INVALID` |

- **このエンドポイントで起こるエラーコード**：

| code | 状況 | 対応する要件 |
|---|---|---|
| `THREADS_AUTH_CANCELLED` | ユーザーがThreads側で拒否した | US1 シナリオ4 |
| `OAUTH_STATE_INVALID` | `state`がない、期限切れ、使用済み | research.md R4 |
| `THREADS_AUTH_FAILED` | トークン交換に失敗した | FR-023 |
| `THREADS_PROFILE_FETCH_FAILED` | プロフィールを取得できなかった。Accountは作らない | spec エッジケース |
| `THREADS_ACCOUNT_TAKEN` | そのThreadsアカウントは別のユーザーが登録済み | FR-012 |
| `ACCOUNT_LIMIT_REACHED` | callback時の再判定で上限に達していた | FR-017 |
| `RECONNECT_ACCOUNT_MISMATCH` | 再接続で、元とは別のThreadsアカウントを認可した | FR-020 |

### DELETE /api/accounts/:accountId

Accountを削除する（FR-022）。

- **認証**：必要（ownerのみ）
- **リクエスト**：`{ "confirmUsername": "…" }`
- **204**：Account・接続情報・関連データを削除した。`last_account_id`が指していた場合はNULLになる
- **422 `CONFIRMATION_MISMATCH`**：`confirmUsername`がAccountの`username`と一致しない
- **404 `ACCOUNT_NOT_FOUND`**

## Metaからのcallback

Threadsアプリの設定に登録する（research.md R7）。どちらも`application/x-www-form-urlencoded`で`signed_request`を受け取り、App SecretのHMAC-SHA256で署名を検証する。検証に失敗したら`400`を返す。

### POST /api/threads/webhooks/uninstall

- **処理**：`threads_user_id`に一致するAccountを`needs_reconnect`にし、`threads_connections`の行を削除する。該当するAccountがなくても`200`を返す。
- **200**：本文なし

### POST /api/threads/webhooks/data-deletion

- **処理**：アンインストールと同じ処理をしたうえで、`threads_deletion_requests`に記録する。
- **200**：

  ```json
  { "url": "{WEB_ORIGIN}/data-deletion/<confirmation_code>", "confirmation_code": "…" }
  ```

  状況確認ページ（`/data-deletion/:code`）の中身は、`TODO(COMMERCIAL_LAUNCH_GATE)`の時点で作る。MVPでは「受け付けました」とだけ表示する。

## 定期処理（Cron Trigger）

HTTPエンドポイントではないが、外から観測できる振る舞いとしてここに記す。

- **スケジュール**：毎日18:00 UTC（03:00 JST）
- **処理**（research.md R6）：
  1. `expires_at`が7日以内で、`issued_at`から24時間以上経った接続のトークンを更新し、プロフィールも取り直す。
  2. 更新時に認証エラーが返った接続、または`expires_at`を過ぎた接続のAccountを`needs_reconnect`にする。
  3. 期限切れの`oauth_states`を削除する。
- 1件の失敗で全体を止めない。失敗した件数はログに出す（トークンは出さない）。

## 環境変数・Secret

| 名前 | 種別 | 説明 |
|---|---|---|
| `CLERK_SECRET_KEY` / `CLERK_PUBLISHABLE_KEY` | Secret / 変数 | Clerk |
| `THREADS_APP_ID` / `THREADS_APP_SECRET` | 変数 / Secret | Threadsアプリ |
| `THREADS_REDIRECT_URI` | 変数 | 例：`https://<api-host>/api/threads/callback`。Metaに登録した値と完全一致させる |
| `THREADS_AUTH_BASE_URL` | 変数 | 既定は`https://threads.com`。テストでは偽サーバーに向ける |
| `THREADS_GRAPH_BASE_URL` | 変数 | 既定は`https://graph.threads.com`。同上 |
| `TOKEN_ENCRYPTION_KEY` | Secret | 32バイトをbase64化した値 |
| `TOKEN_ENCRYPTION_KEY_VERSION` | 変数 | 例：`1` |
| `DATABASE_URL` | Secret | Neonの接続文字列 |
| `WEB_ORIGIN` | 変数 | CORSの許可とリダイレクト先 |
