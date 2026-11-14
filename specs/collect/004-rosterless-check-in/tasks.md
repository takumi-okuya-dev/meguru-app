# Tasks：名簿なしで受付する（セルフ受付で名簿を作る）

**Input**：[plan.md](./plan.md)・[spec.md](./spec.md)・[research.md](./research.md)・[data-model.md](./data-model.md)・[contracts/api.md](./contracts/api.md)・[quickstart.md](./quickstart.md)

**Tests**：書く（001〜003 と同じく、API の結合テスト・Web のテスト・E2E）。

**PR の分け方**（research R11）：
- **PR1**：Phase 1〜2 と各 User Story の API・共通・結合テスト（T001〜T024）。マイグレーションがあるので CI を流す（`run-ci`）。
- **PR2**：各 User Story の画面・Web のテスト・E2E・文書（T025〜T040）。PR1 の上に積む。

作業場所：`/Users/takumi/Documents/my-repositories/meguru-app-collect`。パスはリポジトリの根からの相対。

## Phase 1：Setup（共通の形）

- [ ] T001 [P] `packages/shared/src/apps/collect/` に受付のしかたを足す：`CHECK_IN_MODES = ["roster", "rosterless"] as const`・`NEW_EVENT_CHECK_IN_MODE = "rosterless"`。`collectEventSchema` に `checkInMode`、作る入力に任意の `checkInMode`（省いたら API が `roster`）、直す入力に任意の `checkInMode`（`packages/shared/src/apps/collect/schemas.ts`）。
- [ ] T002 [P] `packages/shared/src/apps/collect/self-check-in.ts` に足す：`SELF_CHECK_IN_LIMITS` の `entriesPerDevicePerLink: 10`・`entriesPerLinkPerMinute: 60`・`entriesPerLink: 1000`。`selfLinkInfoSchema` に `checkInMode`・`media`（`z.array(z.enum(COLLECT_MEDIA))`）・`tiers`（`{ name, amount }[]`）。`selfPersonSchema` に `tierUndecided: z.boolean()`。新しい `selfEntryRequestSchema`（`name`：前後の空白を除いて必須・`COLLECT_LIMITS.personName`（50）文字まで、`kana`：任意・`COLLECT_LIMITS.kana`（50）文字まで、`media`：`z.enum(COLLECT_MEDIA)`、`referrer`：任意・`COLLECT_LIMITS.referrer`（40）文字まで、`clientRequestId`：uuid）と `selfEntryResponseSchema`（`requestId`・`person`）。
- [ ] T003 [P] 仮の区分の決め方を共通の関数にする：`provisionalTier(tiers)`（0円を除いた最も安い区分。0円しかなければ position が最初の区分）と `tierUndecidedFor(tiers)`（区分が2つ以上なら true。0円の区分も数える）を `packages/shared/src/apps/collect/rosterless.ts` に置き、index から出す。テストを `packages/shared/test/apps/collect/rosterless.test.ts` に書く（1つ・2つ・0円を含む・0円だけ・同じ金額は position の順）。
- [ ] T004 [P] 受付の画面の人（`ReceptionPerson` の形）に `tierUndecided`・`sameName`・`selfEntered` を足し、締め（`closingSnapshotSchema`）に `checkInMode`・`unrecordedCount` を足し、振込待ちの項目に `tierUndecided`・`tiers`（`{ id, name, amount }[]`）を足し、`confirmTransferRequestSchema`（`priceTierId` 任意の uuid）を足す（`packages/shared/src/apps/collect/` の該当するファイル）。エラーのコード `TIER_REQUIRED`・`CHECK_IN_MODE_MISMATCH` を集金管理のエラーの文（`apps/web/src/apps/collect/lib/errors.ts` で使う一覧）に足す。

## Phase 2：Foundational（表とマイグレーション）

