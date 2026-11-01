---

description: "Task list for feature 016 test groups"
---

# Tasks:テスト用のグループ

**Input**: [spec.md](./spec.md)、[plan.md](./plan.md)、[research.md](./research.md)、[data-model.md](./data-model.md)、[contracts/api.md](./contracts/api.md)、[contracts/ui-routes.md](./contracts/ui-routes.md)、[quickstart.md](./quickstart.md)

**Tests**: 001〜015と同じく、テストを先に書いて失敗を確かめてから実装する（TDD）。特に次を自動テストで確かめる。SC-001（入れない人はどのAPIも使えない）、SC-002（同時に押しても上限を超えない）、SC-005（前からいた人を締め出さない）、SC-006（OFFでは何も変わらない）。

**Organization**: User Storyごとに分ける。MVPはUS1（P1）。

## Format: `[ID] [P?] [Story] Description`

- **[P]**:別ファイルで、未完了のタスクに依存せず並行できる。
- **[Story]**: [US1]・[US2]はspec.mdのUser Storyに対応する。
- APIのテストは、既定で`TEST_GROUPS_ENABLED=false`。016のテストは、テストの中で`TEST_GROUPS_ENABLED: "true"`と`OPERATOR_CLERK_USER_IDS`を入れた環境を使う。

## Phase 1: Setup

**Purpose**: 設定・エラーのcode・共通の型。

- [X] T001 [P] `apps/api/src/env.ts`に`TEST_GROUPS_ENABLED: string`（必須）と`OPERATOR_CLERK_USER_IDS?: string`を足し、`apps/api/src/lib/config.ts`の`validateConfig`で`TEST_GROUPS_ENABLED`が`"true"`／`"false"`でなければ`TEST_GROUPS_ENABLED`を問題に入れる。`BillingMode`に`testGroups?: boolean`を足し、`billingModeOf`が`TEST_GROUPS_ENABLED === "true"`を`testGroups`に入れる（列挙外は投げる。`BILLING_ENABLED`と同じ）。`operatorIdsOf(env)`（カンマ区切り・空白を除く・空を捨てる）を足す。テスト：`apps/api/test/unit/config.test.ts`。
- [X] T002 [P] `apps/api/wrangler.toml`の`[vars]`（手元）・`[env.staging.vars]`・`[env.production.vars]`に`TEST_GROUPS_ENABLED`（手元`"false"`・staging`"true"`・production`"false"`）、`apps/api/.dev.vars.example`に`TEST_GROUPS_ENABLED="false"`と`OPERATOR_CLERK_USER_IDS`の説明、APIのテストの環境（`apps/api/test/env.ts`など、`BILLING_ENABLED`を入れている所）に`TEST_GROUPS_ENABLED: "false"`、E2Eの環境（`BILLING_ENABLED`を入れている所）に`"false"`を足す。
- [X] T003 [P] `packages/shared/src/errors.ts`に`TEST_ACCESS_REQUIRED`・`TEST_INVITE_INVALID`・`TEST_GROUP_FULL`・`TEST_GROUP_ALREADY_MEMBER`・`TEST_GROUP_CLOSED`・`TEST_GROUP_CAPACITY_INVALID`・`OPERATOR_ONLY`とcontracts/api.mdの文言を足す。`packages/shared/src/billing.ts`の`ReadOnlyReason`に`test_access`を足す。
- [X] T004 [P] `packages/shared/src/schemas.ts`に、`meResponseSchema`の`testGroups: { enabled, admitted, operator }`、`testInvitePreviewSchema`、`testInviteJoinResponseSchema`（`{ groupId }`）、`testGroupSummarySchema`・`testGroupDetailSchema`（members・events）・`testGroupListSchema`、入力`testGroupCreateRequestSchema`（`name`は前後の空白を除いて1〜50文字、`capacity`は整数1〜1000）と`testGroupUpdateRequestSchema`（どちらも任意、少なくとも1つ）を足す。テスト：`packages/shared/test/schemas.test.ts`（範囲の境）。

## Phase 2: Foundational

**Purpose**: DBと「入れる人」の判定。US1・US2の前に要る。

