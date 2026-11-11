---

description: "Task list for feature 028 meguru shell and web split"
---

# Tasks：めぐるの外枠とWebの分割

**Input**：[spec.md](./spec.md)、[plan.md](./plan.md)、[research.md](./research.md)、[data-model.md](./data-model.md)、[contracts/ui-routes.md](./contracts/ui-routes.md)、[contracts/api.md](./contracts/api.md)、[contracts/web-module-boundaries.md](./contracts/web-module-boundaries.md)、[quickstart.md](./quickstart.md)

**Tests**：spec が自動テストを求めている（FR-020・SC-003・SC-004・SC-005）。今あるテスト（共有・Web・API・E2E）は、URLと読みこみ先のほかは中身を変えずに通す。足すテストは、実装の前に書いて失敗を確かめる。

**Organization**：PRは3つ（research.md R15）。PRの順に並べるため、User Storyの順ではなく **US2 → US1 → US3 → US4** の順にする（US1・US2はどちらもP1。フォルダーの分割を先にし、URLの移動と分ける）。
- **PR1＝Phase 1〜3**（境界の規則・入口の形・フォルダーの分割。**URLは変えない**）
- **PR2＝Phase 4**（URLの移動と転送）
- **PR3＝Phase 5〜7**（すべてのアプリ・アプリの切り替え・最後に使ったアプリ・文書）

## Format：`[ID] [P?] [Story] Description`

- **[P]**：別ファイルで、未完了のタスクに依存せず並行できる。
- **[Story]**：[US1]〜[US4]は spec.md の User Story に対応する。
- **パス**：`web/` は `apps/web/src/`、`web-test/` は `apps/web/test/`、`api/` は `apps/api/src/`、`api-test/` は `apps/api/test/`、`shared/` は `packages/shared/src/` の略。
- **移動のしかた**：ファイルの移動は `git mv` で行い、読みこみ先（`@/…` と相対パス）はスクリプトで機械的に直す。中身を変えてよいのは、各タスクに「中身を変える」と書いたものだけ。
- **各タスクの終わり**：`pnpm typecheck`・`pnpm lint`・`pnpm --filter web test` が通ること（PR2・PR3では `pnpm test` と `pnpm e2e` も）。

---

# PR1：境界の規則とフォルダーの分割（URLは変えない）

## Phase 1：Setup（分割の前の基準）

- [X] T001 分割の前の基準を残す：`pnpm --filter web test`・`pnpm --filter shared test`・`pnpm --filter api test` の成功数を数え、PR1の説明に書く（spec SC-003：減らさないことの基準）。あわせて、今のルートの一覧（`web/router.tsx` の `routes` のパス）を `specs/028-meguru-shell/checklists/routes-before.md` に書き出す（PR2の転送の確かめに使う）。
- [ ] T002 [P] ステージングで、Threadsだけを使っている人の主な画面（ホーム・投稿をつくる・投稿ストック・このアカウントの設定・チーム・設定の外観）のスクリーンショットを、1280px幅と390px幅で撮り、`specs/028-meguru-shell/checklists/screenshots-before/` に置く（quickstart.md 4、spec SC-002）。

## Phase 2：Foundational（境界の規則と、アプリの入口の形）

**⚠️ US2〜US4はすべて、ここで作る規則と `AppModule`・`buildRoutes` に頼る。**

- [X] T003 [P] `eslint-rules/web-module-boundaries.test.js` を作る（`node --test`。027の `eslint-rules/module-boundaries.test.js` と同じく、ファイルの初めで `RuleTester.describe`・`it`・`itOnly` を `node:test` につなぐ）。contracts/web-module-boundaries.md 3 のとおり、①アプリ同士（`apps/threads` → `apps/sample`）②外枠 → アプリ（入口を含む）③アプリ → 外枠の入口でないところ（`@/shell/layout/Sidebar`）④共通の部品 → 外枠・アプリ・組み立て ⑤外枠・アプリ → 組み立て（`@/router`）⑥組み立て → 外枠・アプリの入口でないところ ⑦置き場所の外（`src/pages/foo.tsx`、`strictPlacement: true` のとき）が失敗すること、通る例（アプリ → `@/shell`・`@/components/ui/button`・`@/lib/utils`・`@meguru/shared`、組み立て → `@/apps/threads`・`@/shell`、同じアプリの中の相対パス）が通ることを、`@/` と相対パスの両方で書く。先に失敗を確かめる。
- [X] T004 `eslint-rules/web-module-boundaries.js` を作る（T003を通す）。種類の判定（`components/**`・`lib/**` ＝共通の部品、`shell/**` ＝外枠、`apps/<名前>/**` ＝アプリ、`main`・`router`・`app-registry` ＝組み立て）、入口（`shell/index`・`apps/<名前>/index`）、`@/` を `src` に直す処理、知らせの文言（どのモジュールの境界を越えたかと `docs/module-map.md` の場所）を入れる。オプションは `srcDir`（既定 `apps/web/src`）と `strictPlacement`。関数には jsdoc を書く。
- [X] T005 `eslint.config.js` に、`apps/web/src/**/*.{ts,tsx}` へ `local/web-module-boundaries` を `["error", { strictPlacement: false }]` でかける（テスト `apps/web/test/**` にはかけない）。この時点では `shell/`・`apps/` がまだないので、違反は0件のまま通ることを確かめる。⑦（`strictPlacement`）は T026 で有効にする。
- [X] T006 [P] `web/shell/app-module.ts` を作る：`AppModule` の型（data-model.md 4：`id`・`icon`・`routes`・`plainRoutes`・`publicRoutes`・`legacyRedirects`・`sidebar: { Header, Body, Footer }`・`settingsSections`）、`SettingsSectionContribution` の型（`group: "personal" | "operator"`・`order: number`・`slug`・`label`・`Icon`・`keywords`・`element`）、`AppRegistryProvider` と `useAppRegistry()`（組み立てから渡された `AppModule[]` を配るコンテキスト）、`useCurrentApp()`（URLの頭が `AppModule` のルートの頭と一致するアプリ。PR1では、`routes` を持つアプリが1本ならそのアプリ）。
- [X] T007 [P] `web/shell/index.ts` を作る（外枠の入口）。この時点では `app-module.ts` の型と関数だけを出す（T010以降で、移した外枠の部品を足していく）。
- [X] T008 `web/router.tsx` を中身を変えて、`buildRoutes(apps: AppModule[])` を出す形にする：今の `routes` の並び（ログインのいらないルート → `RequireAuth` の中 → `*`）を保ったまま、`publicRoutes` を関所の外、`plainRoutes` と `routes` を関所の中、`settingsSections` を `/settings` の子に入れる。`router` は `buildRoutes(registeredApps)` で作る。この時点では、Threadsのルートを今のURLのまま1つの仮の `AppModule` に入れて渡し、ルートの一覧が T001 の `routes-before.md` と同じであることを確かめる。
- [X] T009 `web/app-registry.ts` を作る（組み立て）：出せるアプリの `AppModule` の一覧 `registeredApps`。`web/main.tsx` で `AppRegistryProvider` に `registeredApps` を渡す。