- [ ] T005 `apps/api/src/apps/collect/schema.ts` に列を足す（data-model.md 2）：`events.check_in_mode text NOT NULL DEFAULT 'roster'`（check `IN ('roster', 'rosterless')`）、`roster_people.tier_undecided boolean NOT NULL DEFAULT false`・`roster_people.self_entered_at timestamptz`（check：`NOT tier_undecided OR self_entered_at IS NOT NULL`）、`self_check_in_requests.client_request_id uuid UNIQUE`。
- [ ] T006 マイグレーションを作る：`pnpm --filter api db:generate` で `apps/api/drizzle/0043_collect_rosterless_check_in.sql` と meta を作り、先頭に何をするかのコメントを書く。前からあるイベントが `roster` になることを確かめる。
- [ ] T007 `apps/api/src/apps/collect/events/event-service.ts` で、作る・直すで `checkInMode` を受けて保存し（作るときに省いたら `roster`）、イベントの応答に `checkInMode` を出す。結合テストを `apps/api/test/integration/collect/events.test.ts` に足す（省くと roster・rosterless で作れる・直せる・応答に出る）。

## Phase 3：User Story 1 - 参加者が名前と媒体を入れるだけで受付する（P1）🎯 MVP

**Goal**：名簿なしのイベントで、参加者が名前・媒体を入れると名簿に入り、払い方を選べる。
**Independent Test**：区分1つ・名簿0人の名簿なしのイベントで、参加者が入れると No.1 で名簿に入り、PayPay を選ぶと確かめ待ちになる。

### Tests（PR1）

- [ ] T008 [P] [US1] 結合テスト `apps/api/test/integration/collect/rosterless.test.ts` を作る：
  - 区分1つで入れる → 201・No.1・`tierUndecided: false`・名簿に媒体と紹介した人が入る・申し出の表に `accepted`
  - 区分2つで入れる → 仮の区分（0円を除いた最も安い区分）・`tierUndecided: true`・`GET /s/:token` の `tiers` に0円を除いた区分
  - 同じ `clientRequestId` の送り直し → 200・同じ人（2人にならない）
  - `GET /me` が `request.person` を返す → `declare` で確かめ待ち（002 と同じ）
  - 名簿ありのイベントでは 409 `CHECK_IN_MODE_MISMATCH`、止めた・期限が過ぎたリンクでは 410
  - 応答に、ほかの名簿の人の名前・人数が出ない
  - `GET /s/:token` の `checkInMode`・`media`（Threads の掲載済みが先）

### Implementation（PR1）

- [ ] T009 [US1] `apps/api/src/apps/collect/self-check-in/self-service.ts` の `selfLinkInfo` に `checkInMode`・`media`（`postedMediaOf` で掲載済みを先に）・`tiers` を足し、`selfPersonOf` に `tierUndecided` を足す。
- [ ] T010 [US1] `apps/api/src/apps/collect/self-check-in/entry-service.ts` を作る：`createEntry(databaseUrl, link, deviceHash, input, now)`。1つのトランザクションで、イベントを `FOR UPDATE` で読み、名簿ありなら 409、送り直しなら同じ応答、受付番号を振って名簿の人を作り（`self_entered_at = now`・区分は `provisionalTier`・`tier_undecided = tierUndecidedFor`・`referrer_key` は 003 と同じ形）、申し出の表に `status = 'accepted'`・`client_request_id`・`roster_person_id`・`resolved_at` の行を作り、版を上げる。
- [ ] T011 [US1] `apps/api/src/apps/collect/self-check-in/self-routes.ts` に `POST /s/:token/entries` を足す（`activeSelfLink`・端末の印・`parseBody(selfEntryRequestSchema)`）。作ったら会場の共有に、002 で申し出を名簿に入れたときと同じ知らせを送る。`apps/api/test/routes.snapshot.txt` を直す。

## Phase 4：User Story 2 - 受付をする人が区分を決めて受け取る（P1）

**Goal**：区分が未定の確かめ待ち・振込待ちを、区分を選んで確かめる。
**Independent Test**：区分2つの名簿なしのイベントで、確かめ待ちを「早割」で受け取ると 2,500円・名簿の区分も早割になる。

### Tests（PR1）

