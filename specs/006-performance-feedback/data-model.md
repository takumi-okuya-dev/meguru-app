# データモデル：パフォーマンス分析と改善フィードバック

**対象feature**：[spec.md](./spec.md) ／ **調査**：[research.md](./research.md) ／ **これまで**：[005 data-model.md](../005-auto-post/data-model.md)

Neon（Postgres 17）＋Drizzle。テーブルを3つと列挙型を3つ足し、既存の3つのテーブルに列を足す。マイグレーションは`apps/api/drizzle/0008_performance.sql`の1本。

## 列挙型

| 名前 | 値 | 用途 |
|---|---|---|
| `metrics_state` | `updating`・`confirmed`・`late_confirmed`・`unmeasurable` | 反応数の記録の状態（research.md R4）。行がない投稿は「確定待ち（まだ取っていない）」 |
| `metrics_kind` | `h24`・`d3`・`d7`・`late` | 取り込みの種類（24時間・3日・7日・遅れて確定） |
| `judgment` | `good`・`normal`・`poor` | 判定（好調・普通・低調） |

取り方（時刻の処理・毎日の処理）は`text`で`slot`・`daily`を持ち、CHECKで値を制限する。計測できない理由も`text`で`no_media_id`・`not_found`。

## 新しいテーブル

### post_metrics（反応数の記録）

投稿済みの下書きに0か1行。最初に取り込んだとき（または計測できないと分かったとき）に作る。

| 列 | 型 | 説明 |
|---|---|---|
| `draft_id` | uuid PK、FK → `post_drafts.id`（削除で連鎖） | 投稿 |
| `account_id` | uuid NOT NULL、FK → `accounts.id`（削除で連鎖） | 集計・ロックの単位 |
| `state` | `metrics_state` NOT NULL | |
| `views`・`likes`・`replies`・`reposts`・`quotes`・`shares` | integer NULL | 最新の値。返らなかった指標はNULL |
| `last_fetched_at` | timestamptz NULL | 最終取り込み日時（`unmeasurable`で一度も取っていなければNULL） |
| `last_elapsed_minutes` | integer NULL | 最終取り込みの、投稿からの経過（分）。CSVでは時間（整数）に直す |
| `last_kind` | `metrics_kind` NULL | 最後に取った種類 |
| `confirmed_at` | timestamptz NULL | 確定した日時 |
| `unmeasurable_reason` | text NULL | `no_media_id`・`not_found` |
| `judgment` | `judgment` NULL | 確定したときに1回だけ入れる（research.md R5） |
| `judgment_ratio` | double precision NULL | 判定に使った倍率（丸める前） |
| `judgment_baseline` | double precision NULL | 判定に使った基準値 |
| `judged_at` | timestamptz NULL | |
| `feedback_memo` | text NULL | 傾向メモ（200文字まで） |
| `include_in_prompt` | boolean NOT NULL DEFAULT true | 「プロンプトに入れる」 |
| `feedback_updated_at` | timestamptz NULL | メモ・切り替えを最後に変えた日時 |
| `created_at`・`updated_at` | timestamptz | |

**CHECK**：
- `state = 'unmeasurable'` ⇔ `unmeasurable_reason IS NOT NULL`
- `state IN ('confirmed','late_confirmed')` ⇔ `confirmed_at IS NOT NULL`
- `judgment IS NOT NULL` ⇒ `state IN ('confirmed','late_confirmed') AND judgment_ratio IS NOT NULL AND judgment_baseline > 0`
- `char_length(feedback_memo) <= 200`
- 6つの数は0以上

**インデックス**：
- `(account_id, state)`：タブの件数・基準値
- `(account_id, judgment) WHERE judgment = 'poor'`：低調のタブとプロンプト

**状態の移り変わり**（research.md R4）：

```text
（行なし＝確定待ち）
   ├─ h24 / d3 を取る ─────────────→ updating
   ├─ d7 を取る（経過192時間以内）──→ confirmed ──（判定：1回）
   ├─ 経過192時間を過ぎて取る ──────→ late_confirmed ──（判定：1回。基準値には使わない）
   └─ 投稿IDなし ──────────────────→ unmeasurable（no_media_id）
updating
   ├─ d3 を取る ───────────────────→ updating
   ├─ d7 を取る ───────────────────→ confirmed / late_confirmed
   └─ 投稿が見つからない ───────────→ unmeasurable（not_found。それまでの値と履歴は残す）
confirmed / late_confirmed / unmeasurable：以後変わらない（判定・数は固定。メモと切り替えだけ変えられる）
```

### post_metric_snapshots（取り込みの履歴）

1回の取り込みで1行。上書きしない（FR-002b）。

| 列 | 型 | 説明 |
|---|---|---|
| `id` | uuid PK | |
| `draft_id` | uuid NOT NULL、FK → `post_drafts.id`（削除で連鎖） | |
| `account_id` | uuid NOT NULL、FK → `accounts.id`（削除で連鎖） | |
| `kind` | `metrics_kind` NOT NULL | |
| `method` | text NOT NULL（`slot`・`daily`） | 取り方 |
| `fetched_at` | timestamptz NOT NULL | |
| `elapsed_minutes` | integer NOT NULL | 投稿からの経過（分） |
| `views`〜`shares` | integer NULL | |

