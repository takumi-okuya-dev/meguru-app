---

description: "Task list for people 001 people memo"
---

# Tasks：人物メモ（アンケートから人を覚え、次の会に誘う）

**Input**：[spec.md](./spec.md)、[plan.md](./plan.md)、[research.md](./research.md)、[data-model.md](./data-model.md)、[contracts/api.md](./contracts/api.md)、[contracts/events.md](./contracts/events.md)、[contracts/ui-routes.md](./contracts/ui-routes.md)、[quickstart.md](./quickstart.md)

**Tests**：このリポジトリの進め方（docs/ai-skills.md「作業の一覧を作る（テストを先に書く）」）に従い、各段のテストを実装の前に書いて、失敗を確かめてから作る。

**始める時期**：**030（アプリの利用の許可。`registerAppAccess`・`requireAppAccess`・`APP_NOT_AVAILABLE`）が`develop`に入ってから**。030は集金管理のセッションの持ち物で、人物メモでは作らない。029は`develop`に入った。始める前に T001 で、030で決まった名前に、この一覧の言葉を合わせる。plan.md の「まだ決めていないこと」1〜4は、とりあえずの決めで進める（答えが違えば、該当のタスクを直す）。

**Organization**：PRは4つ（research.md R23）。
- **PR1＝Phase 1〜5**（土台・イベント・取り込み・同じ人の候補・退会。US1と、US2の取り込みの中の部分）。マイグレーションあり → CIを流す。
- **PR2＝Phase 6〜8**（人の一覧・人のページ・手で足す・まとめる・分ける・人を消す。US4・US2の残り・US7）。マイグレーションなし → 手元の全テスト＋Codexのレビュー。
- **PR3＝Phase 9〜10**（誘う候補・声かけ・誘いの文・設定・リピーター・会の数字。US3・US5）。マイグレーションあり → CIを流す。
- **PR4＝Phase 11〜12**（仕事の相談先へのつなぎ・文書と仕上げ。US6）。マイグレーションなし。
- 文書（Phase 12の一部）は、各PRで、そのPRの分を直す。

## Format：`[ID] [P?] [Story] Description`

- **[P]**：別ファイルで、未完了のタスクに依存せず並行できる。
- **[Story]**：[US1]〜[US7]は spec.md の User Story に対応する。
- **パス**：`api/`は`apps/api/src/`、`api-test/`は`apps/api/test/`、`ptest/`は`apps/api/test/integration/people/`、`web/`は`apps/web/src/`、`wtest/`は`apps/web/test/apps/people/`、`shared/`は`packages/shared/src/`、`sp/`は`packages/shared/src/apps/people/`、`ppl/`は`apps/api/src/apps/people/`、`wppl/`は`apps/web/src/apps/people/`の略。
- **各タスクの終わり**：`pnpm typecheck`・`pnpm lint`が通ること。テストを足したタスクは、そのテストが通ること。
- **個人の情報**（research.md R18）：テストの名前は作った名前だけを使う。`logger`に名前・答え・メモを渡さない。ブラウザの保存（`localStorage`など）に行を書かない。

---

# PR1：土台・イベント・取り込み・同じ人の候補・退会

## Phase 1：Setup（始める前のそろえ）

- [x] T001 `develop`を取り込み（docs/parallel-development.md 5章）、030で入った`api/platform/index.ts`の書き出し（`registerAppAccess`・`requireAppAccess`）と`shared/errors.ts`の`APP_NOT_AVAILABLE`、`api-test/integration/app-access.test.ts`の仮のアプリの作り方を読み、名前や置き場所が違えば plan.md・research.md R3・contracts/api.md 0・この一覧の該当のタスクを直す。直したことを plan.md の頭に1行で書く。
- [x] T002 [P] `sp/index.ts`（空の入口）を作り、`packages/shared/package.json`の`exports`に`"./people": "./src/apps/people/index.ts"`を足す（根の`shared/index.ts`・`shared/apps/index.ts`からは書き出さない。research.md R1）。`apps/web`と`apps/api`の両方から`import {} from "@meguru/shared/people"`が型チェックと`wrangler deploy --dry-run`のバンドルで通ることを確かめる（通らなければ、各`tsconfig.json`の`moduleResolution`を確かめて直す）。
- [x] T003 [P] `ppl/index.ts`（入口）・`ppl/schema.ts`（`export const peopleSchema = pgSchema("people");`だけ）を作り、`api/db/schema.ts`に`export * from "../apps/people/schema";`を1行足す。ESLintの境界の規則（`eslint-rules/module-boundaries.js`）が`apps/people`に当たること（`platform/schema`・`apps/threads`を読むと止まる・`../../platform`の入口は読める）を、`eslint-rules/module-boundaries.test.js`に1例ずつ足して確かめる。
- [x] T004 [P] `wppl/index.ts`で`AppModule`（`id: "people"`・`basePath: "/people"`・アイコンはlucideの`Contact`・`startPath: "/people/import"`・`routes`は空の画面だけ）を出し、`web/app-registry.ts`の`allApps`に`peopleApp`を1行足す。Webの境界の規則（`apps/people` → `apps/threads`が止まる）を`eslint-rules/web-module-boundaries.test.js`に1例足す。
- [x] T005 `shared/apps/catalog.ts`の`APP_CATALOG`に`people`（`name: "めぐる 人物メモ"`・`basePath: "/people"`・`summary: "アンケートから会った人を覚え、次の会に誘う"`・`details`3行（取り込み・誘う候補・同意した人だけ）・`priceLabel: "テスト版（料金なし）"`・`released: true`）を足す。`web-test/app-registry.test.tsx`が`AppModule.basePath`と`APP_CATALOG`の`basePath`の一致を確かめていることを確かめる（なければ足す）。research.md R3。

## Phase 2：Foundational（すべてのUser Storyが頼るもの）

**⚠️ ここが終わるまで、US1〜US7は始めない。**