- [ ] T012 [P] [US2] 結合テストを `apps/api/test/integration/collect/rosterless.test.ts` に足す：
  - 未定の人の確かめで `priceTierId` がない → 400 `TIER_REQUIRED`（主催者・手伝う人の両方）
  - 選ぶと支払い済み・選んだ区分の金額・名簿の区分も変わり `tierUndecided: false`
  - 区分1つのイベントでは `priceTierId` なしで確かめられる
  - 振込待ちの入金を確かめるでも同じ（`POST /transfers/:personId/confirm`）
  - 振込待ちの一覧に `tierUndecided`・`tiers`
  - 主催者が名簿の区分を直す・受付の記録の区分を直すと `tierUndecided: false`
  - 未定の金額は支払い済みになるまで受付の数字・締めの合計に入らない
  - 003 の見込みには仮の金額で入る

### Implementation（PR1）

- [ ] T013 [US2] `apps/api/src/apps/collect/reception/reception-service.ts` の `confirmReception` で、名簿の人が `tier_undecided` でイベントの区分が2つ以上なら `priceTierId` を要求し（なければ `AppError("TIER_REQUIRED", 400)`）、確かめたら名簿の人の `price_tier_id` を選んだ区分にして `tier_undecided = false` にする。受付の記録を直す処理でも区分を変えたら `tier_undecided = false`。受付の画面の人に `tierUndecided`・`selfEntered` を出す。
- [ ] T014 [US2] `apps/api/src/apps/collect/transfers/transfer-service.ts`・`transfer-routes.ts` で、入金を確かめるときに `confirmTransferRequestSchema` を受け、未定の人は区分を要求する（T013 と同じ決まり。記録の区分と金額・名簿の区分を変える）。一覧の項目に `tierUndecided`・`tiers` を足す。
- [ ] T015 [US2] `apps/api/src/apps/collect/roster/roster-service.ts` で、主催者が名簿の人の区分を直したら `tier_undecided = false` にする。

## Phase 5：User Story 3 - 主催者が受付のしかたを選ぶ（P1）

**Goal**：イベントごとに受付のしかたを選べ、名簿なしでは締めで来なかった人を出さない。
**Independent Test**：名簿なしのイベントの締めで `absent` が空・`unrecordedCount` が出る。名簿ありに変えるとセルフ受付が探す形に戻る。

### Tests（PR1）

- [ ] T016 [P] [US3] 結合テストを `apps/api/test/integration/collect/rosterless.test.ts` に足す：
  - 名簿なしの締めで `absent: []`・`unrecordedCount`
  - CSV の区分の列が未定の人は「未定」（`apps/api/test/integration/collect/export.test.ts` に足してもよい）
  - 名簿ありに変えると `GET /s/:token` の `checkInMode: "roster"`・入口は 409、名簿と記録は変わらない
  - 前からのイベント（作るときに省いた）は名簿ありのまま 002 のテストが通る

### Implementation（PR1）

- [ ] T017 [US3] `apps/api/src/apps/collect/closing/closing-service.ts`（と `tally.ts`）で、締めに `checkInMode`・`unrecordedCount` を出し、名簿なしでは `absent` を空にする。`apps/api/src/apps/collect/closing/export-csv.ts` で、未定の人の区分を「未定」にする。

## Phase 6：User Story 4 - 同じ名前の知らせと外す（P2）

**Goal**：名簿なしで別の端末から同じ名前が入ったら知らせ、受付をする人が外せる。主催者が先に入れた人とは当てる。
**Independent Test**：2台目の端末から同じ名前で入れると両方の行に `sameName`、外すと消える。主催者が先に入れた人とは当たり、人数が増えない。

### Tests（PR1）

- [ ] T018 [P] [US4] 結合テストを `apps/api/test/integration/collect/rosterless.test.ts` に足す：
  - 別の端末から同じ名前（ひらがなとカタカナ・空白の違い）→ 2人目ができ、受付の画面の両方に `sameName: true`。名簿ありのイベントでは常に false
  - 主催者が先に入れた未受付の人と一致 → 当たる（申し出は `matched`・人数が増えない・紹介した人が空なら埋まる）
  - 一致した人が受付済み・2人と一致 → 新しい人
  - 名簿なしで入った人どうしは当てない
  - `DELETE …/reception/:personId/entry`：記録なし → 消える（主催者・手伝う人）、記録あり → 409 `ALREADY_RECORDED`、名簿なしで入っていない人 → 404、外したあとの `me` は `person: null`
