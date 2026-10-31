# Data Model：テスト用のグループ

**Feature**：[spec.md](./spec.md) | **計画**：[plan.md](./plan.md) | **日付**：2026-10-31

マイグレーション`0016_test_groups`の1本。表を3つ足し、`users`に列を1つ足す。すべて「足す」だけで、前の版のAPIでも壊れない（[リリースの手順書](../../docs/release-runbook.md) 3）。

## users（列を足す）

| 列 | 型 | 制約・既定 | 意味 |
|---|---|---|---|
| `signed_up_open` | boolean | NOT NULL、既定 false | グループの仕組みがOFFの間に登録した（または、この機能の前からいた）。trueなら、グループに入っていなくても入れる人（research.md R2） |

- マイグレーションで、今ある行をすべて true にする（`UPDATE users SET signed_up_open = true`）。
- 新しい行は、認証のミドルウェアのJITの作成で、仕組みがOFFなら true、ONなら false で作る。

## test_groups（新規）

| 列 | 型 | 制約・既定 | 意味 |
|---|---|---|---|
| `id` | uuid | 主キー、乱数 | |
| `name` | text | NOT NULL、1〜50文字 | グループ名（組織やコミュニティの名前） |
| `capacity` | integer | NOT NULL、1〜1000 | 人数の上限 |
| `invite_token_hash` | text | NOT NULL、一意 | 招待の文字列のSHA-256（照合用） |
| `invite_token_ciphertext` | bytea | NOT NULL | 招待の文字列の暗号文（運営者の画面に出す用。AADはid） |
| `invite_token_iv` | bytea | NOT NULL | |
| `invite_key_version` | smallint | NOT NULL | 暗号の鍵の版 |
| `invite_rotated_at` | timestamptz | NULL可 | 最後に作り直した時刻 |
| `closed_at` | timestamptz | NULL可 | 閉じた時刻。入っていれば閉じている（開き直さない） |
| `created_by_user_id` | uuid | `users.id`、削除でNULL | 作った運営者 |
| `created_at`・`updated_at` | timestamptz | | |

## test_group_members（新規）

今グループに入っている人だけを持つ（外す・閉じるときは行を消す。research.md R3）。

| 列 | 型 | 制約・既定 | 意味 |
|---|---|---|---|
| `user_id` | uuid | 主キー、`users.id`、削除でcascade | 1人1グループ（FR-008） |
| `group_id` | uuid | NOT NULL、`test_groups.id`、削除でcascade | |
| `joined_at` | timestamptz | NOT NULL、既定 now | |
| `granted_billing_exempt` | boolean | NOT NULL、既定 false | 入ったときに料金なしの印を付けた（出るときに戻す。research.md R7） |

索引：`test_group_members_group_idx`（`group_id`）。人数は`group_id`ごとの行数。

## test_group_events（新規）

グループの出来事の記録（FR-013、research.md R6）。

| 列 | 型 | 制約・既定 | 意味 |
|---|---|---|---|
| `id` | uuid | 主キー | |
| `group_id` | uuid | NOT NULL、`test_groups.id`、削除でcascade | |
| `action` | text | NOT NULL、CHECK（下の一覧） | 何をしたか |
| `actor_user_id` | uuid | `users.id`、削除でNULL | した人（入った本人・運営者） |
| `actor_name` | text | NOT NULL | した人の名前（その時点の表示名かメールアドレス） |
| `subject_name` | text | NULL可 | された人の名前（入った・外した） |
| `details` | jsonb | NULL可 | 変える前・後の値（上限・名前） |
| `created_at` | timestamptz | NOT NULL、既定 now | |

`action`：`created`・`renamed`・`capacity_changed`・`invite_rotated`・`closed`・`member_joined`・`member_removed`。

索引：`test_group_events_group_created_idx`（`group_id`, `created_at` desc）。

## 判定（SQLの条件 `testAccessSql(u)`）

入れる人＝次のどれか（research.md R2）。運営者は認証のミドルウェアでだけ足す（定期処理では、運営者も上の2つのどちらかで決まる。運営者は開発者で、`signed_up_open`が true）。

```sql
u.signed_up_open
OR EXISTS (
  SELECT 1 FROM test_group_members m
  JOIN test_groups g ON g.id = m.group_id
  WHERE m.user_id = u.id AND g.closed_at IS NULL
)
```

閉じたグループの行は閉じるときに消すので、`closed_at IS NULL`は二重の守り（閉じる途中のトランザクションで読まれても入れない）。

## 状態の移り変わり

```text
（入れない人）──「参加する」（空きあり・閉じていない）──▶（グループの人：入れる人・料金なし）
（グループの人）──運営者が外す／グループを閉じる──▶（入れない人。グループで付いた料金なしの印は外れる）
（グループの人）──退会──▶（行ごと消える）
（入れない人）──別のグループの「参加する」──▶（そのグループの人）
signed_up_open = true の人は、グループの出入りに関係なく、いつも入れる人
```
