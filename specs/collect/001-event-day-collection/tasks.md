---

description: "Task list for collect 001 event-day collection"
---

# Tasks：当日の集金（受付・締め・振込の確認）

**Input**：[spec.md](./spec.md)、[plan.md](./plan.md)、[research.md](./research.md)、[data-model.md](./data-model.md)、[contracts/api.md](./contracts/api.md)、[contracts/realtime.md](./contracts/realtime.md)、[contracts/events.md](./contracts/events.md)、[contracts/ui-routes.md](./contracts/ui-routes.md)、[quickstart.md](./quickstart.md)

**Tests**：このリポジトリの進め方（docs/ai-skills.md「作業の一覧を作る（テストを先に書く）」）に従い、各段のテストを実装の前に書いて、失敗を確かめてから作る。

**始める時期**：**Threadsをパターン①にそろえる作業（029。Threadsのリファクタリング）が`develop`に入ってから**。それまでは、どのタスクにも手を付けない（コード・マイグレーション・`wrangler.toml`・共通の変更を作らない。文書の直しだけはよい）。始める前に T004 で、029で決まった入口の関数・出来事・スキーマの作り方に、この一覧の言葉を合わせる。

**Organization**：PRは5つ（research.md R16）。
- **PR0＝Phase 0**（共通：既定でOFFの機能のON/OFF・人ごとの`available`）。**029に入れるか、`specs/meguru/NNN`の小さなPRにするかは未定（ユーザーが決める）**。どちらでも、集金管理のPRには混ぜない。
- **PR1＝Phase 1〜3**（土台・イベント・名簿。US1）
- **PR2＝Phase 4〜5**（受付・会場の共有・受付の手伝い。US2・US3）
- **PR3＝Phase 6〜8**（締め・振込・まとめ・CSV・退会。US4・US5）
- **PR4＝Phase 9**（Threadsのイベントの候補。US6。029の出来事と、Threadsが出来事を出す変更のあと）
- **Phase 10**：文書と仕上げ（各PRで該当の分を直す）

## Format：`[ID] [P?] [Story] Description`

- **[P]**：別ファイルで、未完了のタスクに依存せず並行できる。
- **[Story]**：[US1]〜[US6]は spec.md の User Story に対応する。
- **パス**：`api/`は`apps/api/src/`、`api-test/`は`apps/api/test/`、`web/`は`apps/web/src/`、`web-test/`は`apps/web/test/`、`shared/`は`packages/shared/src/`、`collect/`は`apps/api/src/apps/collect/`、`wcollect/`は`apps/web/src/apps/collect/`の略。
- **各タスクの終わり**：`pnpm typecheck`・`pnpm lint`が通ること。テストを足したタスクは、そのテストが通ること。

---

# PR0：共通の利用権（029に入れるか別PRかは未定）

## Phase 0：前提（共通の変更。集金管理のフォルダーの外）

**⚠️ PR1より先に`develop`に入っていること。仕様は029に足すか、`specs/meguru/NNN-app-entitlements`を作る。集金管理のセッションでは作らず、決まった方のセッションで作る。**

**2026-11-13 追記**：PR0は[specs/meguru/030-app-access](../../meguru/030-app-access/spec.md)で入れた。**機能のON/OFF（019）に項目を足すのではなく、共通に「アプリの利用の許可」を作った**（029のあと、機能のON/OFFはThreadsだけが持つ仕組みになったため）。集金管理は、PR1で`APP_CATALOG`に`collect`を足し、組み立てで`registerAppAccess("collect", "granted")`を呼び、道筋に`requireAppAccess("collect")`を付ける。運営者は、設定 > 運営の「使える機能」（人）と「グループ」の「アプリの利用」で開く・閉じる。T001・T002は030で別の形で済んだ。T003のうち`available`・`last`・`landing`の絞り込みと`PUT /api/me/last-app`の400は030で済み、`APP_CATALOG`への`collect`の追加と`registerAppAccess`はPR1でする。

- [ ] T001 共通の機能のON/OFF（`api/platform/features/`、029のあとは029が決めた置き場所）に、**既定でOFF**の項目を持てるようにするテストを先に書く：運営者が人ごと・テストのグループごとにONにした人だけが「使える」、ほかの人は「使えない」、今の項目（自動投稿・戦略・チーム。既定でON）の結果は変わらない（research.md R3）。
- [ ] T002 T001を通す：既定でOFFの項目「集金管理」（キーは`collect`）を足し、運営の画面（機能のON/OFF）に出す。名前と意味はアプリ側が決める形（029 FR-012）。共通の入口の関数の利用権が、この項目を見て`collect`の使える・使えないを返す。
- [ ] T003 `/api/me`の`available`を人ごとにする：`shared/apps.ts`の`APP_CATALOG`に`collect`（名前「めぐる 集金」・`basePath: "/collect"`・説明・料金の文言「テスト版（料金なし）」・`released: true`）を足し、`api/platform/identity/me-routes.ts`の`available`を「出してよいアプリ」かつ「その人に利用権がある」で絞る。テスト：利用権のない人の`available`に`collect`が出ない、ONにした人には出る、`PUT /api/me/last-app`は利用権のないアプリを400にする、Threadsだけの人の画面と応答は変わらない。

---

# PR1：土台・イベント・名簿