- [ ] T019 [P] [US4] 上限の結合テスト（同じファイル）：1つの端末から11人目 → 429 `RATE_LIMITED`。リンク全体の1分の上限は、値を小さくした呼び方で確かめる（または数え方の関数を単体で確かめる）。

### Implementation（PR1）

- [ ] T020 [US4] `apps/api/src/apps/collect/self-check-in/entry-service.ts` に、主催者が先に入れた人に当てる処理（research R5）と上限（research R6：申し出の表の `client_request_id` のある行を、端末ごと・リンクの1分・リンク全体で数える）を足す。
- [ ] T021 [US4] `apps/api/src/apps/collect/reception/reception-service.ts` の受付の画面の人に `sameName`（名簿なしのイベントで同じ `name_key` が2人以上）を出す。
- [ ] T022 [US4] `DELETE …/reception/:personId/entry` を主催者の道筋（`apps/api/src/apps/collect/reception/reception-routes.ts` か `self-routes.ts` の staff）と手伝う人の道筋に足し、`entry-service.ts` に `removeEntry(databaseUrl, actor, eventId, personId)` を置く（`self_entered_at` のある人だけ・記録があれば 409）。会場の共有に名簿の人を消したときと同じ知らせを送る。`apps/api/test/routes.snapshot.txt` を直す。

### PR1 の仕上げ

- [ ] T023 `docs/apps/collect.md` に、表の列（`check_in_mode`・`tier_undecided`・`self_entered_at`・`client_request_id`）と `entry-service.ts` を足す。
- [ ] T024 PR1 の確かめ：API の全テスト・共通のテスト・型チェック・eslint を通し、セルフレビューして PR を出す（`run-ci` を付ける）。

## Phase 7：画面（PR2）

### User Story 1

- [ ] T025 [P] [US1] `apps/web/src/apps/collect/lib/self-api.ts` に `entry(token, input)` を足す。
- [ ] T026 [US1] `apps/web/src/apps/collect/pages/SelfCheckInPublicPage.tsx`：`checkInMode === "rosterless"` なら、探す欄の代わりに入れる欄（名前・ふりがな（任意）・「どこで申し込みましたか」（`info.media` をボタンで。必須）・紹介してくれた人（任意。候補は出さない））。送ったら 002 の「名簿に入りました」→ 払い方の選択へ。`tierUndecided` の人には、払い方の選択と案内に区分ごとの金額（`info.tiers`）と「受付の人が区分を確かめます」を出す。上限の 429 は「受付が混んでいます。受付の人に声をかけてください」。外されたとき（`request.person` が null）は「受付の人に声をかけてください」。
- [ ] T027 [P] [US1] Web のテスト `apps/web/test/collect/self-check-in.test.tsx` に足す：名簿なしの入れる画面・媒体が必須・区分ごとの金額・送ったあと払い方の選択・429 の文。

### User Story 2

- [ ] T028 [US2] `apps/web/src/apps/collect/components/reception/SelfPanel.tsx`（確かめ待ち）で、`tierUndecided` の人は「区分を確かめる」を出し、「受け取った」で区分を選ぶ段を出してから確かめる（区分1つなら今のまま1回）。`TIER_REQUIRED` の文を足す。
- [ ] T029 [US2] `apps/web/src/apps/collect/pages/TransfersPage.tsx` で、`tierUndecided` の人の「入金を確かめた」で区分を選ぶ。
- [ ] T030 [P] [US2] Web のテスト `apps/web/test/collect/self-confirm.test.tsx`・`transfers.test.tsx` に足す（区分を選ぶ段・選ぶまで確かめない・区分1つは1回）。

### User Story 3

