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
- **設定の確認**（2026-10-02に追加）：リクエストを受けたら、環境変数・Secretが使える形かを確かめる（未設定・見本の値・形の誤り。ThreadsのアプリID・シークレット・戻り先URLは、接続先が本物のThreadsのときだけ確かめる）。誤りがあれば、どの項目が悪いかをログに1回出し、`500 CONFIG_ERROR`を返す。`details`には誤っている**項目名だけ**を入れ、値は入れない。ブラウザが遷移してくる`GET /api/threads/callback`だけは、`{WEB_ORIGIN}/accounts/new?error=CONFIG_ERROR`へリダイレクトする。

  ```json
  { "error": { "code": "CONFIG_ERROR", "message": "server configuration error", "details": ["IDENTIFIER_HASH_KEY"] } }
  ```
- **秘密情報**（FR-010）：
  - アクセストークン、認可コード、App Secretは、どのレスポンスにも含めない。
  - `state`は例外で、`POST /api/threads/connect`のレスポンスの`authorizeUrl`の中にだけ含める（OAuthの仕組み上、ブラウザに渡す必要がある）。それ以外のレスポンスには含めない。
  - 上記すべて（`state`と`authorizeUrl`を含む）は、ログ・エラーメッセージに出さない。

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

### GET /api/health

動作確認用。認証不要。設定に誤りがなければ`{ "ok": true }`を返す。

誤りがあるときに返すものは`APP_ENV`で分かれる。手元の開発（`development`）では`{ "ok": false, "configErrors": ["…"] }`（項目名だけ。値は返さない）、それ以外の環境では`{ "ok": false }`のみ。この経路は無認証で、設定が壊れている間も答え続けるので、公開された環境では「どの秘密が未設定か」を資格情報のない相手に渡さない（セキュリティ監査run-1）。項目名は運用者向けにサーバーのログへ出る。

`CONFIG_ERROR`の応答本文も同じ分かれ方で、`error.details`は`development`のときだけ入る。

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

### GET /api/accounts/:accountId

Account 1件の詳細を、DBに保存されている状態のまま返す。副作用はない。

- **認証**：必要
- **200**：`AccountSummary`
- **404 `ACCOUNT_NOT_FOUND`**

### POST /api/accounts/:accountId/open

ユーザーがAccountの画面（`/accounts/:accountId`とその配下）を開いたときに、Webが1回呼ぶ。次の2つを1つのリクエストで行う（research.md R10・R14）。

1. **最後に使ったAccountの記録**（FR-007）：リクエストを受け取った時点のサーバー時刻を`receivedAt`とする。次のどちらかに当たれば、古いリクエストなので記録を変えない。(a) `receivedAt`が`users.last_account_open_received_at`以前（再読み込み前のページなど、先に届いていたリクエストが遅れて完了した）。(b) `clientId`が`users.last_account_client_id`と同じで、`openSeq`が`last_account_open_seq`以下（同じページの遅れて届いた再試行）。それ以外は、`users.last_account_id`・`last_account_client_id`・`last_account_open_seq`・`last_account_open_received_at`を更新し、`accounts.last_used_at`を`receivedAt`にする。比較は`users`の行を更新する1つの条件付き`UPDATE`で行う（research.md R10）。
2. **接続の確認**（FR-018）：接続情報があれば、そのトークンでThreadsのプロフィールを取得する。
   - 成功：プロフィール（ユーザー名・表示名・画像）を最新にする。
   - 認証エラー：`needs_reconnect`にする（research.md R6の競合制御に従う）。
   - 認証エラー以外の失敗（Threads側の障害など）：状態は変えず、記録だけ行う。

