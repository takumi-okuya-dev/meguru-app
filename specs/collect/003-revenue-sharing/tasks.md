# Tasks：売上・経費・紹介と、運営メンバーへの分配

**入力**：[spec.md](./spec.md)・[plan.md](./plan.md)・[research.md](./research.md)・[data-model.md](./data-model.md)・[contracts/api.md](./contracts/api.md)

**PR**：PR1（T001〜T016：共通の形・マイグレーション・API）→ PR2（T017〜T024：主催者の画面）→ PR3（T025〜T031：招待とつながった人の画面・E2E）。→ PR4（T032〜T038：精算の手順。User Story 4）。

## Phase 1: 共通の形と計算（PR1）

- [x] T001 分配の計算 `computeDistribution(amount, members)` を packages/shared/src/apps/collect/distribution.ts に作る（research R1：円の整数・`ratioTenths`・端数は最初のリーダー→主催者→最初の人・全員リーダーは比で分ける・1人・赤字は |A| で負担の目安）。傾斜の上限 `maxRatioTenths(members)`（R2：メンバーがいれば N×10、いなければ null）も
- [x] T002 [P] 単体テスト packages/shared/test/collect/distribution.test.ts（20,000円・4人・12 → 6,002／4,666×3、15 → 7,502／4,166、リーダー2人、全員リーダー、1人、メンバーだけ、赤字、合計がいつも A と同じ（ばらばらの入力で試す））
- [x] T003 [P] 形とエラーのコードを packages/shared/src/apps/collect/sharing.ts と errors.ts に足す（`SharingSnapshot`・`Expense`・`SharingMember`・`Distribution`・入力の形（経費の名前1〜40文字・金額1〜999,999・運営メンバーの名前1〜40文字・`ratioTenths` 10〜50）・`RATIO_TOO_HIGH`・`ALREADY_LINKED`・`INVITE_INACTIVE`・つながった人の形）。`referrerKey(name)`（敬称を除いて `nameKey`）を names.ts に、名簿の人の形に `referrer` を足す

## Phase 2: 表（PR1）

- [x] T004 apps/api/src/apps/collect/schema.ts に `expenses`・`sharing_members`・`sharing_invites` と、`roster_people.referrer`・`referrer_key`、`event_summaries.expense_total`・`referred` を足す（data-model.md 1・2 の check と索引のとおり）。`pnpm db:generate` でマイグレーションを作り、頭に説明を書く
- [x] T005 docs/apps/collect.md の表の一覧と数を直す

## Phase 3: User Story 1・2 経費と分配（PR1、P1）

- [x] T006 [US1] apps/api/src/apps/collect/sharing/sharing-service.ts：`sharingSnapshot`（主催者の行がなければ作る・tally で支払い済みと振込待ち・経費・運営メンバー・招待・今と見込みの分配・立て替えの戻し）
- [x] T007 [US1] 経費の足す・直す・消す（上限100件・立て替えた人は運営メンバーか名前のどちらか）を sharing-service.ts に
- [x] T008 [US2] 運営メンバーの足す・直す・消す・つながりを外す（上限20人・傾斜の上限 `RATIO_TOO_HIGH`・リーダーの既定12・主催者の行のつながりは外せない）を sharing-service.ts に
- [x] T009 [US1] [US2] 道筋を apps/api/src/apps/collect/sharing/sharing-routes.ts に作り、apps/api/src/apps/collect/index.ts でつなぐ（contracts/api.md 1-1〜1-3）

## Phase 4: User Story 3 紹介した人（PR1、P2）

- [x] T010 [US3] 名簿の足す・まとめて貼る・直すで `referrer` を受けて `referrer_key` を入れる（apps/api/src/apps/collect/roster/roster-service.ts）。名簿の人の形に出す
- [x] T011 [US3] `GET …/referrals`・`GET /referrers` を sharing に（tally と同じ数え方。確かめ待ちは来場に数え売上に入れない）
- [x] T012 [US3] CSV に「紹介した人」の列（apps/api/src/apps/collect/closing/export-csv.ts）、まとめに `expenseTotal`・`referred`（summaries とイベントを消すところ）

## Phase 5: User Story 5 招待とつながった人（PR1、P2）

- [x] T013 [US5] apps/api/src/apps/collect/sharing/invite-service.ts：招待を出す（`ci_`＋32バイト・SHA-256・7日・出し直しは消してから）・止める・読む・受ける（主催者自身・二重は `ALREADY_LINKED`・使えないリンクは `INVITE_INACTIVE`）
- [x] T014 [US5] つながった人の道筋 `GET /shares`・`GET /shares/:eventId`（ログインだけ。名簿・参加者を返さない）と招待の道筋を apps/api/src/apps/collect/sharing/member-routes.ts に作り、index.ts でつなぐ
- [x] T015 [US5] 退会のときにつながりを外す（apps/api/src/apps/collect/inbox/received-events.ts の `onUserWithdrawn`）
- [x] T016 結合テスト apps/api/test/integration/collect/sharing.test.ts・referrals.test.ts・sharing-invites.test.ts と routes.snapshot.txt

