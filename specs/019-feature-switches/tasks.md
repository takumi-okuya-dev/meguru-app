---

description: "Task list for feature 019 feature switches"
---

# Tasks:機能のまとまりごとのON/OFF

**Input**: [spec.md](./spec.md)、[plan.md](./plan.md)、[research.md](./research.md)、[data-model.md](./data-model.md)、[contracts/api.md](./contracts/api.md)、[contracts/ui-routes.md](./contracts/ui-routes.md)、[quickstart.md](./quickstart.md)

**Tests**: 001〜018と同じく、テストを先に書いて失敗を確かめてから実装する（TDD）。特に次を自動テストで確かめる。
- SC-002：使えないまとまりの内容が、画面・プロンプト・APIのどこからも出ない。自動投稿が使えないAccountでは新しい公開が0件
- SC-003：設定のない人で、プロンプトの文と自動投稿の動きが変わらない
- SC-004：ONに戻すと、書いた内容がそのまま出る

**Organization**: 2026-11-04 の見直し（まとまりを自動投稿・戦略・チームに、グループごとの設定を足す）で書き直した。最初の版（戦略・投稿をつくる・パフォーマンス）で作ったもののうち、そのまま使えるものは [X] のまま残し、作り直すものは新しいタスクにした。MVPはUS1〜US3（P1）。

## Format: `[ID] [P?] [Story] Description`

- **[P]**：別ファイルで、未完了のタスクに依存せず並行できる。
- **[Story]**：[US1]〜[US4]はspec.mdのUser Storyに対応する。
- APIのテストは、016の`apps/api/test/integration/operator-test-groups.test.ts`・`access.test.ts`と同じ形で書く。部品は`apps/api/test/helpers/features.ts`（OFFの行を直接入れる・運営者の環境）。
- Webのテストは`apps/web/test/feature-switches.test.tsx`（出し分け）と`apps/web/test/settings-features.test.tsx`（運営者の画面）に書く。
- 画面はモック（https://claude.ai/artifact/XbnRAoVcfS7HCprqHfrrqi 、2026-11-04 OK）のとおり。文字は短く、説明は閉じたトグルの箇条書き。ボタンは今の画面にそろえる（docs/ui-design.md §6）。

## Phase 1: Setup

- [X] T001 `packages/shared/src/features.ts`（`FEATURES`・`FEATURE_LABELS`・`isFeature`・`FEATURE_EVENT_ACTIONS`・`FEATURE_EVENTS_LIMIT`）と`packages/shared/test/features.test.ts`を作る。
- [X] T002 [P] `packages/shared/src/errors.ts`に`FEATURE_DISABLED`（403）と`USER_NOT_FOUND`（404）と文言を足す。
- [X] T003 `FEATURES`を`["autopost", "strategy", "team"]`、`FEATURE_LABELS`を「自動投稿」「戦略」「チーム」に直す（`packages/shared/src/features.ts`・`packages/shared/test/features.test.ts`）。

## Phase 2: Foundational

### Tests（先に書いて失敗を確かめる）

- [X] T004 [P] `apps/api/test/migration/migration-0018.test.ts`を、data-model.md のとおり3つの表に直す：`group_feature_disables`（主キー`(group_id, feature)`、グループを消すと消える）、`feature_setting_events`の`subject_group_id`と CHECK `feature_setting_events_one_subject`（人とグループのちょうど一方）、まとまりの CHECK が新しい3つ。
- [X] T005 [P] `apps/api/test/integration/feature-access.test.ts`を、新しいまとまりで書き直し、次を足す（research.md R1・R10）：
  - グループでOFFなら、そのグループの人は使えない。グループから外れる・グループを閉じると使える（FR-018）
  - チーム経由の関わり：オーナーか見る人の`team`が使えなければ`404 ACCOUNT_NOT_FOUND`。オーナーの関わりは`team`がOFFでも404にならない
  - `authorizeTeamMember`：見る人の`team`が使えなければ`403 FEATURE_DISABLED`
- [X] T006 [P] `apps/api/test/integration/operator-flag.test.ts`に足す：`/api/me`の`features`（人 ∪ グループ）、`team`が使えない人の`teams`が空で、担当しているAccountが`accounts`に出ない。

### Implementation