- [x] T006 [P] `sp/names.test.ts`を先に書く：`nameKey`（NFKC・見えない文字を除く・カタカナ→ひらがな・空白を除く・小文字。「ﾀﾛｳ　ﾔﾏﾀﾞ」と「たろうやまだ」が同じ、「たろう🌸」と「たろう🌻」は違う）、`looseKey`（`nameKey`のあと絵文字・記号・句読点を除く。「たろう🌸」と「たろう🌻」が同じ、2文字未満は`null`）、`questionKey`（NFKC・前後の空白を外す・続く空白（全角を含む）を1つの半角空白に。「あなたのLINE名を教えて下さい 」と「あなたのLINE名を教えて下さい」が同じ、「LINE名を教えてください」とは違う）。research.md R6・R9。
- [x] T007 `sp/names.ts`に T006 の3つの関数を作る（jsdocつき。`nameKey`は集金管理と同じ決め方であることを注記）。
- [x] T008 [P] `sp/csv.test.ts`を先に書く：`decodeCsvBytes`（UTF-8・先頭の印つきのUTF-8・Shift_JISで書いた見出し「タイムスタンプ」を読める、先頭が`PK\x03\x04`なら`{ ok: false, reason: "zip" }`、どれでも読めなければ`{ ok: false, reason: "unreadable" }`）、`parseCsv`（`"`で囲んだ値の中のカンマ・改行・`""`、CRLFとLF、空の行を捨てる、値の前後の空白を外す、足りない列は空・余る列は捨てる、1行目を見出し）、上限の確かめ`checkCsvLimits`（行は「500行まで（見出しを除く）」、列は「60列まで」、見出しは「1列500文字まで」、値は「1つ5,000文字まで」。超えたら理由のコード）。research.md R4。
- [x] T009 `sp/csv.ts`に T008 の関数と上限の定数（`CSV_MAX_BYTES = 1_000_000`・`CSV_MAX_ROWS = 500`・`CSV_MAX_COLUMNS = 60`・`CSV_MAX_HEADER = 500`・`CSV_MAX_CELL = 5000`）を作る。新しいnpmの依存は足さない。
- [x] T010 [P] `sp/answers.test.ts`を先に書く：`splitChoices`（`"交流会・勉強会の案内, 転職・求人情報"`と`"交流会・勉強会の案内、転職・求人情報"`と`"…，…"`が同じ2つに分かれる・空を捨てる・「その他」の自由記述は1つの値で残る）、`parseSubmittedAt`（`"2026/10/11 21:03:12"`と`"2026-10-11 21:03:12"`を日本時間として読む・読めなければ`null`）、`consentFromChoices(choices, mapping)`（`decline`が1つでもあれば`{ invite: false, work: false }`、`invite`・`work`の選択肢でそれぞれ真、空なら両方偽）。research.md R7・R8。
- [x] T011 `sp/answers.ts`に T010 の関数、`sp/presets.ts`に`QUESTION_PRESETS`（「タイムスタンプ」「Timestamp」→`submitted_at`、addendum.md の質問1→`line_name`・4→`next_attendance`・5→`bring_friends`・6→`wanted_connections`・7→`career_interests`・8→`contact_consent`、「お名前（フルネーム・任意）」→`real_name`。鍵は`questionKey`）と`CONSENT_CHOICE_PRESETS`（「交流会・勉強会の案内」→`invite`、「転職・求人情報」「副業・業務委託案件」→`work`、「個別の案内は希望しない」→`decline`）を作る。プリセットのテストも`sp/presets.test.ts`に書く。
- [x] T012 [P] `sp/consent.test.ts`を先に書く：`resolveConsent(facts)`が「日付のいちばん新しい事実」を返す（回答の事実の日付＝イベントの開催日、同じ日なら回答の時刻の新しい方。手直しの日付＝直した日。同じ日なら手直しを使う。事実がなければ`{ invite: false, work: false, source: "none" }`）。例：①10/11の回答（同意あり）→11/1に手直しでなし→11/25の回答（同意あり）なら「あり・response」、②11/25の回答のあとに10/11のCSVを取り込んでも11/25の回答のまま、③手直しが11/30なら11/25の回答より手直し。research.md R11。
- [x] T013 `sp/consent.ts`に`resolveConsent`を作る（T012を通す）。
- [x] T014 [P] `sp/schemas.ts`：contracts/api.md の入力と出力の形（zod）。決まりはdata-model.mdのまま写す：項目`field`「`line_name`・`real_name`・`submitted_at`・`next_attendance`・`bring_friends`・`wanted_connections`・`career_interests`・`contact_consent`・`other`のどれか」、同意の選択肢の目的「`invite`・`work`・`decline`・`ignore`のどれか」、イベントの`name`「必須・1〜100文字」・`heldOn`「`YYYY-MM-DD`」・`isOwn`「必須」、取り込みの`headers`「1〜60列・1列500文字まで」・`rows`「0〜500行・値は5,000文字まで」・`decisions`の`action`「`new`・`link`・`skip`」、人の`realName`「1〜100文字」・`lineName`「1〜100文字」（手で足すときは`realName`か`lineName`のどちらかは必須）・`memoAppearance`「300文字まで」・`memoTalk`「1,000文字まで」、`consent`「`{ invite: boolean, work: boolean }`」、`confirmName`「1〜100文字」、声かけの`purpose`「`invite`・`work`」・`targetName`「1〜100文字」・`stage`「`invite`：`asked`・`link_sent`・`attended`、`work`：`asked`・`approved`・`connected`」、設定の`inviteTemplate`「1〜500文字か`null`」・`repeaterGoal`「1〜10,000か`null`」。`sp/index.ts`から書き出す。
- [x] T015 `shared/errors.ts`の`ERROR_CODES`の終わりに、見出し「人物メモ（specs/people/001-people-memo contracts/api.md 0）」をつけて`IMPORT_TOO_LARGE`・`IMPORT_MAPPING_INVALID`・`IMPORT_DECISIONS_REQUIRED`・`PEOPLE_CONFIRM_REQUIRED`・`OUTREACH_NEEDS_APPROVAL`・`OUTREACH_NO_CONSENT`の6つを足し、同じファイルの画面の文言も足す（足すだけ。今のコードは変えない。plan.md まだ決めていないこと4・research.md R21）。`shared`の今のエラーの文言のテストが通ること。
- [x] T016 `ppl/schema.ts`に、PR1の表を作る（data-model.md 2-1〜2-10・2-13）：`events`（`name`「1〜100文字」のcheck・`held_on` date・`is_own`の初めは真・索引`(user_id, held_on)`）、`imports`（`event_id`は`ON DELETE CASCADE`・`row_count`「0〜500」のcheck）、`column_mappings`（PK`(user_id, question_key)`・`field`のcheck）、`choice_mappings`（PK`(user_id, choice_key)`・`purpose`のcheck）、`persons`（`real_name`・`line_name`・`entered_line_name`は「1〜100文字」、`memo_appearance`「300文字まで」、`memo_talk`「1,000文字まで」、`consent_source`「`none`・`response`・`manual`」のcheck・初めは`none`、「`real_name`か`line_name`のどちらかがある」のcheck、`created_by_import_id`は`ON DELETE SET NULL`、索引`(user_id, real_name_key)`・`(user_id, line_name_key)`）、`responses`（`event_id`・`import_id`・`person_id`は`ON DELETE CASCADE`、`(event_id, dedupe_hash)`一意、`line_name`「1〜100文字」、`next_attendance`・`bring_friends`「500文字まで」、配列3つの初めは空、`answers` jsonb、索引`(user_id, line_name_key)`・`person_id`・`import_id`）、`manual_attendances`（PK`(person_id, event_id)`・両方`ON DELETE CASCADE`）、`consent_changes`（`source`「`response`・`manual`」のcheck・`response_id`は`ON DELETE SET NULL`・索引`(person_id, changed_at)`）、`erased_attendances`（`event_id`・`import_id`は`ON DELETE CASCADE`）、`erased_responses`（PK`(event_id, dedupe_hash)`）、`received_events`（PK`event_id`）。**名前の列に一意の印を付けない**（R18）。共通の表への外部キーは張らない（`user_id`はuuidの値だけ）。共通の部品は`api/kernel/db/columns.ts`。
- [x] T017 マイグレーションを作る：`pnpm --filter api db:generate`でできたSQLを読み、スキーマ`people`の作成とT016の表だけであることを確かめてコミットする（release-runbook.md 3。番号は`develop`の次）。`api-test/helpers/app.ts`の`TRUNCATE`に人物メモの11の表を足し、`e2e/tests/helpers.ts`の`schemaname IN ('public', 'threads')`に`'people'`を足す。`api-test/migration/`の今のテストが通ること。
- [x] T018 `ptest/access.test.ts`を先に書く：人物メモの許可のない人は`/api/people/*`が403 `APP_NOT_AVAILABLE`、ログインしていない人は401、許可のある人の`GET /api/people/me`が`{ personCount: 0, eventCount: 0 }`、ほかの作り手のイベントは404 `ITEM_NOT_FOUND`（あるかを見せない）、運営者が許可を閉じてもデータは残り、開き直すと前のまま読める（FR-031）。
- [x] T019 T018を通す：`ppl/register.ts`の`registerPeople()`（`registerModule("people", …)`の中で`registerAppAccess("people", "granted")`）、`ppl/access.ts`（`loadOwnedEvent(db, userId, eventId)`・`loadOwnedPerson`・`loadOwnedImport`・`loadOwnedResponse`と、作り手のロック`lockOwner(tx, userId)`＝`pg_advisory_xact_lock(hashtextextended('people_owner:' || userId, 0))`。持ち主の判定はこのファイルに集める。Constitution原則V）、`ppl/routes.ts`（`/api/people`の下のHono。`authed`のあと`requireAppAccess("people")`）、`ppl/me/me-routes.ts`（`GET /api/people/me`）。`api/app.ts`で`registerThreads()`の隣に`registerPeople()`を呼び、`.route("/people", peopleApi)`でつなぐ。`api/index.ts`の定期処理と`api/jobs/daily-jobs.ts`でも`registerThreads()`の隣に`registerPeople()`を呼ぶ（research.md R19）。`pnpm --filter api routes:snapshot`で`api-test/repo/routes.snapshot.txt`を更新する。
- [x] T020 [P] `ppl/usage.ts`：`reportPeopleUsage(db, userId)`（イベントと人を数え、`reportUsage(db, userId, "people", { quantity: 0, using: events + persons > 0 })`。トランザクションの外で呼ぶ。research.md R3）。テスト`ptest/usage.test.ts`を先に書く（イベントを作ると`/api/me`の`apps.using`に`people`が入る・料金の数は変わらない）。
- [x] T021 [P] `wppl/lib/api.ts`（人物メモの呼び出し。`web/lib/api-client.ts`の共通の土台を使う）・`wppl/lib/query-keys.ts`・`wppl/lib/paths.ts`を作る。
- [x] T022 [P] `wppl/shell/PeopleShell.tsx`（`AppShell`に人物メモの`AppSidebar`を渡し、幅767px以下だけ中身の下に固定の下のバー：誘う候補・人・取り込み・イベントの4つ、押すところ44px以上、`env(safe-area-inset-bottom)`、中身の下に余白）と`wppl/shell/sidebar.tsx`（誘う候補・人・取り込み・イベント・下に「誘いの文と目標」。まだない画面の項目は出さない）。テスト`wtest/shell.test.tsx`を先に書く（767px以下で下のバーが出て今の画面が濃い・768px以上で出ない）。contracts/ui-routes.md 1・research.md R20。
- [x] T023 [P] `wppl/routes.tsx`：利用の許可がない人（`/api/me`の`available`に`people`がない、またはAPIが403 `APP_NOT_AVAILABLE`）には外枠の「使えない」画面を出す。`/people`はPR1では「まずアンケートを取り込みましょう」と取り込みへの案内だけの画面（`wppl/pages/HomePage.tsx`）。Webのテスト`wtest/routes.test.tsx`を先に書く。

