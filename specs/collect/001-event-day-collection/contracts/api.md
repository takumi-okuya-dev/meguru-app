# APIの取り決め：集金管理（/api/collect）

**対象**：[spec.md](../spec.md) | **データ**：[data-model.md](../data-model.md) | **入力と出力の形**：`@meguru/shared`の`collect`（zod）

## 0. 共通の決まり

- **主催者の呼び出し**（1章〜7章）：今と同じログイン（Clerk）。共通の入口の関数で利用権を確かめ、使えない人は403 `APP_NOT_AVAILABLE`。ほかの主催者のイベントは404（あるかどうかを見せない）。
- **手伝う人の呼び出し**（8章）：ログインなし。道筋の`:token`（受付用リンク）と、見出し`X-Collect-Device`（端末の印。参加のあと）で確かめる。
- エラーの形は今のAPIと同じ（`{ error: { code, message } }`）。
- 受付の画面に関わる変更（受付の記録・取り消し・飛び入り・名簿の変更・手伝う人の出入り・リンクを止める）は、成功したら`events.version`を上げ、会場の共有に知らせる（[realtime.md](./realtime.md)）。応答には新しい`version`を入れる。
- 金額は円の整数、時刻はISO 8601（UTC）。画面が日本時間で出す。

| コード | HTTP | いつ |
|---|---|---|
| `APP_NOT_AVAILABLE` | 403 | 集金管理の利用権がない |
| `NOT_FOUND` | 404 | ない・ほかの主催者のもの |
| `VALIDATION` | 400 | 入力の形が違う |
| `ALREADY_RECORDED` | 409 | その人はもう受付済み（`record`に先の記録） |
| `TIER_IN_USE` | 409 | 名簿の人が使っている料金の区分を消そうとした |
| `HELPER_NAME_TAKEN` | 409 | 同じリンクに同じ名前の手伝う人がいる（`helperId`・`joinedAt`） |
| `LINK_INACTIVE` | 410 | 受付用リンクが止められた・期限が過ぎた |
| `DEVICE_REQUIRED` | 401 | 端末の印がない・合わない |
| `FORBIDDEN` | 403 | 手伝う人が、ほかの人の記録を取り消そうとした |
| `IMAGE_TOO_LARGE` | 413 | QRの画像が300KBを超える |

## 1. 集金管理の自分の情報

| 道筋 | 説明 |
|---|---|
| `GET /api/collect/me` | `{ hasPaypayQr, hasBankText, awaitingTransferCount }`（サイドバーの数と、設定への案内に使う。029 FR-024の`/api/<アプリ>/me`の形） |

## 2. イベント・料金の区分・まとめ

| 道筋 | 説明 |
|---|---|
| `GET /api/collect/events` | 開催日時の近い順。各行に`rosterCount`・`attendedCount`・`awaitingTransferCount`・`closedAt`・`fromThreads`（FR-012） |
| `POST /api/collect/events` | `{ name, startsAt, endsAt?, venue?, capacity?, methods, tiers: [{ name, amount }], sourceThreadsPromotionId? }` → 201（FR-010・FR-062） |
| `GET /api/collect/events/:eventId` | イベントと料金の区分・元のThreadsの状態（`sourceChangedAt`・`sourceDeletedAt`） |
| `PATCH /api/collect/events/:eventId` | 名前・日時・会場・定員・払い方・料金の区分（足す・直す・並べる・消す）。名簿の人か受付の記録が使っている区分を消すと409 `TIER_IN_USE` |
| `DELETE /api/collect/events/:eventId` | まとめを残して消す（FR-011・FR-014。R11）→ `{ summaryId }` |
| `GET /api/collect/summaries` | 消したイベントのまとめの一覧 |
| `DELETE /api/collect/summaries/:summaryId` | まとめも消す |

## 3. 名簿

| 道筋 | 説明 |
|---|---|
| `GET /api/collect/events/:eventId/roster` | 名簿の人の一覧（受付番号の順。受付の記録つき） |
| `POST /api/collect/events/:eventId/roster` | 1人足す `{ name, kana?, media, priceTierId, memo? }` → 201 `{ person, sameNameAs?: { number, media } }`（FR-020・FR-024） |
| `POST /api/collect/events/:eventId/roster/bulk` | まとめて足す `{ names: string[], media, priceTierId }`（画面で整えて確かめたもの。APIでも`cleanPastedLine`を当て、空の行を除く）→ 201 `{ people }`（FR-022・FR-026） |
| `PATCH /api/collect/events/:eventId/roster/:personId` | 名前・ふりがな・媒体・料金の区分・メモ |
| `DELETE /api/collect/events/:eventId/roster/:personId` | 受付の記録も消える（画面が先に確かめる。FR-025） |
| `GET /api/collect/past-attendees?eventId=&q=` | 前回の参加者の候補を最大5件 `[{ name, kana, lastEventName, lastEventStartsAt }]`。`q`は1文字以上（FR-027） |

## 4. 受付（主催者）