**2026-11-13 PR1の進め方**：大きいので、**PR1a（共通の関数・API・マイグレーション）**と**PR1b（画面と、`APP_CATALOG`への`collect`の追加）**に分けた。`APP_CATALOG`に足すと`/api/me`の`available`に出るので、画面のあるPR1bで足す。029・030に合わせて、次のように直した（T004）。
- 共通の置き場所は`packages/shared/src/apps/collect/`（029で`apps/threads/`の隣にした形。一覧の`shared/collect/`はこれに読み替える）。
- エラーのコードは今の一覧に合わせ、`NOT_FOUND`は`ITEM_NOT_FOUND`、`VALIDATION`は`VALIDATION_FAILED`を使う。新しく足すのは`TIER_IN_USE`・`IMAGE_TOO_LARGE`（PR1）と、PR2・PR3の分だけ。
- 受け取った出来事の表は、029の決まり（docs/module-map.md 6）に合わせて`received_events`（data-model.md 2-11の`processed_events`）。
- 退会の出来事の受け取り（その主催者のイベント・既定値を消す）は、PR1でデータを持ち始めるので、PR3からPR1aへ前に出した。まとめ・候補の表ができたら、PR3・PR4で消す対象に足す。
- 共通への利用の値（`reportUsage`）は、料金の数を0、イベントがあれば「使っている」で伝え、毎日の処理でも数え直す（docs/module-map.md 6 の4）。
- 名簿の一覧と、名簿を変える応答には、イベントの`version`を入れる（PR2の会場の共有で使う）。

## Phase 1：Setup（始める前のそろえ）

- [x] T004 `develop`を取り込み（docs/parallel-development.md 5章）、029で決まった次の3つを読み、plan.md・research.md R2・R3・R12・data-model.md 5・contracts/events.md の言葉と、この一覧の該当のタスクを直す：①共通の入口の関数の名前と返す形（今の利用者・利用権・利用者の情報）②出来事の名前・形・受け取りの手助け（あれば`processed_events`を置き換える）③アプリ専用のスキーマとマイグレーションの作り方。直したことを plan.md の頭に1行で書く。
- [x] T005 [P] `shared/collect/index.ts`を作り、`shared/index.ts`（パッケージの入口）から書き出す。中身は空の入口だけ。
- [x] T006 [P] `collect/index.ts`（入口）・`collect/schema.ts`（`pgSchema("collect")`だけ）を作り、`api/db/schema.ts`に`export * from "../apps/collect/schema";`を1行足す。ESLintの境界の規則（`eslint-rules/module-boundaries.js`）が`apps/collect`に当たること（共通の表・`apps/threads`を読むと止まること）を、`eslint-rules/module-boundaries.test.js`に1例ずつ足して確かめる。
- [x] T007 [P] `wcollect/index.ts`で`AppModule`（`id: "collect"`・`basePath: "/collect"`・アイコンはlucideの`Wallet`・`startPath: "/collect/events/new"`・`routes`は空の一覧の画面だけ）を出し、`web/app-registry.ts`に1行足す。Webの境界の規則が当たること（`apps/collect` → `apps/threads`が止まる）を`eslint-rules/web-module-boundaries.test.js`に1例足す。

## Phase 2：Foundational（すべてのUser Storyが頼るもの）

**⚠️ ここが終わるまで、US1〜US6は始めない。**

- [x] T008 [P] `shared/collect/names.test.ts`を先に書く：`nameKey`（NFKC・カタカナ→ひらがな・空白を除く・小文字。「ﾔﾏﾀﾞ　タロウ」と「やまだたろう」が同じ）、`cleanPastedLine`（`"1. 松本 れい 様 matsumoto@example.com"`→`"松本 れい"`、`"2. 井上 そら 様 090-1234-5678"`→`"井上 そら"`、`"3. 木村 ゆうき さん"`→`"木村 ゆうき"`、空の行→空）、`looksLikeNonName`（`"申込日 11/20"`・`"一般チケット 3,000円"`は真、`"松本 れい"`は偽）。research.md R9。
- [x] T009 `shared/collect/names.ts`に T008 の3つの関数を作る（jsdocつき）。
- [x] T010 [P] `shared/collect/media.ts`：媒体の値`minato`・`kokuchpro`・`tunagate`・`jimoty`・`peatix`・`youtrust`・`walk_in`・`other`と表示名（港・こくちーずプロ・つなげーと・ジモティー・Peatix・YOUTRUST・当日・その他）、021の媒体の名前との対応表（contracts/events.md 2）。テスト`shared/collect/media.test.ts`も書く。
- [x] T011 [P] `shared/collect/schemas.ts`：contracts/api.md の入力と出力の形（zod）。決まりはdata-model.mdのまま写す：イベントの`name`「必須・1〜100文字」、`venue`「100文字まで」、`capacity`「1〜10,000」、`methods`「`cash`・`paypay`・`transfer`の1つ以上」、料金の区分の`name`「1〜20文字」・`amount`「0〜999,999（円）」、名簿の`name`「1〜50文字」・`kana`「50文字まで」・`memo`「200文字まで」、手伝う人の`name`「1〜20文字」、`bankText`「300文字まで」、受付の`method`「`cash`・`paypay`・`transfer_today`・`transfer_later`・`none`」、`clientRequestId`はUUID。エラーのコード（contracts/api.md 0）も定数で書き出す。
- [x] T012 `collect/schema.ts`に、US1で使う表を作る（data-model.md 2-1・2-2・2-3・2-8）：`events`（`next_number`の初めは1、`version`の初めは0、`ends_at`は`starts_at`より後のcheck）、`price_tiers`（`event_id`は`ON DELETE CASCADE`）、`roster_people`（`(event_id, number)`一意、`(event_id, name_key)`索引、`media`はT010の値のcheck、`price_tier_id`は`ON DELETE NO ACTION`（`RESTRICT`にしない。イベントを消すときのCASCADEで止まるため。data-model.md 2-2）、`added_by_helper_id`はPR2で外部キーを足すので今は列だけ）、`owner_settings`（`paypay_qr`はbytea）。共通の表への外部キーは張らない（`owner_user_id`はuuidの値だけ）。
- [x] T013 マイグレーションを作る：`pnpm --filter api db:generate`でできたSQLを読み、スキーマ`collect`の作成とT012の表だけであることを確かめてコミットする（release-runbook.md 3。番号は`develop`の次）。`api-test/migration/`の今のテストが通ること。
- [x] T014 `api-test/integration/collect/access.test.ts`を先に書く：利用権のない人は`/api/collect/*`が403 `APP_NOT_AVAILABLE`、ログインしていない人は401、ほかの主催者のイベントは404（あるかを見せない）。
- [x] T015 `collect/access.ts`を作る（T014を通す）：共通の入口の関数で今の利用者と`collect`の利用権を確かめるHonoのミドルウェア`requireCollectOwner`と、イベントが主催者のものかを確かめる`loadOwnedEvent(db, ownerUserId, eventId)`。権限の判定はこのファイルに集める（Constitution原則V）。
- [x] T016 `collect/index.ts`から`collectRoutes`（`/api/collect`の下のHono）を書き出し、`api/app.ts`で登録する。`GET /api/collect/me`（contracts/api.md 1。`hasPaypayQr`・`hasBankText`・`awaitingTransferCount`。PR1では`awaitingTransferCount`は0）を作り、`api-test/repo/routes.snapshot.txt`を更新する。
- [x] T017 [P] `wcollect/lib/api.ts`（集金管理の呼び出し。`web/lib/api-client.ts`の共通の土台を使う）・`wcollect/lib/query-keys.ts`・`wcollect/lib/paths.ts`を作る。
- [x] T018 [P] `wcollect/sidebar/CollectShell.tsx`と`AppSidebar`の中身（contracts/ui-routes.md 1：イベント／開いているイベントの名簿・受付・受付の手伝い・締め／振込待ち／下にPayPay・振込先の設定）を作る。PR1では、名簿だけを開けるようにし、まだない画面の項目は出さない。Webのテスト`web-test/apps/collect/sidebar.test.tsx`。
- [x] T019 [P] `wcollect/routes.tsx`：利用権がない人（`/api/me`の`available`に`collect`がない）には外枠の「使えない」画面を出す。Webのテストを先に書く。