**Checkpoint**：人物メモの空の画面が、許可のある人にだけ出る。

## Phase 3：User Story 1 - アンケートのCSVを取り込み、人の一覧を作る（Priority: P1）🎯 MVP

**Goal**：CSVを上げ、イベントを選ぶか作り、列の対応を選んで取り込むと、回答した人と、そのイベントに来た記録と答えが残る。

**Independent Test**：spec US1 の Independent Test（10/11の形のCSV 20行 → 20人・LINE名・次回参加・欲しいつながり・キャリアの興味・同意が残る）。quickstart.md 1。

### Tests for User Story 1 ⚠️

- [x] T024 [P] [US1] `ptest/events.test.ts`：イベントを作る（`name`「必須・1〜100文字」・`heldOn`・`isOwn`。違えば400 `VALIDATION_FAILED`）、一覧が開催日の新しい順で`attendeeCount`・`importCount`を持つ、直す、`GET /api/people/events/:eventId`の`stats`（PR1では`attendeeCount`・`erasedCount`）と`imports`、`GET …/attendees`（来た人の名前・`via`）、ほかの作り手のイベントは404。contracts/api.md 2。
- [x] T025 [P] [US1] `ptest/import-preview.test.ts`：列の対応が「送ったもの → 覚えたもの → 初めから用意した質問文 → null」の順で埋まり`source`が付く、LINE名の列がないと`mappingErrors`に`line_name_missing`、同じ項目に2列で`duplicate_field`（`other`は何列でもよい）、同意の列の知らない選択肢が`unknownConsentChoices`に出る、行の`status`（`new`・`already_imported`・`invalid`の`line_name_empty`・`line_name_too_long`）と`summary`の数（FR-006）、何も書かない（表の行数が変わらない）、上限（`rows`「500行まで」・`headers`「60列まで」・見出し「1列500文字まで」・値「1つ5,000文字まで」）を超えると400 `IMPORT_TOO_LARGE`、本文が3MBを超えると400。research.md R5・R6・R7・data-model.md 5。
- [x] T026 [P] [US1] `ptest/import-commit.test.ts`：取り込むと人・回答（`answers`に項目にあたらない列の答えも入る。FR-005）・取り込みの数が書かれる、列の対応と同意の選択肢の対応を覚え、次のプレビューで`source: "remembered"`になる、すべての列に項目がないと400 `IMPORT_MAPPING_INVALID`、知らない同意の選択肢が残ると409 `IMPORT_DECISIONS_REQUIRED`（`extra.consentChoices`）、回答ごとの同意（「個別の案内は希望しない」があれば両方偽）と人の同意（`consent_source = response`・`consent_changes`に1行）、同じCSVをもう一度書いても回答は増えない（`dedupe_hash`）、**同時に2つ送っても回答と人は1回分だけ**（`Promise.all`）、回答の時刻の列がないCSVでも二重にならない（全部の列のハッシュ）、`dedupe_hash`は64文字の16進で名前を含まない。research.md R8・R11。
- [x] T027 [P] [US1] `ptest/import-undo.test.ts`：取り消すと、その取り込みの回答と、その取り込みだけで作られた人が消える。ほかの取り込みの回答がある人は残り、今のLINE名・同意が決め直される。書き足しのある人（テストでは表に直接メモを入れる）がいるのに`keepPeopleWithNotes`を省くと409 `PEOPLE_CONFIRM_REQUIRED`（`extra.count`）、`true`で回答なしの人として残る、`false`で消える。`undo-preview`の数と一覧。イベントを消すと同じ扱いのあとでイベントが消える（`delete-preview`・409も同じ）。FR-008・FR-027・research.md R14。
- [x] T028 [P] [US1] `wtest/import.test.tsx`：ファイルを選ぶ → イベントを選ぶ（作るへも行ける）→ 列の対応（覚えた・初めから当てた印、LINE名がなければ「LINE名の列を選んでください」で進めない）→ 同意の知らない選択肢を選ぶ → 確かめ（新しく入る人・取り込めない行の理由ごとの数・もう取り込んだ行）→ 取り込む → 結果。ZIP・読めないファイル・1MBを超えるファイルの文言（research.md R4）。読んだ行を`localStorage`・`sessionStorage`に書かないこと。