**Checkpoint**：規則が入り、ルートが登録の一覧から組まれる。画面とテストは今と同じ。

---

## Phase 3：User Story 2 - Webが外枠とアプリに分かれ、境界が自動で守られる（Priority: P1）

**Goal**：Webのコードが、外枠（`web/shell/`）・Threads（`web/apps/threads/`）・共通の部品（`web/components/`・`web/lib/`）・組み立てに分かれ、境界の違反が0件になる。URL・画面・動きは変えない。

**Independent Test**：quickstart.md 2（わざと境界を越えると `pnpm lint` が失敗し、戻すと違反0件）。今あるWebのテストが、読みこみ先のほかは中身を変えずに通る。

### Tests for User Story 2

- [X] T010 [P] [US2] `web-test/app-registry.test.tsx` を作る：`buildRoutes([threadsApp])` のルートのパスの一覧が T001 の `routes-before.md` と同じであること（PR1では URL を変えない）、`settingsSections` の項目が、今の並び（使える機能 → グループ → テスター招待 → アカウント一覧 → 上限）で設定の画面に出ること。先に失敗を確かめる。

### 共通の部品の切り分け（中身を変える）

- [X] T011 [P] [US2] `web/components/guards.tsx` から `LoadingSkeleton`・`useLoadTimeout` を `web/components/LoadingSkeleton.tsx` へ分ける（中身を変える：分けるだけ）。`RequireAuth` と `ClerkLoadFailedScreen` は T014 で外枠へ移す。読みこみ先を直す（`LoadingSkeleton` を使う約18ファイル）。
- [X] T012 [P] [US2] `web/components/FeatureUnavailable.tsx` を切り分ける（中身を変える）：`FeatureUnavailable` は共通に残し、戻る先を新しい共通のコンテキスト `web/lib/home-link.ts`（`HomeLinkProvider`・`useHomeLink()`。既定は `/`）から読む。`RequireFeature` は `web/apps/threads/components/RequireFeature.tsx` へ移す（T019でThreadsのフォルダーができてから置く）。Threadsのアカウントの画面の枠（`account-layout`）は `HomeLinkProvider` に今のアカウントのホームのURLを渡し、今と同じ「ホームへ」の行き先を保つ。`web-test/feature-unavailable.test.tsx` が通ること。
- [X] T013 [US2] `web/lib/api-client.ts` と `web/lib/query.ts` を切り分ける（中身を変える：分けるだけ）。
  - **実装の結果（2026-11-12）**：切り分けないことにした。Webのテストの60ファイルが `vi.mock("@/lib/api-client")` で `api` をまるごと差し替えており、分けるとテストの中身を書き直すことになる（spec SC-003）。共通の `api-client` にThreadsの呼び出しが入っていても境界の違反にはならず、2作目は自分の `apps/<名前>/lib/api.ts` に足せばぶつからない。Threadsの呼び出しを移すことは、移す候補としてモジュール地図に書く（T065）。以下は当初の案。
  - 共通に残す呼び出し：`me`・`withdrawalPreview`・`withdraw`・`billing`・`syncBilling`・`startCheckout`・`openPortal`・`referral`・`referralPage`・`previewTestInvite`・`joinTestGroup`・`testGroups`〜`putTestGroupFeatures`・`featureSettings`〜`resetFeatureSettings`・`operatorLimits`〜`putUserLimits`、と呼び出しの土台（`ApiError`・`request` など、`export` している関数と型）。
  - `web/apps/threads/lib/api.ts` へ移す呼び出し：残り全部（`needsReviewCounts`・アカウント・チームと招待・テスター招待・運営のアカウント一覧・接続・戦略・宣伝・メンション・分析・外部媒体・リサーチ・投稿・自動投稿・パフォーマンスなど）。`api` は `{ ...commonApi, ...threadsApi }` として出し、Threadsのコードは読みこみ先を変えるだけで済むようにする。
  - `queryKeys` も同じに分ける（`web/apps/threads/lib/query-keys.ts`。`queryClient` と共通のキーは `web/lib/query.ts`）。
  - `web-test/api-client-referral.test.ts` が通ること。

### 外枠へ移す（`git mv`）