- [X] T005 `apps/api/src/db/schema.ts`に`users.signedUpOpen`（`signed_up_open` boolean NOT NULL 既定 true）、`testGroups`（`name` CHECK 1〜50文字、`capacity` CHECK 1〜1000、`invite_token_hash` UNIQUE、暗号文・IV・鍵の版、`invite_rotated_at`、`closed_at`、`created_by_user_id`（削除でNULL）、timestamps）、`testGroupMembers`（`user_id`主キー・削除でcascade、`group_id`削除でcascade、`joined_at`、`granted_billing_exempt`、`group_id`の索引）、`testGroupEvents`（`action` CHECK `created`・`renamed`・`capacity_changed`・`invite_rotated`・`closed`・`member_joined`・`member_removed`、`actor_user_id`削除でNULL、`actor_name` NOT NULL、`subject_name`、`details` jsonb、`created_at`、`(group_id, created_at desc)`の索引）を足す（data-model.md）。`pnpm --filter api db:generate`で`apps/api/drizzle/0016_test_groups.sql`を作る（既定が true なので、今ある行は true になる。PR #37 のセルフレビューで、末尾の UPDATE から既定 true に変えた）。
- [X] T006 `apps/api/test/integration/migration-0016.test.ts`：マイグレーションの前からある`users`の行が`signed_up_open = true`になること、新しい行の既定が false であることを確かめる（013の`migration-0014.test.ts`の形）。
- [X] T007 `apps/api/src/services/test-group-service.ts`を作り、`testAccessSql(u)`（data-model.mdの条件。`u`は`users`か別名）を置く。`apps/api/src/services/billing-service.ts`の`BillingFacts`に`testAccess?: boolean`を足し、`entitlementFromFacts`は`mode.testGroups && facts.testAccess === false`なら`{ ...e, state: "read_only", fullAccess: false, readOnlyReason: "test_access", accountLimit: 0 }`を返す。`fullAccessSql`は`mode.testGroups`なら`testAccessSql(users)`をANDで足す（決済OFFならそれだけを返す）。`loadEntitlement`・`loadOwnerEntitlement`は`testAccess`を一緒に読む。テスト：`apps/api/test/unit/billing-entitlement.test.ts`（あれば）と`apps/api/test/integration/billing-sql-parity.test.ts`に、入れる・入れない×決済ON/OFFの行を足す。
- [X] T008 `apps/api/src/services/access.ts`（`authorizeAccount`のオーナーの行）・`apps/api/src/services/auto-post-runner.ts`（候補）・`apps/api/src/services/metrics-runner.ts`（2つの候補とJSの判定）で、`ownerTestAccess: testAccessSql(ownerU/users)`を読み、`entitlementFromFacts`に`testAccess`として渡す。テスト：`apps/api/test/integration/test-groups-jobs.test.ts`に、ONの環境で入れないオーナーのアカウントは自動投稿が`billing_inactive`で飛ばされ、反応の取り込みの候補に入らないこと、入れるオーナーは今までどおりであること、OFFでは変わらないことを書く。

## Phase 3: User Story 1 -運営者が、組織ごとに人数を決めてテスト環境を渡す（P1）🎯 MVP

**Goal**: グループの招待リンクから「参加する」を押した人だけが、料金なしでテスト環境を使える。上限を超えない。

**Independent Test**: 上限2人のグループの招待リンクで2人が入れて、3人目が入れず、リンクなしの人は使えず、入った人に料金が求められない（spec US1）。

### Tests for User Story 1

- [X] T009 [P] [US1] `apps/api/test/integration/test-groups-gate.test.ts`：ONの環境で、(1)新しく作られた利用者は`signed_up_open = false`、OFFでは true、(2)入れない人は`GET /api/me`（`testGroups.admitted = false`）・退会のプレビュー・招待のAPIだけ通り、ほかの代表的なAPI（`POST /api/accounts`、`GET /api/billing`、`GET /api/invites/:token`、`GET /api/me/needs-review-counts`）は`403 TEST_ACCESS_REQUIRED`、(3)`signed_up_open`の人・グループの人・運営者は通る、(4)閉じたグループの人は通らない、(5)OFFでは誰も止まらない、を確かめる。
- [X] T010 [P] [US1] `apps/api/test/integration/test-invites.test.ts`：確認（未ログイン・`can_join`・`full`・`already_member`・使えない文字列・作り直した前の文字列・閉じた・OFFは404）、参加（入る・料金なしの印が付き`granted_billing_exempt = true`・もともと印がある人は`granted = false`・定員で`TEST_GROUP_FULL`・すでに入っていれば`TEST_GROUP_ALREADY_MEMBER`とグループ名・同時に5人が押しても上限3を超えない・記録`member_joined`）。

### Implementation for User Story 1