| 道筋 | 説明 |
|---|---|
| `GET /api/collect/events/:eventId/reception` | スナップショット：`{ version, event, tiers, people: [{ person, record? }], stats, helpers }`。`stats`は来場・現金・PayPay・振込待ちと、`mine`（呼んだ人が受け取った現金） |
| `PUT /api/collect/events/:eventId/reception/:personId` | 記録する `{ method, priceTierId?, amount?, clientRequestId }` → 201 `{ record, version }`。`priceTierId`・`amount`は記録にだけ持ち、名簿の区分は変えない（FR-032・R17）。もう受付済みなら409 `ALREADY_RECORDED`（同じ`clientRequestId`の送り直しは201で同じ結果）（FR-031・032・035） |
| `DELETE /api/collect/events/:eventId/reception/:personId` | 取り消す（FR-039） |
| `POST /api/collect/events/:eventId/walk-ins` | 飛び入り `{ name, clientRequestId }` → 201 `{ person, version }`（媒体`walk_in`・最初の区分。FR-034） |
| `POST /api/collect/events/:eventId/live-ticket` | 会場の共有の入場券（[realtime.md](./realtime.md)） |

## 5. 受付の手伝い（主催者）

| 道筋 | 説明 |
|---|---|
| `GET /api/collect/events/:eventId/link` | 今のリンク（`url`・`expiresAt`・`stoppedAt`）。ない・止めたあとなら`null` |
| `POST /api/collect/events/:eventId/link` | リンクを出す（使えるリンクがあればそれを返す）。`{ expiresAt? }`。省いたら、開催日の日本時間23:59と、終わりの時刻（なければ開始）の1時間後の遅い方（FR-070・R7） |
| `PATCH /api/collect/events/:eventId/link` | 期限を変える |
| `POST /api/collect/events/:eventId/link/stop` | 止める。手伝う人の画面に`link.stopped`を知らせる（FR-073） |
| `GET /api/collect/events/:eventId/helpers` | 受付をしている人：`[{ id, name, joinedAt, lastRecordedAt, recordCount, cashAmount, deviceCount }]`と主催者自身の行（FR-072） |

## 6. 締め

| 道筋 | 説明 |
|---|---|
| `GET /api/collect/events/:eventId/closing` | `{ version, closedAt, changedAfterClose, attendance, cashByReceiver: [{ receiverKey, name, count, amount, countedAmount, settledAt }], paypay: { count, amount, records, checkedAt }, transfers: { paid, awaiting }, byMedia, absent }`（FR-040〜044） |
| `PUT /api/collect/events/:eventId/settlements/:receiverKey` | `{ countedAmount?, settled? }`（FR-041） |
| `POST /api/collect/events/:eventId/paypay-check` | 「履歴と合った」（FR-042） |
| `POST /api/collect/events/:eventId/close` | 締める → `{ closedAt, unsettled: [receiverKey] }`（精算していない人がいても締める。FR-045） |
| `GET /api/collect/events/:eventId/export.csv` | 書き出し（R13。FR-046） |

## 7. 振込待ち・設定・Threadsの候補

| 道筋 | 説明 |
|---|---|
| `GET /api/collect/transfers?q=` | すべてのイベントの振込待ちと、確かめた記録（新しい順）。受付番号・名前で探せる（FR-050） |
| `POST /api/collect/transfers/:personId/confirm` | 入金を確かめた（FR-051） |
| `DELETE /api/collect/transfers/:personId/confirm` | 振込待ちに戻す |
| `GET /api/collect/settings` / `PUT` | `{ bankText }`（FR-013） |
| `PUT /api/collect/settings/paypay-qr` | 本文が画像（`image/png`・`image/jpeg`・300KB以内）。超えたら413 |
| `GET /api/collect/settings/paypay-qr` / `DELETE` | 画像を返す・消す |
| `GET /api/collect/threads-candidates` | 見てよいThreadsのイベントの候補（開催日の近い順、過ぎたものは後ろ）（User Story 6。PR4） |

- 連絡文（FR-052）は`@meguru/shared`の`buildTransferMessage()`で作る（APIを呼ばない）。

## 8. 手伝う人（ログインなし）

| 道筋 | 説明 |
|---|---|
| `GET /api/collect/r/:token` | `{ status: "active" \| "stopped" \| "expired", event: { name, startsAt, venue }, expiresAt }`。リンクがなければ404 |
| `POST /api/collect/r/:token/join` | `{ name, sameAsHelperId?, asNew? }` → 201 `{ helperId, deviceSecret }`。同じ名前がいれば409 `HELPER_NAME_TAKEN`（FR-071・FR-075） |
| `GET /api/collect/r/:token/reception` | スナップショット（主催者と同じ形。ただし`people`は名前・ふりがな・受付番号・媒体・料金の区分・記録だけ。メモは返さない。FR-002） |
| `PUT /api/collect/r/:token/reception/:personId` | 記録する（受け取った人＝その手伝う人）。区分と金額を変えられるのは記録の中だけ（名簿は変えない） |
| `DELETE /api/collect/r/:token/reception/:personId` | 自分が受け取った記録だけ取り消せる（ほかは403 `FORBIDDEN`） |
| `POST /api/collect/r/:token/walk-ins` | 飛び入り |
| `GET /api/collect/r/:token/paypay-qr` | 主催者のQRの画像 |
| `POST /api/collect/r/:token/live-ticket` | 会場の共有の入場券 |

- 参加のあとの呼び出しはすべて`X-Collect-Device`が要る（ないと401 `DEVICE_REQUIRED`）。リンクが使えないときは410 `LINK_INACTIVE`（記録は残る）。
- 名簿の編集・締め・振込・書き出し・設定・ほかのイベントの道筋は、手伝う人には一切ない（FR-071）。

## 9. APIの入口の一覧

`apps/api/test/repo/routes.snapshot.txt`に、上の道筋を足す（今のテストが見張る）。