**Checkpoint**：集金管理の空の画面が、利用権のある人にだけ出る。

## Phase 3：User Story 1 - イベントを作り、名簿を手で速く入れる（Priority: P1）🎯 MVP

**Goal**：イベントを一から作り、名簿を続けて入れる・候補から選ぶ・まとめて貼るで速く入れる。

**Independent Test**：spec US1 の Independent Test（区分3つのイベント、Peatix 5人のうち1人は候補から、こくちーずプロ3人を貼る → 8人・番号1〜8・敬称などが除かれる）。quickstart.md 1。

### Tests for User Story 1 ⚠️

- [x] T020 [P] [US1] `api-test/integration/collect/events.test.ts`：イベントを作る（区分1つ以上・`methods`1つ以上、なければ400）、一覧が開催日時の近い順で`rosterCount`などを持つ、直す（区分を足す・並べる・名簿の人が使っている区分を消すと409 `TIER_IN_USE`）（contracts/api.md 2。消すとまとめはPR3）。
- [x] T021 [P] [US1] `api-test/integration/collect/roster.test.ts`：1人足す（受付番号が足した順・消した番号は使い回さない・`sameNameAs`が同じ名前のときだけ返る）、まとめて足す（APIでも`cleanPastedLine`を当てる・空の行を除く・番号が続く）、飛び入りではない名簿の直す・消す、2つの呼び出しで同時に足しても番号が重ならない（research.md R8）。
- [x] T022 [P] [US1] `api-test/integration/collect/past-attendees.test.ts`：主催者のほかのイベントの名簿から`name_key`ごとに最後のものを、`name_key`か`kana_key`の部分一致で最大5件、最後に来たイベント名と開催日時つきで返す。いまのイベントにいる人・ほかの主催者の名簿は出ない。`q`が空なら400（FR-027）。
- [x] T023 [P] [US1] `web-test/apps/collect/roster.test.tsx`：名前＋Enterで足して欄が空になる・媒体と区分を引き継ぐ・候補を選ぶと名前とふりがなが入る・まとめて貼ると確かめの一覧（`looksLikeNonName`の行は最初から外れている・行を直せる）が出てから足す・同じ名前の知らせ。

### Implementation for User Story 1

- [x] T024 [US1] `collect/events/event-service.ts`・`collect/events/event-routes.ts`：イベントと料金の区分の作る・読む・一覧・直す（contracts/api.md 2。消すはT070）。一覧の数（名簿の人数など）は data-model.md 4 のとおり毎回数える。
- [x] T025 [US1] `collect/roster/roster-service.ts`・`collect/roster/roster-routes.ts`：1人足す・まとめて足す・直す・消す。受付番号は`events.next_number`を同じトランザクションで`UPDATE … RETURNING`して取る（R8）。`name_key`・`kana_key`は`nameKey()`で入れる。名簿を変えたら`events.version`を1上げる（会場の共有はPR2でつなぐ）。
- [x] T026 [US1] `collect/roster/past-attendees.ts`と道筋`GET /api/collect/past-attendees`（R9）。
- [x] T027 [P] [US1] `collect/settings/settings-routes.ts`：`GET/PUT /api/collect/settings`（`bankText`「300文字まで」）と、`PUT/GET/DELETE /api/collect/settings/paypay-qr`（`image/png`・`image/jpeg`だけ・300KBを超えたら413 `IMAGE_TOO_LARGE`。R10）。テスト`api-test/integration/collect/settings.test.ts`を先に書く。
- [x] T028 [P] [US1] `wcollect/pages/EventsPage.tsx`（`/collect`：開催日の近い順・数・「受付を開く」など。モックの「イベント」）。
- [x] T029 [P] [US1] `wcollect/pages/EventNewPage.tsx`（`/collect/events/new`：一から作る。「Threadsのイベントから選ぶ」はPR4まで出さない）と`wcollect/pages/EventEditPage.tsx`（`/collect/events/:eventId/edit`：直す。消すはT072）。
- [x] T030 [US1] `wcollect/pages/RosterPage.tsx`と`wcollect/components/roster/`（続けて入れる欄・媒体のボタン・区分のボタン・候補・まとめて貼る（画面写真の文字の読み取りの案内つき）・確かめの一覧・名簿の表）。T023を通す。
- [x] T031 [P] [US1] `wcollect/pages/SettingsPage.tsx`（`/collect/settings`：QRの画像を画面で長い辺1,000px以内に縮めてから送る・振込先の案内）。