- [X] T014 [US2] 外枠の骨格を `web/shell/layout/` へ移す：`components/layout/AppShell.tsx`・`EnvBanner.tsx`・`PageHeader.tsx`・`shell-context.ts`・`UserMenu.tsx`。`components/layout/Sidebar.tsx` は、中身を変えて**枠**（いちばん上の行・畳むボタン・区切り線・ユーザーメニュー）を `web/shell/layout/Sidebar.tsx` に置き、アカウントの切り替え・担当の案内・機能の一覧・チーム・操作の記録・「このアカウントの設定」は T020 でThreadsの `sidebar` へ移す。枠は `sidebar.Header`・`Body`・`Footer` を research.md R8 の順（アプリが1本：頭と畳むボタンを同じ行）に並べる。**実装の結果**：サイドバーの中身は、登録の一覧からではなく、アプリの画面の枠が `AppShell` の `sidebar` に渡す形にした（Threadsは `ThreadsShell`・`ThreadsSidebar`）。テストがアプリの一覧なしで画面の枠を描くため。サイドバーのテスト5ファイルは、`AppShell`・`Sidebar` を `ThreadsShell`・`ThreadsSidebar` に置き換えた（確かめる中身は変えていない）。`web-test/layout-responsive.test.tsx`・`sidebar-create.test.tsx`・`sidebar-teams.test.tsx`・`solo-owner-unchanged.test.tsx` が中身を変えずに通ること。
- [X] T015 [US2] 関所を `web/shell/guards/` へ移す：`components/guards.tsx`（`RequireAuth`・`ClerkLoadFailedScreen`）→ `shell/guards/RequireAuth.tsx`、`components/TestAccessRequired.tsx`、`components/billing/SubscribeRequired.tsx`、`components/billing/WithdrawalInProgress.tsx`。`web-test/guards.test.tsx`・`test-access.test.tsx`・`subscribe-required.test.tsx` が通ること。
- [X] T016 [P] [US2] 外枠のページを `web/shell/pages/` へ移す：`pages/not-found.tsx`・`sign-in.tsx`・`terms.tsx`・`legal-commerce.tsx`・`test-invite.tsx`・`referral-landing.tsx`、`router.tsx` の `PlainPage`（`shell/pages/plain-page.tsx`）。`lib/seller-info.ts` → `web/shell/lib/seller-info.ts`。`lib/use-logout.ts`・`lib/referral-store.ts`・`lib/invite-return.ts` は共通に残す（`api-client` と Threads も使うため）。
- [X] T017 [P] [US2] 共通の設定を `web/shell/settings/` へ移す：`pages/settings/settings-layout.tsx`・`sections.ts`・`account.tsx`・`appearance.tsx`・`billing.tsx`・`referral.tsx`・`features.tsx`・`test-groups.tsx`・`limits.tsx`。`sections.ts` は中身を変えて、外枠の項目に、各アプリの `settingsSections` を `group` と `order` で混ぜる関数 `settingsGroupsFor(operator, contributions)` にする（今の並びを保つ。`web-test/settings.test.tsx` が通ること）。運営の項目を確かめるテスト3ファイルは、`web-test/helpers/apps.tsx` の `WithApps`（Threadsを登録した `AppRegistryProvider`）で包んだ。`pages/settings/tester-invites.tsx`・`operator-accounts.tsx` は T019 でThreadsへ移す。
- [X] T018 [US2] `web/shell/index.ts` に、外枠の入口として `AppShell`・`CenteredLayout`・`PageHeader`・`useShell`・`AppModule` と設定の項目の型を足す（Threadsはこれだけを使う）。

### Threadsへ移す（`git mv`）

- [X] T019 [US2] Threadsの画面を `web/apps/threads/pages/` へ移す：`pages/` の `account-home`・`account-layout`・`account-new`・`account-settings`・`activity`・`analysis`・`create`・`data-deletion`・`external-media`・`external-media-listing`・`guide-threads-token`・`invite`・`performance`・`promotions`・`research`・`stock`・`strategy`・`team`・`team-assign`・`team-layout`・`team-shared-account`・`team-status`・`threads-complete`、`landing.tsx`（→ `apps/threads/pages/home.tsx`。中身はそのまま）、`pages/settings/tester-invites.tsx`・`operator-accounts.tsx`（→ `apps/threads/pages/settings/`）。
- [X] T020 [US2] Threadsの部品を `web/apps/threads/components/` へ移す：`components/` の `analysis/`・`connect/`・`create/`・`external-media/`・`guides/`・`items/`・`performance/`・`promotions/`・`research/`・`stock/`・`strategy/`、`team/` のうち `AssignedNotice`・`CreateTeamDialog`・`InviteLinkDialog`・`LeaveTeamDialog`・`QrCode`・`RoleDiagram`・`TeamMark`・`TeamRoster`・`TeamSection`、`settings/` のうち `AccountNameSection`・`CoreRulesDialog`・`MentionSettingsSection`・`NgWordsDialog`・`PolicyInfoDialog`・`PostingRulesSection`・`PostingScheduleDialog`・`PostingScheduleSection`、直下の `AccountAvatar`・`AutoPostNotices`・`ConnectionBadge`・`CopyPromptButton`・`NextPostCard`・`NotConnectedNotice`・`ReconnectButton`・`ShareAppCard`、T012の `RequireFeature`。`components/layout/AccountSwitcher.tsx` と、T014で枠から外したサイドバーの中身は `web/apps/threads/sidebar/`（`Header.tsx`・`Body.tsx`・`Footer.tsx`）に置く（中身を変える：今の `Sidebar.tsx` の該当部分を分けるだけ）。
- [X] T021 [P] [US2] 共通に残す部品の置き場所を整える：`components/team/ConfirmDialog.tsx` → `components/ConfirmDialog.tsx`、`components/team/HelpToggle.tsx` → `components/HelpToggle.tsx`、`components/settings/SettingRow.tsx` → `components/SettingRow.tsx`、`components/settings/FeatureSwitches.tsx` → `components/FeatureSwitches.tsx`（外枠の設定とThreadsの両方が使うため。中身は変えない）。
- [X] T022 [US2] Threadsの共通でない `lib` を `web/apps/threads/lib/` へ移す：`use-account-access.ts`・`use-account-open.ts`・`callback-result.ts`・`preferences.ts`。
- [X] T023 [US2] `web/apps/threads/routes.tsx` を作る：今の `web/router.tsx` のThreadsのルート（`/`・`/accounts/new`・`/threads/complete`・`/accounts/:accountId/*`・`/teams/:teamId/*`・`/teams/:teamId/accounts/:accountId`、`/invite/:token`・`/guide/threads-token`・`/data-deletion/:code`）を、**今のURLのまま** `routes`（ログインの要るもの）・`publicRoutes`・`readingRoutes`（環境の帯つきの読みもの：`/guide/threads-token`）に分けて書く。**実装の結果**：ルートを組む関数 `buildRoutes` は外枠（`web/shell/routes.tsx`）に置き、`web/router.tsx` は `buildRoutes(registeredApps)` を呼ぶだけにした。
- [X] T024 [US2] `web/apps/threads/index.ts` を作る（Threadsの入口）：`threadsApp: AppModule`（`id: "threads"`、`basePath: "/threads"`、T023のルート、`settingsSections`：テスター招待（`group: "operator"`、使える機能・グループの後）・アカウント一覧（その後、上限の前））。`legacyRedirects` は空（PR2で入れる）。`web/app-registry.ts` の仮の `AppModule` を `threadsApp` に置き換える。T010が通ること。

