# API の取り決め：名簿なしで受付する

**対象**：[spec.md](./spec.md) | **形**：[data-model.md](../data-model.md) 4 | **前の取り決め**：[001 contracts/api.md](../../001-event-day-collection/contracts/api.md)・[002 contracts/api.md](../../002-self-check-in/contracts/api.md)

道筋は 001・002 と同じく `/api/collect/…`。エラーの形・認証・版（version）は 001 のまま。ここには、変えるものと足すものだけを書く。

## 1. イベント（主催者）

### 1-1. `POST /api/collect/events`・`PATCH /api/collect/events/:eventId`

- 入力に `checkInMode`（`"roster"`・`"rosterless"`）を足す。作るときに省いたら `"roster"`（research R1）。直すときに省いたら変えない。
- 応答のイベント（`GET /api/collect/events/:eventId` も）に `checkInMode` を足す。

## 2. 参加者（ログインなし。端末の印は見出し `X-Collect-Device`。002 と同じ）

### 2-1. `GET /api/collect/s/:token`（変える）

応答に足す：

```json
{
  "checkInMode": "rosterless",
  "media": ["peatix", "minato", "kokuchpro", "tunagate", "jimoty", "youtrust", "walk_in", "other"],
  "tiers": [{ "name": "通常", "amount": 3000 }, { "name": "早割", "amount": 2500 }]
}
```

- `media`：001 の媒体の並び。Threads のイベントから作ったイベントは、掲載済みの媒体を先に並べる。
- `tiers`：名簿なしで、イベントの区分が2つ以上のときだけ、0円を除いた区分を並べる（ほかは `[]`）。

### 2-2. `POST /api/collect/s/:token/entries`（新しい。名簿なしの入口）

入力（`selfEntryRequestSchema`）：

```json
{ "name": "松本 れい", "kana": "まつもと れい", "media": "peatix", "referrer": "井上", "clientRequestId": "…uuid…" }
```

応答 201（`selfEntryResponseSchema`）：

```json
{ "requestId": "…", "person": { "id": "…", "number": 1, "name": "松本 れい", "tierName": "通常", "amount": 3000, "tierUndecided": false } }
```

- 名簿の人を作り（区分が1つならその区分、2つ以上なら仮の区分で `tierUndecided: true`）、申し出の表に `accepted` の行を作る。主催者が先に入れた人1人と名前が一致し、その人に受付の記録がなければ、その人に当てる（`matched`。research R5）。
- 同じ `clientRequestId` の送り直しは、同じ応答を 200 で返す（二重にしない）。
- 会場の共有に、名簿の人が増えたことを知らせる。

エラー：

| 状態 | code | とき |
|---|---|---|
| 400 | `VALIDATION_FAILED` | 名前が空・長すぎる、媒体が知らないもの、など |
| 404 | `ITEM_NOT_FOUND` | リンクがない |
| 409 | `CHECK_IN_MODE_MISMATCH` | イベントが名簿あり |
| 410 | `LINK_INACTIVE` | 止めた・期限が過ぎた・出し直した |
| 429 | `RATE_LIMITED` | 端末ごと・リンクごとの上限（research R6） |

### 2-3. 自分の情報の形（`selfPersonSchema`。探す・申告・`me` の応答）

- `tierUndecided`（boolean）を足す。true のとき、`tierName`・`amount` は仮のもので、画面は `GET /s/:token` の `tiers` を並べる。

### 2-4. `GET /api/collect/s/:token/me`（変えない）

- 名簿なしで入ったあとは、`request`（`status: "accepted"` か `"matched"`・`person`）が返る。名簿から外されたら `person: null`。

### 2-5. `POST /api/collect/s/:token/declare`（変えない）

- 名簿なしで入った人は、`person.id` で 002 と同じく申告する。区分が未定でも、記録は仮の区分と金額で作る（支払い済みになるまで合計に入らない）。

## 3. 受付をする人（主催者 `/api/collect/events/:eventId/…`・手伝う人 `/api/collect/r/:token/…`）

### 3-1. 受付の画面の人（`GET …/reception` の `people[]`）

足す：`tierUndecided`・`sameName`（名簿なしで同じ名前の人が2人以上）・`selfEntered`（名簿なしで入った）。

### 3-2. `POST …/reception/:personId/confirm`（変える）

- 入力は 002 のまま（`method`・`priceTierId`・`amount` は任意）。
- 名簿の人が `tierUndecided` で、イベントの区分が2つ以上なら、`priceTierId` が要る。なければ 400 `TIER_REQUIRED`。
- 確かめたら、名簿の人の区分を選んだ区分にし、`tierUndecided` を false にする。区分が1つのイベントでは、その区分で確かめ、`tierUndecided` を false にする。

### 3-3. `DELETE …/reception/:personId/entry`（新しい。名簿から外す）

- 名簿なしで入った人（`selfEntered`）で、受付の記録がない人を名簿から外す。応答 200 `{ "version": 12 }`。
- 409 `ALREADY_RECORDED`：受付の記録がある（先に取り消す）。404 `ITEM_NOT_FOUND`：いない・名簿なしで入った人でない。
- 会場の共有に、名簿の人が減ったことを知らせる。

## 4. 振込待ち（主催者）

### 4-1. `POST /api/collect/transfers/:personId/confirm`（変える）

- 入力（任意。`confirmTransferRequestSchema`）：`{ "priceTierId": "…" }`。
- 名簿の人が `tierUndecided` で、イベントの区分が2つ以上なら `priceTierId` が要る。なければ 400 `TIER_REQUIRED`。選んだら、記録の区分と金額・名簿の人の区分を変え、`tierUndecided` を false にする。
- 振込待ちの一覧（`GET /api/collect/transfers`）の項目に `tierUndecided` と、区分を選ぶための `tiers`（そのイベントの区分の番号・名前・金額）を足す。

## 5. 締め（主催者）

### 5-1. `GET /api/collect/events/:eventId/closing`（変える）

- 足す：`checkInMode`・`unrecordedCount`（受付の記録がない名簿の人の数）。
- 名簿なしでは `absent` を `[]` にする。

### 5-2. 書き出し（CSV）

- 区分の列：`tierUndecided` の人は「未定」。
