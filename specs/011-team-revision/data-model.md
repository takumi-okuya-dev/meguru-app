# Data Model：チームの見直し

**日付**：2026-10-13 | **計画**：[plan.md](./plan.md) | **マイグレーション**：`apps/api/drizzle/0012_team_revision.sql`

001〜010の表のうち、変えるものと足すものだけを書く。

## 列挙型

| 列挙型 | 値 | 説明 |
|---|---|---|
| `team_role`（新規） | `admin`・`member`・`editor` | チームでのロール（spec用語） |
| `membership_role`（値を足す） | 既存の`owner`・`member`・`partner`・`editor`に`admin`を足す | `memberships.role`は`owner`・`editor`だけを使う。`activity_logs.actor_role`で`admin`・`member`も使う。`partner`は008の記録にだけ残る |

## `teams`（作り直す）

| 列 | 型 | 説明 |
|---|---|---|
| `id` | `uuid` PK | |
| `name` | `text` NOT NULL | 1〜50文字（`char_length`の検査） |
| `admin_user_id` | `uuid` NOT NULL → `users.id`（ON DELETE RESTRICT） | 管理者。`team_members`の`admin`の行と同じ値を同じトランザクションで書く。今のアプリに利用者の削除（退会）はない。退会は011の次のfeatureで作り、退会した人はチームから自動で外れる（管理者なら、FR-046と同じく、いちばん長くいる人へ引き継ぎ、誰もいなければチームを消す）。その処理が`users`の行を消す前に済むので、RESTRICTのままにする |
| `invite_token_hash` | `text` NOT NULL UNIQUE | 招待リンクの照合（008 R4と同じ仕組み） |
| `invite_token_ciphertext`・`invite_token_iv`・`invite_key_version` | `bytea`・`bytea`・`smallint` NOT NULL | 表示用の暗号化した写し |
| `invite_rotated_at` | `timestamptz` NULL | 作り直した日時 |
| `created_at`・`updated_at` | `timestamptz` | |

- 索引：`teams_admin_idx`（`admin_user_id`）。1人が管理者のチームは20まで（作るトランザクションでusersの行ロックを取って数える）。

## `team_members`（新規）

| 列 | 型 | 説明 |
|---|---|---|
| `team_id` | `uuid` → `teams.id`（ON DELETE CASCADE） | |
| `user_id` | `uuid` → `users.id`（ON DELETE CASCADE） | |
| `role` | `team_role` NOT NULL | 入ったときは`member`。作った人は`admin` |
| `joined_at` | `timestamptz` NOT NULL | |
| `joined_notice_dismissed_at` | `timestamptz` NULL | 管理者がこの人の参加の知らせを閉じた日時（R9）。管理者の行では使わない |

- 主キー：（`team_id`・`user_id`）。
- 部分一意索引：`team_members_one_admin`（`team_id`）`WHERE role = 'admin'`。
- 索引：`team_members_user_idx`（`user_id`）。
- 上限：1チーム50人、うち編集者10人（参加・ロールの切り替えのトランザクションでチームの行ロックを取って数える）。

## `team_accounts`（新規）

| 列 | 型 | 説明 |
|---|---|---|
| `team_id` | `uuid` → `teams.id`（ON DELETE CASCADE） | |
| `account_id` | `uuid` → `accounts.id`（ON DELETE CASCADE） | |
| `added_by_user_id` | `uuid` → `users.id` | 入れた人（そのアカウントのオーナー） |
| `shared` | `boolean` NOT NULL DEFAULT false | 「チームに見せる」 |
| `added_at`・`updated_at` | `timestamptz` | |

- 主キー：（`team_id`・`account_id`）。
- 一意索引：`team_accounts_one_team_per_account`（`account_id`）。複数のチームに広げるときはこの索引を外す。
- 規則：入れられるのは、そのアカウントのオーナーが`team_members`にいるときだけ。チームの人は自分のアカウントを1つ以上入れている（最後の1つは外せない。アカウントの削除で0件になったら抜ける。research.md R7）。

## `memberships`（使い方を変える）

| `role` | `team_id` | 意味 |
|---|---|---|
| `owner` | NULL | アカウントのオーナー（001のまま） |
| `editor` | そのチーム | 担当。編集者、または自分を担当にした管理者。`assigned_notice_dismissed_at`（新規、`timestamptz` NULL）で担当の知らせを閉じた日時（R9） |

- `partner`の行は作らない。008の`partner`・`editor`の行はマイグレーションで消す。
- 規則：`editor`の行は、その`team_id`に`account_id`が入っていて、`user_id`がそのチームの編集者か管理者で、`user_id`がそのアカウントのオーナーでないときだけ作る（`authorizeAssignment`で確かめる）。
- `memberships_team_matches_role`の検査（`owner`だけ`team_id`がNULL）はそのまま。

## 消す表

- `account_partners`、`account_partner_invites`、`team_editors`（008）。データは移さない（research.md R2）。

## `activity_logs`（そのまま）

- `actor_role`に`admin`・`member`が入りうる。`action`を足す：`team_created`・`team_renamed`・`team_deleted`・`team_member_joined`・`team_member_left`・`team_member_removed`・`team_role_changed`（`details: { userName, from, to }`）・`team_admin_transferred`（`details: { from, to }`）・`assignment_added`・`assignment_removed`（008の名前を使う）・`team_account_added`・`team_account_removed`・`team_share_changed`（`details: { shared }`）。

## 状態の移り変わり

```text
（チームの人）
  招待リンクで参加 ──▶ member ──管理者が切り替え──▶ editor
                         ▲                            │
                         └──────管理者が切り替え（担当を消す）┘
  admin ──引き継ぎ──▶ editor（担当が1件以上）／ member（担当なし）
  どのロールからでも：抜ける・外される ──▶（チームの人でなくなる。アカウントと担当を外す）
  admin は抜ける前に引き継ぐ。ほかに誰もいなければ、チームを削除する

（アカウント）
  チームに入れる（shared=false）──オーナーが切り替え──▶ shared=true
  オーナーが外す（最後の1つは不可）・オーナーが抜ける・アカウントの削除 ──▶ チームから外れる
```

## 検証の規則

| 対象 | 規則 | 出どころ |
|---|---|---|
| チーム名 | 前後の空白を除いて1〜50文字 | FR-010 |
| 参加 | 自分のアカウント（オーナーのもの）を1つ以上、どれもほかのチームに入っていない | FR-013・FR-015 |
| 人数 | 1チーム50人、編集者10人 | Assumptions |
| 管理者 | 1チームに1人。管理者は自分のロールを切り替えられない | FR-045、Edge Cases |
| 担当 | チームのアカウント×（編集者・管理者）で、自分のアカウントは不可 | FR-022 |
| 見せる | そのアカウントのオーナーだけが切り替えられる | FR-030 |