## Phase 6: 主催者の画面（PR2）

- [x] T017 [US1] apps/web/src/apps/collect/lib/api.ts に分配・経費・運営メンバー・招待・紹介の呼び出し、query-keys・paths（`sharingPath`）を足す
- [x] T018 [US1] 分配の画面 apps/web/src/apps/collect/pages/SharingPage.tsx（売上・経費・残る額（今・見込み）の段）とルート・サイドバーの「分配」・締めの画面からの入口
- [x] T019 [US1] 経費の一覧と足す・直す・消す apps/web/src/apps/collect/components/sharing/ExpenseList.tsx
- [x] T020 [US2] 運営メンバーと傾斜 apps/web/src/apps/collect/components/sharing/MemberList.tsx（傾斜は 1.0〜上限・0.1きざみ。入力しながら共通の計算で出し直す）
- [x] T021 [US2] 分配の表と内訳 apps/web/src/apps/collect/components/sharing/DistributionTable.tsx（今・見込みの切り替え・端数・立て替えの戻し・受け取る合計・赤字）
- [x] T022 [US3] 紹介経由の売上 apps/web/src/apps/collect/components/sharing/ReferralTable.tsx
- [x] T023 [US3] 名簿の紹介した人（PersonDialog・まとめて貼るの列・名簿の行）を apps/web/src/apps/collect/components/roster/ に
- [x] T024 Web のテスト apps/web/test/collect/sharing.test.tsx・roster の紹介した人

## Phase 7: 招待とつながった人の画面（PR3）

- [x] T025 [US5] 運営メンバーの行の「招待のリンクを出す」（QR・コピー・期限・止める・出し直す）を MemberList に
- [x] T026 [US5] 招待を受ける画面 apps/web/src/apps/collect/pages/JoinPage.tsx（`/collect/join/:token`。ログインしていなければ `/sign-in?next=…`）
- [x] T027 [US5] つながった人の画面 apps/web/src/apps/collect/pages/SharesPage.tsx（`/collect/shares`・`/collect/shares/:eventId`。集金管理の骨格の外。読むだけ・自分の行に「あなた」）
- [x] T028 [US5] 利用の許可のない人の「使えません」の画面に、つながったイベントがあれば入口を出す（apps/web/src/apps/collect/routes.tsx）
- [x] T029 Web のテスト apps/web/test/collect/sharing-invites.test.tsx
- [x] T030 E2E e2e/tests/collect-sharing.spec.ts（主催者：経費・運営メンバー・分配 → 招待 → 別の利用者が受けて見る・名簿が見えない）
- [ ] T031 docs/apps/collect-guide.md に分配と招待の使い方（collect-guide.md を入れる #123 のあとで足す）

## Phase 8: 精算の手順（PR4。User Story 4）

- [ ] T032 [US4] 共通の計算 packages/shared/src/apps/collect/settlement.ts（`settlementSteps`：運営メンバーでない人は主催者へ・同じ額の組を先に・差の大きい順。差の合計が0でなければ `mismatch`）と形・単体テスト packages/shared/test/apps/collect/settlement.test.ts
- [ ] T033 [US4] マイグレーション apps/api/drizzle/NNNN_collect_settlement.sql と schema.ts（`settlement_transfers`：from_key・to_key 1〜80文字・名前 1〜40文字・amount 1〜99,999,999・`from_key <> to_key`。`settlement_holders`：helper_id 主キー・member_id null は「運営メンバーでない」）
- [ ] T034 [US4] apps/api/src/apps/collect/sharing/settlement-service.ts：持っている額（PayPay・振込・主催者の現金・001 で精算した分・立て替えた人のない経費）・受け取る合計・手伝う人の対応（名前の形が同じ1人なら自動）・渡したもの（200件まで）
- [ ] T035 [US4] 道筋 `GET …/settlement`・`PUT …/settlement/helpers/:helperId`・`POST`/`DELETE …/settlement/transfers` を sharing-routes.ts に（主催者だけ）
- [ ] T036 [US4] 結合テスト apps/api/test/integration/collect/settlement.test.ts（spec の例：主催者 PayPay 15,000・井上 現金 9,000 → 全員の受け取りが合う）と routes.snapshot.txt
- [ ] T037 [US4] 分配の画面に「精算の手順」の段 apps/web/src/apps/collect/components/sharing/SettlementSteps.tsx（持っている額・手伝う人の対応・手順と「渡した」・渡したもの（時刻・取り消す））
- [ ] T038 [US4] Web のテスト（apps/web/test/collect/sharing.test.tsx に「精算の手順」を足す）