- **認証**：必要
- **リクエスト**：`{ "clientId": "…", "openSeq": 12 }`（`clientId`はページを読み込むたびに作る乱数ID、`openSeq`はそのページでAccountの画面を開くたびに増える連番。再試行でも最初の値を使う）
- **200**：更新後の`AccountSummary`
- **404 `ACCOUNT_NOT_FOUND`**
- **冪等**：同じ`clientId`・`openSeq`で何度呼んでも結果は同じ。Webは失敗時に再試行し、画面を離れたら再試行を中止する（[ui-routes.md](./ui-routes.md)）。
- **プリフェッチ禁止**：画面を実際に開いたときだけ呼ぶ。ホバーなどの先読みで呼ぶと、見ていないAccountが「最後に使ったAccount」になってしまうため。

### POST /api/threads/connect

Threads接続フローを始め、認可URLを返す（FR-008、FR-017、FR-020）。

- **認証**：必要
- **リクエスト**：
  - 新規：`{ "mode": "new" }`
  - 再接続：`{ "mode": "reconnect", "accountId": "…" }`
    - 接続状態に関係なく（`connected`でも`needs_reconnect`でも）使える。既存のAccountの接続を、同じThreadsアカウントで認可し直すための経路である（FR-013、FR-020）。
    - 新しいAccountを作らないので、登録数上限の判定はしない。上限に達しているユーザーでも、既存のAccountは再認可できる。
- **200**：`{ "authorizeUrl": "https://threads.com/oauth/authorize?…" }`
  - WebはこのURLへ`window.location.assign`で遷移する。
  - `state`は有効期限10分、1回限り（research.md R4）。
- **409 `ACCOUNT_LIMIT_REACHED`**：`mode = new`で、上限に達している。認可には進ませない。既存のAccountを認可し直したい場合は、`mode = reconnect`を使う。
- **404 `ACCOUNT_NOT_FOUND`**：`mode = reconnect`で、Accountがない、または自分のものではない

### GET /api/threads/callback

Threadsの認可画面から戻ってくる先。ブラウザのトップレベル遷移で呼ばれるため、Clerkの認証は伴わない。

**この経路は接続を済ませない**（2026-10-28に変更。セキュリティ監査run-1）。`state`と`code`を`{WEB_ORIGIN}/threads/complete`へ渡すだけで、DBにもThreadsにも触らない。接続の完了は、ログイン済みの`POST /api/threads/complete`で行う。

変更の理由：`state`は32バイトの乱数・単回・10分・SHA-256保存なので「第三者が他人の`state`を推測・再生する」向きは防げるが、**`state`を作った人が自分からそれを第三者に踏ませる**向きは防げない。以前はこの経路が`state`の行の`user_id`をそのまま主体に持ち上げて接続まで書き込んでいたため、踏んだ人の認可で発行されたトークンが、作った人のアカウントに保存されてしまった。research.md R4は「第三者に悪用されない」ことを単回・短命・推測困難から論じていて、この逆向きを検討していない。

- **認証**：不要（Metaからのトップレベル遷移で呼ばれる）
- **クエリ**：
  - 許可されたとき：`code`、`state`
  - 拒否されたとき：`error`、`error_reason`、`state`
- **処理**：クエリを`{WEB_ORIGIN}/threads/complete`へ`302`で渡すだけ。

| 受け取ったもの | リダイレクト先 |
|---|---|
| `state`と`code` | `{WEB_ORIGIN}/threads/complete?state=…&code=…` |
| `error`と`state` | `{WEB_ORIGIN}/threads/complete?state=…&error=THREADS_AUTH_CANCELLED` |
| `error`のみ | `{WEB_ORIGIN}/threads/complete?error=THREADS_AUTH_CANCELLED` |
| `state`か`code`が無い | `{WEB_ORIGIN}/threads/complete?error=THREADS_AUTH_FAILED` |

### POST /api/threads/complete

接続の完了（2026-10-28に追加）。**ログイン済みでしか呼べない**。

