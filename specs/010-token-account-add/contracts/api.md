# API契約：自分のMetaアプリのトークンでアカウントを追加

**日付**：2026-10-10 | **計画**：[../plan.md](../plan.md)

001〜009のAPIの書き方（エラーは`{ error: { code, message, details? } }`、日時はISO 8601）に従う。

## `POST /api/threads/token-connect`

トークンを確かめて、Accountを追加する、または接続し直す。

**権限**：ログイン済み。`mode: "reconnect"`は`authorizeAccount(..., "owner")`（008。パートナー・編集者は`ROLE_FORBIDDEN`、関わりのないAccountは`ACCOUNT_NOT_FOUND`）。

**要求**：

```json
{ "mode": "new", "token": "THAAG…" }
{ "mode": "reconnect", "accountId": "…", "token": "THAAG…" }
```

- `token`は前後の空白・改行・引用符を取り除いてから確かめる（`packages/shared/src/token.ts`）。
- 本文は2KBまで。ログ・エラーの`details`にトークンを入れない。

**手順**（research.md R1〜R9）：

1. 形の確認。合わなければ失敗に数えて`TOKEN_INVALID`。
2. 失敗の待ち（usersの行ロックの中で数える）。待ちの間は`TOKEN_CHECK_LOCKED`。
3. `mode: "new"`なら登録の上限（001）。上限なら`ACCOUNT_LIMIT_REACHED`（失敗に数えない）。
4. プロフィール → `debug_token` → 投稿の上限 → フォロワー数。
5. ユーザー名だけが一致するAccountがあれば、そのプロフィールを取り直す（R6）。
6. `completeConnection`（同じトランザクションで、ロック → 取り消し・削除要求 → 照合 → 作成または書き込み → 記録）。
7. `recheck_at`を入れたら`autopost:wake`を書く。

**応答**（200）：

```json
{
  "accountId": "…",
  "kind": "new",
  "username": "cafe_b",
  "warnings": ["no_publish_permission", "no_insights_permission"]
}
```

- `kind`：`new`（作った）・`reconnect`（接続し直した）。
- `warnings`：権限がないもの（なければ空）。

**エラー**：

| code | HTTP | いつ | 失敗に数える |
|---|---|---|---|
| `VALIDATION_FAILED` | 400 | 本文の形が違う（`mode`がない など） | いいえ |
| `TOKEN_INVALID` | 400 | 形が違う、無効・期限切れ・取り消し、プロフィールを読めない | はい |
| `TOKEN_SHORT_LIVED` | 400 | 期限が48時間未満 | はい |
| `TOKEN_CHECK_LOCKED` | 429 | 10分に5回失敗した後の10分。`details: [残りの秒]` | いいえ |
| `THREADS_UNAVAILABLE` | 503 | Threadsの一時的な失敗・上限 | いいえ |
| `ACCOUNT_LIMIT_REACHED` | 409 | 登録の上限（001） | いいえ |
| `ACCOUNT_ALREADY_REGISTERED` | 409 | 自分のAccountと同じThreadsアカウント（新規のとき）。`details: [accountId]` | いいえ |
| `THREADS_ACCOUNT_TAKEN` | 409 | 他の利用者のAccountと同じThreadsアカウント（001） | いいえ |
| `RECONNECT_ACCOUNT_MISMATCH` | 409 | 接続し直しで、別のThreadsアカウントのトークン（001） | はい |
| `THREADS_AUTH_REVOKED`・`THREADS_DATA_DELETION_REQUESTED`・`ACCOUNT_DELETED_DURING_CONNECT` | 409 | 001と同じ | いいえ |
| `ROLE_FORBIDDEN`・`ACCOUNT_NOT_FOUND` | 403・404 | 008と同じ | いいえ |

新しく足すcodeは`TOKEN_INVALID`・`TOKEN_SHORT_LIVED`・`TOKEN_CHECK_LOCKED`・`ACCOUNT_ALREADY_REGISTERED`・`THREADS_UNAVAILABLE`の5つ。ほかは001・008のcodeをそのまま使う。

**文言**（`packages/shared/src/errors.ts`）：

| code | 文言 |
|---|---|
| `TOKEN_INVALID` | トークンを確かめられませんでした。トークンを作り直して貼り付けてください。 |
| `TOKEN_SHORT_LIVED` | 短期のトークンのようです。ユーザートークン生成ツールで作った長期トークンを貼り付けてください。 |
| `TOKEN_CHECK_LOCKED` | しばらく待ってから、もう一度お試しください（あと{minutes}分）。 |
| `ACCOUNT_ALREADY_REGISTERED` | このアカウントはすでに登録されています。接続を更新するときは、そのアカウントの設定の「接続し直す」を使ってください。 |
| `RECONNECT_ACCOUNT_MISMATCH`（トークンのとき） | 別のThreadsアカウントのトークンです。@{username}のトークンを貼り付けてください。 |
| `THREADS_UNAVAILABLE` | Threadsに接続できませんでした。時間をおいて、もう一度お試しください。 |

## 変わるAPI

### `GET /api/threads/callback`（001）

- 照合をユーザーIDとユーザー名に広げる（research.md R6）。新規で自分のAccountと一致したら、001どおり接続を更新する（`kind: "updated"`）。このとき、接続の方法を`app`に書き換える。
- 接続し直しで同じThreadsアカウントかを「IDが同じ、またはユーザー名が同じ」で判定する（research.md R7）。
- チームがあるAccountの接続し直しを`threads_reconnected`（`method: "app"`）で記録する。

### `GET /api/me`・`GET /api/accounts/:id`（001）

Accountの要約に2つ足す（オーナー以外にも返す。値にトークンの情報は含まない）。

```json
{ "connectionMethod": "app", "reconnectHint": null }
```

- `connectionMethod`：`app`・`token`。
- `reconnectHint`：`short_lived_token`またはNULL。

### `GET /api/accounts/:accountId/activity`（008）

`threads_reconnected`の行が加わる（`details.method`）。

## 定期処理

### 5分ごと（005 `contracts/auto-post-job.md`）

- 関所の「次に見る時刻」の候補に、`threads_connections.recheck_at`の最も早い時刻を足す。
- DBの処理の中で、`recheck_at <= now`の接続を確かめ直す（research.md R8）。1回で最大20件。残りがあれば「すぐ続ける」にする。

### 日次（001 `contracts/api.md`「定期処理」）

- トークンの延長は001の処理のまま（接続の方法で分けない）。延長のついでにプロフィールを取り直し、ユーザー名を新しくする。
- `token_check_failures`の1日より前の行を消す。