- [X] T011 [US1] `apps/api/src/middleware/auth.ts`：JITの作成で`signedUpOpen: !billingModeOf(env).testGroups`を入れる。ONなら、利用者の行を読む問い合わせで`testAccess: testAccessSql(users)`も読み、運営者（`operatorIdsOf(env)`にClerkのIDがある）も入れる人とする。入れない人は、`TEST_ACCESS_ALLOWED`（`GET /api/me`・`GET /api/me/withdrawal-preview`・`POST /api/me/withdraw`）と`/api/test-invites/`で始まるパスのほかを`403 TEST_ACCESS_REQUIRED`にする。`c.set("user")`に`testAccess: { admitted, operator }`を足す（OFFなら`{ admitted: true, operator: false }`）。
- [X] T012 [US1] `apps/api/src/services/test-group-service.ts`に、招待の文字列（`g_`＋32バイトのbase64url、`/^g_[A-Za-z0-9_-]{43}$/`、ハッシュと暗号化した写し。`invite-service.ts`の`newInviteToken`・`sealInviteToken`・`openInviteToken`と同じ作り）、`testInviteUrl(env, token)`（`WEB_ORIGIN/test-invite/{token}`）、`previewTestInvite(env, token, viewer)`、`joinTestGroup(env, user, token)`（グループの行に`FOR UPDATE`→閉じていない→すでに入っていない→人数<上限→行を入れる→料金なしの印→記録。research.md R3・R7）、`recordEvent(tx, …)`、`personName`を使った名前を足す。
- [X] T013 [US1] `apps/api/src/routes/test-invites.ts`（`GET /test-invites/:token`はログイン任意・`no-store`、`POST /test-invites/:token/join`はログイン必須。OFFなら`404 TEST_INVITE_INVALID`）を作り、`apps/api/src/app.ts`に足す。`apps/api/src/routes/me.ts`に`testGroups`を足す。
- [X] T014 [US1] `apps/api/src/services/billing-service.ts`の`setBillingExemptByEmail`：印を付けたら、その人の`test_group_members.granted_billing_exempt`を false にする（research.md R7）。テスト：`apps/api/test/integration/set-billing-exempt.test.ts`（あれば足す）。
- [X] T015 [P] [US1] `apps/web/src/lib/api-client.ts`：`TEST_ACCESS_REQUIRED`の受け口（退会の途中と同じ形の`setTestAccessRequired`・`getTestAccessRequired`・`subscribeTestAccessRequired`）。`api.me`で`testGroups.enabled && !testGroups.admitted`なら立てる。`previewTestInvite`・`joinTestGroup`を足す。`apps/web/src/lib/query.ts`に`queryKeys.testInvite(token)`。
- [X] T016 [P] [US1] `apps/web/src/components/TestAccessRequired.tsx`（contracts/ui-routes.md 2）と、`apps/web/src/components/guards.tsx`の`RequireAuth`で、退会の途中の次に、入れない人ならこの画面を出す。テスト：`apps/web/test/test-access.test.tsx`。
- [X] T017 [US1] `apps/web/src/pages/test-invite.tsx`（contracts/ui-routes.md 1）と`apps/web/src/router.tsx`の`/test-invite/:token`（`RequireAuth`の外）。参加したら`me`を読み直し、`setTestAccessRequired(false)`、`/`へ置き換え遷移。テスト：`apps/web/test/test-invite.test.tsx`（未ログイン・参加できる・押した後・定員・すでに入っている・使えない）。
- [X] T018 [P] [US1] 読むだけの理由`test_access`の文言を、`ReadOnlyReason`で分けている画面（`apps/web/src/pages/settings/billing.tsx`・`apps/web/src/pages/account-new.tsx`など、型の誤りで見つかる所）に足す（「テスト版を使えなくなったため、読むだけです」）。
- [X] T019 [US1] Webのテストの共通の`me`（`apps/web/test/helpers/billing.ts`の`ME_BILLING_OFF`など、`MeResponse`を作っている所）に`testGroups: { enabled: false, admitted: true, operator: false }`を足す。

**Checkpoint**: US1は単独で動く（運営者のグループはテストの準備の関数で作る）。

## Phase 4: User Story 2 -運営者が、グループの人数と人を管理する（P2）

**Goal**: 運営者だけが、グループを作る・見る・名前と上限を変える・人を外す・リンクを作り直す・閉じる。

**Independent Test**: 上限を上げると入れる、外すと使えなくなり印が外れる、閉じると全員使えなくなる（spec US2）。

### Tests for User Story 2

