# Tasks：参加者が自分で受付する（セルフ受付）

**入力**：[spec.md](./spec.md)・[plan.md](./plan.md)・[research.md](./research.md)・[data-model.md](./data-model.md)・[contracts/api.md](./contracts/api.md)・[quickstart.md](./quickstart.md)

**PRの分け方**（research.md R7）：
- **PR1a＝Phase 1〜2・各 User Story の API**（共通の形・API・マイグレーション。CIを流す）
- **PR1b＝各 User Story の画面と E2E**

## Format：`[ID] [P?] [Story] Description`

- 置き場所の略：`api`＝`apps/api/src/apps/collect/`、`web`＝`apps/web/src/apps/collect/`、`shared`＝`packages/shared/src/apps/collect/`、`api-test`＝`apps/api/test/integration/collect/`、`web-test`＝`apps/web/test/collect/`

---

# PR1a：共通の形・API・マイグレーション

## Phase 1：Setup

- [x] T001 `shared/reception.ts`：受付の形に足す。`PAYMENT_STATUSES` に `awaiting_confirmation`、`RECEIVER_KINDS` に `self`、記録に `selfReported`・`confirmedAt`、数字に `awaitingConfirmationCount`・`awaitingConfirmationAmount`、スナップショットに `selfRequests`、知らせに `self_requests.changed`・`self_link.stopped`、確かめる入力（`confirmReceptionRequestSchema`）。
- [x] T002 [P] `shared/self-check-in.ts`（新しい）：参加者の道筋の入力と出力（リンクの状態・探す・申告・申し出・自分の状態）、端末の見出しの名前 `COLLECT_SELF_DEVICE_HEADER`、回数の上限の数。
- [x] T003 [P] `shared/errors.ts`：`NOT_AWAITING_CONFIRMATION`・`REQUEST_PENDING`・`REQUEST_RESOLVED` と文言。

## Phase 2：Foundational

- [x] T004 `api/schema.ts`：`reception_links.kind`（`helper`・`self`。部分一意索引を `(event_id, kind)` に）、`reception_records` の check（`payment_status`・`receiver_kind`・確かめ待ちの組）と `self_reported`・`self_device_hash`・`confirmed_at`、新しい表 `self_check_in_requests`・`self_check_in_devices`（data-model.md 2）。マイグレーションを作り、SQLを読んでからコミットする。
- [x] T005 `api/helpers/link-service.ts`・`helper-service.ts`：リンクに種類を持たせる（手伝う人の道筋は `helper` のリンクだけ。トークンの頭 `cs_` はセルフ受付）。鍵の入れ替え（`link-tokens.ts`）は種類を問わない。
- [x] T006 `api/closing/tally.ts`・`reception-service.ts` の `computeStats`・`closing-service.ts`・`export-csv.ts`：確かめ待ちを現金・PayPayの合計と受け取った人ごとの現金から外し、確かめ待ちの件数と合計を別に出す。書き出しの「受け取った人」に「本人の申告（確かめ待ち）」「本人の申告→〇〇」。

## Phase 3：User Story 1・2 - 参加者が自分で受付し、受付をする人が確かめる（P1）

