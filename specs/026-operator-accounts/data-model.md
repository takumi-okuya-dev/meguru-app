# データモデル：運営者がすべてのアカウントを接続方法ごとに確かめられる一覧

**日付**：2026-11-09 | **計画**：[plan.md](./plan.md) | **マイグレーション**：なし

表・列・索引は足さない。今ある表を読むだけ。

## 1. 読む表

| 表 | 使う列 | 用途 |
|---|---|---|
| `accounts` | `id`・`name`・`username`・`connection_method`・`connection_status`・`created_at` | 行・接続方法・接続の状態・並び（research.md R5・R2） |
| `memberships` | `account_id`・`user_id`・`role = 'owner'` | オーナー（R6） |
| `users` | `display_name`・`email` | オーナーの名前とメールアドレス（R6）・検索（R3） |
| `tester_applications` | `account_id`・`status`・`holds_slot`・`removal_reason` | テスター招待の状態（R4） |

## 2. 一覧の1行（`OperatorAccount`）

| 項目 | 型 | 決め方 |
|---|---|---|
| `id` | string（uuid） | `accounts.id` |
| `name` | string | `accounts.name` |
| `username` | string \| null | `accounts.username`（つなぐ前は null） |
| `method` | `app` \| `token` \| `none` | つなぐ前なら`none`、ほかは`connection_method`（R5） |
| `status` | `connected` \| `needs_reconnect` \| `not_connected` | `connection_status` |
| `owner` | `{ name: string \| null; email: string; accountCount: number }` \| null | オーナーの`display_name`・`email`と、そのオーナーが持つアカウントの数（つなぐ前を含む。R6） |
| `tester` | `pending` \| `invited` \| `connected` \| `removable` \| null | R4の順で1つ |
| `createdAt` | string（ISO 8601） | `accounts.created_at` |

## 3. 件数（`counts`）

| 項目 | 数えるもの |
|---|---|
| `all` | すべてのアカウント |
| `app` | `method = app`（要再接続を含む） |
| `token` | `method = token`（要再接続を含む） |
| `none` | `method = none` |

- 検索では変えない（FR-009）。`all = app + token + none`。

## 4. 共有の定数（`packages/shared/src/operator-accounts.ts`）

| 名前 | 中身 |
|---|---|
| `OPERATOR_ACCOUNT_METHODS` | `["all", "app", "token", "none"]`（絞り込み） |
| `OPERATOR_ACCOUNT_METHOD_LABELS` | すべて・Threadsで許可する・トークン・つなぐ前 |
| `CONNECTION_STATUS_LABELS` | 接続中・要再接続・つなぐ前 |
| `OPERATOR_ACCOUNT_TESTER_LABELS` | 申し込み中・招待済み・接続済み・外してよい |
| `OPERATOR_ACCOUNTS_PAGE_SIZE` | 50 |
| `OPERATOR_ACCOUNTS_QUERY_MAX` | 100（検索語の文字数の上限） |