- [X] T007 `feature_disables`・`feature_setting_events`の表と`0018`のマイグレーション（最初の版）。
- [X] T008 `apps/api/src/db/schema.ts`に`group_feature_disables`を足し、`feature_setting_events`に`subject_group_id`（`test_groups.id`、削除でcascade）と CHECK を足し、`subject_user_id`を NULL 可にする。`apps/api/drizzle/0018_feature_switches.sql`と`drizzle/meta`を作り直す（まだどこにも出していないので、0018 を直してよい）（T004を通す）。
- [X] T009 `apps/api/src/services/feature-sql.ts`を作り、`disabledFeaturesSql(userId)`・`featureOnSql(userId, feature)`を置く（data-model.md「判定」）。`apps/api/src/services/access.ts`の`authorizeAccount`をこれに替え、オーナーと見る人の両方を読む。チーム経由の関わりの`team`、`authorizeTeamMember`の`team`を足す（T005を通す）。
- [X] T010 認証のミドルウェアの`user.operator`、`/api/me`の`operator`、`/access`の`features`（`apps/api/src/middleware/auth.ts`・`routes/me.ts`・`routes/account-team.ts`）。
- [X] T011 `apps/api/src/middleware/auth.ts`で`user.features`（自分の使えるまとまり）を同じSELECTで読み、`apps/api/src/routes/me.ts`で`features`を返し、`team`が使えなければ`teams`を空に、担当しているAccountを`accounts`から外す（T006を通す。`packages/shared/src/schemas.ts`の`me`に`features`）。
- [X] T012 [P] `apps/web/src/components/FeatureUnavailable.tsx`（`FeatureUnavailable`・`RequireFeature`）、`apps/web/src/lib/save-error.ts`の`isFeatureDisabled`、`ApiErrorScreen`の`FEATURE_DISABLED`、`apps/web/test/feature-unavailable.test.tsx`。

**Checkpoint**: 判定が新しい3つのまとまりと、人 ∪ グループで動き、設定のない人では何も変わらない。

## Phase 3: User Story 1 -運営者が、ある人の戦略をOFFにする（P1）🎯 MVP

### Tests（先に書いて失敗を確かめる）

- [X] T013 [P] [US1] `apps/api/test/integration/feature-switches-routes.test.ts`を、contracts/api.md「守るAPI」の表で書き直す（`autopost`・`strategy`・`team`の各API、`/profile-status`は通る、ONに戻すとそのまま）。
- [X] T014 [P] [US1] `apps/api/test/integration/prompt-features.test.ts`から`performance`の項目を外す（低調な投稿はいつもどおり入る）。
- [X] T015 [P] [US1] `apps/api/test/integration/feature-autopost-jobs.test.ts`を作る（research.md R12、FR-008）：`autopost`が使えないオーナーのAccountは、時刻の処理で試みを作らず、公開の直前の確かめで公開せず（`auto_post_off`）、反応を取り込まない。グループでOFFでも同じ。ONに戻すと次の時刻から投稿する。公開の結果がわからない途中の投稿は確かめる。
- [X] T016 [P] [US1] `apps/api/test/integration/feature-team.test.ts`を作る（research.md R13、FR-009）：`team`が使えない人はチームを作れず（`POST /api/teams`）、招待から入れず（`POST /api/invites/:token/accept`）、チームの画面のAPIが`FEATURE_DISABLED`。チーム・担当・見せる設定の行は残り、ONに戻すと元どおり使える。
- [X] T017 [P] [US1] 運営者のAPI（探す・保存）のテスト`apps/api/test/integration/operator-features.test.ts`（最初の版）。
- [X] T018 [US1] `apps/api/test/integration/operator-features.test.ts`を新しいまとまりに直し、`GET /api/operator/users`の`group`（グループの名前と、グループの設定でOFFのまとまり）を足す。

### Implementation（API）

- [X] T019 [US1] 守るAPIを contracts/api.md の表に直す（T013を通す）：`performance.ts`・`prompt.ts`・`post-drafts.ts`・`posting-schedule.ts`・`posting-rules.ts`・`auto-post.ts`に`{ feature: "autopost" }`、`teams.ts`・`activity.ts`・`account-team.ts`の`/team`に`team`。チームを作る・招待から入るは`user.features`で`FEATURE_DISABLED`。
- [X] T020 [US1] `apps/api/src/services/prompt-service.ts`から`performance`の扱いを外す（T014を通す）。
- [X] T021 [US1] `apps/api/src/services/auto-post-runner.ts`・`metrics-runner.ts`に`featureOnSql(owner, "autopost")`を足し、`publish-claim.ts`・`publish-executor.ts`で`autopost`が使えなければ新しく公開しない（T015を通す。`fullAccessSql`には混ぜない）。
- [X] T022 [US1] `apps/api/src/services/feature-service.ts`を新しいまとまりに直し、`findUserByEmail`に`group`を足す（T018を通す。`packages/shared/src/schemas.ts`の`featureSettingsRequestSchema`・`operatorUserSchema`）。