- [ ] T031 [US3] `apps/web/src/apps/collect/components/EventForm.tsx` に受付のしかた（名簿なし・名簿あり）を足す。作る画面の初めの値は `NEW_EVENT_CHECK_IN_MODE`（Threads のイベントから選んで作るときも）。`apps/web/src/apps/collect/pages/EventNewPage.tsx` で、名簿なしで作ったらセルフ受付の画面（`selfCheckInPath`）へ移る。
- [ ] T032 [US3] `apps/web/src/apps/collect/pages/RosterPage.tsx` で、名簿なしのイベントに「参加者がセルフ受付で入れると、ここに増えます」、未定の人に「区分を確かめる」を出す。`apps/web/src/apps/collect/pages/ClosingPage.tsx` で、名簿なしでは来なかった人の段の代わりに「受付の記録がない人 N人」。
- [ ] T033 [P] [US3] Web のテスト `apps/web/test/collect/event-form.test.tsx`・`roster.test.tsx`・`closing.test.tsx` に足す（既定が名簿なし・作ったあとセルフ受付へ・締めの段）。

### User Story 4

- [ ] T034 [US4] `apps/web/src/apps/collect/components/reception/ReceptionRow.tsx` で、`sameName` の行に「同じ名前の人がいます」、`selfEntered` で記録のない行に「名簿から外す」（確かめの段を挟む）。主催者と手伝う人の両方（`apps/web/src/apps/collect/lib/api.ts`・`helper-api.ts` に `removeEntry`）。
- [ ] T035 [P] [US4] Web のテスト `apps/web/test/collect/reception.test.tsx`・`helper-reception.test.tsx` に足す（同じ名前の知らせ・名簿から外す）。

## Phase 8：Polish（PR2）

- [ ] T036 E2E `e2e/tests/collect-rosterless.spec.ts`：主催者が名簿なしで作る（区分2つ）→ 参加者（390px・ログインなし）が名前と媒体を入れて現金を選ぶ → 主催者の受付の画面に5秒以内に確かめ待ち → 区分を選んで受け取る → 参加者の画面が「受付が済みました」。参加者の画面がはみ出さない。
- [ ] T037 [P] `docs/apps/collect-guide.md` に「名簿なしで受付する」を書く（受付のしかたの選び方・参加者が入れること・区分を確かめる・同じ名前と外す・締めの違い）。
- [ ] T038 [P] `docs/apps/collect.md`・`specs/collect/001-event-day-collection/contracts/ui-routes.md` に画面の変更を足す。
- [ ] T039 PR2 の確かめ：Web の全テスト・E2E・型チェック・eslint を通し、390px の画面写真で見え方を確かめ、セルフレビューして PR を出す（CI は流さない）。
- [ ] T040 マージのあと、ステージングで [quickstart.md](./quickstart.md) の1〜6を確かめる。

## Dependencies & Execution Order

- Phase 1 → Phase 2 → User Story の API（Phase 3〜6）→ 画面（Phase 7）→ Polish（Phase 8）。
- User Story 1 の API（T008〜T011）が先。User Story 2・3・4 の API は User Story 1 の入口を使うので、その後（2・3・4 のあいだは独立）。
- 画面は、対応する User Story の API のあと。T026 は T025 のあと、T034 は T022 のあと。

## Parallel Example

```text
# Phase 1：共通の形はファイルが別なので並べられる
T001・T002・T003・T004

# User Story 2〜4 の結合テストは、同じファイルの別の describe なので、書く順は自由（ファイルが同じなので [P] は Phase をまたがない）
T012・T016・T018
```

## Implementation Strategy

- **MVP**：Phase 1〜3（名簿なしの入口と参加者の画面）。区分1つのイベントなら、これだけで名簿を作らずに会を開ける。
- 次に User Story 2（区分を決める）と 3（受付のしかた・締め）で、区分が2つ以上の会と、既定の名簿なしに対応する。User Story 4 で二重の受付を片付けられるようにする。
- PR1（API）を先に出し、CI を流してから、その上に PR2（画面）を積む。