### 境界の違反を0件にする

- [X] T025 [US2] `pnpm lint` を流し、境界の違反を直す（**結果：例外0件**）。直せないものは `eslint-disable-next-line local/web-module-boundaries -- <理由>` で止め、`docs/module-map.md` の例外の表（T065で作る）に書く候補として PR の説明に並べる（3件以下を目標。spec SC-004）。
- [X] T026 [US2] `eslint.config.js` の `local/web-module-boundaries` を `strictPlacement: true` にし、`web/pages/`・`web/components/layout/` など空になったフォルダーを消す。違反0件（例外を除く）を確かめる。
- [X] T027 [US2] `apps/web/test/**` の読みこみ先を、移した場所に直す（約84ファイル。テストの中身は変えない）。`pnpm --filter web test` の成功数が T001 と同じであることを確かめる。
- [X] T028 [US2] quickstart.md 2 の手順で、わざと境界を越えたコードを4つ書いて `pnpm lint` が失敗することを確かめ、消す。

**Checkpoint（PR1の完了）**：URL・画面・動きは今と同じで、フォルダーが分かれ、境界が守られている。PR1を `develop` へ出す。

---

# PR2：URLの移動と転送

## Phase 4：User Story 1 - 今のThreadsの利用者は、今までどおり使える（Priority: P1）🎯 MVP

**Goal**：Threadsの画面が `/threads/…` になり、前のURLは転送される。公開ページ・`/threads/complete`・`/settings` のURLは変わらない。アプリが1本の人の見た目は今と同じ。

**Independent Test**：quickstart.md 3・4。

### Tests for User Story 1

- [X] T029 [P] [US1] `web-test/legacy-redirects.test.tsx` を作る（**実装の結果**：T029〜T031は `web-test/shell-routes.test.tsx` にまとめた。ログインしていない人はログインのあと、分割の前と同じく入口へ戻る）：`/accounts/12/external-media?view=work#x` → `/threads/accounts/12/external-media?view=work#x`、`/accounts/new` → `/threads/accounts/new`、`/teams/3/assign` → `/threads/teams/3/assign`、`/teams/3/accounts/12` → `/threads/teams/3/accounts/12`、ログインしていなくても移ること（関所の外）、履歴を置き換えること（`createMemoryRouter` の履歴の数で確かめる）。先に失敗を確かめる。
- [X] T030 [P] [US1] `web-test/threads-home.test.tsx` を作る：`/threads` が最後に使ったアカウント（`landingAccountId`）、なければ `/threads/accounts/new` へ移り、`?error=OAUTH_STATE_INVALID` のトーストを出すこと（今の `web-test/landing.test.tsx` の場面をURLだけ変えて写す）。`/threads/nothing` が「見つかりません」になること。
- [X] T031 [P] [US1] `web-test/public-routes-unchanged.test.tsx` を作る：`/sign-in`・`/terms`・`/legal/commerce`・`/guide/threads-token`・`/invite/<token>`・`/test-invite/<token>`・`/r/<code>`・`/data-deletion/<code>`・`/threads/complete`・`/settings/billing` が、URLを変えずに今の画面を出すこと。
- [X] T032 [P] [US1] （**PR3 へ移した。PR3 で行った**：デプロイは API を Web より先に出すため。T041 と一緒に PR3 で行う）API のテストの期待値を直す：`api-test/` の `/api/threads/callback` の設定の不備の転送先を `/threads/accounts/new?error=CONFIG_ERROR` に、`POST /api/threads/complete` の `redirectTo` を `/threads?error=…`・`/threads/accounts/<番号>/settings?…` にする（contracts/api.md 3）。先に失敗を確かめる。

### Implementation for User Story 1

