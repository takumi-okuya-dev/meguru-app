# データモデル：Threadsで許可するときのアカウントの取り違えを減らす案内

**日付**：2026-11-08 | **計画**：[plan.md](./plan.md) | **マイグレーション**：`0023_connection_notice`（足すだけ）

## 1. 変える表

### 1-1. `tester_applications`（024）

| 列 | 型 | 制約・既定値 | 意味 |
|---|---|---|---|
| `mismatch_notice_dismissed_at` | timestamptz | NULL可、既定値なし | 「違うアカウントでつながった」知らせを、オーナーが閉じた日時（research.md R5） |

- 今ある行は、すべて NULL（閉じていない）。
- 退会・アカウントの削除の扱いは024のまま（`account_id`が空になれば、知らせは出なくなる）。

## 2. 知らせを出す条件（research.md R5）

アカウント（`accounts.id = :accountId`）について、次をすべて満たす申し込みのうち、`status_changed_at`がいちばん新しい1行。

- `account_id = :accountId`
- `removal_reason = 'username_mismatch'`
- `connected_username = lower(accounts.username)`（今もそのアカウントでつながっている）
- `mismatch_notice_dismissed_at IS NULL`

なければ、知らせは出さない。

## 3. 共有の定数（`packages/shared/src/threads-account-guide.ts`）

| 名前 | 中身 |
|---|---|
| `THREADS_WEB_URL` | `https://www.threads.com/` |
| `ACCOUNT_SWITCH_ERRORS` | `["RECONNECT_ACCOUNT_MISMATCH", "THREADS_ACCOUNT_TAKEN", "ACCOUNT_ALREADY_REGISTERED"]`（research.md R3） |
| `accountGuideLead(expected)` | 押す前の案内の文。`expected`があれば「threads.comでログインしているアカウントで許可されます。@〇〇 でログインしているか確かめてください。」、なければ前半だけ |
| `accountSwitchSteps(expected, again)` | 手順の3行。①「threads.com（またはThreadsのアプリ）で、今のアカウントからログアウトする」②「@〇〇 でログインし直す」（`expected`がなければ「つなぎたいアカウントでログインし直す」）③「このページに戻って、もう一度「{again}」を押す」 |
