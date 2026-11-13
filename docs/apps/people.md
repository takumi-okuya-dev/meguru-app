# 人物メモのモジュール地図

**対象**：apps/api/src/apps/people・apps/web/src/apps/people（specs/people/001-people-memo）。全体の決まりは[docs/module-map.md](../module-map.md)。アプリごとの地図をここに分けて置き、並行開発で同じ文書に行を足し合わないようにする（specs/meguru/031-conflict-free-composition、[docs/parallel-development.md](../parallel-development.md) 11）。

## 1. API：人物メモ（apps/people）

specs/people/001-people-memo。運営者が開いた人だけが使える（`registerAppAccess("people", "granted")`）。道筋は`/api/people`の下で、すべてログインと`requireAppAccess("people")`を通る。

| 小分け | 表 | 処理とAPIの入口 |
|---|---|---|
| `events/`（イベント） | `events` | `event-service.ts`（作る・直す・一覧・数字・来た人・消す。参加者数は毎回数える）・`event-routes.ts` |
| `imports/`（取り込み） | `imports`・`column_mappings`・`choice_mappings`・`responses`・`erased_responses` | `mapping.ts`（列と同意の選択肢の対応・覚える）・`classify.ts`（行の判定・二重の印）・`candidates.ts`（同じ人の候補）・`import-service.ts`（プレビューと書く）・`undo.ts`（取り消し・イベントを消すときの取り消し）・`import-routes.ts` |
| `persons/`（人） | `persons`・`manual_attendances`・`consent_changes`・`erased_attendances` | `person-derive.ts`（今のLINE名と同意を決め直す）・`person-query.ts`（来た記録・最後に会った日・いちばん新しい回答の問い合わせの部品）・`person-list.ts`（人の一覧・選べる値）・`person-service.ts`（人のページ・直す・同意を直す）・`person-create.ts`（手で足す・会ったイベント）・`person-merge.ts`（まとめる・分ける）・`person-delete.ts`（人を消す。数と回答の印は残す）・`person-routes.ts` |
| `outreach/`（誘う候補・声かけ） | `outreaches` | `candidate-service.ts`（誘う候補。目的の同意を問い合わせの条件に入れる）・`outreach-service.ts`（始める・進み具合・消す・自動で「来た」・まとめるときの移し替え）・`outreach-routes.ts` |
| `settings/`（設定と数字） | `owner_settings` | `settings-service.ts`（誘いの文の型・リピーターの目標・リピーターの数・次の自分の会）・`settings-routes.ts` |
| `me/`（人物メモの「自分」） | — | `me-routes.ts`（`GET /api/people/me`） |
| `inbox/`（出来事の受け取り） | `received_events` | `withdrawal.ts`（`user.withdrawn`の受け取り） |
| （直下） | — | `index.ts`（入口）・`schema.ts`（13表。スキーマ`people`）・`register.ts`（`registerPeople()`）・`registry.ts`（アプリの番号）・`access.ts`（持ち主の確かめ・作り手のロック）・`usage.ts`（`reportUsage`。数はいつも0）・`routes.ts`（`/api/people`の関所と道筋） |

## 2. Web

| モジュール | 主な中身 |
|---|---|
| `apps/people/` | `index.ts`（`peopleApp`）・`routes.tsx`・`shell/`（`PeopleShell`：サイドバーの中身と、767px以下の下のバー）・`pages/`（誘う候補・取り込み・イベント・人の一覧・人のページ・人を足す・誘いの文と目標）・`components/`（取り込みの段・同じ人の候補のカード・`person/`（探す欄・絞り込み・人の行・人のページの各段・まとめる・消す・声かけの記録）・`candidates/`（誘う会の選択・目的の切り替え・候補の行と文のコピー・リピーターの段））・`lib/`（`api.ts`・`query-keys.ts`・`paths.ts`・`refresh.ts`・`read-csv-file.ts`） |