### Implementation for User Story 1

- [x] T029 [US1] `ppl/events/event-service.ts`・`ppl/events/event-routes.ts`：イベントの作る・一覧・読む・直す（contracts/api.md 2）。数（参加者数＝来た人の数＋`erased_attendances`の行数、取り込みの数）は data-model.md 4 のとおり毎回数える。`GET …/attendees`。消す道筋は T034 のあとにつなぐ。作る・消すのあと`reportPeopleUsage`。
- [x] T030 [US1] `ppl/imports/mapping.ts`：列の対応の決め方（送ったもの → `column_mappings` → `QUESTION_PRESETS` → null。鍵は`questionKey`）と誤りの確かめ（`line_name_missing`・`duplicate_field`）、同意の選択肢の対応（送ったもの → `choice_mappings` → `CONSENT_CHOICE_PRESETS`）と知らない選択肢の一覧、覚える（`ON CONFLICT (user_id, question_key) DO UPDATE`）。
- [x] T031 [US1] `ppl/persons/person-derive.ts`：人の今のLINE名を決め直す（いちばん新しい回答のLINE名。なければ`entered_line_name`。research.md R10）と、同意を決め直す（回答の事実と`consent_changes`の`source = manual`のいちばん新しい行から`resolveConsent`。変わったら`persons`を直して`consent_changes`に1行。research.md R11）。取り込み・取り消し・まとめる・分けるから呼ぶ。
- [x] T032 [US1] `ppl/imports/classify.ts`：行を読む（項目ごとの値・`splitChoices`・`parseSubmittedAt`・`consentFromChoices`）と`dedupe_hash`（`sha256(event_id|回答の時刻の文字|nameKey(LINE名))`、時刻の列がなければ全部の列の値の`sha256`）、行の`status`（`invalid`・`already_imported`（`responses`にある）・`erased`（`erased_responses`にある）・`new`）と`summary`。候補と重なりは T041 で足す。
- [x] T033 [US1] `ppl/imports/commit.ts`・`ppl/imports/import-routes.ts`：`POST /api/people/imports/preview`と`POST /api/people/imports`（両方`bodyLimit`で3MB）。書く方は判定をやり直し、`withTransaction`の中で`lockOwner` → 取り込みの行 → 列と選択肢の対応を覚える → 人と回答をまとめて足す（`ON CONFLICT (event_id, dedupe_hash) DO NOTHING`）→ T031 で決め直す。トランザクションのあとで`reportPeopleUsage`。`logger`には行の数と取り込みの番号だけを渡す。`routes.snapshot.txt`を更新する。
- [x] T034 [US1] `ppl/imports/undo.ts`と道筋`GET /api/people/imports/:importId/undo-preview`・`DELETE /api/people/imports/:importId`（research.md R14）。イベントの`GET …/delete-preview`・`DELETE /api/people/events/:eventId`を、このファイルの取り消しを使ってつなぐ。`routes.snapshot.txt`を更新する。
- [x] T035 [P] [US1] `wppl/lib/read-csv-file.ts`：`File` → 1MBを超えたら読まない → `arrayBuffer` → `decodeCsvBytes` → `parseCsv` → `checkCsvLimits`。結果はメモリーにだけ返す。
- [x] T036 [US1] `wppl/pages/ImportPage.tsx`と`wppl/components/import/`（ファイルを選ぶ・イベントを選ぶ／作る・列の対応（1列1行・見本の値3つ・印）・同意の選択肢・確かめ・結果）。T028を通す。画面を離れたら行を捨てる。
- [x] T037 [P] [US1] `wppl/pages/EventsPage.tsx`（`/people/events`）・`wppl/pages/EventNewPage.tsx`（`/people/events/new`：名前・開催日・自分の会か）・`wppl/pages/EventPage.tsx`（`/people/events/:eventId`：参加者数・来た人の名前の一覧・取り込みの一覧と「取り消す」の確かめ（書き足しのある人の一覧と、残す・消すの選択）・直す・消す）。Webのテスト`wtest/events.test.tsx`も書く。

## Phase 4：User Story 2 - 同じ人をつなぐ（取り込みの中の部分）（Priority: P1）

**Goal**：取り込むとき、LINE名や本名が同じ人を「同じ人かも」と出し、作り手が「つなぐ」「別の人」を選ぶまでつながない。

**Independent Test**：spec US2 の Independent Test（11/25のCSVで5組の候補 → 4組つなぐ・1組別の人 → 4人は来たイベントが2つ）。quickstart.md 2。

### Tests for User Story 2 ⚠️

- [x] T038 [P] [US2] `ptest/import-candidates.test.ts`：候補になる条件（今のLINE名・前の回答のLINE名（別名）・`entered_line_name`の`nameKey`が同じ＝理由`line_name`、`looseKey`が同じ＝`line_name_loose`、本名の`nameKey`が同じ＝`real_name`）、1行に5人まで（来たイベントの新しい順）、候補の中身（`recentEvents`は新しい順に3つまで・`latestAnswers`）、**決めのない候補の行があると409 `IMPORT_DECISIONS_REQUIRED`で何も書かない**、`link`で回答が前の人のものになり今のLINE名が新しい回答のものに変わり前のLINE名が別名に残る、`new`で別の人になる、1つの取り込みで2つの行を同じ人に`link`すると400 `VALIDATION_FAILED`、ほかの作り手の人への`link`は404、1つのCSVの中で同じLINE名の行は`duplicate_in_file`の組になり全部に決めが要る（1つを残してほかを`skip`・全部`new`）、プレビューのあとで別の取り込みで同じLINE名の人が増えたら書く方が409、候補のない行は勝手に既存の人につながない（SC-004）。research.md R9・R10。
- [x] T039 [P] [US2] `wtest/import-candidates.test.tsx`：候補のカード（左に取り込む行、右に候補の人・理由・来たイベント・答え）、「つなぐ」「別の人」、候補が2人以上なら人ごとに「この人につなぐ」、同じCSVの中の重なりの選び方、全部選ぶまで「取り込む」が押せない、409が返ったらプレビューを読み直して決めていない組に戻る、390px幅で上下に積んで1組ずつ進む。

### Implementation for User Story 2