- [X] T033 [US1] `web/apps/threads/lib/paths.ts` を作る：Threadsの画面のURLを作る関数（`threadsPaths.home()` → `/threads`、`.newAccount()`、`.account(id, sub?)`、`.team(teamId, sub?)`、`.sharedAccount(teamId, accountId)`）。
- [X] T034 [US1] （**実装の結果**：関数に置き換えず、頭に `/threads` を足す機械的な置き換えにした。URLの形を変えるのは頭だけで、置き換え漏れは `grep` で0件を確かめた。関数は `accountHomePath` だけ）Threadsのコードの中の、ハードコードしたURL（`"/accounts…"`・`` `/accounts/${…}` ``・`"/teams…"` など約29ファイル・37か所。`grep -rnE '["\`]/(accounts|teams)' apps/web/src` で洗い出す）を、T033の関数に置き換える。`useMatch("/teams/:teamId/*")`（サイドバーの中身）も `/threads/teams/:teamId/*` にする。`FeatureUnavailable` の戻る先（T012の `HomeLinkProvider` に渡す値）も新しいURLにする。
- [X] T035 [US1] `web/apps/threads/routes.tsx` のルートを `/threads` の下へ移す（contracts/ui-routes.md 1-2）：ホーム（今の `/`）→ `/threads`、`/accounts/new` → `/threads/accounts/new`、`/accounts/:accountId/*` → `/threads/accounts/:accountId/*`、`/teams/:teamId/*` → `/threads/teams/:teamId/*`、`/teams/:teamId/accounts/:accountId` → `/threads/teams/:teamId/accounts/:accountId`。`/threads/complete`・`publicRoutes` は変えない。
- [X] T036 [US1] 前のURLの転送を作る：`web/apps/threads/index.ts` の `legacyRedirects` に `[{ from: "/accounts", to: "/threads/accounts" }, { from: "/teams", to: "/threads/teams" }]` を入れ、外枠に `web/shell/pages/legacy-redirect.tsx`（パスの残り・`location.search`・`location.hash` を保ち、`<Navigate replace>` で移す）を作り、`web/router.tsx` の `buildRoutes` で `legacyRedirects` から `"<from>/*"` と `"<from>"` のルートを**関所の外**に作る。T029が通ること。
- [X] T037 [US1] 外枠の `/` を作る：`web/shell/pages/landing.tsx`。PR2では、登録したアプリが1本ならそのアプリのホーム（`/threads`）へ、クエリを保って置き換えで移すだけにする（`me.apps` による振り分けは T052 で入れる）。`web/router.tsx` で `/` を外枠のこのルートにする。T030が通ること。
- [X] T038 [US1] Threadsから入る道を `/threads` へ向ける（contracts/ui-routes.md 3）：`web/shell/pages/referral-landing.tsx`（ログインしている人の `Navigate` と、ログインしていない人のログインの戻り先）、`web/shell/pages/test-invite.tsx` の「アプリを開く」、`web/apps/threads/pages/invite.tsx` の「アプリを開く」。`web/shell/pages/sign-in.tsx` の戻り先の許可に、`/threads` をちょうど一致で足す（今の招待の2つは変えない）。「参加しない」「トップへ」「見つかりませんの戻る」「設定の戻る」は `/` のまま。`web-test/referral-landing.test.tsx`・`test-invite.test.tsx`・`invite-page.test.tsx` の期待値を直す。
- [X] T039 [US1] `web/lib/invite-return.ts`（招待から「アカウントを作る」へ進んだ人を、接続のあとに招待へ戻す）と `web/apps/threads/lib/callback-result.ts` の中のURLの形を確かめ、`/threads/accounts/…` で動くよう直す。`web-test/account-settings.test.tsx`・`threads-complete.test.tsx` が通ること。
- [X] T040 [US1] `web/shell/guards/RequireAuth.tsx` の `SUBSCRIBE_ALLOWED_PATHS`（`/settings/billing`・`/settings/account`）が変わらないことを確かめる（URLを変えないため、直しは要らない見込み）。
- [X] T041 [P] [US1] （**PR3 へ移した。PR3 で行った**：PR2 の Web が出たあとに API を変える。それまでは前のURLの転送が受ける）APIが作るURLを直す（contracts/api.md 3）：`api/app.ts` の `${web}/accounts/new?…` → `${web}/threads/accounts/new?…`、`api/apps/threads/connection/threads-connect-routes.ts` の `withParams("/", …)` → `withParams("/threads", …)`、`/accounts/${…}/settings` → `/threads/accounts/${…}/settings`。T032が通ること。
- [X] T042 [US1] `apps/web/test/**` の残りのURLの期待値（`/accounts/…`・`/teams/…`）を新しいURLに直す（中身の場面は変えない）。`pnpm --filter web test` が通り、成功数が T001 より減らないこと。
- [X] T043 [US1] E2Eを直す：`e2e/tests/` の `billing.spec.ts`・`create.spec.ts`・`onboarding.spec.ts`・`phone-width.spec.ts`・`reconnect-delete.spec.ts`・`research.spec.ts`・`strategy.spec.ts`・`team.spec.ts`・`token.spec.ts`・`team-flow.ts`・`helpers.ts` のURLを新しいURLにする。前のURLの転送を確かめる場面を `e2e/tests/onboarding.spec.ts` に1つ足す（`/accounts/<番号>/stock` を開くと `/threads/accounts/<番号>/stock`）。`pnpm e2e` が通ること。
- [ ] T044 [US1] quickstart.md 3 の表を手元で確かめる。ステージングへ出したあと、T002と同じ画面のスクリーンショットを撮り、URLのほかに差がないことを見比べる（quickstart.md 4、spec SC-002）。

**Checkpoint（PR2の完了）**：Threadsの画面が `/threads/…` で開き、前のURLは移る。今の利用者から見える違いはURLだけ。PR2を `develop` へ出す。

---

# PR3：すべてのアプリ・アプリの切り替え・最後に使ったアプリ

## Phase 5：User Story 3 - アプリをまだ使っていない人は「すべてのアプリ」から始める（Priority: P2）

**Goal**：アプリを使っていない人は `/apps` から始まり、Threadsを「使い始める」と今の「アカウントを作る」に入る。使っている人もユーザーメニューから `/apps` を開ける。

**Independent Test**：quickstart.md 5。

