# Data Model：Threadsのアルゴリズムの解析

**Feature**：[spec.md](./spec.md) | **計画**：[plan.md](./plan.md) | **日付**：2026-11-05

マイグレーション `0020_algorithm_analysis` の1本。表を2つ足すだけで、前の版のAPIでも壊れない（[リリースの手順書](../../docs/release-runbook.md) 3）。解析の結果は保存しない（research.md R1）。

## analysis_settings（新規）

Accountに0か1行。行がなければ初めの値（傾向をプロンプトに入れる・テーマなし。APIでは `version: null`）。

| 列 | 型 | 制約・既定 | 意味 |
|---|---|---|---|
| `account_id` | uuid | 主キー、`accounts.id`、削除でcascade | |
| `trends_in_prompt` | boolean | NOT NULL、既定 true | 傾向をプロンプトに入れるか（FR-040a） |
| `themes` | jsonb | NOT NULL、既定 `[]` | テーマの一覧 `[{ id, name }]`。10個まで、`name` は1〜20文字で重ならない、`id` は `^t[0-9a-z]{1,8}$`（shared の `analysisThemesSchema` で確かめる） |
| `version` | int | NOT NULL、既定 1 | 保存の衝突の検知（STALE_UPDATE） |
| `updated_by_user_id` | uuid | `users.id`、削除でNULL | 最後に変えた人 |
| `updated_at` | timestamptz | NOT NULL、既定 now | |

## post_classifications（新規）

投稿（下書き）に0か1行。内容の分類（FR-050〜FR-053）。

| 列 | 型 | 制約・既定 | 意味 |
|---|---|---|---|
| `draft_id` | uuid | 主キー、`post_drafts.id`、削除でcascade | 投稿 |
| `account_id` | uuid | NOT NULL、`accounts.id`、削除でcascade | 判定と集計のため |
| `opening_type` | text | NOT NULL、CHECK（`aruaru`・`question`・`assertion`・`story`・`number`・`announce`・`other`） | 書き出しの型 |
| `theme_id` | text | NULL可、`^t[0-9a-z]{1,8}$` | テーマ（`analysis_settings.themes` の `id`）。NULL＝テーマなし |
| `source` | text | NOT NULL、CHECK（`ai`・`manual`） | 外のAIの答えから付けたか、手で直したか |
| `updated_by_user_id` | uuid | `users.id`、削除でNULL | |
| `updated_at` | timestamptz | NOT NULL、既定 now | |

索引：`post_classifications_account_idx`（`account_id`）。

- テーマを消したとき：同じトランザクションで、そのテーマの `theme_id` をNULLにする。
- 一覧にない `theme_id`（消したあとに残ったもの）は、集計でテーマなしとして扱う。

## 共有の定数（packages/shared/src/limits.ts）

| 名前 | 値 | 意味 |
|---|---|---|
| `ANALYSIS_PERIOD_DAYS` | 90 | 解析の期間（FR-001） |
| `ANALYSIS_MIN_TOTAL` | 20 | 表と傾向を出す最小の件数（research.md R11） |
| `ANALYSIS_MIN_BUCKET` | 10 | 区切りの件数のしきい値（FR-011・FR-030） |
| `ANALYSIS_TREND_RATIO` | 1.5 | 傾向にする中央値の差（FR-030） |
| `ANALYSIS_RECOMMENDED_TOP` | 0.2 | おすすめに乗った目安の上位の割合（FR-020） |
| `ANALYSIS_MAX_TRENDS` | 5 | 傾向の数の上限（FR-040） |
| `ANALYSIS_CLASSIFY_BATCH` | 50 | 分類のプロンプトに入れる投稿の数（FR-051） |
| `ANALYSIS_THEMES_MAX` | 10 | テーマの数（FR-050） |
| `ANALYSIS_THEME_NAME_MAX` | 20 | テーマの名前の文字数 |

## 共有の型（packages/shared/src/analysis/）

| 名前 | 内容 |
|---|---|
| `OPENING_TYPES`・`OPENING_TYPE_LABELS` | 書き出しの型の7つと名前 |
| `TIME_BUCKETS` | `morning`・`noon`・`evening`・`night`・`latenight`（朝・昼・夕方・夜・深夜） |
| `TEXT_FEATURES` | `question`・`number`・`shortFirstLine`・`manyLines`・`emoji`・`callout`（research.md R4） |
| `AnalysisPost` | 計算の入力。`id`・`body`・`publishedAt`・`views`・`likes`・`replies`・`reposts`・`quotes`・`followersAtPost`・`h24Views`・`openingType`・`themeId`・`promo` |
| `PostValues` | 投稿ごとに求めた値（R3・R4）。`timeBucket`・`dayKind`・`lengthBucket`・`features`・`engagementRate`・`replyRate`・`spread`・`firstSpeed`・`laterGrowth` |
| `BucketRow` | `{ key, label, count, views, engagementRate, replyRate, mark: "few" \| "untried" \| null }`（中央値。件数が0なら値は null） |
| `FeatureRow` | `{ key, label, with: { count, views }, without: { count, views }, ratio: number \| null, mark }` |
| `Trend` | `{ dimension, key, text, count, views, otherViews, ratio, promptable }`（`dimension` は `time`・`day`・`length`・`feature`・`opening`・`theme`） |
| `RecommendedPost` | `{ id, head, publishedAt, views, spread, firstSpeed, laterGrowth, replyRate }`（`head` は本文の初めの40文字） |
| `AnalysisResult` | 下の「APIの応答」の `result` |

## 状態

```text
analysis_settings：（行なし＝初めの値）──切り替え・テーマを保存──▶ 行を作る（version 1）──保存──▶ version +1
post_classifications：（行なし＝分類なし）──AIの答えを反映（source=ai）／手で選ぶ（source=manual）──▶ 行を作る・入れ替える
投稿（下書き）を消す・Accountを消す・退会：cascade で消える（013の退会の流れのまま）
```