- [x] T040 [US2] `ppl/imports/candidates.ts`：作り手の人の名前の鍵（今のLINE名・`entered_line_name`・回答のLINE名・本名）を`user_id`の索引で1回読み、Workerの中で`nameKey`・`looseKey`で比べて候補（5人まで）と理由を作る。候補の人の`recentEvents`・`latestAnswers`をまとめて読む。
- [x] T041 [US2] `ppl/imports/classify.ts`に`candidate`・`duplicate_in_file`（同じ`nameKey(LINE名)`の組の`groupId`）を足し、`ppl/imports/commit.ts`で決めの確かめ（候補と重なりの行に決めがない → 409、同じ人に2つの`link` → 400）と`link`（回答を前の人に足し、T031 で今のLINE名・同意を決め直す）・`skip`を足す。T038を通す。
- [x] T042 [US2] `wppl/components/import/CandidateCards.tsx`・`wppl/components/import/DuplicateGroups.tsx`を作り、`ImportPage.tsx`の確かめの段に入れる。T039を通す。
- [x] T043 [US2] `e2e/tests/people-import.spec.ts`：作った名前の2つのCSV（10/11の形20行、11/25の形10行。`e2e/fixtures/people/`に置く）で、①1回目で20人 ②2回目で候補5組 → 4組つなぐ・1組別の人 ③イベントのページの参加者数（quickstart.md 1・2）。

## Phase 5：退会・個人の情報（PR1に入れる。spec FR-030・research.md R18・R19）

- [x] T044 [P] `ptest/withdrawal.test.ts`：`user.withdrawn`を受け取ると、その人のイベント・取り込み・回答・人・同意の記録・列の対応・同意の選択肢の対応・消した人の数と印が消える。**同じ出来事を2回受け取っても同じ結果**（`people.received_events`）。ほかの人のデータは消えない。contracts/events.md。
- [x] T045 `ppl/inbox/withdrawal.ts`：`onUserWithdrawn`（`withTransaction`の中で`received_events`に`ON CONFLICT DO NOTHING`で書き、書けたら`user_id`の行を消す。`logger`には出来事の番号と消した行の数だけ）。`ppl/register.ts`で`registerConsumer("people", "user.withdrawn", onUserWithdrawn)`。T044を通す。
- [x] T046 [P] `wppl/index.ts`の`AppModule`に`withdrawalPreview`（`defineWithdrawalPreview`。`GET /api/people/me`の`personCount`・`eventCount`で「人物メモ：人 n人・イベント n件が消えます」）を足す。Webのテスト`wtest/withdrawal-preview.test.tsx`。
- [x] T047 [P] `ptest/no-pii-logs.test.ts`：作った目立つ名前（例「ログニデナイ太郎」）で、プレビュー・取り込み（成功・409・400）・取り消し・イベントを消す・退会の受け取りを通し、その間の`console`の出力に名前・LINE名・答えの文字が1つも出ないこと（research.md R18）。

**Checkpoint（PR1を出せる）**：quickstart.md 1・2と6の3・6の4 が通る。テスト版で、運営者が開いた人が10/11と11/25のCSVを取り込み、同じ人をつなげる。

---

# PR2：人の一覧・人のページ・手で足す・まとめる・分ける・人を消す

## Phase 6：User Story 4 - 人のページで、その人を思い出す（Priority: P2）

**Goal**：名前・LINE名（別名も）・メモで探し、人のページで、来たイベント・答え・メモ・同意を1ページで読む。

**Independent Test**：spec US4 の Independent Test（2回来た人のページ・メモ「メガネ、Pythonの話」・別名で探せる）。quickstart.md 3の1〜3。

### Tests for User Story 4 ⚠️

- [ ] T048 [P] [US4] `ptest/persons-list.test.ts`：`q`で本名・今のLINE名・前の回答のLINE名・`entered_line_name`の一部（`nameKey`で比べる。ひらがなとカタカナ・全角と半角を区別しない）とメモの言葉で探せる、`%`・`_`を入れても全部に当たらない、絞り込み（来たイベント・次回参加の値・欲しいつながりの値（どれか1つを含む）・キャリアの興味・`lastMetFrom`・`lastMetTo`）は**いちばん新しい回答**の答えで比べる、並びは最後に会った日の新しい順（会っていない人は後ろ）、100人ずつ・`total`、同意に関わらず出る、ほかの作り手の人は出ない、`GET /api/people/facets`がいちばん新しい回答の値を多い順で返す。research.md R22。
- [ ] T049 [P] [US4] `ptest/person-detail.test.ts`：人のページの形（contracts/api.md 4。来たイベントは新しい順・イベントごとの回答と`answers`・別名・同意と記録）、`PATCH`（`realName`「1〜100文字か`null`」・`memoAppearance`「300文字まで」・`memoTalk`「1,000文字まで」。超えたら400）、本名を直すと`q`で新しい本名で探せる、`PUT …/consent`で`consent_source = manual`・`consent_changes`に1行（いつ・どう）、そのあと新しいイベントの回答を取り込むと回答の同意に変わる、前のイベントの回答では変わらない（research.md R11）。
- [ ] T050 [P] [US4] `wtest/persons.test.tsx`：一覧の探す欄・絞り込みのチップ（facetsの値）・行（名前・LINE名・最後に会った日）・人のページの各段・メモを書いて保存・同意を直す（記録が出る）・本名を直す。

### Implementation for User Story 4

- [ ] T051 [US4] `ppl/persons/person-query.ts`：来た記録（`responses` ∪ `manual_attendances`）・最後に会った日・自分の会の回数・いちばん新しい回答（`DISTINCT ON (person_id)`。並びは data-model.md 4）の問い合わせの部品を1か所に作る。人の一覧・誘う候補・数字で使い回す（research.md R22）。
- [ ] T052 [US4] `ppl/persons/person-list.ts`・`ppl/persons/person-routes.ts`：`GET /api/people/persons`と`GET /api/people/facets`。`routes.snapshot.txt`を更新する。
- [ ] T053 [US4] `ppl/persons/person-service.ts`：人のページ（`GET /api/people/persons/:personId`）・`PATCH`（`real_name_key`も直す）・`PUT …/consent`（手直しの事実として`consent_changes`に書き、T031 で決め直す）。`routes.snapshot.txt`を更新する。
- [ ] T054 [P] [US4] `wppl/pages/PeopleListPage.tsx`（`/people/list`）と`wppl/components/person/`（探す欄・絞り込み・人の行）。
- [ ] T055 [US4] `wppl/pages/PersonPage.tsx`（`/people/list/:personId`：本名（直す）・LINE名と別名・同意（直す・記録）・メモ2つ・来たイベント（新しい順・アンケートの答え））。T050を通す。
- [ ] T056 [US4] `wppl/pages/EventPage.tsx`の来た人の一覧から人のページへ行けるようにし、サイドバーと下のバーの「人」を出す。

## Phase 7：User Story 2 - 同じ人をつなぎ、手で人を足す（残りの部分）（Priority: P1）

**Goal**：人のページで2人をまとめ、間違ってつないだ回答を分け、アンケートのない会で会った人を手で足す。

**Independent Test**：spec US2 AS3〜AS5。quickstart.md 3の4〜6。

### Tests for User Story 2 ⚠️

