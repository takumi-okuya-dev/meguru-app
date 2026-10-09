# データモデル：チーム運用

**対象feature**：[spec.md](./spec.md) ／ **調査**：[research.md](./research.md) ／ **これまで**：[006 data-model.md](../006-performance-feedback/data-model.md)

Neon（Postgres 17）＋Drizzle。テーブルを5つと列挙型を1つ足し、既存の列挙型に値を、既存のテーブルに列を足す。マイグレーションは`apps/api/drizzle/0009_team_operations.sql`の1本。すべて後方互換で、既存の行は変えない（新しい列はNULLか既定値）。

## 全体の関係

```text
users ─1:0..1─ teams（パートナーのチーム）
                 ├─1:N─ team_editors ─N:1─ users（編集者）
                 └─1:N─ account_partners ─N:1─ accounts（手伝う先。本featureでは1Accountに1件まで）

memberships（Account×ユーザー×役割）
  owner  ：team_id NULL（001から）
  partner：team_id = 手伝うチーム（account_partners から作る）
  editor ：team_id = 所属するチーム（担当。パートナーが付ける）

account_partner_invites ─1:1─ accounts（パートナーの招待リンク）
activity_logs ─N:1─ accounts（操作の記録、90日）
```

## 列挙型

| 名前 | 変更 | 用途 |
|---|---|---|
| `membership_role` | 値`partner`・`editor`を足す（`ALTER TYPE ... ADD VALUE`） | Accountに対する役割（Constitution原則IV）。既存の`member`は使わない（消せないので残す） |
| `activity_kind`（新規） | `review`・`draft`・`content`・`settings`・`member` | 操作の記録の種類（画面の絞り込みの単位。FR-052） |

## 新しいテーブル

### teams（チーム）

パートナー1人に0か1行。初めてパートナーとして参加したときに作る（research.md R7）。

| 列 | 型 | 説明 |
|---|---|---|
| `id` | uuid PK | |
| `partner_user_id` | uuid NOT NULL UNIQUE、FK → `users.id`（削除で連鎖） | パートナー。1人1チーム |
| `name` | text NULL | チーム名（会社名）。50文字まで（CHECK）。NULLなら画面ではパートナーの名前を使う |
| `editor_invite_token_hash` | text NULL UNIQUE | 編集者の招待リンクの照合用（SHA-256の16進）。最初に表示したときに作る |
| `editor_invite_token_ciphertext`・`editor_invite_token_iv` | bytea NULL | 表示用の暗号化した写し（research.md R4） |
| `editor_invite_key_version` | smallint NULL | 暗号の鍵の版 |
| `editor_invite_rotated_at` | timestamptz NULL | 最後に作った（作り直した）日時 |
| `created_at`・`updated_at` | timestamptz | |

- 招待の4列は、すべてNULLかすべて値ありのどちらか（CHECK）。

### team_editors（チームの編集者）

| 列 | 型 | 説明 |
|---|---|---|
| `team_id` | uuid、FK → `teams.id`（削除で連鎖） | |
| `user_id` | uuid、FK → `users.id`（削除で連鎖） | 編集者 |
| `joined_at` | timestamptz NOT NULL | 参加した日時 |

- 主キー（`team_id`, `user_id`）。
- 1チーム10人まで（`TEAM_EDITOR_LIMIT`）。DBの制約ではなく、参加のトランザクションで`teams`の行を`FOR UPDATE`で取ってから数える（research.md R7）。
- チームのパートナー本人は入れない（参加のときに確かめる）。

### account_partners（手伝いの関係）

| 列 | 型 | 説明 |
|---|---|---|
| `account_id` | uuid、FK → `accounts.id`（削除で連鎖） | 手伝う先 |
| `team_id` | uuid、FK → `teams.id`（削除で連鎖） | 手伝うチーム |
| `delegate_review` | boolean NOT NULL DEFAULT false | 「投稿の承認・却下」を任せる（FR-030） |
| `delegate_settings` | boolean NOT NULL DEFAULT false | 「設定」を任せる |
| `joined_at` | timestamptz NOT NULL | パートナーが参加した日時 |
| `joined_notice_dismissed_at` | timestamptz NULL | オーナーのホームの「参加しました」を閉じた日時（FR-047） |
| `updated_at` | timestamptz | |

- 主キー（`account_id`, `team_id`）。将来、1つのAccountに複数のチームを持てる形（FR-016）。
- 本featureでは一意のインデックス`account_partners_one_per_account`（`account_id`）で1件までに制限する。複数にするときはこのインデックスを外す。
- パートナー自身がオーナーのAccountには作らない（参加のときに確かめる）。

### account_partner_invites（パートナーの招待リンク）

Accountに0か1行。オーナーが「招待リンクを作る」で作り、参加・取り消しで消し、作り直しで文字列を差し替える。

| 列 | 型 | 説明 |
|---|---|---|
| `account_id` | uuid PK、FK → `accounts.id`（削除で連鎖） | |
| `token_hash` | text NOT NULL UNIQUE | 照合用 |
| `token_ciphertext`・`token_iv` | bytea NOT NULL | 表示用の暗号化した写し |
| `key_version` | smallint NOT NULL | |
| `created_by_user_id` | uuid NULL、FK → `users.id`（SET NULL） | 作ったオーナー |
| `created_at` | timestamptz NOT NULL | 最後に作った（作り直した）日時 |

- パートナーがいるAccountには作れない（APIで確かめる）。

### activity_logs（操作の記録）

チームがあるAccountの操作だけを、その操作と同じトランザクションで書く（research.md R9）。