**Checkpoint（PR1を出せる）**：quickstart.md 1 が通る。テスト版で、運営者が開いた人がイベントと名簿を作れる。

---

# PR2：受付・会場の共有・受付の手伝い

**2026-11-13 PR2の進め方**：大きいので、**PR2a（共通の形・API・会場の共有・マイグレーション）**と**PR2b（画面とE2E）**に分けた。マイグレーションはPR2の表をまとめて1つ（`0035_collect_reception`。人物メモが0034を先に使った）。031（並行開発の決まり）に合わせ、集金管理のフォルダーの外の変更（Durable Objectの書き出し・`wrangler.toml`・`kernel/env.ts`・CORS・鍵の入れ替えの差し込み口`tokenKeys`）は、共通のPR（#116）に分けて先に入れた。エラーコードは`packages/shared/src/apps/collect/errors.ts`、地図は`docs/apps/collect.md`。次のように直した・決めた。
- ほかの人の記録を取り消したときのエラーは、`FORBIDDEN`ではなく`RECORD_NOT_YOURS`（403）。今の一覧に汎用の`FORBIDDEN`がなく、画面が文言を出し分けられるようにするため。
- `COLLECT_LIVE_SECRET`は必須にしない。入れていない間は、入場券の道筋だけが503 `CONFIG_ERROR`で、受付はできる（画面は15秒ごとの読み直しで動く）。設定の誤りで、すでにあるThreadsのAPIを止めないため。
- Durable Object`CollectLiveRoom`は、`cloudflare:workers`の`DurableObject`を継がない形（`ctx`を受け取るだけのclass）。APIの入口の一覧を書き出すスクリプトとそのテストがNodeで`app.ts`を読み、Nodeは`cloudflare:`のimportを読めないため。WebSocketの休止の仕組みはこの形でも使える。
- 飛び入りの送り直しを二重にしないため、`roster_people`に`client_request_id`（空でよい・一意）を足した。
- 名簿の変更（PR1の道筋）とイベントの変更も、会場の共有に知らせる（1人の追加・直しは`roster.changed`に人を付け、まとめて足す・消すは中身なしで読み直し、イベントを直したら`resync`）。
- 受付の記録ができたので、イベントの一覧の来場・振込待ちの数と、`/api/collect/me`の振込待ちの数を数える（PR1では0だった）。
- 受付用リンクのトークンは共通の鍵で暗号化するので、集金管理の入口の`tokenKeys`（`helpers/link-tokens.ts`）から鍵の入れ替えに足した（止めたリンクは出し直さないので入れ替えない）。
- 手伝う人の道筋（`/r/:token/…`）は`helpers/helper-routes.ts`に、主催者のリンク・受付をしている人の道筋と並べて置いた。
- 画面（PR2b）：手伝う人の呼び出しは`wcollect/lib/helper-api.ts`に分けた（共通の`request`は401をログインの切れとして扱い、ログインの画面へ移すため）。受付の画面の中身（`components/reception/`）は、主催者と手伝う人で同じものを使う。E2Eでは、利用の許可・イベント・名簿をDBに直接入れる。

## Phase 4：User Story 2 - 受付で、来た人と払い方と受け取った人を1タップで記録する（Priority: P1）

**Goal**：受付で1回押すと、来場・払い方・金額・受け取った人が残り、会場のほかの画面に5秒以内に出る。二重に記録しない。

**Independent Test**：spec US2 の Independent Test（主催者の2つの画面で、片方の記録が5秒以内にもう片方に出る。手伝う人はUS3で足す）。quickstart.md 2 の3・4・7・9。

### Tests for User Story 2 ⚠️

- [x] T032 [P] [US2] `api-test/integration/collect/reception.test.ts`：記録する（区分の金額・`priceTierId`で区分を変えると記録の区分と金額が変わり**名簿の区分は変わらない**（R17）・`amount`を直接入れると`amount_overridden`・`none`は0円・振込は`awaiting_transfer`）、受付の記録が使っている区分を消すと409 `TIER_IN_USE`、受付済みの人は409 `ALREADY_RECORDED`と先の記録、**同時に2つ送っても1件だけ**（`Promise.all`）、同じ`clientRequestId`の送り直しは201で同じ結果、取り消す、飛び入り（媒体`walk_in`・最初の区分）、スナップショットの`stats`（来場・現金・PayPay・振込待ち・`mine`）、変更のたびに`version`が1上がる。research.md R6。
- [x] T033 [P] [US2] `api-test/integration/collect/live.test.ts`：入場券の署名と期限（60秒を過ぎたら401・ほかのイベントの入場券では入れない）、記録・取り消し・飛び入りのあとに、そのイベントの`CollectLiveRoom`へ知らせ（`reception.recorded`・`reception.undone`・`roster.changed`、`version`つき）が送られる、WebSocketにつないだ2つの相手の両方に届く（vitestのWorkersの中でDurable Objectを動かす）。contracts/realtime.md。
- [x] T034 [P] [US2] `web-test/apps/collect/reception.test.tsx`：名前・ふりがな・受付番号の一部で絞る（ひらがなとカタカナ・全角と半角を区別しない）、払い方を押すと記録の呼び出し1回、PayPayはQRのシート→「受け取った」、振込は当日・後日を選ぶ、受付済みの行は払い方を出さない、保存できなかったら「保存できませんでした・もう一度送る」を出して受付済みに見せない（FR-037）、知らせで1行が変わる、`version`が飛んだらスナップショットを読み直す。

### Implementation for User Story 2

