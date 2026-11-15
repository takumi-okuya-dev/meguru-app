# Data Model：機能のまとまりごとのON/OFF

**Feature**：[spec.md](./spec.md) | **計画**：[plan.md](./plan.md) | **日付**：2026-11-04

マイグレーション`0018_feature_switches`の1本。表を3つ足すだけで、既存の表は変えない。前の版のAPIでも壊れない（[リリースの手順書](../../docs/release-runbook.md) 3）。行がない人・グループはすべてONなので、既存の利用者に行を作らない（research.md R2）。

## まとまり（共有の定数）

`packages/shared/src/features.ts`：

| 値 | 画面の名前 | 中身（spec.md FR-001） |
|---|---|---|
| `autopost` | 自動投稿 | 投稿をつくる・投稿ストック・パフォーマンス・自動投稿の設定。定期処理の自動投稿と反応の取り込み |
| `strategy` | 戦略 | 課題・宣伝内容・リサーチと、その中のAIの手助け |
| `team` | チーム | チームを作る・入る・チームの画面・担当・操作の記録・手伝う／見せてもらう |

`FEATURES = ["autopost", "strategy", "team"] as const`。DBの CHECK もこの3つ。

## feature_disables（新規）

人の設定で、OFFのまとまりだけを持つ。行があればOFF、なければON。

| 列 | 型 | 制約・既定 | 意味 |
|---|---|---|---|
| `user_id` | uuid | `users.id`、削除でcascade | OFFにされた人 |
| `feature` | text | NOT NULL、CHECK（3つ） | まとまり |
| `disabled_at` | timestamptz | NOT NULL、既定 now | OFFにした時刻 |
| `disabled_by_user_id` | uuid | `users.id`、削除でNULL | OFFにした運営者 |

主キー：`(user_id, feature)`。

## group_feature_disables（新規）

グループの設定で、OFFのまとまりだけを持つ（FR-017）。

| 列 | 型 | 制約・既定 | 意味 |
|---|---|---|---|
| `group_id` | uuid | `test_groups.id`、削除でcascade | OFFにされたグループ |
| `feature` | text | NOT NULL、CHECK（3つ） | まとまり |
| `disabled_at` | timestamptz | NOT NULL、既定 now | OFFにした時刻 |
| `disabled_by_user_id` | uuid | `users.id`、削除でNULL | OFFにした運営者 |

主キー：`(group_id, feature)`。閉じたグループの行は残すが、判定では使わない（`test_groups.closed_at IS NULL` のグループだけを見る）。

## feature_setting_events（新規）

機能の設定を変えた記録（FR-014、research.md R7）。人かグループのどちらか一方。

| 列 | 型 | 制約・既定 | 意味 |
|---|---|---|---|
| `id` | uuid | 主キー | |
| `subject_user_id` | uuid | `users.id`、削除でcascade | 設定を変えられた人（グループなら NULL） |
| `subject_group_id` | uuid | `test_groups.id`、削除でcascade | 設定を変えられたグループ（人なら NULL） |
| `feature` | text | NOT NULL、CHECK（3つ） | まとまり |
| `action` | text | NOT NULL、CHECK（`disabled`・`enabled`） | OFFにした・ONに戻した |
| `actor_user_id` | uuid | `users.id`、削除でNULL | 変えた運営者 |
| `actor_name` | text | NOT NULL | 変えた運営者の名前（その時点） |
| `subject_name` | text | NOT NULL | 変えられた人・グループの名前（その時点） |
| `created_at` | timestamptz | NOT NULL、既定 now | |

CHECK：`feature_setting_events_one_subject`（`subject_user_id` と `subject_group_id` のどちらか一方だけが NULL でない）。
索引：`feature_setting_events_created_idx`（`created_at` desc）、`feature_setting_events_subject_created_idx`（`subject_user_id`, `created_at` desc）。

一覧の「最後に変えた日」（FR-013）は、その人の記録のうち一番新しい`created_at`（ONに戻した変更も含む）。

## 判定（使えないまとまり）

人 U の使えないまとまり＝人の設定のOFF ∪ U が入っている閉じていないグループの設定のOFF（FR-018）。`apps/api/src/services/feature-sql.ts` の `disabledFeaturesSql(U)` 1つにまとめ、`authorizeAccount`・認証のミドルウェア・定期処理のすべてがこれを使う。

```sql
coalesce((
  SELECT array_agg(f.feature) FROM (
    SELECT d.feature FROM feature_disables d WHERE d.user_id = U
    UNION
    SELECT gd.feature FROM test_group_members m
      JOIN test_groups g ON g.id = m.group_id AND g.closed_at IS NULL
      JOIN group_feature_disables gd ON gd.group_id = m.group_id
    WHERE m.user_id = U
  ) f
), '{}')
```

- `AccountAccess.features` ＝ オーナーの使えるまとまり。
- `opts.feature` がオーナーの使えるまとまりになければ `403 FEATURE_DISABLED`。
- 関わりが担当・見せてもらう（チーム経由）なら、オーナーと見る人の両方で `team` が使えるときだけ。どちらかで使えなければ `404 ACCOUNT_NOT_FOUND`（関わりがないのと同じ。FR-009・FR-012）。

## 状態の移り変わり

```text
（ON：行なし）──運営者がOFFにする──▶（OFF：行あり。記録 disabled）
（OFF：行あり）──運営者がONに戻す／すべてONに戻す──▶（ON：行なし。記録 enabled）
（グループでOFFの人）──グループから外れる／グループを閉じる──▶（人の設定だけで判定）
（人）──退会──▶（行も記録も消える）
書いた内容（課題・宣伝内容・参考投稿・承認済みの案・反応・チーム）は、どの移り変わりでも消さない
```