- **認証**：必要
- **本文**：`{ "state": "…", "code": "…" }`、または許可されなかったとき`{ "state": "…", "error": "THREADS_AUTH_CANCELLED" }`
- **処理**：`state`を使い切り、その行の`user_id`がClerkで確かめた呼び出し元と**一致することを要求する**。一致しなければ`400 OAUTH_STATE_INVALID`。`state`が無い場合と他人の`state`の場合で、応答のコードも文面も**区別しない**（区別すると`state`の存在を確かめる手がかりになる）。ログには分けて残す。
- **応答**：`200 { "redirectTo": "/…" }`。行き先はサーバーが決める（下の表はその値）。必ず`/`で始まるこのアプリの中の相対パス。Web側は`//`で始まるものを使わない。

既知の性質：Metaの画面にいる間にClerkのセッションが切れていると、`/threads/complete`が`/sign-in`へ送られ、`state`と`code`を失う（接続をやり直す）。Metaへの往復は数秒で、`state`自体10分で切れるため、受容する。

以前この経路が`GET /api/threads/callback`にあったときのリダイレクト先の表は、そのまま`redirectTo`の値として引き継いでいる。

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
| `ACCOUNT_DELETED_DURING_CONNECT` | この認可フローを始めた後に、ユーザーが自分のAccountを削除していた（`users.last_account_deleted_at`が`oauth_states.created_at`より新しい）。Accountは作らず、接続も更新しない | research.md R13 |
| `THREADS_AUTH_REVOKED` | 認可の直後、callbackが接続を書き込む前に、ユーザーがThreads側で連携を解除していた（`authorized_at`以降に発行された取り消しがある）。Accountは作らず、接続も更新しない | research.md R7 |
| `INTERNAL_ERROR` | 上記以外の想定外の失敗。JSONの画面で止めず、Webへ戻して案内を出す（2026-10-02に追加） | — |
| `THREADS_DATA_DELETION_REQUESTED` | そのThreadsユーザーについて、未完了（`pending` / `failed`）のデータ削除要求がある。または、この認可フローを始めた後にデータ削除要求が完了していた。Accountは作らず、接続も更新しない | spec エッジケース、research.md R7 |

### DELETE /api/accounts/:accountId

Accountを削除する（FR-022）。

- **認証**：必要（ownerのみ）
- **リクエスト**：`{ "confirmUsername": "…" }`
  - サーバーは`confirmUsername`と`username`の両方を次の手順で正規化してから比較する：前後の空白を除く → 先頭の`@`を1つだけ除く → 小文字にする。
  - そのため、`@takumi`、`takumi`、` @Takumi `はいずれも`takumi`と一致する。Webは入力をそのまま送ってよい。
  - 正規化の関数は`packages/shared`に置き、Webのボタンの有効・無効の判定にも同じ関数を使う。
- **処理**：1つのトランザクションで、`users`の行を`FOR UPDATE`でロックし、`users.last_account_deleted_at`を現在時刻にしてから、Accountを削除する（research.md R13）。進行中の`mode = new`の認可フローが、削除したAccountを作り直さないようにするため。
- **204**：Account・接続情報・関連データを削除した。`last_account_id`が指していた場合はNULLになる
- **422 `CONFIRMATION_MISMATCH`**：正規化した`confirmUsername`が、正規化したAccountの`username`と一致しない
- **404 `ACCOUNT_NOT_FOUND`**

## Metaからのcallback

Threadsアプリの設定に登録する（research.md R7）。どちらも`application/x-www-form-urlencoded`で`signed_request`を受け取り、App SecretのHMAC-SHA256で署名を検証する。検証に失敗したら`400`を返す。

### POST /api/threads/webhooks/uninstall

