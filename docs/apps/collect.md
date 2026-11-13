# 集金管理のモジュール地図

**対象**：apps/api/src/apps/collect・apps/web/src/apps/collect（specs/collect/001-event-day-collection）。全体の決まりは[docs/module-map.md](../module-map.md)。アプリごとの地図をここに分けて置き、並行開発で同じ文書に行を足し合わないようにする（specs/meguru/031-conflict-free-composition、[docs/parallel-development.md](../parallel-development.md) 11）。

## 1. API：集金管理（apps/collect）

パターン①の最初の2作目（specs/collect/001-event-day-collection）。運営者が開いた人だけが使う（`registerAppAccess("collect", "granted")`。specs/meguru/030-app-access）。道筋はすべて`/api/collect`の下で、ログインと利用の許可の関所（`access.ts`の`collectOwner`）を付ける。今は PR1 の分（イベント・料金の区分・名簿・既定値）。

| 小分け | 表 | 処理とAPIの入口 |
|---|---|---|
| `events/`（イベント・料金の区分） | `events`・`price_tiers` | `event-service.ts`・`event-routes.ts` |
| `roster/`（名簿・前回の参加者） | `roster_people` | `roster-service.ts`（受付番号は`events.next_number`から取る）・`past-attendees.ts`・`roster-routes.ts` |
| `settings/`（主催者の既定値） | `owner_settings` | `settings-service.ts`（PayPayのQRの画像・振込先の案内）・`settings-routes.ts` |
| `me/`（集金管理の「自分」） | — | `collect-me.ts`（`GET /api/collect/me`） |
| `usage/`（利用の値） | — | `usage.ts`（料金の数は0、イベントがあれば「使っている」を`reportUsage`で伝える。毎日の数え直し） |
| `inbox/`（出来事の受け取り） | `received_events` | `received-events.ts`（`user.withdrawn`：その主催者のデータをすべて消す） |
| （直下） | — | `index.ts`（入口）・`schema.ts`（5表。スキーマ`collect`）・`access.ts`（関所とイベントの持ち主の確かめ）・`register.ts`（`registerCollect()`：利用の決まりと出来事の受け取りの登録） |

## 2. Web

| モジュール | 主な中身 |
|---|---|
| `apps/collect/` | `index.ts`（`collectApp`）・`routes.tsx`（利用の許可のない人には「使えない」の案内だけ）・`sidebar/CollectShell.tsx`（イベント・作る・開いているイベントの名簿・PayPay・振込先の設定）・`pages/`（イベントの一覧・作る・直す・名簿・設定）・`components/`（イベントの入力欄・名簿の続けて入れる欄・まとめて貼る・直す）・`lib/`（`api.ts`の`collectApi`・`query-keys.ts`・`paths.ts`・`event-time.ts`・`image.ts`） |