### Tests for User Story 3

- [X] T045 [P] [US3] `packages/shared/test/apps.test.ts`を作る：`APP_CATALOG` のIDが重ならないこと、Threadsの `priceLabel` が `BILLING_UNIT_PRICE_JPY` から作った「アカウント1件につき月1,000円」であること、`lastAppRequestSchema` が知らないIDを断ること。
- [X] T046 [P] [US3] `api-test/` に `/api/me` の `apps` のテストを足す（contracts/api.md 4）：登録した直後 → `{ available: ["threads"], using: [], last: null, landing: null }`、自分のアカウントあり → `using: ["threads"]`・`landing: "threads"`、担当だけ（チームのまとまりがON）→ `using: ["threads"]`、`last_app_id` が知らないID → `last: null`。先に失敗を確かめる。
- [X] T047 [P] [US3] `web-test/apps-page.test.tsx` を作る：`/apps` で、`using` が空なら「足せるアプリ」だけにめぐる Threads（名前・料金・「詳しく見る」・「使い始める」）が出ること、「詳しく見る」で説明が開き画面は移らないこと、「使い始める」で `/threads/accounts/new` へ移ること、`using: ["threads"]` なら「使っているアプリ」にThreadsが出て「開く」で `/threads` へ移ること、「戻る」で `/` へ移ること。
- [X] T048 [P] [US3] （**実装の結果**：外枠の振り分けのテストは `web-test/shell-routes.test.tsx` に足した。`landing.test.tsx` はThreadsのホーム（`/threads`）のテストのまま）`web-test/landing.test.tsx` を外枠の振り分けに書き直す：`me.apps.landing` が `"threads"` なら `/threads`（クエリを保つ）、`null` なら `/apps`、`/api/me` を読めなければ今のエラーの画面。紹介リンクからログインした人は `/apps` を挟まず `/threads` へ進むこと（T038の戻り先で）。
- [X] T049 [P] [US3] `web-test/user-menu.test.tsx` を作る：ユーザーメニューに「設定」「すべてのアプリ」「ログアウト」がこの順で出て、「すべてのアプリ」で `/apps` へ移ること。

### Implementation for User Story 3

- [X] T050 [US3] `shared/apps.ts` を作り、`shared/index.ts` から出す（data-model.md 2）：`APP_CATALOG`（Threads：`id: "threads"`・`name: "めぐる Threads"`・`basePath: "/threads"`・`summary`・`details`（3〜5行）・`priceLabel`・`released: true`）、`AppId` の型、`lastAppRequestSchema`（`{ app: AppId }`。`released` でないIDも断る）。T045が通ること。
- [X] T051 [US3] `api/platform/identity/me-routes.ts` に `apps` を足す（contracts/api.md 1）：`available` は `APP_CATALOG` の `released`、`using` は `visible.length > 0` なら `["threads"]`、`last` は `user.lastAppId`（`available` に入っていなければ `null`）、`landing` は `last` が `using` に入っていれば `last`、なければ `using[0] ?? null`。`landing` を決める純粋な関数 `resolveLandingApp(using, last)` を同じファイルに置き、`resolveLandingAccountId` と同じく単体でテストする。ここで使う `users.lastAppId` は T056 のマイグレーションで足すので、T056を先に行う。T046が通ること。
- [X] T052 [US3] `web/shell/pages/landing.tsx` を `me.apps.landing` で振り分けるようにする（contracts/ui-routes.md 3）：`landing` があれば `APP_CATALOG` のそのアプリの `basePath` へ（クエリを保つ・置き換え）、なければ `/apps`。開くたびに `/api/me` を読み直す（今の `refetchOnMount: "always"` を保つ）。T048が通ること。
- [X] T053 [US3] `web/shell/pages/apps.tsx` を作り、`web/router.tsx` の関所の中に `/apps` を足す（contracts/ui-routes.md 4、外枠モック）：サイドバーなしの1カラム・左上の「戻る」（`/`）・見出し「すべてのアプリ」・「使っているアプリ」（`me.apps.using`、0本なら区分ごと出さない）・「足せるアプリ」（`available` のうち `using` でないもの、0本なら出さない）。アプリの名前・説明・料金は `APP_CATALOG`、アイコンは `useAppRegistry()` の `icon`。「使い始める」はアプリの入口に持たせた開始の行き先（Threadsは `/threads/accounts/new`。`AppModule` に `startPath` を足す）。`APP_CATALOG` にあっても登録の一覧にないアプリは出さない。T047が通ること。
- [X] T054 [US3] `web/shell/layout/UserMenu.tsx` に「すべてのアプリ」を「設定」の下に足す（`/apps` へ）。ほかの項目は変えない。T049が通ること。
- [X] T055 [US3] `web/apps/threads/index.ts` の `threadsApp` に `icon`（Threadsのアイコン）と `startPath: "/threads/accounts/new"` を入れ、`web/shell/app-module.ts` の `AppModule` の型に `startPath` を足す。

**Checkpoint**：登録した直後の人は `/apps` から始まり、Threadsを始められる。今の利用者の入口は `/threads` のまま。

---

## Phase 6：User Story 4 - アプリが2本以上の人は、サイドバーのいちばん上でアプリを切り替える（Priority: P3）

**Goal**：使っているアプリが2本以上の人にアプリの切り替えを出し、最後に使ったアプリから始める。仮のアプリでテストする。

**Independent Test**：quickstart.md 6（`pnpm --filter web test -- app-switcher`）。

### Tests for User Story 4