- [ ] T057 [P] [US2] `ptest/person-manual.test.ts`：手で足す（`realName`か`lineName`のどちらかは必須・1〜100文字、同意は手直しの事実として`consent_source = manual`、`eventId`があれば会ったイベント）、会ったイベントを足す（もうあれば何もしない）・外す（回答による来た記録は外せない）、手で足した人が一覧に出て、来た記録・最後に会った日に入る、取り込みでLINE名が同じなら候補になる（`entered_line_name`）。FR-014。
- [ ] T058 [P] [US2] `ptest/person-merge-split.test.ts`：まとめる（回答・会ったイベント（重なりは1つ）・同意の記録が移る、本名は残す人のもの（なければ相手）、メモは「残す人 ／ 相手」でつなぐ（上限を超える分は相手の方を切る）、相手は消える、参加者数は変わらない、`erased_*`は増えない、今のLINE名・同意の決め直し、自分自身は400・ほかの作り手は404）、分ける（新しい人ができ回答とその来た記録が移る、メモ・手直しの同意は元の人に残る、回答が1つの人は400 `VALIDATION_FAILED`、両方の今のLINE名・同意の決め直し）。research.md R15。
- [ ] T059 [P] [US2] `wtest/person-merge.test.tsx`：人を足す画面、人のページの「この人と同じ人」（名前で探して選ぶ → 確かめ → まとまる）、回答ごとの「別の人に分ける」（確かめ → 新しい人のページへ）。

### Implementation for User Story 2

- [ ] T060 [US2] `ppl/persons/person-create.ts`：`POST /api/people/persons`と`POST/DELETE /api/people/persons/:personId/attendances…`。足すのあと`reportPeopleUsage`。`routes.snapshot.txt`を更新する。
- [ ] T061 [US2] `ppl/persons/person-merge.ts`：`POST /api/people/persons/:personId/merge`（`withTransaction`・`lockOwner`・research.md R15のとおり。声かけの移し替えはPR3の T079 で足す）。
- [ ] T062 [US2] `ppl/persons/person-split.ts`：`POST /api/people/responses/:responseId/split`（`withTransaction`・`lockOwner`）。`routes.snapshot.txt`を更新する。
- [ ] T063 [P] [US2] `wppl/pages/PersonNewPage.tsx`（`/people/list/new`：本名・LINE名・会ったイベント・同意2つ）。
- [ ] T064 [US2] `wppl/pages/PersonPage.tsx`に「この人と同じ人」のダイアログと、回答ごとの「別の人に分ける」を足す。T059を通す。

## Phase 8：User Story 7 - 参加者の求めで、その人の記録を消す（Priority: P3）

**Goal**：人のページから名前を入れて確かめて消すと、回答・メモ・声かけ・別名がすべて消え、会ごとの参加者数だけが残る。

**Independent Test**：spec US7 の Independent Test。quickstart.md 3の8〜9。

### Tests for User Story 7 ⚠️

- [ ] T065 [P] [US7] `ptest/person-delete.test.ts`：`confirmName`が表示名と`nameKey`で違えば400 `CONFIRMATION_MISMATCH`、合えば204で、その人の回答・会ったイベント・同意の記録が消え、人の一覧・`q`・facets・人のページ（404）に出ない、来たイベントの参加者数は変わらない（`erased_attendances`）、その会の取り込みを取り消すと消した人の分も数から抜ける、同じCSVをもう一度プレビューすると、その人の行は`erased`になり取り込まれない、別のイベントの回答（新しいハッシュ）は新しい人として入る（US7 AS3）、`erased_attendances`・`erased_responses`に名前・答えが入っていない。research.md R13・SC-006。
- [ ] T066 [P] [US7] `wtest/person-delete.test.tsx`：確かめの画面（消えるもの・残るもの・「元に戻せません」）、名前を入れるまで「消す」が押せない、消したら一覧へ戻る。

### Implementation for User Story 7

- [ ] T067 [US7] `ppl/persons/person-delete.ts`と道筋`DELETE /api/people/persons/:personId`（`withTransaction`・`lockOwner` → イベントごとに`erased_attendances`（同じイベントに回答が2つあれば古い取り込み、手で足した会ったイベントなら取り込みの番号は空）→ 回答の`dedupe_hash`を`erased_responses`へ（`ON CONFLICT DO NOTHING`）→ 人を消す）。消すのあと`reportPeopleUsage`。`logger`に名前を渡さない。`routes.snapshot.txt`を更新する。
- [ ] T068 [US7] `wppl/pages/PersonPage.tsx`に「この人を消す」と確かめの画面を足し、`wppl/pages/EventPage.tsx`に「消した人 n人」を出す。T066を通す。

**Checkpoint（PR2を出せる）**：quickstart.md 3 が通る。テスト版で、人を探して思い出す道具として使える。

---

# PR3：誘う候補・声かけ・誘いの文・リピーター・会の数字

## Phase 9：User Story 3 - 次の会の誘う候補を見て、声をかけ、記録する（Priority: P1）

**Goal**：交流会への誘いの候補（同意した人だけ）を絞って並べ、誘いの文をコピーし、進み具合を残す。

**Independent Test**：spec US3 の Independent Test。quickstart.md 4の1〜5・7。

### Tests for User Story 3 ⚠️

- [ ] T069 [P] [US3] `sp/invite.test.ts`：`buildInviteMessage(template, { name, eventName, heldOn })`が`{名前}`・`{会の名前}`・`{日にち}`を差し込む（`{日にち}`は「12月13日（土）」の形・日本時間）、`DEFAULT_INVITE_TEMPLATE`が「{名前}さん、{日にち}の{会の名前}、もしご興味あれば一緒にいかがですか？」、型に差し込みがなくても型のまま返す。research.md R17。
- [ ] T070 [P] [US3] `ptest/candidates.test.ts`：`purpose=invite`は交流会への誘いの同意が真の人だけ、**「個別の案内は希望しない」と答えた人・同意の列がなかった人は、どの絞り込みの組み合わせでも出ない**（すべての絞り込みを順に当てて確かめる。SC-003）、手で同意した人は出る、`visitedOwn=true`で自分の会に1回以上来た人だけ（参加者として出た会だけの人は出ない）、ほかの絞り込みと並び（最後に会った日の新しい順）、`eventId`の会への声かけ（`outreach`）が行に入る、`purpose`がないと400。FR-018・FR-019。
- [ ] T071 [P] [US3] `ptest/outreach-invite.test.ts`：声かけを始める（同意がなければ409 `OUTREACH_NO_CONSENT`、同じ人・同じ誘う会なら200で今のもの・新しければ201で`asked`）、`stage`を`link_sent`・`attended`へ進める・1つ戻すと先の日時が空になる、誘った会の回答を取り込んで同じ人につなぐ・まとめる・会ったイベントを足すと自動で`attended`（FR-022）、誘う会を消すと声かけも消える、人を消すと声かけも消える、まとめるとき同じ声かけが両方にあれば進み具合の先の方が残る。research.md R15・R16。
- [ ] T072 [P] [US3] `ptest/settings.test.ts`：`GET/PUT /api/people/settings`（`inviteTemplate`「1〜500文字か`null`」・`repeaterGoal`「1〜10,000か`null`」。超えたら400）、`GET /api/people/stats`の`nextOwnEvent`（今日以降でいちばん近い自分の会。なければ`null`）。
- [ ] T073 [P] [US3] `wtest/candidates.test.tsx`：誘う会の初めの値、絞り込み、「文をコピー」で`navigator.clipboard.writeText`に名前・会の名前・日にちの入った文（使えないときは文を選んだ欄）、コピーのあと「興味を聞いたにする」で声かけを始める、進み具合のボタン、誘う会がないときは「誘う会を選んでください」、上に「個別の案内に同意した人だけを出しています」。

