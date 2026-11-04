# Data Model：外部媒体展開

**Feature**：[spec.md](./spec.md) | **計画**：[plan.md](./plan.md) | **日付**：2026-11-04

マイグレーション `0019_external_media` の1本。足すだけで、前の版のAPIでも壊れない（[リリースの手順書](../../docs/release-runbook.md) 3）。

## promotions（列を足す）

| 列 | 型 | 制約・既定 | 意味 |
|---|---|---|---|
| `event` | jsonb | NULL可 | イベントの情報（下の `promotionEventSchema`）。NULLならイベントの情報なし |

`version` は今の列をそのまま使う（イベントの情報を直しても、宣伝内容の版が上がる）。

### promotionEventSchema（packages/shared/src/schemas.ts）

| 項目 | 型 | 制約 | 意味 |
|---|---|---|---|
| `startAt` | string | `YYYY-MM-DDTHH:mm`（日本時間）、必須 | 開始 |
| `endAt` | string・null | 同じ形、`startAt` 以後 | 終了（なくてもよい） |
| `format` | `"venue"`・`"online"` | 必須 | 会場かオンラインか |
| `venueName` | string・null | 100文字まで | 会場名 |
| `prefecture` | string・null | 47都道府県のどれか | 都道府県 |
| `address` | string・null | 200文字まで | 市区町村・番地 |
| `building` | string・null | 100文字まで | 建物・階 |
| `station` | string・null | 60文字まで | 最寄り駅（例：御徒町駅 徒歩3分） |
| `capacity` | int・null | 1〜100000 | 定員（NULL＝決めていない） |
| `feeYen` | int・null | 0〜1000000 | 参加費（0＝無料、NULL＝金額にできない） |
| `feeNote` | string・null | 500文字まで | 参加費の説明（割引・飲み放題など） |
| `cancelPolicy` | string・null | 1000文字まで | キャンセルの決まり |
| `audience` | string・null | 300文字まで | 対象者 |
| `organizer` | string・null | 100文字まで | 主催者名 |

申込先のURLは、今の `linked_url`（専用URL）を使う（spec FR-001）。

## promotion_listings（新規）

宣伝内容×媒体で1行。掲載内容と状況。

| 列 | 型 | 制約・既定 | 意味 |
|---|---|---|---|
| `promotion_id` | uuid | `promotions.id`、削除でcascade | 宣伝内容 |
| `account_id` | uuid | `accounts.id`、削除でcascade | 判定と一覧のため（宣伝内容のAccount） |
| `media` | text | NOT NULL、CHECK（`kokuchpro`・`peatix`・`tsunagate`・`jmty`・`youtrust`） | 媒体 |
| `status` | text | NOT NULL、既定 `not_started`、CHECK（`not_started`・`drafting`・`posted`・`stopped`） | 状況 |
| `posted_url` | text | NULL可、`https?://` で始まる、2000文字まで | 掲載URL |
| `fields` | jsonb | NULL可 | 欄の値（`{ [fieldKey]: string }`）。NULL＝まだ作っていない |
| `fixes` | jsonb | NULL可 | 自動で直した内容（`[{ field, excerpt, reason }]`） |
| `image_style` | text | 既定 `illustration`、CHECK（`illustration`・`photo`） | 画像の種類 |
| `source_version` | int | NULL可 | 作ったときの宣伝内容の `version`（R8） |
| `generated_at` | timestamptz | NULL可 | 作った日時 |
| `version` | int | NOT NULL、既定 1 | 保存の衝突の検知 |
| `updated_by_user_id` | uuid | `users.id`、削除でNULL | 最後に変えた人 |
| `created_at`・`updated_at` | timestamptz | NOT NULL、既定 now | |

主キー：`(promotion_id, media)`。索引：`promotion_listings_account_idx`（`account_id`）。

状態：

```text
（行なし＝未着手）──状況を変える・作る──▶ 行を作る
not_started ──作る──▶ drafting（fields・fixes・generated_at・source_version を入れる）
drafting ⇄ posted ⇄ stopped（利用者が選ぶ。posted のときだけ posted_url を勧める（必須にはしない））
作り直す：fields・fixes を入れ直す（status は変えない）
宣伝内容を消す：cascade で消える
```

## media_defaults（新規）

Account×媒体で1行。毎回同じ値（spec FR-002）。

| 列 | 型 | 制約・既定 | 意味 |
|---|---|---|---|
| `account_id` | uuid | `accounts.id`、削除でcascade | |
| `media` | text | 上と同じ CHECK | 媒体 |
| `values` | jsonb | NOT NULL、既定 `{}` | `{ [fieldKey]: string }`。媒体の欄のうち `defaultable` のものだけ（contracts/media.md） |
| `version` | int | NOT NULL、既定 1 | |
| `updated_by_user_id` | uuid | `users.id`、削除でNULL | |
| `updated_at` | timestamptz | NOT NULL、既定 now | |

主キー：`(account_id, media)`。

## 共有の定数（packages/shared/src/media/）

| 名前 | 内容 |
|---|---|
| `MEDIA` | `["kokuchpro", "peatix", "tsunagate", "jmty", "youtrust"]` |
| `MEDIA_LABELS` | こくちーずプロ・Peatix・つなげーと・ジモティー・YOUTRUST |
| `LISTING_STATUSES` | `not_started`（未着手）・`drafting`（作成中）・`posted`（掲載済み）・`stopped`（掲載停止） |
| `MediaDefinition` | 媒体ごとの `steps`（区切り）・`fields`（欄）・`workSteps`（作業のSTEP）・`image`（大きさ・注意）・`rules`・`fixRules` |
| `MediaField` | `key`・`label`（媒体の画面での名前）・`step`・`kind`（`text`・`textarea`・`select`・`datetime`・`number`）・`options`・`required`・`immutable`（登録後に変えられない）・`max`・`help`・`defaultable` |
| `ListingCheck` | `{ level: "red" \| "yellow" \| "info", field?, message }` |
| `ListingFix` | `{ field, excerpt, reason }` |

## 消すとき

- 宣伝内容を消す：`promotion_listings` が cascade で消える。
- Accountを消す・退会：`promotion_listings`・`media_defaults` が cascade で消える（013の退会の流れのまま）。