- [X] T056 [US4] マイグレーションを作る（data-model.md 1）：`api/platform/schema.ts` の `users` に `lastAppId: text("last_app_id")`（**`text`・null可・既定 `null`・CHECKの制約なし**）を足し、`pnpm --filter api db:generate` で `apps/api/drizzle/0025_*.sql` を作る。もう一度 `db:generate` して変更なしを確かめる。（T051より先に行う）
- [X] T057 [P] [US4] `api-test/` に `PUT /api/me/last-app` のテストを足す（contracts/api.md 2・4）：`{ app: "threads" }` で `204` と `users.last_app_id = 'threads'`、知らないIDで `400 VALIDATION_FAILED`（`details: ["app"]`）、`released` でないIDで `400`、ログインなしで `401`、使っていないアプリでも覚えること。APIの入口の一覧（`api-test/repo/routes.snapshot.txt`）に `PUT /api/me/last-app` を足す。先に失敗を確かめる。
- [X] T058 [P] [US4] `web-test/app-switcher.test.tsx` を作る（research.md R13）：テストの中だけで仮のアプリ `sample`（`AppModule`：`/sample` のホームと、サイドバーの頭・中身）を作り、`buildRoutes([threadsApp, sampleApp])` と `AppRegistryProvider` で組む。確かめること：`me.apps.using: ["threads", "sample"]` ならサイドバーのいちばん上にアプリの切り替えが出て、その下にThreadsのアカウントの切り替えが出る／`using: ["threads"]` なら出ない（今の並び）／切り替えを押すと使っているアプリと「すべてのアプリ」が出て、`sample` を選ぶと `/sample` へ移る／`landing: "sample"` なら `/` で `/sample` が開く／`/sample` を開くと `PUT /api/me/last-app` を `{ app: "sample" }` で1回だけ呼ぶ（`me.apps.last` がすでに `sample` なら呼ばない）／`/apps`・`/settings` では呼ばない／呼び出しが失敗しても画面にエラーを出さない／仮のアプリを足すのに `buildRoutes` に渡す一覧のほか、外枠のコードを直していない（SC-005）／引き出しのサイドバー（390px幅）でも同じ並び。先に失敗を確かめる。
- [X] T059 [P] [US4] `eslint-rules/web-module-boundaries.test.js` に、仮のアプリのフォルダー（`apps/sample/`）でも①〜⑥が同じに当たることを足す（spec US2 5。T003で書いていれば確かめるだけ）。

### Implementation for User Story 4

- [X] T060 [US4] `api/platform/identity/me-routes.ts` に `PUT /me/last-app` を足す（contracts/api.md 2）：`lastAppRequestSchema` で確かめ、だめなら `AppError("VALIDATION_FAILED", 400, …, undefined, ["app"])`。`users.last_app_id` と `updated_at` を書き、`204` を返す。T057が通ること。
- [X] T061 [US4] `web/lib/api-client.ts` に `putLastApp(app: AppId)` を足し、`me` の型に `apps` を足す（共通の呼び出し）。
- [X] T062 [US4] （**実装の結果**：`useRememberLastApp` を、`buildRoutes` のログインの関所の中の入れ物（`RememberLastApp`）で使う）`web/shell/lib/use-last-app.ts` を作り、外枠の関所の中（`web/shell/guards/RequireAuth.tsx` の子の共通の枠、またはサイドバーを出す `AppShell`）で使う（contracts/ui-routes.md 6）：`useCurrentApp()` が変わり、`me.apps.last` がそのアプリでなければ `putLastApp` を1回呼び、成功したら `queryKeys.me` を読み直す。失敗は黙って捨てる。`/apps`・`/settings`・ログインのいらないページでは呼ばない。`useCurrentApp()` は、PR2で決めたURLの頭（`APP_CATALOG` の `basePath`）で判定するよう直す。
- [X] T063 [US4] `web/shell/layout/AppSwitcher.tsx` を作る（contracts/ui-routes.md 5-2、外枠モック）：開いているアプリのアイコンと名前（`APP_CATALOG.name`。「めぐる Threads」）と下向きの印、押すと使っているアプリの一覧（開いているアプリに印）・区切り線・「すべてのアプリ」（`/apps`）。アプリを選ぶとそのアプリの `basePath` へ移る。
- [X] T064 [US4] `web/shell/layout/Sidebar.tsx`（枠）に、`me.apps.using.length >= 2` のときだけ、いちばん上の行をアプリの切り替えにし、アプリの `sidebar.Header` をその下に出す並びを足す（research.md R8）。1本以下のときの並びは変えない。T058が通り、`web-test/solo-owner-unchanged.test.tsx`・`layout-responsive.test.tsx` が中身を変えずに通ること。

**Checkpoint（PR3の機能の完了）**：仮のアプリで、アプリの切り替えと最後に使ったアプリからの開始が動く。本番の利用者には切り替えは出ない。

---

## Phase 7：Polish & Cross-Cutting Concerns（PR3）