### Tests（Web。先に書いて失敗を確かめる）

- [X] T023 [P] [US1] `apps/web/test/feature-switches.test.tsx`を新しいまとまりで書き直す（contracts/ui-routes.md 1〜3）：サイドバーの並び（ホーム → 自動投稿 → 戦略 → チーム、「分析」なし）と区分ごとの出し分け、ホーム（自動投稿が使えないと次の投稿のカード・「投稿をつくりましょう」が出ない）、投稿をつくる（戦略の出し分け）、このアカウントの設定（自動投稿・チームの区分）、チームで見せてもらっている画面（タブ）、直接開いたとき（`/create`・`/stock`・`/performance`・`/strategy`…）。
- [X] T024 [P] [US1] `apps/web/test/settings-features.test.tsx`を作る（contracts/ui-routes.md 4）：「運営」の区分の出し分け（`me.operator`、「グループ」はどの環境でも）、探す・見つからない、3つのスイッチと保存、「グループ：〇〇」と「グループでOFF」、「この画面について」のトグル。

### Implementation（Web）

- [X] T025 [US1] `apps/web/src/components/layout/Sidebar.tsx`を新しい並びにし、「自動投稿」「戦略」は`access.features`、「チーム」は`me.features`で出し分ける。`apps/web/src/router.tsx`の`RequireFeature`を`create`・`stock`・`performance`（autopost）、`strategy`・`promotions`・`research`（strategy）、`activity`（team）にする。
- [X] T026 [US1] 出し分けを直す：`apps/web/src/pages/account-home.tsx`（自動投稿：次の投稿のカード・自動投稿の知らせ・作る案内）、`pages/create.tsx`（「貼る欄だけ」をやめる）、`pages/account-settings.tsx`（自動投稿・チームの区分）、`pages/team-shared-account.tsx`（投稿ストックと戦略のタブ）、`components/layout/AccountSwitcher.tsx`（必要なら）。
- [X] T027 [US1] `apps/web/src/pages/settings/features.tsx`を作り、`pages/settings/sections.ts`・`settings-layout.tsx`・`router.tsx`をつなぐ（T024を通す）。

**Checkpoint**: 運営者が人を探して戦略（自動投稿・チーム）をOFFにすると、その人の画面・プロンプト・APIから消え、ONに戻すとそのまま使える。

## Phase 4: User Story 2 -何もしなければ、今までどおりすべて使える（P1）

- [X] T028 [P] [US2] `apps/api/test/integration/feature-defaults.test.ts`を新しいまとまりに直す（プロンプトの全文が同じ、新しく登録した人の`features`が3つ、決済の読むだけはゆるまない）。
- [X] T029 [US2] 全体のテスト（API・Web）を通す。既存のテストの書き換えは、サイドバーの並びの変更と、016の「OFFの環境ではグループを使えない」の振る舞いの変更（FR-017・FR-019）だけにし、PR に理由を書く。

## Phase 5: User Story 3 -運営者が、組織（グループ）ごとにON/OFFする（P1）

- [X] T030 [P] [US3] `apps/api/test/integration/test-groups-production.test.ts`を作る（research.md R11、FR-017・FR-019）：招待制がOFFでも、運営者がグループを作れ、招待の確認（`testVersion: false`）と参加ができる。参加しても料金なしの印は付かない。グループに入っていない人も今までどおり使える。
- [X] T031 [P] [US3] `apps/api/test/integration/operator-group-features.test.ts`を作る：`PUT /api/operator/test-groups/:groupId/features`で保存し、詳しい内容の`disabled`に出る。変わったまとまりごとに記録（`subjectKind: "group"`）。閉じたグループは`409 TEST_GROUP_CLOSED`。グループの全員に効く。
- [X] T032 [US3] `apps/api/src/routes/test-invites.ts`・`operator-test-groups.ts`の「招待制がOFFなら使えない」守りを外し、運営者の判定を`user.operator`に替える。`apps/api/src/services/test-group-service.ts`の`joinTestGroup`で、料金なしの印は招待制がONのときだけ付ける。招待の確認に`testVersion`を足す（T030を通す）。016の`test-groups-gate.test.ts`・`operator-test-groups.test.ts`の「OFFの環境」の項目を新しい振る舞いに書き換える。
- [X] T033 [US3] グループの設定の保存（`apps/api/src/services/feature-service.ts`の`saveGroupFeatures`）と、詳しい内容の`disabled`（`test-group-service.ts`）、`PUT /api/operator/test-groups/:groupId/features`（T031を通す）。
- [X] T034 [P] [US3] `apps/web/test/test-groups.test.tsx`に足す：設定の項目名が「グループ」、詳しい画面の「使える機能」（3つのスイッチと保存。閉じたグループには出ない）、招待リンクの説明はテスト版でだけ。`apps/web/test/test-invite.test.tsx`に、本番（`testVersion: false`）ではテスト版の注意を出さないことを足す。
- [X] T035 [US3] `apps/web/src/pages/settings/test-groups.tsx`・`pages/test-invite.tsx`・`pages/settings/sections.ts`を直す（T034を通す）。