- [x] T035 [US2] `collect/schema.ts`に`reception_records`を足す（data-model.md 2-4：`roster_person_id`が主キー・`client_request_id`一意・`price_tier_id`（記録したときの区分。`ON DELETE NO ACTION`）・`method`と`receiver_kind`と`payment_status`のcheck・`receiver_helper_id`の外部キーはT046で足す）。マイグレーションを作り、SQLを読んでからコミットする。
- [x] T036 [US2] `collect/reception/reception-service.ts`：記録（区分と金額は記録に持ち、名簿の区分は変えない。R17。`INSERT … ON CONFLICT DO NOTHING RETURNING`、返らなければ先の記録で409。同じ`clientRequestId`は前の結果を返す）・取り消し・飛び入り・スナップショット・数字（data-model.md 4）。変更のたびに`events.version`を上げ、新しい`version`を返す。受け取った人は呼んだ人（PR2のこの段では主催者＝`owner`）。
- [x] T037 [US2] `collect/reception/reception-routes.ts`：contracts/api.md 4 の道筋（主催者）。`routes.snapshot.txt`を更新する。
- [x] T038 [US2] `collect/live/live-room.ts`：Durable Object`CollectLiveRoom`（WebSocketの休止の仕組み`ctx.acceptWebSocket`・`POST /broadcast`はWorkerの中からだけ・受付をする人の印を`serializeAttachment`で持つ・保存は使わない）。`api/index.ts`から書き出す。
- [x] T039 [US2] `apps/api/wrangler.toml`の一番上・`[env.staging]`・`[env.production]`のすべてに、Durable Objectの結びつけ`COLLECT_LIVE`（`class_name = "CollectLiveRoom"`）と`[[migrations]]`（`new_sqlite_classes = ["CollectLiveRoom"]`）を書く。`api-test/unit/wrangler-config.test.ts`に、3つの環境すべてにあることの確かめを足す。`api/kernel/env.ts`に`COLLECT_LIVE`と`COLLECT_LIVE_SECRET`の型、`apps/api/.dev.vars.example`と`api-test/env.ts`に`COLLECT_LIVE_SECRET`を足す。
- [x] T040 [US2] `collect/live/live-ticket.ts`（入場券の署名と確かめ。HMAC-SHA256・`COLLECT_LIVE_SECRET`・イベントの番号・受付をする人・60秒）・`collect/live/notify.ts`（保存のあと`ctx.waitUntil`で`CollectLiveRoom`に知らせる）・道筋`POST /api/collect/events/:eventId/live-ticket`と`GET /api/collect/live?ticket=`（R5）。T036の変更のあとに`notify`を呼ぶ。
- [x] T041 [US2] `wcollect/lib/live.ts`：入場券を取ってつなぐ・知らせで行を直す・`version`が飛んだら・つなぎ直したら・画面に戻ったらスナップショットを読み直す・切れたら1秒・2秒・4秒…最大30秒でつなぎ直す・つながらない間は15秒ごとに読み直す（contracts/realtime.md 4）。
- [x] T042 [US2] `wcollect/pages/ReceptionPage.tsx`と`wcollect/components/reception/`（上の数字の段（来場・現金・PayPay・振込待ち・あなたが受け取った現金）・会場で共有中の表示・検索・受付の行（区分の変更・金額を直接入れる）・払い方のボタン（高さ44px以上）・PayPayのシート（QRを大きく）・振込のシート（当日・後日・受付番号の案内）・飛び入り・保存できなかった行）。T034を通す。

**Checkpoint**：主催者が2台で受付し、片方の記録が5秒以内にもう片方に出る。

## Phase 5：User Story 3 - 受付を手伝ってもらう（Priority: P1）

**Goal**：主催者が受付用リンクを出し、手伝う人がログインなしで名前だけ入れて受付をする。

**Independent Test**：spec US3 の Independent Test（手伝う人は受付だけ・主催者の一覧に出る・止めると画面が止まる）。quickstart.md 2 の2・5・6・8。

### Tests for User Story 3 ⚠️

- [x] T043 [P] [US3] `api-test/integration/collect/helpers.test.ts`：リンクを出す（使えるリンクは1つ・トークンはハッシュと暗号文で持つ・同じリンクを返す・期限の既定は開催日の日本時間23:59:59と終わりの時刻の1時間後の遅い方。19:00〜翌1:00のイベントでは翌2:00）、参加する（端末の印を返す・同じ名前は409 `HELPER_NAME_TAKEN`・`sameAsHelperId`で同じ人に端末を足す・`asNew`で別の人）、端末の印なしは401 `DEVICE_REQUIRED`、手伝う人の記録は`receiver_kind = helper`、**ほかの人の記録の取り消しは403 `FORBIDDEN`**、手伝う人のスナップショットにメモが入らない、止めた・期限が過ぎたリンクは410 `LINK_INACTIVE`で記録は残る、止めると`link.stopped`が知らされる、出し直すと前のトークンは使えない、受付をしている人の一覧（件数・最後の記録・受け取った現金・端末の数。「同じ人」でまとめると2）。research.md R7。
- [x] T044 [P] [US3] `api-test/integration/collect/helper-routes-scope.test.ts`：手伝う人の資格（端末の印）で、名簿の編集・締め・振込・書き出し・設定・ほかのイベントの道筋が呼べないこと（`/api/collect/r/:token/…`以外は主催者のログインが要る）。FR-071。
- [x] T045 [P] [US3] `web-test/apps/collect/helper-reception.test.tsx`：名前を入れる画面 → 受付だけの画面（サイドバーなし）、同じ端末は保存した端末の印で続きから、409で「すでに〇〇さんがいます。同じ人ですか？」→ 同じ人／別の人、自分の記録だけ「取り消す」が出る、止められたら「このリンクは止められました」、ブラウザの保存が使えないときも名前を入れれば使える。

### Implementation for User Story 3