- [X] T065 [P] `docs/module-map.md` にWebの章を足す（spec FR-010・FR-011・FR-021）：contracts/web-module-boundaries.md の種類・入口・依存の向き・規則のかけ方、data-model.md 6 の地図（実際に移した結果）、境界の例外の表（T025で止めたもの。場所・理由・解消の予定）、アプリを足す手順（contracts/web-module-boundaries.md 5）、Threadsの公開ページの3つのURLを例外として残すこと（research.md R5）、`/api/me` の `using` の判定を2作目の利用権で置き換える予定（R6）、`@meguru/shared` の2作目からの置き場所とThreads固有のものが移す候補であること（R12）。
- [X] T066 [P] `docs/architecture.md` に、Webの構成（外枠・アプリ・共通の部品・組み立て）と、URLのパス分け・前のURLの転送・`/api/me` の `apps` を書き足す。
- [X] T067 [P] `docs/product-structure.md` §6 の表のWebの行を「◎ 028で `shell/` と `apps/<名前>/` に分けた。アプリ同士・外枠とアプリの境界をESLintでかける」に直し、§7 の「Webとsharedのモジュール分割の細部」の行を、決めたこと（028で済み・sharedは2作目から）に直す。§5 の表と食い違いがないかを確かめる。
- [X] T068 [P] `docs/ui-design.md` に、アプリの切り替え（サイドバーのいちばん上・2本以上のときだけ）・すべてのアプリの画面・ユーザーメニューの「すべてのアプリ」を書き足す。
- [X] T069 （**実装の結果**：技術スタック制約に2つの決まりを足し、4.6.0 にした。テンプレートには影響なし）`/speckit-constitution` の手順で Constitution を **4.6.0（MINOR）** に改める（spec FR-021、plan の Constitution Check）：技術スタック制約に「**Webのモジュール構成**（2026-11-12、specs/028）」（外枠・アプリ・共通の部品・組み立て、依存の向き、入口、ESLintの規則 `eslint-rules/web-module-boundaries.js`、アプリを足すときは登録の1か所）と「**モバイル化を見込んだ技術の選び方**（2026-11-12）」（2作目以降のアプリは、業務の判断とデータのやりとりをAPIと共通のパッケージに置き、Webの画面やブラウザだけで動く仕組みに閉じこめない。Threadsは今のままでよい）を足し、Sync Impact Report を残す。
- [ ] T070 quickstart.md の 1〜7 をすべて流し、結果をPR3の説明に書く。`pnpm --filter api db:migrate` をステージングに当てたあと（デプロイの手順に従う）、新しい人で `/apps` から始まることと、今の人で `/threads/…` から始まることを確かめる。

---

## Dependencies & Execution Order

### Phase の依存

- **Phase 1（Setup）**：すぐ始められる。T002はステージングで、PR2の前までに済ませればよい。
- **Phase 2（Foundational）**：Phase 1 のあと。**US2〜US4 はすべてここを待つ**。
- **Phase 3（US2、PR1）**：Phase 2 のあと。
- **Phase 4（US1、PR2）**：US2（PR1）がマージされてから。Threadsのルートとリンクが `apps/threads/` にまとまっていることに頼る。
- **Phase 5（US3、PR3）**：US1（PR2）がマージされてから（`/threads` のホームと外枠の `/` に頼る）。
- **Phase 6（US4、PR3）**：T056（マイグレーション）は T051 より先。US3 の `me.apps`・`APP_CATALOG` に頼る。
- **Phase 7（Polish）**：US3・US4 のあと。

### タスクの中の依存

- T003 → T004 → T005（規則はテストを先に）。T026 は T025 のあと。
- T006・T007 → T008 → T009 → T024。
- T011・T012・T013（共通の切り分け）→ T014〜T024（移動）。T012 の `RequireFeature` の置き場所は T019 のあと。
- T014（サイドバーの枠）と T020（サイドバーの中身）は続けて行う（間で `Sidebar` が壊れないよう、同じコミットにしてよい）。
- T033 → T034 → T035 → T036。T037 は T035 のあと。
- T050 → T051・T053。T056 → T051・T060。T061 → T062 → T064。

### User Story の独立性

- US2 は単独で出せる（URLを変えない）。
- US1 は US2 の上に乗るが、US3・US4 がなくても出せる（外枠の `/` は「アプリが1本ならそのホーム」）。
- US3 は US4 がなくても出せる（アプリの切り替えは、2本以上の人がいなければ見えない）。
- US4 は仮のアプリのテストで確かめる。本番の利用者には見えない。

## Parallel Example

```text
# Phase 2：規則のテストと、入口の型は別ファイル
T003 eslint-rules/web-module-boundaries.test.js
T006 apps/web/src/shell/app-module.ts
T007 apps/web/src/shell/index.ts

# Phase 3：共通の部品の切り分け（別ファイル）
T011 components/LoadingSkeleton.tsx
T012 components/FeatureUnavailable.tsx・lib/home-link.ts

# Phase 3：外枠のページと設定の移動（別フォルダー）
T016 shell/pages/
T017 shell/settings/

# Phase 4：テストを先に（別ファイル）
T029 web-test/legacy-redirects.test.tsx
T030 web-test/threads-home.test.tsx
T031 web-test/public-routes-unchanged.test.tsx
T032 api-test/（callback・complete の期待値）

# Phase 5：テストを先に
T045 packages/shared/test/apps.test.ts
T046 api-test/（/api/me の apps）
T047 web-test/apps-page.test.tsx
T048 web-test/landing.test.tsx
T049 web-test/user-menu.test.tsx

# Phase 7：文書（別ファイル）
T065 docs/module-map.md
T066 docs/architecture.md
T067 docs/product-structure.md
T068 docs/ui-design.md
```

## Implementation Strategy

### 先に出すもの

1. PR1（Phase 1〜3）：利用者から見える変化はないが、2作目とThreadsの改善を並行して進める前提（§6）ができる。ここで止めても価値がある。
2. PR2（Phase 4、US1 🎯 MVP）：URLを `/threads/…` にし、前のURLを転送する。今の利用者に影響を出さないことを、ステージングのスクリーンショットで確かめてから `main` へ出す。
3. PR3（Phase 5〜7）：すべてのアプリと切り替え。本番では、登録した直後の人の入口が `/apps` になることだけが見える変化。

### 気をつけること

- PR1の移動のコミットと、中身を変えるコミット（T011〜T014・T017・T020）を分ける（レビューで、移動だけのコミットは差分を読まずに済むように）。
- Threadsの改善のPRが並行して `develop` に入ったら、各PRの前に `develop` を取り込み、移したファイルへの変更を新しい場所に当て直す（§6の決まり）。
- 表示名は、すべてのアプリの画面とアプリの切り替えのほかで変えない（spec FR-017）。`ThreadsGrower` を置き換えるような一括の置換はしない。