- **処理**（research.md R7）：
  1. `signed_request`から`user_id`と`issued_at`を取り出す。
  2. トランザクションを始め、Threadsユーザー単位のアドバイザリーロックを取る（callbackと同じキー）。
  3. Accountの有無にかかわらず、`threads_revocations`に取り消しを記録する（`threads_user_hmac`、`issued_at`、受信時刻）。進行中のcallbackが、この取り消しを見つけて接続を拒否できるようにするため（research.md R7）。
  4. `threads_user_id`に一致するAccountと`threads_connections`の行を読む。どちらかがなければ、ここで終える（取り消しの記録は残る）。
  5. `issued_at`が`threads_connections.authorized_at`より前なら、その後に再認可された接続への古い通知なので、何もしない（遅れて届いた通知・再送への対応）。
  6. それ以外なら、Accountを`needs_reconnect`にし、`threads_connections`の行を削除し、`accounts.connection_generation`を1増やす。
  7. `issued_at`が含まれていない場合は、受信時刻を`issued_at`として取り消しを記録する。そのうえで、手順4の前に現在のトークンでプロフィール取得を試し、成功すれば接続は変えない。認証エラーなら、取得前に読んだ`connection_generation`を条件にして手順6を行う。
  - 結果にかかわらず`200`を返す。
- **200**：本文なし

### POST /api/threads/webhooks/data-deletion

- **処理**（research.md R7）：
  1. **重複の排除**：検証済みの`signed_request`の文字列全体からSHA-256の指紋（`request_fingerprint`）を作る。同じ指紋の要求がすでにあれば、新しい行は作らず、削除も試みず、既存の確認コードと状況確認URLを`200`で返して終える（Metaの再送への対応。research.md R7）。`INSERT … ON CONFLICT (request_fingerprint) DO NOTHING RETURNING …`で判定し、競合したら既存の行を読み出す。
  2. 新しい要求なら、確認コードを発行し、`threads_deletion_requests`に`status = pending`で記録する。平文の`threads_user_id`と鍵付きハッシュ`threads_user_hmac`の両方を記録し、`last_attempted_at`を現在時刻にする。この記録は単独でコミットし、以降の処理が中断しても要求が失われないようにする。
  3. 削除の試行を、次の手順で**1つのトランザクション**として行う（research.md R7「試行ごとの原子的なclaim」）。Cronの再試行も、まったく同じ手順を使う。
     1. Threadsユーザー単位のアドバイザリーロックを取る（callbackと同じキー。research.md R7・R8）。
     2. 削除要求の行を`SELECT … FOR UPDATE`で読み直し、`status`が`pending` / `failed`で、`threads_user_id`がロックのキーと一致し、`last_attempted_at`が最初に読み取った値のままであることを確かめる。どれかが違えば、他のWorkerが処理済みなので、何もせずに終える。
     3. 条件付きの`UPDATE … SET attempts = attempts + 1, last_attempted_at = now() WHERE confirmation_code = $1 AND status IN ('pending', 'failed') AND last_attempted_at = <最初に読み取った値> RETURNING threads_user_id`で、この試行の担当を確定（claim）する。更新件数が0なら、削除しない。
     4. claimで得た`threads_user_id`に一致するAccountを削除する。接続情報と関連データは`ON DELETE CASCADE`で消える。FR-022と同じ削除処理を、確認入力なしで実行する。該当するAccountがなければ、削除すべきデータがないので何もしない。
     5. `status = completed`・`completed_at`を記録し、平文の`threads_user_id`をNULLにしてからコミットする。`threads_user_hmac`はここでは消さない（完了の直前に始めた認可フローの照合に使うため。research.md R7）。
  4. 3が失敗したらロールバックし、別のトランザクションで`status = failed`、`attempts + 1`、`last_attempted_at = now()`にする（`status <> 'completed'`を条件にする。claimの更新もロールバックされているため、ここで試行を記録し直す）。Workerが強制終了して`failed`に移せなかった場合は、`pending`のまま残る。どちらも日次のCronで再試行する（下記「定期処理」）。
  5. 処理の成否にかかわらず、Metaには`200`と確認コードを返す。
- **200**：

  ```json
  { "url": "{WEB_ORIGIN}/data-deletion/<confirmation_code>", "confirmation_code": "…" }
  ```