### Implementation for User Story 3

- [ ] T074 [US3] `sp/invite.ts`に`buildInviteMessage`・`DEFAULT_INVITE_TEMPLATE`を作る（T069を通す）。
- [ ] T075 [US3] `ppl/schema.ts`に`outreaches`（data-model.md 2-11：`purpose`「`invite`・`work`」のcheck、`invite`なら`event_id`必須・`target_name`は空、`work`なら`event_id`は空・`target_name`「1〜100文字」必須のcheck、`stage`の値のcheck（`invite`：`asked`・`link_sent`・`attended`、`work`：`asked`・`approved`・`connected`）、「`stage = connected`なら`approved_at`がある」のcheck、部分一意索引`(person_id, event_id) WHERE purpose = 'invite'`・`(person_id, target_key) WHERE purpose = 'work'`、`person_id`・`event_id`は`ON DELETE CASCADE`）と`owner_settings`（2-12：`invite_template`「1〜500文字」・`repeater_goal`「1〜10,000」のcheck）を足す。マイグレーションを作り、SQLを読んでからコミットする。`api-test/helpers/app.ts`の`TRUNCATE`に2つの表を足す。
- [ ] T076 [US3] `ppl/outreach/candidate-service.ts`・`ppl/outreach/candidate-routes.ts`：`GET /api/people/candidates`（T051 の部品を使い、目的の同意を問い合わせの条件に入れる。画面では絞らない）。`routes.snapshot.txt`を更新する。
- [ ] T077 [US3] `ppl/outreach/outreach-service.ts`・`ppl/outreach/outreach-routes.ts`：`POST /api/people/outreaches`（同意の確かめ・同じ声かけは今のものを返す）・`PATCH`（同じ目的の進み具合・戻したら先の日時を空に）・`DELETE`（`invite`の分。`work`は T089）。`markInviteAttended(tx, personId, eventId)`を書き出す。`routes.snapshot.txt`を更新する。
- [ ] T078 [US3] `ppl/settings/settings-service.ts`・`ppl/settings/settings-routes.ts`：`GET/PUT /api/people/settings`・`GET /api/people/stats`（`nextOwnEvent`。リピーターは T085）。`routes.snapshot.txt`を更新する。
- [ ] T079 [US3] 自動で「来た」をつなぐ：`ppl/imports/commit.ts`（新しい人・つないだ人）・`ppl/persons/person-merge.ts`（あわせて声かけの移し替え：同じ声かけが両方にあれば進み具合の先の方を残す）・`ppl/persons/person-create.ts`（会ったイベントを足す）のトランザクションの最後で`markInviteAttended`を呼ぶ。T071を通す。
- [ ] T080 [US3] `wppl/pages/CandidatesPage.tsx`（`/people`。PR1の`HomePage.tsx`を置き換える）と`wppl/components/candidates/`（誘う会の選択・絞り込み・人の行・文をコピー・興味を聞いたにする・進み具合）。文は`buildInviteMessage`で作る（APIを呼ばない）。T073を通す。
- [ ] T081 [P] [US3] `wppl/pages/SettingsPage.tsx`（`/people/settings`：誘いの文の型（差し込みの説明・見本・初めの型に戻す）・リピーターの目標）と、サイドバーの「誘いの文と目標」。
- [ ] T082 [US3] `wppl/pages/PersonPage.tsx`に声かけの記録（誘う会ごとの進み具合と日時）を足す。
- [ ] T083 [US3] `e2e/tests/people-invite.spec.ts`：①10/11・11/25を取り込んだ状態で誘う候補を開き、「前に来た」「次回参加」で絞る ②「個別の案内は希望しない」の人が出ない ③文をコピー → 興味を聞いたにする ④**390px幅で、下のバーの「誘う候補」→「文をコピー」の3回のタップ以内で文がコピーされる**（SC-005）（quickstart.md 4）。

## Phase 10：User Story 5 - リピーターの目標と今の数を比べる（Priority: P2）

**Goal**：自分の会に2回以上来た人の数を目標と並べ、自分の会ごとに初めて・前にも来た人の数を出す。

**Independent Test**：spec US5 の Independent Test（「リピーター 4人／目標 10人」・11/25に「初めて 6人・前にも来た 4人」）。quickstart.md 4の2・6。

### Tests for User Story 5 ⚠️

- [ ] T084 [P] [US5] `ptest/stats.test.ts`：リピーター＝自分の会の来た記録が2つ以上の人（参加者として出た会は数えない・手で足した会ったイベントも数える・同じ会に回答が2つでも1回）、`GET /api/people/stats`の`repeaterCount`・`repeaterGoal`、自分の会の`stats`の`firstTimeCount`・`returningCount`（その会より前の開催日の自分の会に来ていない／来た。同じ日は前に数えない）・`erasedCount`は別に出る、`attendees`の`firstTime`、イベントの開催日・自分の会かを直すと数が変わる。research.md R12。
- [ ] T085 [US5] `ppl/settings/settings-service.ts`の`stats`に`repeaterCount`、`ppl/events/event-service.ts`の自分の会の`stats`に`firstTimeCount`・`returningCount`と`attendees`の`firstTime`を足す（T051 の部品で数える）。T084を通す。
- [ ] T086 [P] [US5] `wtest/repeater.test.tsx`を先に書いてから、`wppl/pages/CandidatesPage.tsx`の上の段（「リピーター n人／目標 n人」、目標がなければ「目標を決める」）と`wppl/pages/EventPage.tsx`の数字（参加者・初めて・前にも来た・消した人）を作る。

**Checkpoint（PR3を出せる）**：quickstart.md 4 が通る。テスト版で、12月の会の誘いに使える。

---

# PR4：仕事の相談先へのつなぎ・仕上げ

## Phase 11：User Story 6 - 仕事の相談先へつなぐ記録を残す（Priority: P2）

**Goal**：「転職・求人情報」か「副業・業務委託案件」に同意した人だけを並べ、「本人に聞いた → OKをもらった → つないだ」を記録する。

**Independent Test**：spec US6 の Independent Test。quickstart.md 5。

### Tests for User Story 6 ⚠️

- [ ] T087 [P] [US6] `ptest/outreach-work.test.ts`：`purpose=work`の候補は仕事のつなぎの同意が真の人だけ（「個別の案内は希望しない」の人は出ない）、声かけを始める（`targetName`「1〜100文字」・同意がなければ409 `OUTREACH_NO_CONSENT`・同じ人で`nameKey`が同じ相談先なら200で今のもの・`asked`から）、**`approved`の前に`connected`にすると409 `OUTREACH_NEEDS_APPROVAL`**（表のcheckでも止まる）、`approved` → `connected`で日時が残る、人のページの`outreaches`に相談先・日時が出る、誘う候補の行の`outreach`は最新の声かけ。FR-023・research.md R16。
- [ ] T088 [P] [US6] `wtest/candidates-work.test.tsx`：目的の切り替え（`?purpose=work`）、「声かけを始める」（相談先の名前を入れる）、「OKをもらった」の前に「つないだ」が出ない、人のページの記録（いつ・どの相談先へ・「あなたが記録」）。

### Implementation for User Story 6

