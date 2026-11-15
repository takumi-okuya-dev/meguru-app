# Data Model：チームの運用状況を見る

**Feature**：[spec.md](./spec.md) | **計画**：[plan.md](./plan.md) | **日付**：2026-11-04

マイグレーションは足さない。表も列も変えない。運用状況は、開いたときに今ある表から数える（research.md R1）。

## 使う表

| 表 | 使う列 | 何に使うか |
|---|---|---|
| `team_members` | `team_id`・`user_id`・`role`・`joined_at` | 人の一覧・ロール・「止まっている」の起点 |
| `team_accounts` | `team_id`・`account_id`・`added_at` | Accountの一覧・「止まっている」の起点 |
| `memberships` | `user_id`・`account_id`・`role`・`team_id` | Accountのオーナー、編集者の担当（範囲） |
| `accounts` | `name`・`username`・`display_name`・`profile_picture_url`・`connection_status` | Accountの名前・接続の状態 |
| `users` | `display_name`・`email` | 人の名前（`personName`） |
| `activity_logs` | `account_id`・`actor_user_id`・`action`・`created_at` | 人の動き（R1の4つの `action`） |
| `post_drafts` | `account_id`・`status`・`published_at` | 投稿の数・最後に投稿した日・承認済みの残り・要確認 |
| `post_metrics` | `draft_id`・`state`・`views` | 伸び（確定した閲覧数） |
| `feature_disables`ほか | （019の `featureOnSql`） | オーナーの `autopost`・`team` |

## 人の運用状況（返すだけ。保存しない）

| 項目 | 型 | 決め方 |
|---|---|---|
| `userId` | uuid | `team_members.user_id` |
| `name` | text | `personName(users)` |
| `role` | `admin`・`editor`・`member` | `team_members.role` |
| `isMe` | boolean | 見ている人か |
| `joinedAt` | timestamptz | `team_members.joined_at` |
| `lastActiveAt` | timestamptz・null | 範囲のAccountでの、R1の4つの `action` の `created_at` の最大。90日より前は消えている |
| `activeCount7d` | int | 同じ行のうち、`created_at > now - 7日` の件数（まとめての操作も1件） |
| `stopped` | boolean | `max(lastActiveAt, joinedAt) < now - 7日` |
| `retentionLimited` | boolean | `lastActiveAt` がなく、`joinedAt < now - 90日`（「90日以内にありません」と出す。R2） |

範囲（research.md R5）：
- 管理者：そのチームの人すべて。動きは、チームに入っているすべてのAccountで数える。
- 編集者：担当のAccountのオーナーだけ。動きは、担当のAccountでの動きだけを数える（spec Edge Cases）。編集者自身の行は出さない。

## Accountの運用状況（返すだけ。保存しない）

| 項目 | 型 | 決め方 |
|---|---|---|
| `accountId` | uuid | `team_accounts.account_id` |
| `name`・`username`・`displayName`・`profilePictureUrl` | text・null | `accounts`（画像は、見ている人が開けるAccountだけ。`getTeamDetail` と同じ） |
| `owner` | `{ userId, name, isMe }` | `memberships.role = 'owner'` |
| `connection` | `connected`・`disconnected` | `accounts.connection_status`（`needs_reconnect`・`not_connected` は `disconnected`） |
| `addedAt` | timestamptz | `team_accounts.added_at` |
| `lastPostedAt` | timestamptz・null | `post_drafts.published_at` の最大（`status = 'published'`） |
| `postCount7d` | int | `published_at > now - 7日` の件数 |
| `approvedCount` | int | `status IN ('approved','publishing')` の件数 |
| `needsReviewCount` | int | `status = 'needs_review'` の件数 |
| `stopped` | boolean | `max(lastPostedAt, addedAt) < now - 7日` |
| `growth` | 下の表 | research.md R4・R7 |

`growth`：

| `growth.state` | 条件 | 画面 |
|---|---|---|
| `metrics_off` | オーナーの `autopost` が使えない | 「取り込んでいません」 |
| `insufficient` | 直近30日かその前の30日の、確定した投稿が5件未満。または前の中央値が0 | 「まだ判定できません」 |
| `ok` | 比 > 0.8 | 灰色の比（例：×1.3） |
| `poor` | 比 ≦ 0.8 | 青の右下がりの矢印と比、「伸びていない」 |

`ok`・`poor` のときは `growth.ratio`（小数第1位で丸めて画面に出す）、`growth.recentMedian`・`growth.previousMedian` も返す。

範囲（research.md R5・R6）：
- 管理者：そのチームのAccountすべて。
- 編集者：担当のAccountのうち、オーナーの `team` が使えるものだけ。

## 定数（`packages/shared/src/limits.ts`）

| 名前 | 値 | 意味 |
|---|---|---|
| `TEAM_STATUS_STOPPED_DAYS` | 7 | 「止まっている」の日数・「この7日」 |
| `TEAM_STATUS_GROWTH_WINDOW_DAYS` | 30 | 伸びを比べる期間 |
| `TEAM_STATUS_GROWTH_MIN_POSTS` | 5 | 判定に要る確定した投稿の数（006の判定を始める件数にそろえる） |
| `TEAM_STATUS_GROWTH_POOR_RATIO` | 0.8 | 「伸びていない」のしきい値（`[ASSUMPTION]`） |
| `TEAM_STATUS_ACTIVITY_ACTIONS` | `drafts_registered`・`draft_edited`・`drafts_approved`・`drafts_rejected` | 動きに数える操作の記録 |

## 並び（FR-012）

1. 「止まっている」の印があるものが先。その中は起点（`max(最後の日時, 入った日時)`）の古い順。
2. 印のないものは、人は名前の順、Accountはチームに入った順（`getTeamDetail` と同じ）。
3. Accountは、「止まっている」の次に「伸びていない」を上に置く。