- [x] T046 [US3] `collect/schema.ts`に`reception_links`（data-model.md 2-5：`token_hash`一意・暗号文の列・使えるリンクはイベントに1つの部分一意索引）・`helpers`・`helper_devices`（2-6）を足し、`reception_records.receiver_helper_id`（`ON DELETE NO ACTION`。`RESTRICT`にしない）と`roster_people.added_by_helper_id`（`ON DELETE SET NULL`）の外部キーを張る。マイグレーションを作り、SQLを読んでからコミットする。
- [x] T047 [US3] `collect/helpers/link-service.ts`：リンクを出す・期限を変える・止める・出し直す（トークンは`newInviteToken("cr_")`の作り方、ハッシュは`sha256Hex`、暗号文はチームの招待と同じ`createTokenCipher`。共通の入口から使えないときは`kernel/crypto.ts`を直接使う）。止めたら`link.stopped`を知らせる。
- [x] T048 [US3] `collect/helpers/helper-service.ts`：参加（同じ名前の扱い・端末の印の発行とハッシュ・`last_seen_at`）と、端末の印の確かめ。`collect/access.ts`に`requireHelperDevice`（`:token`と`X-Collect-Device`を確かめ、リンクが使えないと410）を足す。
- [x] T049 [US3] `collect/reception/reception-service.ts`を、受け取った人に手伝う人を入れられるようにし、取り消しを「主催者はすべて・手伝う人は自分の記録だけ」にする（FR-039）。手伝う人のスナップショットはメモを除く（FR-002）。
- [x] T050 [US3] `collect/helpers/helper-routes.ts`：contracts/api.md 8 の道筋（`/api/collect/r/:token/…`。ログインの関所の外に登録）と、主催者の道筋 contracts/api.md 5（リンク・受付をしている人）。`routes.snapshot.txt`を更新する。手伝う人の出入りで`helpers.changed`を知らせる。
- [x] T051 [P] [US3] `wcollect/pages/HelpersPage.tsx`（`/collect/events/:eventId/helpers`：リンク・QR（`wcollect/components/QrCode.tsx`を、Webにすでにある`uqr`で集金管理の中に作る。新しい依存は足さない。Threadsの部品はアプリ同士で使えないので使わない。R18）・コピー・期限・止める・出し直す・受付をしている人の表（端末の数を含む））。
- [x] T052 [US3] `wcollect/pages/HelperReceptionPage.tsx`を`AppModule`の`publicRoutes`（`/collect/r/:token`）に足す：名前を入れる → 受付（T042の部品を使い、名簿の編集・締めの入口は出さない）。端末の印はリンクごとに`localStorage`へ（読めなければ持たない）。T045を通す。
- [x] T053 [US3] `e2e/tests/collect-reception.spec.ts`：主催者と手伝う人の2つのブラウザで、①手伝う人の記録が5秒以内に主催者の画面に出る ②同じ人を同時に押して1件 ③手伝う人に主催者の記録の「取り消す」が出ない ④リンクを止めると手伝う人の画面が止まる ⑤受付の1人が、探す→払い方→（PayPay・振込ならシートの1回）の3回の操作で終わる（SC-001の操作の数）⑥手伝う人がリンクを開いてから受付の画面までの操作が、名前の入力と「受付を始める」だけ（SC-007）（quickstart.md 2）。

**Checkpoint（PR2を出せる）**：quickstart.md 2 が通る。テスト版で、当日の受付を複数人でできる。

---

# PR3：締め・振込・まとめ・CSV・退会

**2026-11-13 PR3の進め方**：031の決まり（マイグレーションのあるPRは小さく切って先に入れる）に合わせ、**PR3a（共通の形・API・マイグレーション`0036_collect_closing`）**と**PR3b（画面）**に分けた。次のように決めた。
- 精算に`expected_at_settle`（精算したときの受け取った人の現金の合計）を足した。精算のあとでその人の記録が取り消されても「精算したあとで変わった」と出せるように（data-model.md 2-7 にない列）。
- 精算・PayPayの確かめ・締め・振込の確かめは、受付の画面の版を上げない（締めのあとの「変わった」にしない。振込の確かめは後日のことが多いため）。締めの画面と振込の数は毎回数えるので反映される。
- `processed_events`は作らず、PR1の`received_events`を使う（029の決まり）。退会では、まとめ（`event_summaries`）も消す。
- 書き出しは、表計算ソフトの式として読まれる頭の文字（`=`・`+`・`-`・`@`）の値に`'`を付ける。
- イベントを消したら、手伝う人の画面を止めるため`link.stopped`を知らせる。

## Phase 6：User Story 4 - 締めで、現金の精算・PayPay・振込が合っているかを確かめる（Priority: P1）

**Goal**：受け取った人ごとの現金を精算し、PayPay・振込・媒体ごと・来なかった人を見て締める。

**Independent Test**：spec US4 の Independent Test。quickstart.md 3。

### Tests for User Story 4 ⚠️

- [x] T054 [P] [US4] `api-test/integration/collect/closing.test.ts`：受け取った人ごとの現金（主催者と手伝う人に分かれる）、渡された額と差、精算した、PayPayの件数と合計と「履歴と合った」、振込の受け取った分と振込待ち、媒体ごと（名簿・来場・支払い済み・振込待ち）、来なかった人、締めると`unsettled`を返す（締めることは止めない）、締めたあとに記録を変えると`changedAfterClose`が真（`closed_version`と`version`の比較）、精算したあとにその人の現金の記録を取り消すと「精算したあとで変わった」。
- [x] T055 [P] [US4] `api-test/integration/collect/export.test.ts`：CSVがUTF-8（BOMつき）・CRLF・受付番号の順・列（受付番号・名前・ふりがな・媒体・料金の区分・来場・払い方・金額・受け取った人・記録した時刻（日本時間）・入金を確かめた日・メモ）、ファイル名が`集金_<開催日>_<イベント名>.csv`（RFC 5987）、手伝う人は呼べない。research.md R13。
- [ ] T056 [P] [US4] `web-test/apps/collect/closing.test.tsx`：人ごとの精算の行（額を入れると差が出る・精算した）、PayPay、振込、媒体ごと、来なかった人、精算していない人がいるときの知らせ、締めたあとに変わったときの知らせ。

### Implementation for User Story 4

