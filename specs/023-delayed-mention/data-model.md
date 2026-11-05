# Data Model：時間差のメンション

**Feature**：[spec.md](./spec.md) | **計画**：[plan.md](./plan.md) | **日付**：2026-11-05

マイグレーション `0021_delayed_mention` の1本。表3つと列1つを足すだけで、前の版のAPIでも壊れない（[リリースの手順書](../../docs/release-runbook.md) 3）。

## accounts（列を足す）

| 列 | 型 | 制約・既定 | 意味 |
|---|---|---|---|
| `replies_denied_at` | timestamptz | NULL可 | 返信の権限がないと分かった時刻（research.md R1）。つなぎ直すとNULL |

## mention_settings（新規）

Accountに0か1行。行がなければ初めの値（ひとことは空・時間差30分）。

| 列 | 型 | 制約・既定 | 意味 |
|---|---|---|---|
| `account_id` | uuid | 主キー、`accounts.id`、削除でcascade | |
| `message` | text | NOT NULL、既定 `''`、100文字まで | ひとこと |
| `delay_minutes` | int | NOT NULL、既定 30、CHECK（10・30・60・180・360・720・1440） | 時間差 |
| `version` | int | NOT NULL、既定 1 | 保存の衝突の検知 |
| `updated_by_user_id` | uuid | `users.id`、削除でNULL | |
| `updated_at` | timestamptz | NOT NULL、既定 now | |

## mention_people（新規）

メンションする人。Accountに20人まで（`MENTION_PEOPLE_MAX`。サービスで確かめる）。

| 列 | 型 | 制約・既定 | 意味 |
|---|---|---|---|
| `id` | uuid | 主キー | |
| `account_id` | uuid | NOT NULL、`accounts.id`、削除でcascade | |
| `username` | text | NOT NULL、CHECK（`^[a-z0-9._]{1,30}$`） | Threadsのユーザー名（@なし・小文字） |
| `label` | text | NOT NULL、1〜30文字 | 呼び名 |
| `always` | boolean | NOT NULL、既定 false | いつも付ける |
| `created_at` | timestamptz | NOT NULL、既定 now | |

一意：`(account_id, username)`。並びは `created_at` の順。

## post_mentions（新規）

時間差のメンション。下書きに0か1行。

| 列 | 型 | 制約・既定 | 意味 |
|---|---|---|---|
| `draft_id` | uuid | 主キー、`post_drafts.id`、削除でcascade | 投稿（下書き） |
| `account_id` | uuid | NOT NULL、`accounts.id`、削除でcascade | |
| `usernames` | text[] | NOT NULL、1〜5件 | 選んだ人（@なし） |
| `text` | text | NOT NULL、1〜500文字 | 返信の文 |
| `delay_minutes` | int | NULL可 | 付けたときの時間差。NULL＝投稿済みの投稿に付けた（`send_after` を使う） |
| `send_after` | timestamptz | NULL可 | 投稿済みの投稿で「返信する」を押した時刻 |
| `state` | text | NOT NULL、既定 `pending`、CHECK（`pending`・`sent`・`canceled`・`failed`） | 状態 |
| `failure_reason` | text | NULL可、CHECK（`not_found`・`post_failed`・`no_permission`・`expired`・`ng_word`・`limit`・`error`） | 出せなかった理由 |
| `container_id` | text | NULL可 | 返信のコンテナー（research.md R4） |
| `publish_requested_at` | timestamptz | NULL可 | 公開を送った時刻 |
| `reply_media_id` | text | NULL可 | 出した返信のid（分からなければNULL） |
| `sent_at` | timestamptz | NULL可 | 出した時刻 |
| `attempts` | int | NOT NULL、既定 0 | 一時的な失敗の回数（3で `failed`） |
| `next_attempt_at` | timestamptz | NULL可 | やり直す時刻 |
| `lease_token` | uuid | NULL可 | 処理中の借り（005と同じ） |
| `lease_until` | timestamptz | NULL可 | |
| `created_by_user_id` | uuid | `users.id`、削除でNULL | 付けた人 |
| `updated_at` | timestamptz | NOT NULL、既定 now | |

CHECK：
- `delay_minutes IS NOT NULL OR send_after IS NOT NULL`
- `(state = 'failed') = (failure_reason IS NOT NULL)`
- `(state = 'sent') = (sent_at IS NOT NULL)`

索引：
- `post_mentions_due_idx`（`account_id`, `state`）：`state = 'pending'` の部分索引
- `post_mentions_sent_idx`（`account_id`, `sent_at`）：24時間の回数を数えるため

状態：

```text
（行なし）──付ける（要確認・承認済み：delay_minutes／投稿済み：send_after）──▶ pending
pending ──出した──▶ sent
pending ──外す（要確認・承認済み）──▶ 行を消す
pending ──やめる（投稿済み）──▶ canceled
pending ──出せない（not_found・post_failed・no_permission・expired・ng_word・limit、一時的な失敗が3回）──▶ failed
下書きの削除・Accountの削除 ──▶ cascade で消える
下書きの却下 ──▶ 行を消す（spec Edge Cases）
```

返信を直す・人を入れ替えると、下書きの `version` を1つ上げる。承認済みなら要確認に戻す（004の本文の編集と同じ）。投稿済みの行は、直さずに「やめる」だけにする。

## 共有の定数（packages/shared/src/limits.ts）

| 名前 | 値 | 意味 |
|---|---|---|
| `MENTION_PEOPLE_MAX` | 20 | メンションする人の上限 |
| `MENTION_PER_REPLY_MAX` | 5 | 1つの返信で選べる人 |
| `MENTION_MESSAGE_MAX` | 100 | ひとこと |
| `MENTION_LABEL_MAX` | 30 | 呼び名 |
| `MENTION_DELAY_OPTIONS` | `[10, 30, 60, 180, 360, 720, 1440]` | 時間差（分） |
| `MENTION_DELAY_DEFAULT` | 30 | |
| `MENTION_SAME_PERSON_HOURS` | 24 | 同じ人へのメンションの間隔 |
| `MENTION_EXPIRE_HOURS` | 24 | この時間を過ぎたら出さない |
| `MENTION_PUBLISHED_DAYS` | 7 | 投稿済みの投稿に付けられる期間 |
| `MENTION_MAX_ATTEMPTS` | 3 | 一時的な失敗の上限 |
| `MENTION_MAX_PER_TICK` | 10 | 1回の処理で出す返信 |

## 共有の関数（packages/shared/src/mention.ts）

| 名前 | 内容 |
|---|---|
| `normalizeMentionUsername(s)` | 前後の空白と先頭の@を外し、小文字にする。形が違えば null |
| `buildMentionText(message, usernames)` | ひとこと、改行、`@a @b`。ひとことが空なら `@a @b` だけ |
| `mentionDueAt(m, publishedAt)` | 返信の時刻（research.md R3） |
| `mentionUsernamesIn(text, people)` | 文の中の `@ユーザー名` のうち、一覧にある人（重なりなし・文の順） |
| `toggleMentionInText(text, username)` | 文の最後の行に `@ユーザー名` を足す（なければ行を足す）・あれば消す |
| `MENTION_FAILURE_LABELS` | 出せなかった理由の表示名（投稿が見つかりません・返信の権限がありません など） |
