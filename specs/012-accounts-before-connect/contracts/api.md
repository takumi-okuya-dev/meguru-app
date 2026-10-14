# API契約：アカウントを先に作る

**日付**：2026-10-14 | **計画**：[../plan.md](../plan.md)

001〜011のAPIの書き方（エラーは`{ error: { code, message, details? } }`、日時はISO 8601）に従う。権限の判定は011の`authorizeAccount`のまま（[011 permissions.md](../../011-team-revision/contracts/permissions.md)）。

## 新しいエラーコード

| code | HTTP | いつ | 画面の文言 |
|---|---|---|---|
| `ACCOUNT_NOT_CONNECTED` | 409 | 未接続のアカウントで、Threadsが要る操作をした（パフォーマンスの書き出し）。未接続のアカウントをチームに入れようとした（`details: [accountId]`） | 「このアカウントは、まだThreadsにつながっていません。『このアカウントの設定』からつないでください」 |
| `ACCOUNT_ALREADY_CONNECTED` | 409 | はじめてつなごうとしたアカウントが、もうつながっていた（同時の操作。spec FR-018） | 「このアカウントは、すでにThreadsにつながっています」 |

今のcodeの使い方の変更：

- `ACCOUNT_ALREADY_REGISTERED`（010）：はじめてつなぐときに、自分の別のアカウントと重なったときにも使う。`details: [accountId, name]`（重なったアカウントのIDと名前）。接続し直し（010 US2-1）で重なったときも、同じく`[accountId, name]`を返す（文言を1つにそろえる）。文言は「@{username}は、あなたのアカウント『{name}』につながっています」（spec US3-1）。
- `THREADS_ACCOUNT_TAKEN`（001）：はじめてつなぐときに、他の利用者のアカウントと重なったとき（今のまま）。
- `ACCOUNT_DELETED_DURING_CONNECT`（001）：使わなくなる（つなぐことでアカウントを作らないため）。codeは残す。
- `THREADS_NOT_READY`（005）：`details`に`not_connected`が入りうる。
- `CONFIRMATION_MISMATCH`（001）：削除の確認を、アカウントの名前で比べる。

## アカウント

| API | 判定 | 説明 |
|---|---|---|
| `POST /api/accounts` | ログイン済み | **新規**。`{ name }`（前後の空白を除いて1〜50文字）。上限を行ロックの中で判定し、未接続のアカウントとオーナーの`membership`を作る。201で`AccountSummary`。上限なら`ACCOUNT_LIMIT_REACHED`（409）。名前が不正なら`VALIDATION_FAILED`（`details: ["name"]`） |
| `PATCH /api/accounts/:accountId` | `owner` | **新規**。`{ name }`。名前を直す。チームがあるアカウントなら記録`account_renamed`。200で`AccountSummary` |
| `GET /api/accounts/:accountId` | `read` | 変わらない（応答の形が変わる。下の`AccountSummary`） |
| `POST /api/accounts/:accountId/open` | `view` | 変わらない。未接続ならThreadsに問い合わせない（接続の行がないため） |
| `DELETE /api/accounts/:accountId` | `owner` | 本文を`{ confirmName }`にする。前後の空白を除いたアカウントの名前と一致しなければ`CONFIRMATION_MISMATCH` |

### `AccountSummary`（変わる）

```json
{
  "id": "…",
  "name": "カフェの公式",
  "username": "cafe_b",
  "displayName": "Cafe B",
  "profilePictureUrl": "https://…",
  "plan": "auto-only",
  "connectionStatus": "connected",
  "connectionMethod": "app",
  "reconnectHint": null,
  "lastUsedAt": "2026-10-14T00:00:00.000Z",
  "role": "owner",
  "ownerName": null
}
```

- `name`：足す。主に出す名前（research.md R2）。
- `username`・`displayName`・`profilePictureUrl`・`connectionMethod`：未接続なら`null`。
- `connectionStatus`：`not_connected`・`connected`・`needs_reconnect`。
- 見せてもらっている人への伏せ方（011）は今のまま。`name`は伏せない（チームの画面に出す名前なので）。

`/api/me`の`accounts`も同じ形。`landingAccountId`は、未接続のアカウントも対象にする（今のまま、最後に使ったアカウント）。

