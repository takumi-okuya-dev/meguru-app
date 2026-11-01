---

description: "Task list for feature 017 referral links"
---

# Tasks:紹介リンク

**Input**: [spec.md](./spec.md)、[plan.md](./plan.md)、[research.md](./research.md)、[data-model.md](./data-model.md)、[contracts/api.md](./contracts/api.md)、[contracts/ui-routes.md](./contracts/ui-routes.md)、[quickstart.md](./quickstart.md)

**Tests**: 001〜016と同じく、テストを先に書いて失敗を確かめてから実装する（TDD）。特に次を自動テストで確かめる。SC-002（同じブラウザで30日以内に登録した人は記録される）、SC-003（すでにいる人・自分のリンク・30日を過ぎた人は記録されない）、SC-004（紹介した人に、誰が登録したかを返さない）、SC-005（テスト環境で紹介リンクだけでは入れない）、SC-006（紹介で料金・使える状態が変わらない）。

**Organization**: User Storyごとに分ける。MVPはUS1（P1）。

## Format: `[ID] [P?] [Story] Description`

- **[P]**:別ファイルで、未完了のタスクに依存せず並行できる。
- **[Story]**: [US1]〜[US3]はspec.mdのUser Storyに対応する。
- APIのテストは、既定の`TEST_GROUPS_ENABLED=false`の環境を使う。US3だけ、016の`groupsEnv()`（`apps/api/test/helpers/test-groups.ts`）を使う。紹介の見出しは、`call(app, method, path, { user, headers: { "X-Referral-Code": … } })`で付ける。

## Phase 1: Setup

**Purpose**: 共通の型と定数。

- [X] T001 [P] `packages/shared/src/limits.ts`に`REFERRAL_REMEMBER_DAYS = 30`と、紹介の文字列の形`REFERRAL_CODE_PATTERN = /^r_[A-Za-z0-9_-]{22}$/`を足す（画面とAPIで同じ形を使う。research.md R2）。
- [X] T002 [P] `packages/shared/src/schemas.ts`に`referralResponseSchema`（`{ url: string; referredCount: number（0以上の整数） }`）と`referralPageSchema`（`{ testGroups: boolean }`）と、その型を足す（contracts/api.md）。テスト：`packages/shared/test/referral-schemas.test.ts`（人数が負・小数なら通さない）。

## Phase 2: Foundational

**Purpose**: DBの列。US1〜US3の前に要る。

- [X] T003 `apps/api/src/db/schema.ts`の`users`に、`referralCode`（`referral_code` text、NULL可、UNIQUE）、`referredByUserId`（`referred_by_user_id` uuid、NULL可、`users.id`を参照し削除でNULL）、`referredAt`（`referred_at` timestamptz、NULL可）、索引`users_referred_by_idx`（`referred_by_user_id`）、CHECK`users_not_self_referred`（`referred_by_user_id <> id`）を足す（data-model.md）。`pnpm --filter ./apps/api db:generate`で`apps/api/drizzle/0017_referral_links.sql`を作る（足すだけ。既存の行は3列ともNULL）。
- [X] T004 `apps/api/test/migration/migration-0017.test.ts`：0016まで当てて利用者を入れてから0017を当て、前からいる行の3列がNULLであること、`referral_code`の重複が拒まれること、`referred_by_user_id = id`が拒まれること、紹介した人の行を消すと紹介された人の`referred_by_user_id`がNULLになり`referred_at`は残ることを確かめる（`migration-0016.test.ts`の形）。

## Phase 3: User Story 1 -利用者が、自分の紹介リンクを人に送る（P1）🎯 MVP

**Goal**: 紹介リンクを開いてから同じブラウザで30日以内に新しく登録した人に、紹介した人が記録される。

**Independent Test**: 利用者Aの紹介の文字列を見出しに付けて、まだ行のない人Bが初めてAPIを呼ぶ。Bの`referred_by_user_id`がAになる。

### Tests（先に書いて失敗を確かめる）

- [X] T005 [P] [US1] `apps/api/test/integration/referrals.test.ts`に、記録のテストを書く：
  - 持ち主のいる文字列を`X-Referral-Code`に付けて、新しい人が`GET /api/me`を呼ぶ → 行ができ、`referred_by_user_id`が持ち主、`referred_at`が入る
  - すでに行がある人が付けて呼ぶ → 記録されない（前に記録があれば変わらない）
  - 持ち主本人が自分の文字列を付けて呼ぶ → 記録されない
  - 形に合わない文字列・持ち主のいない文字列 → 紹介なしで行ができる（200）
  - 見出しなし → 今までどおり
  - `GET /api/me/referral`：初めては文字列を作って`url`（`WEB_ORIGIN/r/r_…`）を返す、2回目は同じ`url`、`referredCount`は紹介された人の数
  - 紹介で登録しても、`GET /api/me`の`billing`（使える状態・無料体験の終わり）が紹介なしと同じ（SC-006）
  - 紹介の見出しを付けたまま、新しい人がチームの招待（`GET /api/invites/:token`→参加）から始める → 紹介の記録が残り、チームにも招待のとおり入る（FR-010）
