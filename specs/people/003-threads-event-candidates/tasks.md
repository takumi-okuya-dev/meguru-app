# Tasks：Threadsの宣伝内容のイベントから、人物メモのイベントを作る

**Input**: [spec.md](./spec.md)・[plan.md](./plan.md)

1つの PR（マイグレーション 0044 があるので`run-ci`を付ける）。テストを先に書く。

## Phase 1：土台（共通の形・表）

- [x] T001 `packages/shared/src/apps/people/schemas.ts`：`eventCreateSchema`に`sourceThreadsPromotionId`（任意、1〜100文字）を足し、`eventUpdateSchema`は元の番号を含まない形のままにする。`PeopleThreadsCandidate`（promotionId・name・startsAt・usedByEventId）の型を足す
- [x] T002 `packages/shared/src/apps/people/errors.ts`：`PEOPLE_THREADS_EVENT_USED`（409）と文言
- [x] T003 `apps/api/src/apps/people/schema.ts`：`peopleThreadsEventCandidates`と`peopleEvents.sourceThreadsPromotionId`（作り手ごとに一意）。`pnpm --filter api db:generate`で 0044 を作り、SQLを読む

## Phase 2：User Story 1・2（API）

- [x] T004 [US1][US2] 結合テスト`apps/api/test/integration/people/threads-candidates.test.ts`：Threadsで保存 → 候補に出る／直す → 新しくなる／消す・開催日時を消す → 出ない／2回届く・古い出来事 → 変わらない／ほかの人の候補は出ない／候補から作る → 元の番号・「作った」／2つ目は409／ほかの人・知らない番号は400／イベントを消すとまた選べる／退会で候補も消える／使えない人は403
- [x] T005 [US2] `apps/api/src/apps/people/inbox/threads-candidates.ts`：`onPromotionEventSaved`・`onPromotionEventDeleted`（received_events で二重を防ぎ、古い出来事を捨てる）
- [x] T006 [US1] `apps/api/src/apps/people/threads-candidates/`：`listCandidates`（近い順・usedByEventId）・`assertOwnCandidate`・`GET /threads-candidates`
- [x] T007 [US1] `apps/api/src/apps/people/events/event-service.ts`：`createEvent`で元の番号を確かめて持たせ、一意の制約を 409 にする
- [x] T008 `apps/api/src/apps/people/register.ts`・`routes.ts`：受け取りと道筋の登録。`inbox/withdrawal.ts`で候補も消す。`pnpm --filter api routes:snapshot`

## Phase 3：User Story 1（画面）

- [x] T009 [US1] Webのテスト`apps/web/test/apps/people/threads-event-picker.test.tsx`：候補が出る・選ぶと名前と開催日が入る・作ったものは選べない・候補がないときの案内・作るときに元の番号を送る
- [x] T010 [US1] `apps/web/src/apps/people/components/ThreadsEventPicker.tsx`と`lib/api.ts`・`lib/query-keys.ts`。`EventNewPage`・`import/EventStep.tsx`に置く
- [x] T011 [US1] E2E`e2e/tests/people-threads-candidates.spec.ts`：候補の行を置き（出来事が写るところは T004 で確かめる）、390px幅の「イベントを作る」で選んで作る → イベントのページへ → もう一度開くと「作った」で選べない（はみ出さない・押すところ44px）

## Phase 4：仕上げ

- [x] T012 文書：`docs/apps/people.md`・`docs/module-map.md`の出来事の表・人物メモ 001 の`contracts/ui-routes.md`
- [x] T013 手元で全部の確かめ（型チェック・lint・`eslint-rules`のテスト・共通・Web・APIの全テスト・関わるE2E）
- [ ] T014 マージのあと、テスト版で Threads の宣伝内容を保存して、人物メモの候補から作れることを確かめる