| 列 | 型 | 説明 |
|---|---|---|
| `id` | uuid PK | |
| `account_id` | uuid NOT NULL、FK → `accounts.id`（削除で連鎖） | |
| `actor_user_id` | uuid NULL、FK → `users.id`（SET NULL） | した人。絞り込みに使う |
| `actor_name` | text NOT NULL | その時点の名前の写し |
| `actor_role` | `membership_role` NOT NULL | その時点の役割 |
| `kind` | `activity_kind` NOT NULL | 絞り込みの種類 |
| `action` | text NOT NULL | 操作のコード（[contracts/api.md](./contracts/api.md)「操作の記録のコード」） |
| `item_count` | integer NOT NULL DEFAULT 1 | まとめての操作の件数（FR-050a） |
| `summary` | text NULL | 対象の要約（投稿の書き出し30文字、設定の変更の前後など） |
| `details` | jsonb NULL | まとめての操作の対象の書き出し（最大50件）、却下の理由、担当を変えた相手の名前など |
| `created_at` | timestamptz NOT NULL DEFAULT now() | |

- インデックス：（`account_id`, `created_at` DESC）、（`account_id`, `actor_user_id`, `created_at` DESC）。
- 90日を過ぎた行は日次の処理で消す（`ACTIVITY_LOG_RETENTION_DAYS = 90`）。画面の問い合わせも90日以内に絞る。

## 既存のテーブルに足す列

### memberships

| 列 | 型 | 説明 |
|---|---|---|
| `team_id` | uuid NULL、FK → `teams.id`（削除で連鎖） | partner・editor の行の、経由するチーム。ownerはNULL |

- CHECK：`(role = 'owner') = (team_id IS NULL)`（ownerだけがチームなし。マイグレーションの注意を参照）。
- 既存の`memberships_user_account_unique`（1人1Accountに1行）で、役割の重なりを防ぐ。
- インデックス：（`team_id`, `role`）（チームの操作で行をまとめて消すため）。

### post_drafts

| 列 | 型 | 説明 |
|---|---|---|
| `created_by_user_id` | uuid NULL、FK → `users.id`（SET NULL） | 登録した人（FR-053）。本featureより前の行はNULL |
| `edited_by_user_id` | uuid NULL、FK → `users.id`（SET NULL） | 最後に本文を直した人。時刻は006の`body_edited_at` |

### post_metrics

| 列 | 型 | 説明 |
|---|---|---|
| `feedback_version` | integer NOT NULL DEFAULT 1 | 改善メモの保存の衝突を見つける（research.md R8） |
| `feedback_updated_by_user_id` | uuid NULL、FK → `users.id`（SET NULL） | 改善メモ・「プロンプトに入れる」を最後に変えた人 |

### 保存した人（research.md R8）

衝突のときに「（名前）さんが先に保存しました」と出すため、次の表に`updated_by_user_id`（uuid NULL、FK → `users.id`、SET NULL）を足す。

| 表 | 列 |
|---|---|
| `strategy_designs` | `updated_by_user_id` |
| `promotions` | `updated_by_user_id` |
| `reference_posts` | `updated_by_user_id` |
| `research_keywords` | `updated_by_user_id` |
| `posting_schedules` | `updated_by_user_id` |
| `accounts` | `core_rules_updated_by_user_id`（投稿のルール） |

## 状態の移り変わり

### パートナー

```text
（なし）──招待リンクを作る──▶ 招待中（account_partner_invites）
招待中 ──作り直す──▶ 招待中（文字列が変わる）
招待中 ──取り消す──▶（なし）
招待中 ──参加する──▶ 参加中（account_partners＋memberships(partner)。招待の行を消す）
参加中 ──任せる範囲を変える──▶ 参加中（delegate_* を変える）
参加中 ──外す──▶（なし）（account_partners、そのチーム経由の memberships をすべて消す）
```

### 編集者

```text
（なし）──チームのリンクから参加──▶ 担当なし（team_editors のみ）
担当なし ⇄ 担当あり（memberships(editor) を Account ごとに付け外し）
担当あり／担当なし ──外す──▶（なし）（team_editors と、そのチーム経由の editor の memberships を消す）
パートナーが外される ──▶ そのAccountの editor の memberships だけ消える（team_editors は残る）
```

## 主な制約（まとめ）

| 規則 | どこで守るか |
|---|---|
| 1つのAccountに同じ人は1つの役割だけ | `memberships_user_account_unique` |
| 1つのAccountのパートナーは1チームまで | `account_partners_one_per_account`（将来外す） |
| 1人が持てるチームは1つ | `teams.partner_user_id` UNIQUE |
| 1チームの編集者は10人まで | 参加のトランザクション（`teams`を`FOR UPDATE`） |
| editorの担当は、手伝う先か、パートナー自身がオーナーのAccountだけ | 担当を付けるAPI（同じトランザクションで確かめる） |
| owner の行は team_id NULL、partner・editor は team_id あり | CHECK |
| 自分がオーナーのAccountにパートナー・編集者として入れない | 参加のAPI（1人1Accountに1行の制約でも防ぐ） |

## マイグレーションの注意

- `ALTER TYPE membership_role ADD VALUE`で足した値は、コミットするまで同じトランザクションの中で使えない（マイグレーションは1ファイル1トランザクションで流れる）。そのため、マイグレーションの中では新しい値（`partner`・`editor`）を書かない。`memberships`のCHECKは既存の値だけで書く：`(role = 'owner') = (team_id IS NULL)`。ローカルのPostgres 17とNeonで適用を確かめる（quickstart 手順1）。
- 既存の`memberships`の行はすべて`owner`なので、CHECKを足しても違反しない。
