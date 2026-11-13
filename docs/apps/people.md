# 人物メモのモジュール地図

**対象**：apps/api/src/apps/people・apps/web/src/apps/people（specs/people/001-people-memo）。全体の決まりは[docs/module-map.md](../module-map.md)。アプリごとの地図をここに分けて置き、並行開発で同じ文書に行を足し合わないようにする（specs/meguru/031-conflict-free-composition、[docs/parallel-development.md](../parallel-development.md) 11）。

## 1. API：人物メモ（apps/people）

specs/people/001-people-memo。運営者が開いた人だけが使える（`registerAppAccess("people", "granted")`）。道筋は`/api/people`の下で、すべてログインと`requireAppAccess("people")`を通る。

| 小分け | 表 | 処理とAPIの入口 |
|---|---|---|
| `events/`（イベント） | `events` | `event-service.ts`（作る・直す・一覧・数字・来た人・消す。参加者数は毎回数える）・`event-routes.ts` |
| `imports/`（取り込み） | `imports`・`column_mappings`・`choice_mappings`・`responses`・`erased_responses` | `mapping.ts`（列と同意の選択肢の対応・覚える）・`classify.ts`（行の判定・二重の印）・`candidates.ts`（同じ人の候補）・`import-service.ts`（プレビューと書く）・`undo.ts`（取り消し・イベントを消すときの取り消し）・`import-routes.ts` |
| `persons/`（人） | `persons`・`manual_attendances`・`consent_changes`・`erased_attendances` | `person-derive.ts`（今のLINE名と同意を決め直す） |
| `me/`（人物メモの「自分」） | — | `me-routes.ts`（`GET /api/people/me`） |
| `inbox/`（出来事の受け取り） | `received_events` | `withdrawal.ts`（`user.withdrawn`の受け取り） |
| （直下） | — | `index.ts`（入口）・`schema.ts`（11表。スキーマ`people`）・`register.ts`（`registerPeople()`）・`registry.ts`（アプリの番号）・`access.ts`（持ち主の確かめ・作り手のロック）・`usage.ts`（`reportUsage`。数はいつも0）・`routes.ts`（`/api/people`の関所と道筋） |

## 2. Web

| モジュール | 主な中身 |
|---|---|
| `apps/people/` | `index.ts`（`peopleApp`）・`routes.tsx`・`shell/`（`PeopleShell`：サイドバーの中身と、767px以下の下のバー）・`pages/`（ホーム・取り込み・イベント）・`components/`（取り込みの段・同じ人の候補のカード）・`lib/`（`api.ts`・`query-keys.ts`・`paths.ts`・`read-csv-file.ts`） |