- [X] T020 [P] [US2] `apps/api/test/integration/operator-test-groups.test.ts`：運営者でない人は`403 OPERATOR_ONLY`、OFFは`404 NOT_FOUND`。作る（名前・上限の範囲の誤りは`VALIDATION_FAILED`か`TEST_GROUP_CAPACITY_INVALID`）、一覧（人数・リンク・閉じたものは後ろ・閉じたらリンクは null）、詳しく（人の入った順・記録の新しい順50件）、名前と上限を変える（今の人数より少なくしても人は外れない・`capacity_changed`の記録）、作り直す（前の文字列は`TEST_INVITE_INVALID`）、外す（入れない人になる・`granted`なら印が外れ・手で付けた印は残る・`member_removed`）、閉じる（全員外れる・印が戻る・閉じたグループは変えられず`TEST_GROUP_CLOSED`・閉じた人は別のグループに入れる）。

### Implementation for User Story 2

- [X] T021 [US2] `apps/api/src/services/test-group-service.ts`に`listTestGroups`・`createTestGroup`・`testGroupDetail`・`updateTestGroup`・`rotateTestGroupInvite`・`closeTestGroup`・`removeTestGroupMember`（どれも1つのトランザクション、グループの行に鍵、記録を残す。外す・閉じるは`granted_billing_exempt`の人だけ印を戻す）を足す。
- [X] T022 [US2] `apps/api/src/routes/operator-test-groups.ts`（contracts/api.md「運営者のAPI」）を作り、`apps/api/src/app.ts`に足す。運営者の判定は`c.get("user").testAccess.operator`、OFFは`404 NOT_FOUND`。
- [X] T023 [P] [US2] `apps/web/src/lib/api-client.ts`に運営者のAPIを足し、`apps/web/src/lib/query.ts`に`queryKeys.testGroups`・`queryKeys.testGroup(id)`を足す。
- [X] T024 [US2] `apps/web/src/pages/settings/sections.ts`に「運営」の区分（`test-groups`・「テスト用のグループ」）を足し、`apps/web/src/pages/settings/settings-layout.tsx`で運営者（`me.testGroups.operator`）にだけ出す。`apps/web/src/router.tsx`に`/settings/test-groups`と`/settings/test-groups/:groupId`。
- [X] T025 [US2] `apps/web/src/pages/settings/test-groups.tsx`：一覧・「グループを作る」のダイアログ・詳しい画面（名前と上限を変える・リンクのコピーと作り直し・人を外す・閉じる・記録）。contracts/ui-routes.md 3の文言と確認。テスト：`apps/web/test/test-groups.test.tsx`（運営者でない・一覧・作る・外すの確認・閉じるの確認）。

## Phase 5: Polish & Cross-Cutting Concerns

- [X] T026 [P] `docs/staging-setup-record.md`と`docs/external-services-setup.md`に、`TEST_GROUPS_ENABLED`（staging`"true"`・production`"false"`）と`OPERATOR_CLERK_USER_IDS`（`wrangler secret put … --env staging`）の入れ方を足す。`docs/user-guide.md`の「テスト版について」に、招待されたグループのリンクから入ることを足す。
- [X] T027 `pnpm test`・`pnpm typecheck`・`pnpm lint`・`pnpm --filter web build`を通す。OFFの既存のテストが変わらないこと（SC-006）。
- [ ] T028 quickstart.mdの「2. 手元で試す」を、手元で`TEST_GROUPS_ENABLED="true"`にして画面で通す（できる範囲。Googleのログインが要る所は、テストで代える）。※2026-11-01時点で未実施。Googleのログインが要るため、自動テスト（API・Web）で代えた。ユーザーが起きてから手で確かめる

## Dependencies & Execution Order

- Phase 1（T001〜T004）は並行できる。
- Phase 2（T005→T006、T005→T007→T008）はUS1・US2の前。
- US1：T009・T010（テスト）→T011〜T014（API）→T015〜T019（Web）。
- US2：US1のT012（招待の文字列の作り）の後。T020→T021→T022→T023〜T025。
- Polish は最後。

## Parallel Example: User Story 1

```text
T009（入れない人の止め方のテスト）と T010（招待のテスト）は別ファイルで並行できる。
T015（api-client）・T016（入れない人の画面）・T018（文言）は別ファイルで並行できる。
```

## Implementation Strategy

1. Phase 1・2で、設定・DB・判定を作る（OFFでは何も変わらないことを、既存のテストで確かめる）。
2. US1でテスト環境を閉じ、招待で入れるようにする（ここで出してもよい。グループはSQLで作れる）。
3. US2で運営者の画面を作る。
4. Polishで文書と全体のテスト。
