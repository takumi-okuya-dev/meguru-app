# データモデル：名簿なしで受付する

**対象**：[spec.md](./spec.md) | **決めた理由**：[research.md](./research.md) | **前の表**：[001 data-model.md](../001-event-day-collection/data-model.md)・[002 data-model.md](../002-self-check-in/data-model.md)

## 1. 変える表

| 表 | 変えること |
|---|---|
| `events`（001） | `check_in_mode` を足す |
| `roster_people`（001） | `tier_undecided`・`self_entered_at` を足す |
| `self_check_in_requests`（002） | `client_request_id` を足す |

新しい表はない。マイグレーションは1つ（develop の最新 0042 の次。あとから入る方が番号を作り直す）。

## 2. 列

### 2-1. `events` に足す列

| 列 | 型 | 決まり |
|---|---|---|
| check_in_mode | text | NOT NULL・既定 `'roster'`。check：`IN ('roster', 'rosterless')`。前からあるイベントは `roster` |

### 2-2. `roster_people` に足す列

| 列 | 型 | 決まり |
|---|---|---|
| tier_undecided | boolean | NOT NULL・既定 false。名簿なしで、イベントの区分が2つ以上のときに入った人は true。区分を選んで確かめた・主催者が区分を直した・受付の記録の区分を直したら false |
| self_entered_at | timestamptz null | 名簿なしの入口で作った時刻。主催者・手伝う人が入れた人は空 |

- `price_tier_id` は NOT NULL のまま。`tier_undecided = true` の人には、0円を除いた最も安い区分（0円しかなければ最初の区分）を仮に入れる。
- check：`tier_undecided` が true なら `self_entered_at` は空でない（名簿なしの入口でしか未定にならない）。

### 2-3. `self_check_in_requests` に足す列

| 列 | 型 | 決まり |
|---|---|---|
| client_request_id | uuid null | 一意。名簿なしの入口で作った行だけに入る（送り直しで二重にしない・入れた人数の上限を数える） |

- 名簿なしの入口で作った行は、作ったときに `status = 'accepted'`（主催者が先に入れた人に当てたら `'matched'`）・`roster_person_id`・`resolved_at` が入る。待ち（`pending`）にはならないので、002 の「1つの端末が待てる申し出は1件」と待ちの数の上限には数えない。
- 名簿なしで入った人を外したら、`roster_person_id` は 002 と同じく空になる（`ON DELETE SET NULL`）。参加者の画面は「受付の人に声をかけてください」を出す。

## 3. 状態の移り変わり

### 3-1. 名簿なしで入った人

```text
（入れる）→ 名簿の人（self_entered_at・区分が2つ以上なら tier_undecided）
  ├─ 払い方を選ぶ → 本人の申告（002 と同じ：現金・PayPay は確かめ待ち、振込は振込待ち）
  │    ├─ 受付をする人が「受け取った」（区分が未定なら区分を選ぶ）→ 支払い済み・tier_undecided = false
  │    └─ 振込待ちで「入金を確かめた」（区分が未定なら区分を選ぶ）→ 入金済み・tier_undecided = false
  └─ 受付をする人が「名簿から外す」（受付の記録がないときだけ）→ 消える
```

### 3-2. 受付のしかた

`roster` ⇄ `rosterless` はいつでも変えられる。名簿・受付の記録・リンクは変えない（FR-004）。

## 4. 共通の形（`packages/shared/src/apps/collect/`）に足すもの

| 形 | 足すもの |
|---|---|
| イベント（`collectEventSchema`・作る・直すの入力） | `checkInMode`（`CHECK_IN_MODES = ["roster", "rosterless"]`）。作る入力では任意（省いたら `roster`） |
| `NEW_EVENT_CHECK_IN_MODE` | `"rosterless"`（画面の作る画面の初めの値） |
| `SELF_CHECK_IN_LIMITS` | `entriesPerDevicePerLink: 10`・`entriesPerLinkPerMinute: 60`・`entriesPerLink: 1000` |
| `selfLinkInfoSchema` | `checkInMode`・`media`（並べる順の媒体）・`tiers`（0円を除いた区分の名前と金額。名簿なしで区分が2つ以上のときだけ。ほかは空） |
| `selfPersonSchema` | `tierUndecided`（boolean） |
| `selfEntryRequestSchema`（新しい） | `name`（必須・50文字まで）・`kana`（任意・50文字まで）・`media`（`COLLECT_MEDIA`）・`referrer`（任意・40文字まで）・`clientRequestId`（uuid） |
| `selfEntryResponseSchema`（新しい） | `requestId`・`person`（`selfPersonSchema`） |
| 受付の画面の人（`ReceptionPerson`） | `tierUndecided`・`sameName`・`selfEntered` |
| 確かめる入力（`confirmReceptionRequestSchema`） | 変えない（`priceTierId` は前から任意で受ける。未定の人で区分が2つ以上なら API が要求する） |
| 振込の入金を確かめる入力（新しい `confirmTransferRequestSchema`） | `priceTierId`（任意） |
| 締め（`ClosingSnapshot`） | `checkInMode`・`unrecordedCount` |
| エラーのコード | `TIER_REQUIRED`（400）・`CHECK_IN_MODE_MISMATCH`（409。名簿ありのイベントで名簿なしの入口を呼んだ） |
