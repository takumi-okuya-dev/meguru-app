# Implementation Plan：Threadsの宣伝内容のイベントから、人物メモのイベントを作る

**Branch**: `feature/people-003-threads-event-candidates` | **Date**: 2026-11-15 | **Spec**: [spec.md](./spec.md)

## Summary

集金 001 の「Threadsのイベントの候補」（`apps/api/src/apps/collect/inbox/threads-candidates.ts`・`threads-candidates/`）と同じ形で、人物メモにも候補を持たせる。人物メモは Threads の出来事を受け取って自分のスキーマ（`people`）の表に写し、イベントを作るときに候補の番号を持たせる。Threads 側と共通（`platform/`）は変えない。

## Technical Context

- **Language/Version**：TypeScript（API：Cloudflare Workers + Hono + Drizzle、Web：React 19 + TanStack Query）
- **Storage**：Neon（Postgres）。人物メモのスキーマ`people`に表を1つ足し、`people.events`に列を1つ足す（マイグレーション 0044）
- **Testing**：APIの結合テスト（`apps/api/test/integration/people/`）・共通のテスト・Webのテスト（`apps/web/test/apps/people/`）・E2E（`e2e/tests/people-*.spec.ts`）
- **Constraints**：パターン①（人物メモは Threads と共通の表を読まない。出来事と入口の関数だけ）。出来事の受け取りは2回届いても同じ結果。名前をログに出さない

## Constitution Check

- アプリのデータの分け方（パターン①）：人物メモは出来事の中身だけを自分の表に写す。外部キーは張らない（宣伝内容の番号は値として持つ）。✅
- 運用コスト：出来事の届けは今ある仕組み（書いた直後と5分ごと）に乗る。新しい定期処理・サービスは足さない。✅
- 人の承認・NGワード：投稿にかかわらない。対象外。

## 設計

### R1. 出来事の受け取り（マイクロサービスを見込んで）

- 受け取るのは`threads.promotion_event.saved`と`threads.promotion_event.deleted`だけ（掲載の状況は使わない）。`registerPeople()`で`registerConsumer("people", …)`する。
- 受け取りは、人物メモのトランザクションの中で`people.received_events`に出来事の番号を書いてから処理する（もうあれば何もしない）。001 の退会の受け取りと同じ。
- 順番が入れ替わって届くので、候補の`details_occurred_at`より古い出来事は捨てる（集金と同じ）。
- 中身から写すのは`promotionId`・`ownerUserId`・`name`・`startsAt`だけ（FR-002）。人物メモに要らない値（会場・定員・料金）は持たない。持つ値を少なくすると、Threads の出来事の形が増えても影響を受けにくい。
- 切り出したときは、受け取りの関数（`onPromotionEventSaved`など）が、届けの仕組み（今は共通の送り出しの表、将来はキューやAPI）から呼ばれるだけで、中身は変えずに済む。
- **さかのぼらない**：出来事は、出したときに登録されている受け取り先にだけ届く。この機能を入れる前に保存された宣伝内容は候補にならない（Threadsでもう一度保存すれば出る）。テスト版で使っている人が少ないので、さかのぼる仕組み（共通の送り出しの表を読み直す・Threadsから出し直す）は作らない。出し直すと、集金の「元が変わった」の印が付いてしまうため。

### R2. 候補から作ったイベント

- `people.events.source_threads_promotion_id`（text、空を許す）を足す。作り手ごとに一意（`UNIQUE (user_id, source_threads_promotion_id)`。空は重ならない）。
- イベントを作る API（`POST /api/people/events`）に`sourceThreadsPromotionId`（任意）を足す。作り手のロックの中で、その作り手の消されていない候補かを確かめてから作る。一意の制約に当たったら 409 `PEOPLE_THREADS_EVENT_USED`。
- 作ったあとは、Threads の変更に合わせてイベントを変えない（FR-007）。候補が消されても、イベントの番号はそのまま残す（候補から外れるだけ）。
- 直す API（`PATCH`）では、元の番号は変えられない（入力の形に入れない）。

### R3. 画面

- 共通の部品`ThreadsEventPicker`（候補の一覧。選ぶと名前と開催日を入力欄に入れる。作ったものは「作った」で選べない）を、「イベントを作る」（`EventNewPage`）と取り込みの「新しいイベントを作る」（`EventStep`）の入力欄の上に置く。
- 開催日は、開始の時刻を日本時間の日付にしたもの（`jstDate`）。
- 候補がないときは、閉じた案内「Threadsの宣伝内容に開催日時を入れて保存すると、ここに出ます」を出す。読み込みに失敗したときは、候補の欄だけを出さず、手で作れるままにする。

## データ（マイグレーション 0044）

| 表・列 | 型 | 説明 |
|---|---|---|
| `people.threads_event_candidates.promotion_id` | text 主キー | Threads の宣伝内容の番号（値だけ。外部キーなし） |
| `.user_id` | uuid not null | 作り手（宣伝内容のアカウントの持ち主） |
| `.name` | text not null | 宣伝内容の名前 |
| `.starts_at` | timestamptz not null | 開始の時刻 |
| `.deleted_at` | timestamptz | Threadsで消された時刻（消されたら候補に出さない） |
| `.details_occurred_at` | timestamptz(6) not null | 最後に写した出来事の起きた時刻（古い出来事を捨てる） |
| 索引 | `(user_id, starts_at)` | 作り手の候補を開催日時の順に読む |
| `people.events.source_threads_promotion_id` | text | 候補から作ったときの元の番号。`UNIQUE (user_id, source_threads_promotion_id)` |

- 退会の受け取り（`inbox/withdrawal.ts`）で、作り手の候補も消す。

## API

| 道筋 | 説明 |
|---|---|
| `GET /api/people/threads-candidates` | 作り手の候補（消されていないもの）。`{ candidates: [{ promotionId, name, startsAt, usedByEventId }] }`。開催日時の近い順（今日より前は後ろ） |
| `POST /api/people/events` | 入力に`sourceThreadsPromotionId?: string`を足す。知らない・ほかの人の番号は 400 `VALIDATION_FAILED`（`fields: ["sourceThreadsPromotionId"]`）、もう作ってあれば 409 `PEOPLE_THREADS_EVENT_USED` |

## Project Structure

```text
packages/shared/src/apps/people/
  schemas.ts        # eventCreateSchema に sourceThreadsPromotionId、PeopleThreadsCandidate の型
  errors.ts         # PEOPLE_THREADS_EVENT_USED
apps/api/src/apps/people/
  schema.ts         # peopleThreadsEventCandidates、events.sourceThreadsPromotionId
  inbox/threads-candidates.ts      # 出来事の受け取り（新）
  threads-candidates/candidate-service.ts・candidate-routes.ts   # 候補の一覧・自分の候補かの確かめ（新）
  events/event-service.ts          # createEvent で元の番号を確かめて持たせる
  inbox/withdrawal.ts              # 候補も消す
  register.ts・routes.ts           # 受け取りと道筋の登録
apps/api/drizzle/0044_people_threads_event_candidates.sql
apps/web/src/apps/people/
  components/ThreadsEventPicker.tsx（新）・EventForm.tsx・import/EventStep.tsx
  pages/EventNewPage.tsx・lib/api.ts・lib/query-keys.ts
```

## 文書

- `docs/apps/people.md`（表・処理・道筋・Web）、`docs/module-map.md`（出来事の表の受け取り手に人物メモ）、人物メモ 001 の`contracts/ui-routes.md`（「イベントを作る」の候補の欄）、`apps/api/test/repo/routes.snapshot.txt`。