## Threadsにつなぐ

| API | 判定 | 説明 |
|---|---|---|
| `POST /api/threads/connect` | `owner`（対象のアカウント） | 本文を`{ mode: "connect", accountId }`か`{ mode: "reconnect", accountId }`にする（`new`をなくす）。`connect`は対象が未接続でなければ`ACCOUNT_ALREADY_CONNECTED`。上限は判定しない。応答は今のまま`{ authorizeUrl }` |
| `GET /api/threads/callback` | `state` | 戻り先：成功は`/accounts/:id/settings?connected=connect`（または`reconnect`）、失敗は`/accounts/:id/settings?error=CODE`。ただし、許可の画面にいる間に対象のアカウントが消された・オーナーでなくなった（`ACCOUNT_NOT_FOUND`・`ROLE_FORBIDDEN`）ときは、消えた画面へ戻さず`/?error=CODE`（振り分けで最後に使ったアカウントへ移し、エラーをトーストで出す）。`state`が読めないときは`/?error=OAUTH_STATE_INVALID`。`mode = new`の古い`state`は`OAUTH_STATE_INVALID` |
| `POST /api/threads/token-connect` | `owner`（対象のアカウント） | 本文を`{ mode: "connect", accountId, token }`か`{ mode: "reconnect", accountId, token }`にする。応答の`kind`は`connect`・`reconnect`。確認の失敗の数え方・待ち（010 FR-015）は今のまま。判定（オーナーか、`connect`なら未接続か）を、失敗の予約より先に行う（権限のない要求・つながっているアカウントへの`connect`を失敗に数えない） |

`connect`の確定の手順は[research.md R4](../research.md)。照合の結果：

| 照合 | 結果 |
|---|---|
| 一致なし | つなぐ。`connected`にし、方法を記録する |
| 自分の別のアカウント（ユーザーIDかユーザー名） | `ACCOUNT_ALREADY_REGISTERED`（`details: [そのアカウントのID, 名前]`）。つながない |
| 他の利用者のアカウント | `THREADS_ACCOUNT_TAKEN`。つながない |
| ユーザー名だけ一致 | 010 FR-023のまま、登録済みのアカウントのプロフィールを取り直してから照合する |

## Threadsが要る機能

| API | 未接続のとき |
|---|---|
| `POST /api/accounts/:id/threads-check` | Threadsに問い合わせず`{ status: "not_connected" }` |
| `PUT /api/accounts/:id/posting-schedule` | `enabled: true`なら`THREADS_NOT_READY`（`details: ["not_connected"]`）。`enabled: false`なら今のまま保存する |
| `GET /api/accounts/:id/posting-schedule`・自動投稿の状態 | `stoppedReason`は今のまま（オンにできないので`not_connected`は出ない。型には足す） |
| `GET /api/accounts/:id/performance` | `notConnected: true`と、空の数字（数えない）。一覧は空 |
| `GET /api/accounts/:id/performance/export` | `ACCOUNT_NOT_CONNECTED` |
| `GET /api/accounts/:id/auto-post`（投稿ストックの自動投稿の状態と知らせ） | `notices`の先頭に`{ kind: "not_connected" }`を足す。`next`（次の投稿）は、オフなので今のまま`null` |
| 戦略・宣伝内容・リサーチ・プロンプト・投稿の案・承認・NGワード・投稿のルール・操作の記録 | 今のまま（spec FR-031） |

## チーム（011からの変更）

| API | 変更 |
|---|---|
| `POST /api/teams`・`POST /api/teams/:teamId/accounts`・`POST /api/invites/:token/accept` | 未接続のアカウントを選んだら`ACCOUNT_NOT_CONNECTED`（`details: [accountId]`）。判定は`assertOwnFreeAccounts`の1か所 |
| `GET /api/invites/:token` | `viewer.status`に`needs_connection`（自分のアカウントはあるが、つないだものがない）を足す。`viewer.accounts`の各行に`name`・`connected`を足し、`needs_connection`のときも未接続のアカウントを返す（画面が「Threadsとの接続」へ案内するため） |
| `GET /api/teams/:teamId`・`GET /api/teams/:teamId/assignments` | アカウントの行に`name`を足す。`username`は`nullable`の型にする |
