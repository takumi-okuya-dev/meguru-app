# データモデル：参加者が自分で受付する（セルフ受付）

**対象**：[spec.md](./spec.md) | **決めた理由**：[research.md](./research.md) | **001 の表**：[001 data-model.md](../001-event-day-collection/data-model.md)

## 1. 変える表・足す表

| 表 | 変えること |
|---|---|
| `reception_links`（001） | `kind`（`helper`・`self`。既定 `helper`）を足す。使えるリンクの部分一意索引を `(event_id, kind)` に直す |
| `reception_records`（001） | `payment_status` に `awaiting_confirmation`、`receiver_kind` に `self` を足す（check を直す）。`self_reported`・`self_device_hash`・`confirmed_at` を足す |
| `self_check_in_requests`（新しい） | 飛び入りの申し出 |
| `self_check_in_devices`（新しい） | 参加者の端末の印と回数の上限 |

## 2. 列

### 2-1. `reception_records` に足す列と決まり

| 列 | 型 | 決まり |
|---|---|---|
| self_reported | boolean | 既定 false。本人の申告で作ったら true（確かめたあとも true のまま） |
| self_device_hash | text null | 申告した端末の印のハッシュ（選び直しの判定） |
| confirmed_at | timestamptz null | 確かめた時刻 |

- `payment_status`：`paid`・`awaiting_transfer`・`awaiting_confirmation`。`awaiting_confirmation` は、`method` が `cash`・`paypay` で `receiver_kind = self` のときだけ。
- `receiver_kind`：`owner`・`helper`・`self`。`self` のときは `receiver_helper_id` は空。`self` は本人の申告で、まだ確かめていない（振込の本人の申告は、確かめずに `self` のまま振込待ちに入る。入金は 001 の振込待ちで確かめる）。
- 確かめたら：`receiver_kind` を確かめた人（`owner`・`helper`）、`payment_status` を `paid`（振込は `awaiting_transfer` のまま）、`confirmed_at` を入れる。

### 2-2. `self_check_in_requests`（飛び入りの申し出）

| 列 | 型 | 決まり |
|---|---|---|
| id | uuid PK | |
| event_id | uuid FK → events ON DELETE CASCADE | 索引 |
| link_id | uuid FK → reception_links ON DELETE CASCADE | 申し出たリンク（`kind = self`） |
| name / name_key | text | 1〜50文字 |
| kana | text null | 50文字まで |
| device_hash | text | 申し出た端末の印のハッシュ |
| status | text | `pending`・`accepted`・`matched`・`rejected` |
| roster_person_id | uuid null FK → roster_people ON DELETE SET NULL | 名簿に入れた・当てた人 |
| created_at / resolved_at | timestamptz | |

- 1つの端末が待てる申し出は1件（`(link_id, device_hash) WHERE status = 'pending'` の部分一意索引）。

### 2-3. `self_check_in_devices`（端末と回数）

| 列 | 型 | 決まり |
|---|---|---|
| link_id | uuid FK → reception_links ON DELETE CASCADE | |
| device_hash | text | `(link_id, device_hash)` が PK |
| window_started_at | timestamptz | 回数を数え始めた時刻（1分ごとに数え直す） |
| search_count | integer | その1分の探した回数 |
| created_at | timestamptz | |

- リンク全体の回数は、このリンクの行の合計で見る（1分の窓）。

## 3. 状態の移り変わり

**本人の申告（現金・PayPay）**：未受付 →（本人の申告）→ 確かめ待ち →（受付をする人が「受け取った」）→ 支払い済み。確かめ待ちは、同じ端末なら払い方を選び直せる。受付をする人は取り消せる（未受付に戻る）。

**本人の申告（振込）**：未受付 →（本人の申告）→ 振込待ち（`receiver_kind = self`）→（001 の入金の確かめ）→ 支払い済み。

**飛び入りの申し出**：待ち →（名簿に入れる）→ 名簿に入れた（名簿の人ができ、参加者は払い方を選べる）／→（名簿の人に当てる）→ 当てた／→（断る）→ 断った。

## 4. 画面に返す数字（001 に足すもの）

| 数字 | 数え方 |
|---|---|
| 確かめ待ち | `payment_status = awaiting_confirmation` の件数と合計（現金・PayPayの合計・受け取った人ごとの現金には入れない） |
| セルフ受付 | `self_reported = true` の件数、確かめ待ちの件数、待ちの申し出の件数 |

## 5. マイグレーション

- 1つ（番号は作るときの `develop` の次）。今ある行は書き換えない（足す列は既定値つき・空でよい）。check の直しは、今の行がすべて新しい check を満たすので安全。