- [X] T006 [P] [US1] `apps/api/test/integration/cors.test.ts`（なければ作る。※`referrals.test.ts`の「CORS」に置いた）：`OPTIONS /api/me`の`Access-Control-Allow-Headers`に`X-Referral-Code`が入ることを確かめる。
- [X] T007 [P] [US1] `apps/web/test/referral-store.test.ts`：`rememberReferral(code)`は形に合うときだけ`localStorage`の`tg.referral`に`{ code, at }`を書く（あとから開いた方で上書き）、`currentReferral()`は30日以内なら文字列を返し、過ぎていれば消して null、`clearReferral()`で消える、`localStorage`が投げる環境では何もしない。
- [X] T008 [P] [US1] `apps/web/test/referral-landing.test.tsx`：ログインしていない人が`/r/:code`を開くと、見出し「ThreadsGrowerに招待されています」・紹介の3行・「Googleで始める」が出て、`tg.referral`に書かれる。「Googleで始める」で`/sign-in`へ移る。紹介した人の名前は出ない（APIに名前を問い合わせない）。ログインしている人は書かずに`/`へ移る。
- [X] T009 [P] [US1] `apps/web/test/api-client-referral.test.ts`：`tg.referral`があればAPIの呼び出しに`X-Referral-Code`が付く、なければ付かない、`api.me`が成功したら`tg.referral`が消える。

### Implementation

- [X] T010 [US1] `apps/api/src/services/referral-service.ts`を作る：`newReferralCode()`（`r_`＋16バイトの`crypto.getRandomValues`のbase64url、22文字）、`referrerIdByCode(db, code)`（`REFERRAL_CODE_PATTERN`に合わなければ null、`users.referral_code`で引いてIDを返す）、`referralOf(env, userId)`（`referral_code`がNULLなら`UPDATE … SET referral_code = 新しい文字列 WHERE id = 本人 AND referral_code IS NULL`、一意の制約に当たったら作り直す（3回まで）。`url`は`invite-service.ts`の`inviteUrl(env, code, "r")`、`referredCount`は`count(*) WHERE referred_by_user_id = 本人`）。
- [X] T011 [US1] `apps/api/src/middleware/auth.ts`のJIT作成（利用者の行がないときの`insert(users)`）で、`X-Referral-Code`の見出しを`referrerIdByCode`で引き、持ち主がいれば`referredByUserId`と`referredAt: new Date()`を`values`に足す。すでに行がある人では見出しを読まない。
- [X] T012 [US1] `apps/api/src/app.ts`のCORSの`allowHeaders`に`"X-Referral-Code"`を足す（コメントに specs/017 research.md R4）。
- [X] T013 [US1] `apps/api/src/routes/referrals.ts`を作り、`GET /api/me/referral`（認証が要る。`referralOf`を`referralResponseSchema`の形で返す）を置いて、`apps/api/src/app.ts`に登録する。
- [X] T014 [P] [US1] `apps/web/src/lib/referral-store.ts`を作る：`rememberReferral`・`currentReferral`・`clearReferral`（キー`tg.referral`、`REFERRAL_REMEMBER_DAYS`、`REFERRAL_CODE_PATTERN`。読み書きは try/catch で囲む）。
- [X] T015 [US1] `apps/web/src/lib/api-client.ts`の`request`で、`currentReferral()`があれば`X-Referral-Code`を付ける。`api.me`が成功したら`clearReferral()`を呼ぶ。`api.referral()`（`GET /api/me/referral`）を足す。`apps/web/src/lib/query.ts`に`queryKeys.referral`を足す。
- [X] T016 [US1] `apps/web/src/pages/referral-landing.tsx`を作る（contracts/ui-routes.md 1。016の`pages/test-invite.tsx`と同じ骨格。ログインしていなければ`rememberReferral(code)`して紹介の3行と「Googleで始める」、ログインしていれば`<Navigate to="/" replace />`）。`apps/web/src/router.tsx`に`/r/:code`を認証のガードの外で足す。
- [X] T017 [US1] `apps/web/src/pages/settings/referral.tsx`を作る（contracts/ui-routes.md 2。見出し「紹介」・説明・紹介リンクの読み取り専用の入力欄と「コピー」（「コピーしました」）・「あなたの紹介で登録した人：N人」）。`apps/web/src/pages/settings/sections.ts`の「個人設定」の最後に`{ slug: "referral", label: "紹介", Icon: Share2Icon（特典を思わせるプレゼントの絵は使わない。FR-008）, keywords: ["紹介", "招待", "友だち", "共有", "リンク"] }`を足し、`apps/web/src/router.tsx`に`settings/referral`を足す。テスト：`apps/web/test/settings-referral.test.tsx`（リンクとコピー、人数、名前を出さない）。

**Checkpoint**: 紹介リンクを開いて登録した人に記録が付き、設定で自分のリンクをコピーできる。

## Phase 4: User Story 2 -紹介した人が、自分の紹介で何人が登録したかを確かめる（P2）