- [x] T007 [P] [US1] `api-test/self-check-in.test.ts`：リンクの状態・探す（名前・ふりがな・受付番号の完全一致・同じ名前で ambiguous・見つからない・敬称）・申告（現金とPayPayは確かめ待ち・振込は振込待ち・0円は来場だけ・使わない払い方は400・受付済みは409・同じ端末の確かめ待ちは選び直し・ほかの端末は409・送り直し）・回数の上限（端末・リンク全体）・止めた／期限が過ぎたリンクは410・手伝う人のリンクでは入れない・参加者の応答にメモ・ほかの人の名前が入らない。
- [x] T008 [P] [US2] `api-test/self-confirm.test.ts`：確かめる（受け取った人＝呼んだ人・払い方と金額を直す・確かめ待ちでなければ409・手伝う人も）・本人の申告の取り消し（手伝う人も）・数字（確かめ待ちは合計の外）・締め（確かめ待ちを外し、件数を出す）・書き出し・会場の共有の知らせ。
- [x] T009 [US1] `api/self-check-in/self-service.ts`：探す・申告・自分の状態・回数の上限（`self_check_in_devices`）。
- [x] T010 [US2] `api/reception/reception-service.ts`：`confirmReception`、本人の申告の取り消し（手伝う人も）、スナップショットに `selfRequests` と確かめ待ちの数字。
- [x] T011 [US1] `api/self-check-in/self-routes.ts`（`/s/:token/…`。ログインの関所の外）と、確かめるの道筋（主催者・手伝う人）。`routes.snapshot.txt` を書き直す。

## Phase 4：User Story 3 - セルフ受付のリンク（P2）

- [x] T012 [P] [US3] `api-test/self-check-in.test.ts` の「リンク（主催者）」：出す・同じものを返す・期限の既定・期限を変える・止める（知らせ・申告は残る）・出し直すと前のトークンは使えない・手伝う人のリンクと別に持てる・手伝う人は出せない。
- [x] T013 [US3] `api/self-check-in/self-routes.ts`：`…/self-link` の道筋。

## Phase 5：User Story 4 - 飛び入りの申し出（P2）

- [x] T014 [P] [US4] `api-test/self-requests.test.ts`：申し出る（端末ごとに待ち1件・リンク全体の上限）・名簿に入れる（受付番号・媒体「当日」）・当てる・断る・片付けた申し出は409・参加者の状態が進む・会場の共有の知らせ。
- [x] T015 [US4] `api/self-check-in/request-service.ts` と道筋（参加者の `POST /s/:token/requests`、受付をする人の `…/self-requests/:id/accept|match|reject`）。

## Phase 6：PR1a の仕上げ

- [x] T016 `docs/apps/collect.md`、tasks.md の印。API の全テスト・lint・型チェック。

---

# PR1b：画面・E2E

- [x] T017 [US3] `web/pages/SelfCheckInPage.tsx`（`/collect/events/:eventId/self`）：QR・コピー・期限・止める・出し直す・件数。サイドバーに「セルフ受付」。
- [x] T018 [US1] `web/pages/SelfCheckInPublicPage.tsx`（`publicRoutes` の `/collect/s/:token`）と `web/lib/self-api.ts`：探す → 払い方 → 案内（現金・PayPayのQR・振込）、選び直し、見つからない・同じ名前・受付済み・止められた、申し出と待ち、見えている間だけ3秒ごとに自分の状態を読む。端末の印はリンクごとに `localStorage`（読めなければ開いている間だけ）。
- [x] T019 [US2・US4] `web/components/reception/`：受付の画面の上に「確かめ待ち」（受け取った・払い方を変えて受け取る・申告を取り消す）と「申し出」（名簿に入れる・名簿の人に当てる・断る）。数字の段に確かめ待ち。締めの画面に確かめ待ちの知らせ。
- [x] T020 [P] `web-test/self-check-in.test.tsx`・`web-test/self-confirm.test.tsx`。
- [x] T021 `e2e/tests/collect-self-check-in.spec.ts`：参加者と主催者の2つのブラウザ。参加者が探して PayPay を選ぶ → 5秒以内に主催者の確かめ待ち → 受け取った → 参加者の画面が「済みました」。申し出 → 名簿に入れる → 払い方へ。390px ではみ出さない。
- [x] T022 `docs/apps/collect.md`、tasks.md の印。（`docs/apps/collect-guide.md` の使い方は、#145 で 5 章に足した）

## Dependencies

- PR1a の中：T001〜T003 → T004 → T005・T006 → US1・US2 → US3・US4（US3 のリンクは US1 のテストで使うので、T013 は T009 と同じころに作る）。
- PR1b は PR1a のあと。