**一意**：`(draft_id, kind)`。同じ時点を二重に入れない（重なった処理でも`ON CONFLICT DO NOTHING`で1つになる）。
**インデックス**：`(account_id, fetched_at)`：取り込みごとのCSV。

### follower_snapshots（フォロワー数の記録）

| 列 | 型 | 説明 |
|---|---|---|
| `account_id` | uuid、FK → `accounts.id`（削除で連鎖） | |
| `snapshot_date` | date（日本時間） | |
| `followers_count` | integer NOT NULL | |
| `captured_at` | timestamptz NOT NULL | |

**主キー**：`(account_id, snapshot_date)`。
**投稿時点のフォロワー数**：`captured_at <= published_at`で最も新しい行（FR-002c）。**取り込みの時点のフォロワー数**：`snapshot_date`が取り込んだ日（日本時間）の行。どちらも書き出しのときに結合して求め、履歴の行には持たない。

## 既存のテーブルに足す列

### post_drafts

| 列 | 型 | 説明 |
|---|---|---|
| `body_edit_tracked` | boolean NOT NULL | マイグレーションで既存の行は`false`（不明）。その後の既定は`true`（research.md R9） |
| `body_edited_at` | timestamptz NULL | 登録の後に本文を人が直した最後の日時（`updateDraft`で本文が変わったとき） |
| `published_slot_minute` | smallint NULL（0〜1439） | 公開した時刻の枠（ずらす前） |
| `published_carryover` | boolean NULL | 持ち越しで公開したか |
| `published_prioritized` | boolean NULL | 「次に投稿する」で前に出していたか |

公開の3列は、005の公開の成功の記録で一緒に入れる。本featureより前に公開した下書きはNULL（CSVでは空欄）。
CSVの「登録の後に本文を直したか」：`body_edit_tracked = false`→「不明」、`body_edited_at IS NOT NULL`→「はい」、それ以外→「いいえ」。

### draft_batches

| 列 | 型 | 説明 |
|---|---|---|
| `strategy_updated_at` | timestamptz NULL | 登録した時点の課題の最終更新（`strategy_designs.updated_at`） |
| `promotions_changed_at` | timestamptz NULL | 同じく宣伝内容（`accounts.promotions_changed_at`） |
| `research_changed_at` | timestamptz NULL | 同じくリサーチ（`accounts.research_changed_at`） |
| `core_rules_changed_at` | timestamptz NULL | 同じく投稿ルール（`accounts.core_rules_changed_at`） |

本featureより前のバッチはNULL。

### accounts

| 列 | 型 | 説明 |
|---|---|---|
| `promotions_changed_at` | timestamptz NULL | 宣伝内容を追加・変更・削除・状態を変えた最後の日時 |
| `research_changed_at` | timestamptz NULL | 参考の投稿・キーワードを追加・変更・削除した最後の日時 |
| `core_rules_changed_at` | timestamptz NULL | 投稿ルールを保存した最後の日時 |
| `insights_denied_at` | timestamptz NULL | 反応数を読む権限がないと分かった日時（research.md R11）。再接続で消す |

マイグレーションで、既存のAccountの`promotions_changed_at`・`research_changed_at`に、各表（`promotions`、`reference_posts`と`research_keywords`）の`max(updated_at)`を入れる（行がなければNULL）。`core_rules_changed_at`は保存日時の記録がないのでNULLのまま（その間に登録したバッチの「投稿ルールの最終更新日時」は空欄になる）。

## マイグレーション（0008_performance.sql）

1. 列挙型3つを作る。
2. `post_metrics`・`post_metric_snapshots`・`follower_snapshots`を作る。
3. `post_drafts`に列を足す：`body_edit_tracked boolean NOT NULL DEFAULT false`で既存の行を`false`にしてから、`ALTER COLUMN body_edit_tracked SET DEFAULT true`。ほかの列はNULLで足す。
4. `draft_batches`・`accounts`に列を足し、`accounts`の`*_changed_at`を埋める。

後方互換：既存のコードは新しい列を読まず、新しい列はNULLか既定値なので、005までの動きは変わらない。新しい列挙型の値は、同じトランザクションの中では使わない（005と同じ注意）。

## 読み書きのルール

- **反応数の段階の書き込み**（research.md R3）：取り込みの履歴の追加（`ON CONFLICT (draft_id, kind) DO NOTHING`）、`post_metrics`のupsert、判定、フォロワー数の記録を、`db.batch`で1回にまとめる。
  - `post_metrics`のupsertは、`state`が`confirmed`・`late_confirmed`・`unmeasurable`の行を変えない条件で行う（重なった処理が確定の値を上書きしない）。
- **判定**（research.md R5）：同じバッチの最後に、確定した投稿のあったAccountごとに1つのSQLで行う。
- **傾向メモ・切り替え**：`post_metrics`の`judgment = 'poor'`の行だけを更新する。後から保存したもので上書き（spec エッジケース）。
- **削除**：Account・下書きの削除で、3つの新しい表の行も連鎖して消える。001のデータ削除の依頼（Accountの削除）でも同じ。
