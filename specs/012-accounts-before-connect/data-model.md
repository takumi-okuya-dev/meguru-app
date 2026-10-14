# Data Model：アカウントを先に作る

**日付**：2026-10-14 | **仕様**：[spec.md](./spec.md) | **Research**：[research.md](./research.md)

マイグレーション`0013_accounts_before_connect.sql`の1本。表は足さない。

## 列挙型

| 型 | 変更 | 理由 |
|---|---|---|
| `connection_status` | `not_connected`を足す（`connected`・`needs_reconnect`・`not_connected`） | 未接続（一度もつないでいない）を、要再接続と分けて持つ（spec FR-030、R1） |
| `oauth_mode` | `connect`を足す。`new`は使わない値として残す | はじめてつなぐ流れ（R4）。列挙型から値は消せない |

値の追加は、それぞれ別の文にする（`ALTER TYPE ... ADD VALUE`）。同じマイグレーションの中では新しい値を使えないので、CHECK制約は`::text`で比べる。

## accounts（変更）

| 列 | 変更 | 内容 |
|---|---|---|
| `name` | 足す（`text NOT NULL`。既定値なし） | アカウントの名前。前後の空白を除いて1〜50文字。CHECK `accounts_name_length`：`char_length(name) BETWEEN 1 AND 50 AND name = btrim(name)`。今のアカウントは`left(COALESCE(NULLIF(btrim(display_name), ''), username), 50)`で埋めてから`NOT NULL`にする（spec FR-044） |
| `threads_user_id` | `NOT NULL`を外す | 未接続の間は`NULL`。一意制約はそのまま |
| `username` | `NOT NULL`を外す | 未接続の間は`NULL`。`lower(username)`の索引はそのまま |
| `connection_method` | `NOT NULL`を外す（既定値`app`は残す） | 未接続の間は`NULL`（作る時にアプリが`NULL`を書く）。つないだときに`app`か`token`が入る |
| `connection_status` | 変えない（既定値`connected`のまま） | 作る時はアプリが`not_connected`を書く（R3）。既定値を変えないのは、テストの準備（`test/helpers/app.ts`）など、Threadsのユーザーつきでアカウントを入れる所を変えずに済ませるため。書き忘れはCHECK制約が拒む |

**CHECK制約**（`accounts_connection_consistency`）：

```text
(connection_status::text = 'not_connected'
   AND threads_user_id IS NULL AND username IS NULL AND connection_method IS NULL)
OR (connection_status::text <> 'not_connected'
   AND threads_user_id IS NOT NULL AND username IS NOT NULL AND connection_method IS NOT NULL)
```

`threads_user_id`・`username`・`connection_method`は、3つそろって`NULL`か、3つそろって値を持つ。

**状態の移り変わり**：

```text
（作る）→ not_connected ──つなぐ（R4）──→ connected ⇄ needs_reconnect（001・010のまま）
                 │                                  
                 └──削除（001 FR-022）
```

- `not_connected`へ戻る移り変わりはない（spec Edge Cases）。
- `connected`・`needs_reconnect`は、001・010のまま（期限切れ・取り消しで`needs_reconnect`、接続し直しで`connected`）。

## threads_connections（変更なし）

未接続のアカウントには行を作らない。つないだときに`writeConnection`が作る（今のまま）。

## oauth_states（変更）

- `mode = connect`のとき、`target_account_id`は未接続のアカウント。`reconnect`は今のまま。
- `target_account_id`の外部キーを`ON DELETE CASCADE`から`ON DELETE SET NULL`にする。許可の画面にいる間に対象のアカウントが消されたとき、`state`ごと消えて「使えない`state`」になるのではなく、callbackで「見つからない」（`ACCOUNT_NOT_FOUND`）と分かるようにするため（contracts/api.md）。
- CHECK `oauth_states_target_required_for_reconnect`を、`oauth_states_no_target_for_new`（`mode::text <> 'new' OR target_account_id IS NULL`）に置き換える（実装のときに足した）。
- 列挙型の値の追加は`ADD VALUE IF NOT EXISTS`にする（実装の途中で0013を作り直したため、手元のDBで2回当たっても失敗しないように）。

## 操作の記録（activity_logs、変更なし）

足す`action`（`kind = settings`）：

| action | いつ | details |
|---|---|---|
| `account_renamed` | オーナーが名前を直した（チームがあるアカウントだけ） | `{ from, to }` |
| `threads_connected` | 未接続のアカウントをつないだ（チームがあるアカウントだけ。ふつうは起きない。R7） | `{ method }` |

## 共通の型（packages/shared）

- `connectionStatusSchema`：`not_connected`を足す。
- `accountSummarySchema`：`name`（文字列）を足す。`username`を`nullable`にする。`connectionMethod`を`nullable().optional()`にする。
- `accountNameSchema`：前後の空白を除いて1〜50文字（`ACCOUNT_NAME_MAX = 50`、`limits.ts`）。
- `connectRequestSchema`・`tokenConnectRequestSchema`：`mode`を`connect`・`reconnect`の2つにし、どちらも`accountId`を持つ。
- `tokenConnectResponseSchema`の`kind`：`connect`・`reconnect`。
- `deleteAccountRequestSchema`：`confirmUsername`を`confirmName`にする。
- チームの型（`teamMemberAccountSchema`・`teamAssignmentsSchema`の`accounts`・`invitePreviewSchema`の`accounts`）：`name`を足し、`username`を`nullable`にする。招待の`accounts`に`connected`（真偽）を足す。`inviteViewerStatusSchema`に`needs_connection`を足す。
- `threadsCheckSchema`（投稿の権限の確認）の`status`・自動投稿の`stoppedReason`：`not_connected`を足す。
- `performanceSummarySchema`：`notConnected`（真偽）を足す。
- `accountLabel(account)`：主の名前（`name`）・添える名前（`@username`か`NULL`）・頭文字を返す（R2）。

## 定数

| 名前 | 値 | 使う所 |
|---|---|---|
| `ACCOUNT_NAME_MAX` | 50 | 名前の長さ（spec FR-002・FR-040） |

## 確かめること（マイグレーションのテスト）

- 今のアカウントがすべて`connected`か`needs_reconnect`のまま、`name`が表示名（なければユーザー名）で埋まる。
- `accounts`・`post_drafts`・`strategy_designs`・`activity_logs`の件数が、前後で同じ。
- 未接続のアカウントを2つ作っても、`threads_user_id`の一意制約にかからない。
- CHECK制約：未接続で`username`だけ入れる、接続中で`threads_user_id`を`NULL`にする、のどちらも拒まれる。