**Goal**: 紹介した人は人数だけを見られる。退会した人は数えない。

**Independent Test**: Aの紹介で2人登録 → 2人、1人退会 → 1人。

- [X] T018 [P] [US2] `apps/api/test/integration/referrals.test.ts`に足す：紹介で2人登録した人の`referredCount`が2、紹介された人が退会（`POST /api/me/withdraw`の後に退会の処理を終える。`withdrawal.test.ts`と同じ手順）すると1。紹介した人が退会すると、紹介された人の`referred_by_user_id`がNULLになり、その文字列で新しく登録しても記録されない。`GET /api/me/referral`の応答に、紹介された人の名前・メールアドレス・IDが入らない（応答のキーが`url`と`referredCount`だけ。SC-004）。
- [X] T019 [US2] T018が通るよう、`apps/api/src/services/referral-service.ts`の人数と退会の振る舞いを直す（外部キーの「削除でNULL」で足りれば、コードは変えない）。0人のときに設定の「紹介」が「あなたの紹介で登録した人：0人」を出すことを`apps/web/test/settings-referral.test.tsx`に足す。終わりの条件：T018のテストと、この0人のテストが通ること。

**Checkpoint**: 人数が正しく、誰が登録したかは伝わらない。

## Phase 5: User Story 3 -テスト環境では、紹介リンクで入れる人を増やさない（P3）

**Goal**: テスト用のグループがONの環境で、紹介の記録は残るが、紹介リンクだけではテスト環境に入れない。紹介リンクの画面に注意を出す。

**Independent Test**: ONの環境で、紹介の見出しを付けて新しい人が登録する → 記録は残り、ほかのAPIは`403 TEST_ACCESS_REQUIRED`。

- [X] T020 [P] [US3] `apps/api/test/integration/referrals.test.ts`に、`groupsEnv()`で：紹介の見出しを付けて新しい人が`GET /api/me`を呼ぶ → `referred_by_user_id`が入り、`testGroups.admitted`が false、`GET /api/me/referral`などは`403 TEST_ACCESS_REQUIRED`。そのあとグループの招待から参加すると、入れる人になり、紹介の記録は変わらない（FR-010）。`GET /api/referral-page`がONで`{ testGroups: true }`、OFFで`{ testGroups: false }`（認証なしで呼べる）。
- [X] T021 [US3] `apps/api/src/routes/referrals.ts`に`GET /api/referral-page`（認証なし。`billingModeOf(c.env).testGroups`を`referralPageSchema`の形で返す）を足す。
- [X] T022 [US3] `apps/web/src/lib/api-client.ts`に`api.referralPage()`（認証なし）を足し、`apps/web/src/pages/referral-landing.tsx`で`testGroups`が true なら「テスト版は、招待された方だけが使えます。招待のリンクを受け取った方は、そちらから始めてください。」を出す（失敗したら出さずに画面は出す）。テスト：`apps/web/test/referral-landing.test.tsx`に、ONで注意が出る・OFFと失敗で出ない、を足す。

**Checkpoint**: テスト環境で、紹介リンクが016の「招待された人だけ」を崩さない。

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T023 [P] `docs/user-guide.md`に「紹介リンク」（設定 › 紹介でコピーして送る。特典はない。人数だけ見える）を足す。`docs/architecture.md`の機能の一覧に紹介リンクを1行足す。
- [X] T024 [P] `docs/next-features.md`の§Eの「017で決めること」を、決めた内容（specs/017-referral-links へのリンク）に置き換える。
- [X] T025 全体のテスト・lint・型チェック・Webのビルドを通す（`pnpm --filter ./apps/api test`、`pnpm --filter ./apps/web test`、`pnpm --filter ./packages/shared test`、`pnpm lint`、`pnpm -r exec tsc --noEmit`、`pnpm --filter ./apps/web build`）。
- [ ] T026 quickstart.mdの「2. テスト版で手で確かめる」を、マージのあとにユーザーとテスト版で通す。

## Dependencies & Execution Order

- Phase 1（T001・T002）は並行できる。
- Phase 2（T003→T004）はUS1〜US3の前。
- US1：T005〜T009（テスト）→T010〜T013（API）・T014〜T017（Web。T014→T015→T016）。
- US2：US1のT010・T013の後。T018→T019。
- US3：US1のT013・T016の後。T020→T021→T022。
- Polish は最後。

## Parallel Example: User Story 1

```text
T005（APIの記録のテスト）・T006（CORS）・T007（ブラウザに覚える）・T008（紹介リンクの画面）・T009（APIクライアント）は別ファイルで並行できる。
T014（referral-store）は、API側のT010〜T013と並行できる。
```

## Implementation Strategy

1. Phase 1・2で、型・定数・DBの列を作る（足すだけなので、既存のテストは変わらない）。
2. US1で、紹介リンクの画面・記録・設定の「紹介」を作る（ここで出してもよい）。
3. US2で、人数と退会の振る舞いを確かめる。
4. US3で、テスト環境の注意を足す。
5. Polishで文書と全体のテスト。