- [ ] T089 [US6] `ppl/outreach/outreach-service.ts`に`work`（`target_key`＝`nameKey(targetName)`・`approved_at`がなければ`connected`は409・戻すと先の日時を空に）と、`ppl/outreach/candidate-service.ts`に`purpose=work`の最新の声かけを足す。T087を通す。
- [ ] T090 [US6] `wppl/pages/CandidatesPage.tsx`の目的の切り替えと`wppl/components/candidates/`の「声かけを始める」・進み具合のボタン、`wppl/pages/PersonPage.tsx`の仕事のつなぎの記録。T088を通す。

## Phase 12：文書と仕上げ（各PRで、そのPRの分を直す）

- [ ] T091 [P] `docs/module-map.md`に人物メモを足す（2章に`apps/people`の表・入口・道筋の表、2-5の組み立てに`registerPeople()`、7-3にWebの`apps/people/`）。PR1で土台と取り込み、PR2で人、PR3で声かけ・設定。
- [ ] T092 [P] `docs/app-separation.md`の例（`people`）を、実際に作った形（`requireAppAccess`・`registerConsumer`・`people.received_events`・作り手のロック）に合わせて直す（7章「2作目を作って具体的になったら直す」。PR1）。
- [ ] T093 [P] `docs/product-structure.md`・`README.md`・`docs/architecture.md`に、めぐるのアプリとして人物メモを足す。`docs/ui-design.md`「5. 画面幅ごとの振る舞い」に、人物メモの下のバー（767px以下・4つ・アプリの切り替えは上部バーの左）を1行足す（research.md R20。PR1）。
- [ ] T094 [P] `docs/user-guide.md`に、人物メモの使い方（取り込み・同じ人・人のページ・誘う候補・声かけ・消す）を足す（PR3・PR4）。
- [ ] T095 `specs/people/001-people-memo/quickstart.md`の1〜6を、各PRのマージのあとにテスト版で手で確かめ、確かめた日と結果を`specs/people/001-people-memo/checklists/manual-check.md`に残す。あわせて時間を測って同じファイルに書く：20行のCSVの初めての取り込み（5分以内）と2回目（2分以内。SC-001）、2回分を取り込んだあと12月の会の候補を出すまで（1分以内。SC-002）、同じ人の候補1組を見分けて選ぶ（10秒以内。SC-004）、スマートフォンで誘う候補から文のコピーまで（3回のタップ以内。SC-005）。作り手が実際の会で使い、SC-007の3つを満たしたかを同じファイルに書く。
- [ ] T096 [P] スマートフォン（390px幅）で、取り込み（列の対応・候補のカード）・人の一覧・人のページ・誘う候補が横にスクロールしないこと、押すところが44px以上であること、下のバーで中身の最後が隠れないことを確かめる（spec Edge Cases「スマートフォンでの取り込み」）。

---

## Dependencies & Execution Order

### 段の順番

- **前提**：030が`develop`に入っていること（029は入った）。
- **Phase 1〜2**：前提のあと。Phase 2がすべてのUser Storyの前提。
- **US1（Phase 3）**：Phase 2のあと。ほかのStoryに頼らない（MVP）。
- **US2の取り込みの中（Phase 4）**：US1（取り込みの判定と書く）のあと。PR1に入れる。
- **Phase 5（退会・個人の情報）**：Phase 2のあと（いつでもよいが、PR1に入れる。PR1から個人の情報を持つため）。
- **US4（Phase 6）**：US1のあと。
- **US2の残り（Phase 7）**：US4（人のページ）のあと。
- **US7（Phase 8）**：US4のあと。US2の残りとは並行できる。
- **US3（Phase 9）**：US4のあと（T051 の問い合わせの部品）。声かけの自動の「来た」は、まとめる（Phase 7）・取り込み（Phase 3〜4）のあと。
- **US5（Phase 10）**：US3のあと（ホームの上の段）。数の部分（T084・T085）は US4のあとならいつでも。
- **US6（Phase 11）**：US3（声かけの仕組み）のあと。
- **Phase 12**：各PRの終わりに、そのPRの分。

### User Storyの中

- テストを書いて失敗を確かめる → 表とマイグレーション → サービス → 道筋 → 画面。
- マイグレーションはPR1とPR3の2つだけ。集金管理と同時に作って番号がぶつかったら parallel-development.md 6章。

### 並行できるもの

- Phase 1：T002・T003・T004は並行できる（T005は T004 のあと）。
- Phase 2：共通のパッケージのテストと関数（T006〜T014）はファイルごとに並行できる。T021・T022・T023（Web）は T019 と並行できる。
- 各Storyのテスト（[P]）は並行して書ける。
- PR2：US7（Phase 8）と US2の残り（Phase 7）は、US4のあとに並行できる。

## Parallel Example：Phase 2（共通のパッケージ）

```text
T006 sp/names.test.ts
T008 sp/csv.test.ts
T010 sp/answers.test.ts
T012 sp/consent.test.ts
T014 sp/schemas.ts
```

## Parallel Example：User Story 1

```text
# テストを並行して書く
T024 ptest/events.test.ts
T025 ptest/import-preview.test.ts
T026 ptest/import-commit.test.ts
T027 ptest/import-undo.test.ts
T028 wtest/import.test.tsx

# サービスのあと、画面を並行して作る
T035 wppl/lib/read-csv-file.ts
T037 wppl/pages/EventsPage.tsx・EventNewPage.tsx・EventPage.tsx
```

## Parallel Example：User Story 3

```text
T069 sp/invite.test.ts
T070 ptest/candidates.test.ts
T071 ptest/outreach-invite.test.ts
T072 ptest/settings.test.ts
T073 wtest/candidates.test.tsx
```

## Implementation Strategy

### MVP（PR1）

1. 030が入っていることを確かめる（T001）。
2. Phase 1〜2 → US1 → US2の取り込みの中 → 退会。
3. テスト版で、運営者が自分に人物メモを開き、10/11と11/25のCSVを取り込む。取り込みの速さ（SC-001）と、同じ人の候補の見分けやすさ（SC-004）を確かめる。

### 少しずつ出す

1. PR2（US4・US2の残り・US7）：人を探して思い出す。会場で「お久しぶりです」と言われたときに使ってみる。
2. PR3（US3・US5）：12月の会の誘いに使う（SC-002・SC-003・SC-005）。リピーターの目標を決める。
3. PR4（US6）：仕事の相談先へのつなぎ。広げる前に、同意の残し方を専門家に確かめる（plan.md まだ決めていないこと5）。

### 気をつけること

- 030（共通）は人物メモのPRに混ぜない（parallel-development.md 5章）。人物メモのPRで共通に足すのは、組み立ての1行（`app.ts`・`index.ts`・`jobs/daily-jobs.ts`・`db/schema.ts`・`app-registry.ts`）・`APP_CATALOG`の1行・`packages/shared/package.json`の`exports`の1行・`ERROR_CODES`の6つだけ。
- 誘う候補の同意の絞り込みは、APIの問い合わせの条件に入れる（画面で絞らない）。どの絞り込みの組み合わせでも同意のない人が出ないことを、テストで確かめる（SC-003）。
- 名前・答えをログ・ブラウザの保存・一意の印に入れない（research.md R18）。