## Phase 6: User Story 4 -運営者が、誰がOFFになっているかを確かめる（P2）

- [X] T036 [P] [US4] 一覧・すべてONに戻す・最近の変更のAPIのテスト（最初の版）。
- [X] T037 [US4] 一覧・すべてONに戻す・最近の変更のAPI（最初の版）。
- [X] T038 [US4] 最近の変更にグループの変更を含める（`subjectKind`）。`apps/api/test/integration/operator-features.test.ts`と`feature-service.ts`。
- [X] T039 [P] [US4] `apps/web/test/settings-features.test.tsx`に足す：「OFFの人」の一覧（いなければ「OFFの人はいません」）、「すべてONに戻す」の確認のダイアログ、「最近の変更」のトグル（人とグループ）。
- [X] T040 [US4] `apps/web/src/pages/settings/features.tsx`に、「OFFの人」・「すべてONに戻す」・「最近の変更」を足す（T039を通す）。

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T041 [P] `docs/environment-switches.md`・`docs/staging-setup-record.md`を、`OPERATOR_CLERK_USER_IDS`（どの環境でも機能の設定とグループ）と`TEST_GROUPS_ENABLED`（OFFでもグループは使える。招待制と料金なしだけを切り替える）に合わせて直す。
- [X] T042 [P] `docs/ui-design.md`に、サイドバーの新しい並び・まとまりの出し分け・運営者の「使える機能」とグループの「使える機能」を書く。
- [X] T043 [P] `docs/user-guide.md`・`docs/architecture.md`・`docs/next-features.md`を、新しいまとまりとグループごとの設定に合わせて直す（共有用の文書なので、アカウントのID・テスト版のURL・秘密の値は書かない）。
- [X] T044 `.specify/memory/constitution.md`の先頭の Sync Impact Report を消す。
- [X] T045 全体のテスト・lint・型チェック・Webのビルドを通す（`pnpm --filter ./packages/shared test`、`pnpm --filter ./apps/api test`、`pnpm --filter ./apps/web test`、`pnpm lint`、`pnpm -r exec tsc --noEmit`、`pnpm --filter ./apps/web build`）。
- [X] T046 quickstart.md の「テスト版で確かめる」を、マージのあとにユーザーとテスト版で通す。

## Dependencies & Execution Order

- Phase 1（T003）が最初。
- Phase 2：T004〜T006（テスト）は並行できる → T008（表）→ T009（判定）→ T011（自分のまとまり）。US1〜US4の前。
- US1：API のテスト（T013〜T016・T018）は並行できる → T019〜T022。Web のテスト（T023・T024）→ T025〜T027。
- US2：US1 のあと、全体で通す（T029）。
- US3：Phase 2 のあと。T030・T031 → T032・T033。T034 → T035。
- US4：US1 の T022・T027 のあと。
- Polish は最後。T041〜T043 は並行できる。T046 はマージのあと。

## Implementation Strategy

1. Phase 1・2 で、まとまりを3つに直し、人 ∪ グループの判定を作る。
2. US1 で、守るAPI・定期処理・チーム・運営者のAPIと画面を直す。
3. US2 で、全体のテストを通す。
4. US3 で、グループを本番でも使えるようにし、グループごとの設定を足す。
5. US4 で、一覧と最近の変更をグループに広げる。
6. Polish で文書と全体のテスト。マージの直前に最新の develop を取り込み、PR の CI を通してから、マージのOKをもらう。