- [x] T057 [US4] `collect/schema.ts`に`settlements`（data-model.md 2-7：`(event_id, receiver_key)`が主キー）を足す。マイグレーションを作り、SQLを読んでからコミットする。
- [x] T058 [US4] `collect/closing/closing-service.ts`・`collect/closing/closing-routes.ts`：contracts/api.md 6 の締めの道筋（スナップショット・精算・PayPayを確かめる・締める）。
- [x] T059 [US4] `collect/closing/export-csv.ts`と道筋`GET /api/collect/events/:eventId/export.csv`。`routes.snapshot.txt`を更新する。
- [ ] T060 [US4] `wcollect/pages/ClosingPage.tsx`と`wcollect/components/closing/`（モックの「締め」）。書き出しは、ログインのトークンつきで受け取ってからファイルにする。T056を通す。

## Phase 7：User Story 5 - 後日、振込を確かめ、未入金の人に連絡する（Priority: P2）

**Goal**：すべてのイベントの振込待ちを確かめ、連絡文をコピーする。

**Independent Test**：spec US5 の Independent Test。quickstart.md 4。

### Tests for User Story 5 ⚠️

- [x] T061 [P] [US5] `shared/collect/messages.test.ts`：`buildTransferMessage({ name, eventName, amount, number, kana, bankText })`が、名前・イベント名・金額・「振込の名義の前に受付番号『12』を付けてください（例：12ヤマダタロウ）」・振込先を含む。振込先がないときは「振込先は主催者にお問い合わせください」にする。
- [x] T062 [P] [US5] `api-test/integration/collect/transfers.test.ts`：すべてのイベントの振込待ち（受付番号・名前で探せる）、入金を確かめると支払い済み・確かめた日・締めの振込に反映、戻す、ほかの主催者の人は404、`GET /api/collect/me`の`awaitingTransferCount`。
- [ ] T063 [P] [US5] `web-test/apps/collect/transfers.test.tsx`：一覧・探す・確かめた・戻す・連絡文をコピー（コピーできないときは文を選ぶ）。

### Implementation for User Story 5

- [x] T064 [US5] `shared/collect/messages.ts`に`buildTransferMessage`を作る（T061を通す）。
- [x] T065 [US5] `collect/transfers/transfer-service.ts`・`collect/transfers/transfer-routes.ts`（contracts/api.md 7 の振込の道筋）。`GET /api/collect/me`の`awaitingTransferCount`を数える。`routes.snapshot.txt`を更新する。
- [ ] T066 [US5] `wcollect/pages/TransfersPage.tsx`（`/collect/transfers`。モックの「振込待ち」）とサイドバーの数。T063を通す。

## Phase 8：イベントを消す・まとめ・退会（US1のFR-011・FR-014と、Edge Cases）

- [x] T067 [P] `api-test/integration/collect/delete-and-summary.test.ts`：イベントを消すと、名簿・記録・リンク・手伝う人・精算が消え、`event_summaries`に数字だけが残る（**名前・手伝う人の名前が入らない**）、まとめの一覧と消す、消したイベントの人は前回の参加者に出ない。FR-011・FR-014。
- [x] T068 [P] `api-test/integration/collect/withdrawal.test.ts`：共通の退会の出来事を受け取ると、その人のイベント・まとめ・既定値（PR4のあとはThreadsの候補も）が消える。**同じ出来事を2回受け取っても同じ結果**。ほかの人のデータは消えない。contracts/events.md 1。
- [x] T069 `collect/schema.ts`に`event_summaries`（data-model.md 2-9）と、029に受け取りの手助けがなければ`processed_events`（2-11）を足す。マイグレーションを作り、SQLを読んでからコミットする。
- [x] T070 `collect/events/event-delete.ts`：同じトランザクションでまとめを書いてからイベントを消す（R11）。道筋`DELETE /api/collect/events/:eventId`・`GET/DELETE /api/collect/summaries…`。`routes.snapshot.txt`を更新する。
- [x] T071 `collect/inbox/withdrawal.ts`：029の出来事の受け取りに、退会の受け取りを登録する（`collect/index.ts`の登録の関数から。029の決めた形に合わせる）。
- [ ] T072 [P] `wcollect/pages/EventEditPage.tsx`に「イベントを消す」（確かめの画面：名簿と記録が消え、数字のまとめだけが残る）、`wcollect/pages/SummariesPage.tsx`（`/collect/summaries`）を足す。Webのテストも書く。

**Checkpoint（PR3を出せる）**：quickstart.md 3・4・5 が通る。

---

# PR4：Threadsのイベントの候補（029の出来事と、Threadsが出来事を出す変更のあと）

## Phase 9：User Story 6 - Threadsの宣伝内容から、イベントを選んで作る（Priority: P3）

**Goal**：Threadsの宣伝内容のイベントの情報を候補として受け取り、選んでイベントを作る。

**Independent Test**：spec US6 の Independent Test。quickstart.md 6。

**前提**：Threadsが contracts/events.md 2 の3つの出来事を出す変更が`develop`に入っていること（Threadsのフォルダーの作業。集金管理のPRには混ぜない）。

### Tests for User Story 6 ⚠️

- [ ] T073 [P] [US6] `api-test/integration/collect/threads-candidates.test.ts`：`saved`で候補ができる・上書き、`deleted`で消された印、`listing_status.changed`で掲載済みの媒体（021の名前→集金管理の値）、`occurredAt`の古い出来事は捨てる、2回届いても同じ結果、候補は`ownerUserId`の人にだけ返る、そこから作ったイベントに`source_changed_at`・`source_deleted_at`が付く（イベントの中身は変わらない）。research.md R15。
- [ ] T074 [P] [US6] `web-test/apps/collect/event-new-threads.test.tsx`：「Threadsのイベントから選ぶ」→ 候補 → 選ぶと名前・日時・会場・定員と区分の下書きが入る、保存するまでできない、候補がない・Threadsを使っていない人には出さないか理由を1行、名簿の媒体で掲載済みが先に並ぶ、「元が変わりました」の表示。

### Implementation for User Story 6