### GET /api/data-deletion/:confirmationCode

データ削除の状況確認ページ（`/data-deletion/:code`）が、実際の進み具合を表示するために呼ぶ。

- **認証**：不要（確認コードは推測できない乱数）
- **200**：`{ "status": "pending" | "completed" | "failed", "receivedAt": "…", "completedAt": "…" | null }`
  - `failed`は「処理中」として表示し、再試行で`completed`になるのを待つ。
  - ThreadsのユーザーIDやAccountの情報は返さない。
- **404**：確認コードが存在しない

## 定期処理（Cron Trigger）

HTTPエンドポイントではないが、外から観測できる振る舞いとしてここに記す。

- **スケジュール**：毎日18:00 UTC（03:00 JST）
- **処理**（research.md R6）：
  1. `expires_at`が7日以内で、`issued_at`から24時間以上経った接続のトークンを更新し、プロフィールも取り直す。
  2. 更新時に認証エラーが返った接続、または`expires_at`を過ぎた接続のAccountを`needs_reconnect`にする。
  3. 期限切れの`oauth_states`と、受信から15分以上経った`threads_revocations`を削除する。
  4. データ削除要求を再試行する（research.md R7）。対象は、`last_attempted_at`から15分以上経った`status = pending`と`status = failed`のもの（同じリースで扱う）。対象を一覧で読み取った後、1件ずつwebhookの手順3〜4（ロック → 読み直し → 条件付きUPDATEでclaim → 削除 → 完了）で処理する。claimできなかった要求は、他のWorkerが処理中か処理済みなので、削除しない。
  5. `completed`で、完了から15分以上経った削除要求の`threads_user_hmac`をNULLにする（research.md R7）。前回の実行が止まっていた場合も、条件を満たす行はこの回でまとめて消える。
  6. 消去した件数と、消去の対象なのに残っている最も古い行の経過時間をログに出す。25時間を超える行があれば、エラーとしてログに出す（research.md R7）。
- **再接続との競合**：1・2の書き込みは、読み取った時点の`accounts.connection_generation`が変わっていない場合だけ反映する。処理の途中で再接続・アンインストールなどにより接続が変わった場合は、Cronの結果を捨てる（data-model.mdの`accounts`）。
- 1件の失敗で全体を止めない。失敗した件数はログに出す（トークンは出さない）。

## 環境変数・Secret

| 名前 | 種別 | 説明 |
|---|---|---|
| `CLERK_SECRET_KEY` / `CLERK_PUBLISHABLE_KEY` | Secret / 変数 | Clerk |
| `THREADS_APP_ID` / `THREADS_APP_SECRET` | 変数 / Secret | Threadsアプリ |
| `THREADS_REDIRECT_URI` | 変数 | 例：`https://<api-host>/api/threads/callback`。Metaに登録した値と完全一致させる |
| `THREADS_AUTH_BASE_URL` | 変数 | 既定は`https://threads.com`。テストでは偽サーバーに向ける |
| `THREADS_GRAPH_BASE_URL` | 変数 | 既定は`https://graph.threads.com`。同上 |
| `TOKEN_ENCRYPTION_KEYS` | Secret | バージョン別の鍵リング（JSON）。例：`{"1":"<32バイトのbase64>"}`。ローテーション中は新旧の鍵を両方含める（research.md R5） |
| `TOKEN_ENCRYPTION_KEY_VERSION` | 変数 | 新しく暗号化するときに使う鍵のバージョン。例：`1`。鍵リングに含まれていなければ起動を失敗させる |
| `IDENTIFIER_HASH_KEY` | Secret | 32バイトをbase64化した値。データ削除要求のtombstone用の鍵付きハッシュに使う（research.md R7） |
| `DATABASE_URL` | Secret | Neonの接続文字列 |
| `WEB_ORIGIN` | 変数 | CORSの許可とリダイレクト先 |
