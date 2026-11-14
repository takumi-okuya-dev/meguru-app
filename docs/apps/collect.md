# 集金管理のモジュール地図

**対象**：apps/api/src/apps/collect・apps/web/src/apps/collect（specs/collect/001-event-day-collection）。全体の決まりは[docs/module-map.md](../module-map.md)。アプリごとの地図をここに分けて置き、並行開発で同じ文書に行を足し合わないようにする（specs/meguru/031-conflict-free-composition、[docs/parallel-development.md](../parallel-development.md) 11）。

## 1. API：集金管理（apps/collect）

パターン①の最初の2作目（specs/collect/001-event-day-collection）。運営者が開いた人だけが使う（`registerAppAccess("collect", "granted")`。specs/meguru/030-app-access）。道筋はすべて`/api/collect`の下。主催者の道筋には、ログインと利用の許可の関所（`access.ts`の`collectOwner`）を付ける。関所の外にあるのは、手伝う人の`/api/collect/r/:token/…`（受付用リンクと端末の印`X-Collect-Device`で確かめる）と、会場の共有の`/api/collect/live`（60秒の入場券で確かめる）だけ。今は PR1〜PR4 の分（イベント・料金の区分・名簿・既定値・受付・受付の手伝い・会場の共有・締め・振込待ち・まとめ・書き出し・Threadsのイベントの候補）。

| 小分け | 表 | 処理とAPIの入口 |
|---|---|---|
| `events/`（イベント・料金の区分） | `events`・`price_tiers` | `event-service.ts`・`event-routes.ts` |
| `roster/`（名簿・前回の参加者） | `roster_people` | `roster-service.ts`（受付番号は`events.next_number`から取る）・`past-attendees.ts`・`roster-routes.ts` |
| `settings/`（主催者の既定値） | `owner_settings` | `settings-service.ts`（PayPayのQRの画像・振込先の案内）・`settings-routes.ts` |
| `me/`（集金管理の「自分」） | — | `collect-me.ts`（`GET /api/collect/me`） |
| `usage/`（利用の値） | — | `usage.ts`（料金の数は0、イベントがあれば「使っている」を`reportUsage`で伝える。毎日の数え直し） |
| `reception/`（受付） | `reception_records` | `reception-service.ts`（記録は名簿の人1人に1行・`clientRequestId`の送り直し・取り消し・飛び入り・スナップショットと数字）・`reception-routes.ts` |
| `helpers/`（受付の手伝い） | `reception_links`・`helpers`・`helper_devices` | `link-service.ts`（受付用リンク。トークンはハッシュと暗号文）・`link-tokens.ts`（鍵の入れ替え。入口の`tokenKeys`）・`helper-service.ts`（参加・端末の印の確かめ・受付をしている人の一覧）・`helper-routes.ts`（主催者の道筋と、ログインのいらない`/r/:token/…`） |
| `live/`（会場の共有） | — | `live-room.ts`（Durable Object`CollectLiveRoom`。知らせを配るだけで保存しない。組み立ての`durable-objects.ts`が書き出す）・`live-ticket.ts`（入場券の署名。`COLLECT_LIVE_SECRET`）・`notify.ts`（保存のあと`waitUntil`で知らせる）・`live-routes.ts` |
| `closing/`（締め・書き出し） | `settlements` | `tally.ts`（締めとまとめの数え方）・`closing-service.ts`（受け取った人ごとの精算・PayPayの確かめ・締める。締めたときの版を残し、あとで版が上がったら「締めのあとで変わった」）・`export-csv.ts`（UTF-8のBOMつき・CRLF）・`closing-routes.ts` |
| `transfers/`（振込待ち） | — | `transfer-service.ts`（すべてのイベントの振込待ちと確かめた記録・確かめる・戻す。受付の画面の版は上げない）・`transfer-routes.ts` |
| `summaries/`（消す・まとめ） | `event_summaries` | `summary-service.ts`（同じトランザクションで数字だけのまとめを書いてからイベントを消す。名前は入れない）・`summary-routes.ts` |
| `threads-candidates/`（Threadsのイベントの候補） | `threads_event_candidates` | `candidate-service.ts`（持ち主にだけ見せる・イベントを作るときの元の確かめ・掲載済みの媒体）・`candidate-routes.ts`（`GET /api/collect/threads-candidates`） |
| `inbox/`（出来事の受け取り） | `received_events` | `received-events.ts`（`user.withdrawn`：その主催者のイベント・まとめ・既定値・候補をすべて消す）・`threads-candidates.ts`（Threads の `threads.promotion_event.saved`・`.deleted`・`threads.listing_status.changed` を候補に写し、作ったイベントに「元が変わった・消された」を付ける） |
| （直下） | — | `index.ts`（入口`collectModule`。道筋・毎日の処理・`tokenKeys`）・`schema.ts`（12表。スキーマ`collect`）・`access.ts`（関所とイベントの持ち主の確かめ）・`register.ts`（`registerCollect()`：利用の決まりと出来事の受け取りの登録） |

## 2. Web

| モジュール | 主な中身 |
|---|---|
| `apps/collect/` | `index.ts`（`collectApp`。ログインのいらない`publicRoutes`に手伝う人の受付`/collect/r/:token`）・`routes.tsx`（利用の許可のない人には「使えない」の案内だけ）・`sidebar/CollectShell.tsx`（イベント・作る・振込待ち（数）・まとめ・開いているイベントの名簿・受付・受付の手伝い・締め・PayPay・振込先の設定）・`pages/`（イベントの一覧・作る（Threadsのイベントから選ぶ）・直す（消す）・名簿（掲載済みの媒体を先に並べる・元が直された／消された知らせ）・受付・受付の手伝い・手伝う人の受付・締め（精算・PayPay・振込・媒体ごと・来なかった人・CSV）・振込待ち（連絡文のコピー）・まとめ・設定）・`components/`（イベントの入力欄・名簿の続けて入れる欄・まとめて貼る・直す・`reception/`の受付の画面の中身（主催者と手伝う人で同じもの）・`QrCode.tsx`）・`lib/`（`api.ts`の`collectApi`・`helper-api.ts`（手伝う人の呼び出し。共通の`request`は401でログインへ移すので使わない）・`live.ts`（会場の共有のつなぎ方）・`use-reception.ts`（受付の状態と、知らせ・応答の当て方）・`reception-model.ts`・`device-store.ts`・`query-keys.ts`・`paths.ts`・`event-time.ts`・`image.ts`） |
