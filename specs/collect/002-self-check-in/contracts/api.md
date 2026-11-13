# APIの取り決め：セルフ受付（/api/collect）

**対象**：[spec.md](../spec.md) | **001 の取り決め**：[001 contracts/api.md](../../001-event-day-collection/contracts/api.md)（共通の決まり・エラーの形・`version` と会場の共有はそのまま）

## 1. セルフ受付のリンク（主催者）

| 道筋 | 説明 |
|---|---|
| `GET /api/collect/events/:eventId/self-link` | 今のセルフ受付のリンク（`{ link: { url, expiresAt, stoppedAt } \| null }`。手伝う人の `…/link` と同じ形） |
| `POST /api/collect/events/:eventId/self-link` | 出す（使えるリンクがあればそれを返す。期限の既定は 001 と同じ） |
| `PATCH /api/collect/events/:eventId/self-link` | 期限を変える |
| `POST /api/collect/events/:eventId/self-link/stop` | 止める（版を上げ、会場の共有に `self_link.stopped` を送る） |

## 2. 確かめ待ちと申し出（受付をする人。主催者と手伝う人）

主催者は `/api/collect/events/:eventId/…`、手伝う人は `/api/collect/r/:token/…`（`X-Collect-Device`）。

| 道筋 | 説明 |
|---|---|
| `POST …/reception/:personId/confirm` | 確かめ待ちを支払い済みにする `{ method?, priceTierId?, amount? }` → `{ record, version }`。受け取った人＝呼んだ人。確かめ待ちでなければ 409 `NOT_AWAITING_CONFIRMATION` |
| `DELETE …/reception/:personId` | 001 と同じ。本人の申告（`receiver_kind = self`）は手伝う人も取り消せる |
| `POST …/self-requests/:requestId/accept` | 申し出を名簿に入れる（001 の飛び入りと同じ） → `{ person, version }` |
| `POST …/self-requests/:requestId/match` | `{ personId }` 名簿の人に当てる → `{ version }` |
| `POST …/self-requests/:requestId/reject` | 断る → `{ version }` |

- 受付のスナップショット（001 の `GET …/reception`）に `selfRequests: [{ id, name, kana, createdAt }]`（待ちだけ）と、`stats.awaitingConfirmationCount`・`stats.awaitingConfirmationAmount` を足す。記録に `selfReported`・`confirmedAt` を足す。
- 会場の共有の知らせに `self_requests.changed`（`{ selfRequests }`）と `self_link.stopped` を足す。本人の申告・確かめ・取り消しは 001 の `reception.recorded`・`reception.undone`。

## 3. 参加者（ログインなし）

道筋の `:token` はセルフ受付のリンク（`cs_…`）。端末の印を見出し `X-Collect-Device`（UUID。手伝う人と同じ見出しの名前。CORS ですでに許しているので、共通の `app.ts` を変えずに済む）で送る（ないと 400 `VALIDATION_FAILED`）。

| 道筋 | 説明 |
|---|---|
| `GET /api/collect/s/:token` | `{ status: "active" \| "stopped" \| "expired", event: { name, startsAt, venue, methods } }`。リンクがなければ 404 |
| `POST /api/collect/s/:token/search` | `{ query }` → `{ result: "found", person: { id, number, name, tierName, amount }, record: { method, paymentStatus } \| null }` か `{ result: "ambiguous" }`（同じ名前が2人以上。受付番号を聞く）か `{ result: "not_found" }`。回数の上限を超えたら 429 `RATE_LIMITED` |
| `POST /api/collect/s/:token/declare` | `{ personId, method, clientRequestId }` → 201 `{ record, version }`。受付済みなら 409 `ALREADY_RECORDED`（ただし同じ端末の確かめ待ちなら、払い方を選び直して 200）。0円の区分は `method` を省いて来場だけ |
| `POST /api/collect/s/:token/requests` | `{ name, kana? }` → 201 `{ requestId }`。同じ端末の待ちがあれば 409 `REQUEST_PENDING`、リンク全体の待ちが上限なら 429 |
| `GET /api/collect/s/:token/me` | 自分の端末の状態：`{ status, declaration: { personId, number, name, method, paymentStatus, amount } \| null, request: { id, status, person?: { id, number, name, tierName, amount } } \| null }`（画面が見えている間だけ3秒ごとに読む） |
| `GET /api/collect/s/:token/paypay-qr` | 主催者のQRの画像（PayPayを選んだあと） |

- リンクが止められた・期限が過ぎたら、`GET …/s/:token` と `…/me` のほかは 410 `LINK_INACTIVE`。
- 参加者の道筋は、名簿の一覧・メモ・ほかの人の記録を返さない。`search` は完全に一致した1人だけを返す。

## 4. エラーのコード（集金管理の `errors.ts` に足す）

| コード | HTTP | いつ |
|---|---|---|
| `NOT_AWAITING_CONFIRMATION` | 409 | 確かめ待ちでない記録を確かめようとした |
| `REQUEST_PENDING` | 409 | 同じ端末の申し出がまだ待ち |
| `REQUEST_RESOLVED` | 409 | もう片付けた申し出を片付けようとした |
