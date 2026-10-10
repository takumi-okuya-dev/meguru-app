# Data Model：自分のMetaアプリのトークンでアカウントを追加

**日付**：2026-10-10 | **計画**：[plan.md](./plan.md) | **マイグレーション**：`apps/api/drizzle/0011_token_connect.sql`

001〜009の表はそのまま。足すものだけを書く。

## 列挙型

### `connection_method`（新規）

| 値 | 意味 |
|---|---|
| `app` | このアプリのMetaアプリで許可した接続（001のOAuth） |
| `token` | 利用者が自分のMetaアプリで作ったトークンを貼り付けた接続（本feature） |

## `accounts`（列を足す）

| 列 | 型 | 既定 | 説明 |
|---|---|---|---|
| `connection_method` | `connection_method` | `'app'`（NOT NULL） | 今の接続の方法。接続し直しで変わる（FR-031・FR-033）。既存の行は`app` |
| `reconnect_hint` | `text` | NULL | 要再接続になった理由の補い。今は`short_lived_token`だけ（research.md R8）。接続し直しで消す |

- 索引`accounts_username_lower_idx`：`lower(username)`。一意にしない（research.md R6）。
- `threads_user_id`の一意の制約はそのまま。接続し直しで新しいIDに書き換える（research.md R7）。
- 照合に使う「正規化したユーザー名」は、001の`normalizeUsername`（前の`@`を外し、小文字にする）と同じ。

## `threads_connections`（列を足す）

| 列 | 型 | 既定 | 説明 |
|---|---|---|---|
| `recheck_at` | `timestamptz` | NULL | トークンの期限を確かめられなかったときの、確かめ直しの時刻（追加・接続し直しの2時間後。research.md R8）。確かめ直したら消す。OAuthでは入れない |

- トークンの接続でも`expires_at`・`issued_at`・`scopes`・`authorized_at`はOAuthと同じ意味で入れる。
  - `expires_at`：`debug_token`の`expires_at`。読めなければ受け取りから60日。
  - `issued_at`：`debug_token`の`issued_at`。読めなければ受け取りの時刻（日次の延長は「発行から24時間以上」を見るので、受け取りから24時間後から延長の対象になる）。
  - `scopes`：`debug_token`の`scopes`。読めなければ001の3つ。
  - `authorized_at`：リクエストを受け取った時刻。
- 部分索引`threads_connections_recheck_idx`：`recheck_at`（`WHERE recheck_at IS NOT NULL`）。5分ごとの処理で最も早い時刻を読む。

## `token_check_failures`（新規）

トークンの確認の失敗の時刻（FR-015、research.md R9）。

| 列 | 型 | 説明 |
|---|---|---|
| `id` | `uuid` PK | |
| `user_id` | `uuid` NOT NULL → `users.id`（ON DELETE CASCADE） | 失敗した利用者 |
| `failed_at` | `timestamptz` NOT NULL | 失敗した時刻 |
| `reason` | `text` NOT NULL | `invalid_format`・`invalid`・`short_lived`・`account_mismatch`（記録の調べもの用。トークンの値は持たない） |

- 索引`token_check_failures_user_time_idx`：`(user_id, failed_at)`。
- 日次の処理で、`failed_at`が1日より前の行を消す。

## 状態の移り変わり

### Accountの接続（001の「接続中」「要再接続」はそのまま）

```text
          トークンで追加（debug_tokenで期限を読めた）
  (なし) ─────────────────────────────────────────▶ 接続中（token、recheck_atなし）
          トークンで追加（期限を読めない）
  (なし) ─────────────────────────────────────────▶ 接続中（token、recheck_at＝2時間後）
                                                        │ 2時間後に読めた → recheck_atを消す
                                                        │ 2時間後に認証のエラー
                                                        ▼
                                                  要再接続（reconnect_hint＝short_lived_token）
  接続中 ──認証のエラー（どこでも）──▶ 要再接続 ──接続し直し（app／token）──▶ 接続中（方法を書き換え、hintを消す）
```

- 接続し直しのたびに`connection_generation`を1増やす（001）。確かめ直し・延長の結果は、読んだ時点の世代番号を条件に書く。

## 検証の規則

| 対象 | 規則 | 出どころ |
|---|---|---|
| 貼り付けた文字列 | 前後の空白・改行・引用符を取り除き、32〜2048文字、英数字と`_ - . \|`だけ | FR-003、research.md R1 |
| 期限 | `debug_token`の`expires_at`が今から48時間未満なら短期トークンとして拒む | FR-012、research.md R3 |
| 同じThreadsアカウントか | ユーザーIDが同じ、または正規化したユーザー名が同じ | FR-020・FR-032、research.md R6・R7 |
| 失敗の待ち | 直近10分の`token_check_failures`が5件以上なら、5件目から10分は確かめない | FR-015、research.md R9 |
| 権限 | 追加・接続し直しはオーナーだけ（008の`owner`） | FR-034 |

## 操作の記録（008の`activity_logs`）

| `action` | `kind` | `details` | いつ |
|---|---|---|---|
| `threads_reconnected` | `settings` | `{ method: "app" \| "token" }` | チームがあるAccountで、接続し直したとき（どちらの方法でも。research.md R11a） |