- [ ] T075 [US6] `collect/schema.ts`に`threads_event_candidates`（data-model.md 2-10）を足す。マイグレーションを作り、SQLを読んでからコミットする。
- [ ] T076 [US6] `collect/inbox/threads-candidates.ts`：3つの出来事の受け取り（contracts/events.md 2・3）を登録する。T071の退会の受け取りで候補も消す。
- [ ] T077 [US6] 道筋`GET /api/collect/threads-candidates`と、イベントを作るときの`sourceThreadsPromotionId`の保存。`GET /api/collect/events/:eventId`の`sourceChangedAt`・`sourceDeletedAt`。名簿の画面に返す`postedMedia`。`routes.snapshot.txt`を更新する。
- [ ] T078 [US6] `wcollect/pages/EventNewPage.tsx`に「Threadsのイベントから選ぶ」、`wcollect/components/roster/`の媒体のボタンに「掲載済み」を先に並べる、イベントの画面に「元が変わりました／消されました」。T074を通す。

**Checkpoint（PR4を出せる）**：quickstart.md 6 が通る。

---

## Phase 10：文書と仕上げ（各PRで、そのPRの分を直す）

- [ ] T079 [P] `docs/module-map.md`に集金管理（`apps/collect`の表・入口・道筋・Durable Object・Webのフォルダー）を足す（PR1で土台、PR2で受付・手伝い・Durable Object、PR3で締めなど）。
- [ ] T080 [P] `docs/product-structure.md`・`README.md`・`docs/architecture.md`に、2作目として集金管理を足し、Durable Objectと`COLLECT_LIVE_SECRET`を書く。`docs/external-services-setup.md`に、ステージングと本番で`wrangler secret put COLLECT_LIVE_SECRET --env …`を入れる手順を足す（PR2）。
- [ ] T081 [P] `docs/user-guide.md`に、集金管理の使い方（名簿・受付・手伝い・締め・振込）を足す（PR3）。
- [ ] T082 `specs/collect/001-event-day-collection/quickstart.md`の1〜6を、各PRのマージのあとにテスト版で手で確かめ、確かめた日と結果を`specs/collect/001-event-day-collection/checklists/manual-check.md`に残す。あわせて時間を測って同じファイルに書く：受付の1人（名簿50人で10秒以内。SC-001）、名簿30人を手で入れる（5分以内）・画面写真から貼る（1分以内。SC-002）、受付をした人が3人のときの締め（5分以内。SC-003）、手伝う人がリンクを開いてから受付を始めるまで（30秒以内。SC-007）。
- [ ] T083 [P] スマートフォン（390px幅）で、受付・手伝う人の受付・締めの画面が横にスクロールしないこと、押すところが44px以上であることを確かめる（spec Edge Cases）。
- [ ] T084 Durable Objectsの無料枠の使い方を、テスト版で1回のイベントのあとにCloudflareの画面で確かめ、research.md R4に実際の数を1行で足す。

---

## Dependencies & Execution Order

### 段の順番

- **Phase 0（PR0）**：029のあとに、集金管理より先に`develop`へ。
- **Phase 1〜2**：Phase 0のあと。Phase 2がすべてのUser Storyの前提。
- **US1（Phase 3）**：Phase 2のあと。ほかのStoryに頼らない（MVP）。
- **US2（Phase 4）**：US1（名簿）のあと。
- **US3（Phase 5）**：US2（受付・会場の共有）のあと。
- **US4（Phase 6）**：US2のあと（US3があると人ごとの精算を確かめられる。US3がなくても主催者1人分で動く）。
- **US5（Phase 7）**：US2のあと（振込の記録）。US4とは並行できる。
- **Phase 8**：US1のあと（いつでもよいが、PR3に入れる）。退会の受け取りは029の出来事に頼る。
- **US6（Phase 9）**：US1のあと、かつThreadsが出来事を出す変更のあと。
- **Phase 10**：各PRの終わりに、そのPRの分。

### User Storyの中

- テストを書いて失敗を確かめる → 表とマイグレーション → サービス → 道筋 → 画面。
- マイグレーションは段ごとに1つ。2つのセッションでぶつかったら parallel-development.md 6章。

### 並行できるもの

- Phase 2：T008・T010・T011（共通のパッケージ）と、T017・T018・T019（Web）は並行できる。
- 各Storyのテスト（[P]）は並行して書ける。
- US4とUS5は、US2のあとに並行できる。

## Parallel Example：User Story 1

```text
# テストを並行して書く
T020 api-test/integration/collect/events.test.ts
T021 api-test/integration/collect/roster.test.ts
T022 api-test/integration/collect/past-attendees.test.ts
T023 web-test/apps/collect/roster.test.tsx

# サービスのあと、画面を並行して作る
T028 wcollect/pages/EventsPage.tsx
T029 wcollect/pages/EventNewPage.tsx・EventEditPage.tsx
T031 wcollect/pages/SettingsPage.tsx
```

## Parallel Example：User Story 2・3

```text
T032 api-test/integration/collect/reception.test.ts
T033 api-test/integration/collect/live.test.ts
T034 web-test/apps/collect/reception.test.tsx
（US3に入ったら）
T043 api-test/integration/collect/helpers.test.ts
T044 api-test/integration/collect/helper-routes-scope.test.ts
T045 web-test/apps/collect/helper-reception.test.tsx
```

## Implementation Strategy

### MVP（PR1）

1. Phase 0（PR0）が入っていることを確かめる。
2. Phase 1〜2 → US1。
3. テスト版で、運営者が開いた人に、イベントと名簿を作ってもらう。名簿を入れる速さ（SC-002）を確かめる。

### 少しずつ出す

1. PR2（US2・US3）：当日の受付を複数人で。港のイベントで1回試す（SC-001・SC-005・SC-006・SC-007）。
2. PR3（US4・US5・まとめ・退会）：締めと振込まで。試した主催者に、次も使いたいかを聞く（SC-003・SC-008）。
3. PR4（US6）：Threadsとつなぐ。

### 気をつけること

- 共通（PR0）とThreadsの出来事の変更は、集金管理のPRに混ぜない（parallel-development.md 5章）。
- 029の形が決まるまで実装しない。T004でそろえてから始める。
