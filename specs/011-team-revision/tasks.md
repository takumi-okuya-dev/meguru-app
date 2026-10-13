---

description: "Task list for feature 011 team revision"
---

# Tasks:チームの見直し

**Input**: [spec.md](./spec.md)、[plan.md](./plan.md)、[research.md](./research.md)、[data-model.md](./data-model.md)、[contracts/permissions.md](./contracts/permissions.md)、[contracts/api.md](./contracts/api.md)、[contracts/ui-routes.md](./contracts/ui-routes.md)、[quickstart.md](./quickstart.md)

**Tests**: 001〜010と同じく、テストを先に書いて失敗を確かめてから実装する（TDD）。特にSC-002（関わり×権限の表）、SC-003（見せる設定と別のチーム）、SC-004（管理者がいないチームを作らない）、SC-005（個人運用の画面が変わらない）、SC-006（008のデータを消した後の件数）、SC-007（3人のE2E）を自動テストで確かめる。

**Organization**: User Storyごとに分ける。MVPはUS1＋US2＋US3（どれもP1）。

## Format: `[ID] [P?] [Story] Description`

- **[P]**:別ファイルで、未完了のタスクに依存せず並行できる。
- **[Story]**: [US1]〜[US5]はspec.mdのUser Storyに対応する。
- すべてのタスクに、変更または確認する正確なパスを書く。

## Phase 1: Setup

**Purpose**:定数・エラーのcode・権限の表。

- [ ] T001 [P] `packages/shared/src/limits.ts`に`TEAM_MEMBER_LIMIT = 50`・`TEAMS_PER_ADMIN = 20`を足す（`TEAM_EDITOR_LIMIT = 10`・`TEAM_NAME_MAX = 50`は008のまま）。`packages/shared/src/errors.ts`にcode `TEAM_LIMIT_REACHED`・`TEAM_FULL`・`TEAM_NEEDS_ACCOUNT`・`ACCOUNT_IN_OTHER_TEAM`・`TEAM_LAST_ACCOUNT`・`TEAM_ADMIN_MUST _TRANSFER`・`TEAM_ADMIN_ALONE`と文言を足し、`PARTNER_ALREADY_EXISTS`・`INVITE_SELF`・`TEAM_EDITOR_LIMIT`を消す（contracts/api.md「新しいエラーコード」）。`packages/shared/test/errors.test.ts`に文言のテストを足す。
- [ ] T002 [P] `packages/shared/test/permissions.test.ts`を先に書き直し、`packages/shared/src/permissions.ts`を関わり（`Relation`：`owner`・`assigned`・`shared_viewer`）と権限`read`の形にする：`permissionsFor(relation, { isTeamAdmin })`（owner＝すべて、assigned＝`read`・`view`・`content`（管理者なら`activity`も）、shared_viewer＝`read`だけ）。`Delegation`と委任の引数を消す（contracts/permissions.md「権限」）。

---

## Phase 2: Foundational（すべてのStoryの前提）

**Purpose**: DB・判定・008の片付け。ここが終わるまでStoryに入らない。

- [ ] T003 `apps/api/src/db/schema.ts`をdata-model.mdのとおりにする：列挙型`team_role`（`admin`・`member`・`editor`）、`membership_role`に`admin`を足す、`teams`の作り直し（`name` NOT NULL「1〜50文字」、`admin_user_id` NOT NULL、招待リンクのハッシュ（UNIQUE）・暗号化した写し・鍵の版・`invite_rotated_at`）、`team_members`（主キー（`team_id`・`user_id`）、部分一意索引`team_members_one_admin`（`WHERE role = 'admin'`）、`joined_notice_dismissed_at`）、`team_accounts`（主キー（`team_id`・`account_id`）、一意索引`team_accounts_one_team_per_account`（`account_id`）、`shared` NOT NULL DEFAULT false、`added_by_user_id`）、`memberships.assigned_notice_dismissed_at`。`account_partners`・`account_partner_invites`・`team_editors`を消す。`pnpm --filter api db:generate`で`apps/api/drizzle/0012_team_revision.sql`を作り、その先頭で`DELETE FROM memberships WHERE role IN ('partner','editor')`を行う（列挙型の値の追加は別の文に分ける）。`apps/api/test/helpers/app.ts`の`resetDb`のTRUNCATEを新しい表に合わせる。
- [ ] T004 `apps/api/test/integration/migration-0012.test.ts`を作る：008の形のデータ（パートナー・編集者・担当・任せる範囲・招待）を入れた状態からマイグレーションを当て、`accounts`・`post_drafts`・`strategy_designs`・`activity_logs`の件数が同じで、`memberships`に`partner`・`editor`の行が残らないことを確かめる（SC-006、research.md R2）。テスト用のDBに、0011までを当ててからデータを入れて0012を当てる手順を`apps/api/test/helpers/migrate.ts`に置く。
- [ ] T005 `apps/api/test/helpers/team.ts`を作り直す：`makeTeam(adminClerkId, accountIds)`・`joinTeam(teamId, clerkId, accountIds, { shared })`・`setRole(teamId, clerkId, role)`・`assign(teamId, clerkId, accountId)`・`setShared(teamId, accountId, shared)`。008の`makePartner`・`makeEditor`・`setDelegation`を消す。
- [ ] T006 `apps/api/test/integration/access.test.ts`を先に書き直し、`apps/api/src/services/access.ts`の`authorizeAccount`を4つの関わりにする（1回の問い合わせ。`memberships`の`owner`・`editor`、なければ`team_accounts.shared = true`×同じチームの`team_members`で`shared_viewer`、どれでもなければ`ACCOUNT_NOT_FOUND`）。`AccountAccess`に`relation`・`team`（`{ id, name, myRole } | null`）・`isTeamAdmin`を持たせ、`delegation`・`team.partnerName`を消し、`hasTeam`を「チームに入っている」にする（research.md R3）。`authorizeTeamMember`・`authorizeTeamAdmin`を足し、`authorizeTeam`・`listTeamAccounts`を消す。`authorizeAssignment`を新しい規則（チームのアカウント×編集者・管理者、自分のアカウントは不可）にする（research.md R4、data-model.md「memberships」）。
- [ ] T007 `apps/api/test/integration/permissions-matrix.test.ts`を先に作り直し（関わり：owner・assigned（編集者）・assigned（管理者）・shared_viewer・見せていないチームの人・別のチームの人・関わりなし、チームのAPIの表、ルートの一覧で表にないルートがあれば失敗）、Accountのルートの権限をcontracts/permissions.md「ルートの権限の表」のとおりに直す（`read`に下げる10のGET：`apps/api/src/routes/accounts.ts`・`account-team.ts`・`strategy.ts`・`promotions.ts`・`research.ts`・`post-drafts.ts`）。`review`・`settings`はオーナーだけになることを表で確かめる（SC-002、FR-060）。
- [ ] T008 008のAPIの部品を消す：`apps/api/src/routes/team.ts`（`/api/team/*`）、`apps/api/src/routes/account-team.ts`のパートナーの招待・任せる範囲・参加の知らせ、`apps/api/src/services/partner-summary.ts`、`apps/api/src/services/invite-service.ts`のパートナー・編集者の招待、`apps/api/src/services/team-service.ts`の008の関数、`apps/api/src/services/account-review-counts.ts`と`apps/api/src/routes/me.ts`のパートナーの扱い（担当のアカウントの要確認の件数は残す）、`apps/api/src/services/key-rotation.ts`の招待の鍵の付け替え（新しい`teams`の招待に向ける）。`apps/api/src/app.ts`のルートの登録を直す。008のテスト（`team.test.ts`・`invites.test.ts`・`activity.test.ts`のパートナーの部分、`key-rotation.test.ts`）は、011の形に直すか消す。
- [ ] T009 `packages/shared/src/schemas.ts`の008の型（`partnerTeam`・`editorWaiting`・`AccountTeam`のパートナー・`delegation`・`teamSchema`・パートナーのまとめ）を消し、`/api/me`の`teams: [{ id, name, memberCount, role }]`と、contracts/api.mdのチームの要求・応答のスキーマを足す。`apps/api/src/routes/me.ts`で`teams`を返す（入っているチームを`joined_at`の順。なければ空）。`apps/api/test/integration/me.test.ts`を直す。
- [ ] T010 008のWebの部品を消す：`apps/web/src/pages/partner/*`、`apps/web/src/components/team/EditorWaiting.tsx`・`PartnerJoinedNotice.tsx`・`RemovePartnerDialog.tsx`、`TeamSection.tsx`の招待・任せる範囲・外す、`apps/web/src/router.tsx`の`/partner/*`、`apps/web/src/lib/api-client.ts`・`query.ts`のパートナーのAPI、`apps/web/src/pages/landing.tsx`の待機の案内、`apps/web/src/pages/account-home.tsx`の参加の知らせ。対応するテスト（`partner-accounts.test.tsx`・`partner-editors.test.tsx`・`editor-waiting.test.tsx`、`team-section.test.tsx`の008の部分）を消すか、後のタスクで作り直す。`pnpm --filter web build`が通る状態にする。
- [ ] T011 [P] `apps/api/src/services/activity-log.ts`で`actor_role`に`admin`・`member`を使えるようにし（関わりから決める。research.md R8）、記録を書く条件を「チームに入っているアカウント」にする。`apps/web/src/pages/activity.tsx`に、data-model.md「activity_logs」の新しい`action`の文言と、`partner`の行の「パートナー（008）」を足す。

**Checkpoint**：既存のテスト（008のチームを除く）が通る。個人運用の画面と判定が変わらない。

---

## Phase 3: User Story 1 -管理者がチームを作り、リンクで人を招く(Priority: P1) 🎯 MVP

**Goal**：自分のアカウントを持つ人がチームを作り、招待リンク（チームに1本）を送り、受けた人が自分のアカウントを1つ以上選んでメンバーとして入る。

**Independent Test**：管理者がチームを作り、別の人がリンクから自分のアカウントを選んで参加し、管理者のメンバー一覧に出る。

### Tests for User Story 1

- [ ] T012 [P] [US1] `apps/api/test/integration/teams.test.ts`を作る：`POST /api/teams`（自分のアカウント1つ以上、名前「1〜50文字」、20チームまでで`TEAM_LIMIT_REACHED`、ほかのチームのアカウントで`ACCOUNT_IN_OTHER_TEAM`、アカウントなしで`TEAM_NEEDS_ACCOUNT`）、`GET /api/teams/:teamId`（チームの人だけ、`canOpen`・`isMe`、管理者以外に招待を返さない）、`PATCH`・`DELETE`（管理者だけ。削除でアカウントのデータと記録は残る）、招待の表示と作り直し（前のリンクがすぐ使えない）。
- [ ] T013 [P] [US1] `apps/api/test/integration/invites.test.ts`を作り直す：`GET /api/invites/:token`の`status`（`anonymous`・`needs_account`・`ready`・`already_member`）と、ほかのチームのアカウントの`inOtherTeam`、`POST /api/invites/:token/accept`（1件以上、メンバーになる、選んだアカウントがチームに入り`shared`がそのとおり、同じ人の同時の参加で1回だけ、50人・作り直したリンク・削除したチームで止まる）、平文のトークンを保存しない（FR-011〜FR-016）。

### Implementation for User Story 1

- [ ] T014 [US1] `apps/api/src/services/team-service.ts`を作り直す：`createTeam`（usersの行ロックで20を数え、`teams`・`team_members(admin)`・`team_accounts`を同じトランザクションで書く）・`getTeamDetail`・`renameTeam`・`deleteTeam`（チームの人・アカウント・担当を外し、記録`team_deleted`）。`apps/api/src/services/invite-service.ts`をチームの招待（`t_`で始まる文字列、ハッシュで照合、暗号化した写しで表示、008 R4の仕組み）にし、`previewTeamInvite`・`acceptTeamInvite`（チームの行の`FOR UPDATE`で人数を数える）を作る。
- [ ] T015 [US1] `apps/api/src/routes/teams.ts`を作り（contracts/api.md「チーム」の作る・詳細・名前・削除・招待・作り直す）、`apps/api/src/routes/invites.ts`をチームの招待の確認・参加に直す。`apps/api/src/app.ts`に登録する。
- [ ] T016 [P] [US1] `apps/web/src/lib/api-client.ts`・`apps/web/src/lib/query.ts`にチームと招待のAPIとクエリのキーを足す。
- [ ] T017 [US1] `apps/web/test/sidebar-teams.test.tsx`を先に書き、`apps/web/src/components/layout/Sidebar.tsx`で、今の構造のまま見出し「チーム」の下にチーム名（色の四角・名前・人数）を`/api/me`の`teams`から並べ、その下に「操作の記録」（008の条件のまま）、どれかのチームの管理者に「チームを作る」を出す。チームに入っていなければ何も出さない（contracts/ui-routes.md「サイドバー」、FR-050）。
- [ ] T018 [US1] `apps/web/test/team-page.test.tsx`を先に書き、`apps/web/src/pages/team.tsx`（`/teams/:teamId`）を作る：ヘッダー（チーム名・人数・管理者の操作）、メンバー一覧（名前・「あなた」・ロール・アカウントのチップ、開けるものに「見る」、開けないものは点線の「見せていません」）、管理者の「メンバーを招待」のダイアログ（`apps/web/src/components/team/InviteLinkDialog.tsx`をチームの招待に直す。リンク・コピー・QRコード・送る・作り直す）、管理者のヘッダーの「⋯」の「チーム名を直す」（1〜50文字）と「チームを削除する」（確認のダイアログ、赤のボタン。FR-017）。`apps/web/src/router.tsx`に足す（contracts/ui-routes.md「チームの画面」）。
- [ ] T019 [US1] `apps/web/test/invite-page.test.tsx`を先に作り直し、`apps/web/src/pages/invite.tsx`をチームの招待の確認にする（ログイン前・`needs_account`・`ready`（アカウントを選ぶ、アカウントごとの「チームに見せる」、0件で無効）・`already_member`・無効なリンク（作り直した後の古いリンク・チームの削除の後に「このリンクは使えません」）。contracts/ui-routes.md「招待の確認」）。アカウントの追加の後にリンクへ戻れるよう`apps/web/src/pages/sign-in.tsx`の`safeNext`と`apps/web/src/pages/account-new.tsx`の戻り先に`/invite/t_…`を許す。
- [ ] T020 [US1] `apps/web/test/team-section.test.tsx`を先に作り直し、`apps/web/src/components/team/TeamSection.tsx`を「チーム」の区分にする（チームに入っていなければ「チームに入っていません」と「チームを作る」の1行だけ（Constitution 4.0.1原則Vの例外）、入っていればチーム名へのリンク）。「チームを作る」のダイアログ`apps/web/src/components/team/CreateTeamDialog.tsx`（名前「1〜50文字」と、入れる自分のアカウントを1つ以上選ぶ）を作り、サイドバーからも開く。

**Checkpoint**：チームを作り、リンクで人が入れる。

---

## Phase 4: User Story 2 -管理者がロールを切り替え、編集者に担当を割り当てる(Priority: P1)

**Goal**：管理者がメンバー⇔編集者を切り替え、チームごとの表で担当（編集者と自分）を決める。担当の人は投稿の案を作れるが、承認・設定はできない。

**Independent Test**：管理者がメンバーを編集者にして担当を付け、その人がそのアカウントで案を登録でき、承認はできない。

### Tests for User Story 2

- [ ] T021 [P] [US2] `apps/api/test/integration/team-roles.test.ts`を作る：`PATCH /api/teams/:teamId/members/:userId`（管理者だけ、管理者自身は不可、editor→memberで担当が消える、編集者10人で`TEAM_FULL`）、担当の表の`GET`と`PUT`・`DELETE`（編集者と管理者だけ、自分のアカウントは`ASSIGNMENT_NOT_ALLOWED`、メンバーは不可）、担当の人が案を登録でき（`content`）、登録した案は「要確認」になり、NGワードを含む案はオーナーでも承認できない（FR-005、原則I・II）、承認・設定は`ROLE_FORBIDDEN`、管理者は自分を担当にしたアカウントでだけ作れて、操作の記録が見られる（FR-020〜FR-024、research.md R3）。

### Implementation for User Story 2

- [ ] T022 [US2] `apps/api/src/services/team-service.ts`に`changeRole`・`getAssignments`・`setAssignment`（`memberships`の`editor`の行を、チームの行の`FOR UPDATE`の後に書く）を足し、`apps/api/src/routes/teams.ts`にルートを足す。記録`team_role_changed`・`assignment_added`・`assignment_removed`。
- [ ] T023 [US2] `apps/web/test/team-page.test.tsx`にロールの切り替えのテストを足し、`apps/web/src/pages/team.tsx`の管理者の表にメンバー⇔編集者の切り替え（`aria-pressed`の2つのボタン）とロールの説明を足す。
- [ ] T024 [US2] `apps/web/test/team-assign.test.tsx`を先に書き、`apps/web/src/pages/team-assign.tsx`（`/teams/:teamId/assign`）を作る（行＝編集者と管理者、列＝チームのアカウント、自分のセルは「自分」、`role="checkbox"`の44pxのボタン、注記。contracts/ui-routes.md「担当を決める」）。
- [ ] T025 [US2] `apps/web/test/account-switcher.test.tsx`を直し、`apps/web/src/components/layout/AccountSwitcher.tsx`の見出しを「自分のアカウント」「担当しているアカウント」（オーナー名つき）にする。サイドバーの役割の表示を「担当しています・オーナー：（名前）」にする（`apps/web/src/components/layout/Sidebar.tsx`）。
- [ ] T026 [US2]担当の知らせ：`POST /api/accounts/:accountId/assigned-notice/dismiss`（`apps/api/src/routes/account-team.ts`、テストは`team-roles.test.ts`）と、`apps/web/src/components/team/AssignedNotice.tsx`をホームに置く（「（アカウント名）の担当になりました。投稿の案を作れます。」。FR-062、research.md R9）。

---

## Phase 5: User Story 3 -オーナーがアカウントを見せ、チームの人が読むだけで見る(Priority: P1)

**Goal**：オーナーがアカウントごとに「チームに見せる」を選び、同じチームの人は投稿ストックと戦略だけを読める。

**Independent Test**：オーナーが見せる・見せないを切り替え、同じチームのメンバーが見せているときだけ読めて、書き込み・パフォーマンス・設定は拒まれる。

### Tests for User Story 3

- [ ] T027 [P] [US3] `apps/api/test/integration/team-share.test.ts`を作る：`PATCH /api/teams/:teamId/accounts/:accountId`（そのアカウントのオーナーだけ）、見せているとき同じチームの人（管理者を含む）が`read`のGETだけ通り、`view`・`content`・`review`・`settings`・`activity`は`ROLE_FORBIDDEN`、見せていないと`ACCOUNT_NOT_FOUND`（担当の人を除く）、別のチームの人は見せていても`ACCOUNT_NOT_FOUND`、オフにした次の要求で拒まれる（SC-003、FR-030〜FR-033）。`POST`・`DELETE /api/teams/:teamId/accounts`（自分のアカウントを足す・外す、最後の1つは`TEAM_LAST_ACCOUNT`、外すと担当が消える）。

### Implementation for User Story 3

- [ ] T028 [US3] `apps/api/src/services/team-service.ts`に`setShared`・`addTeamAccount`・`removeTeamAccount`を足し、`apps/api/src/routes/teams.ts`にルートを足す。記録`team_share_changed`・`team_account_added`・`team_account_removed`。
- [ ] T029 [US3] `apps/web/test/team-page.test.tsx`にメンバー・編集者の画面（「チームに入れている、あなたのアカウント」の「チームに見せる」のスイッチ、アカウントを足す・外す）のテストを足し、`apps/web/src/pages/team.tsx`に作る。`apps/web/src/components/team/TeamSection.tsx`にも「チームに見せる」のスイッチを足す（オーナーだけ）。
- [ ] T030 [US3] `apps/web/test/team-shared-account.test.tsx`を先に書き、`apps/web/src/pages/team-shared-account.tsx`（`/teams/:teamId/accounts/:accountId`、タブ「投稿ストック」「戦略」、上部の帯と「チームに戻る」、操作を出さない、見られなくなったら知らせてチームの画面へ）を作る。`apps/web/src/pages/account-layout.tsx`で、`relation === "shared_viewer"`ならこの画面へ移す（contracts/ui-routes.md「見せてもらっているアカウント」）。

**Checkpoint**：MVP（US1〜US3）。チームを作り、招き、ロールと担当を決め、見せたアカウントを読める。

---

## Phase 6: User Story 4 -サイドバーでチームを見る(Priority: P2)

**Goal**：チームに入っている人が、サイドバーのチーム名からメンバー一覧を開ける。スマートフォンでも同じ。

**Independent Test**：2つのチームの管理者と1つのチームのメンバーで、サイドバーと一覧を確かめ、個人運用の人には出ないことを確かめる。

- [ ] T031 [P] [US4] `apps/web/test/sidebar-teams.test.tsx`に、2つのチームの切り替え（今開いているチームの選択の背景）、スマートフォンの引き出しで同じ並び（`apps/web/test/layout-responsive.test.tsx`）、個人運用で何も出ないことのテストを足し、足りないところを`apps/web/src/components/layout/Sidebar.tsx`で直す。
- [ ] T032 [US4]参加の知らせ：`POST /api/teams/:teamId/members/:userId/joined-notice/dismiss`（`apps/api/src/routes/teams.ts`、テストは`teams.test.ts`）と、`apps/web/src/pages/team.tsx`の上部の「（名前）さんが参加しました」（管理者だけ、閉じたら出さない。FR-062）。

---

## Phase 7: User Story 5 -抜ける・外す・管理者を引き継ぐ(Priority: P2)

**Goal**：メンバー・編集者は抜けられ、管理者は人を外せる。管理者は引き継いでからでないと抜けられない。どの順番でも、管理者のいないチームはできない。

**Independent Test**：抜ける・外す・引き継いで抜ける・アカウントの削除の組み合わせで、管理者が常に1人で、アカウントと記録が残る。

### Tests for User Story 5

- [ ] T033 [P] [US5] `apps/api/test/integration/team-leave.test.ts`を作る：メンバーが抜ける（アカウント・担当が外れる、記録が残る）、管理者が外す（自分は不可）、管理者が引き継ぎ先なしで抜けると`TEAM_ADMIN_MUST _TRANSFER`、ほかに誰もいなければ`TEAM_ADMIN_ALONE`、引き継いで抜ける（前の管理者は担当があれば編集者、なければメンバー）、`POST /api/teams/:teamId/admin`（抜けずに引き継ぐ）、同時の引き継ぎで管理者は1人、最後のアカウントの削除で抜けたものになる（管理者ならいちばん早く入った人へ、誰もいなければチームを消す）（SC-004、FR-040〜FR-046、research.md R7）。

### Implementation for User Story 5

- [ ] T034 [US5] `apps/api/src/services/team-service.ts`に`leaveTeam`・`removeMember`・`transferAdmin`を足し（チームの行の`FOR UPDATE`、同じトランザクションで`team_members`・`team_accounts`・`memberships`）、`apps/api/src/routes/teams.ts`にルートを足す。`apps/api/src/services/account-service.ts`のアカウントの削除で、最後のアカウントなら抜ける処理を同じトランザクションで呼ぶ。記録`team_member_left`・`team_member_removed`・`team_admin_transferred`。
- [ ] T035 [US5] `apps/web/test/team-page.test.tsx`に抜ける・外す・引き継ぐのダイアログのテストを足し、`apps/web/src/components/team/LeaveTeamDialog.tsx`（管理者：引き継ぎ先のラジオ、選ぶまで「引き継いで抜ける」は無効、管理者だけなら削除の案内／メンバー・編集者：確認）・`RemoveMemberDialog.tsx`・「⋯」の「管理者を引き継ぐ」を作る（contracts/ui-routes.md「チームの画面」）。

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T036 [P] 009のカードを改める（FR-055）：`GET /api/accounts/:accountId/team`の応答（contracts/api.md）と`apps/api/src/services/team-service.ts`、`apps/web/src/components/team/TeamRoster.tsx`（チーム名・管理者・このアカウントの担当の人、「あなた」）と`apps/web/test/team-section.test.tsx`。
- [ ] T037 [P]役割の図と文書（FR-056）：`apps/web/src/components/team/RoleDiagram.tsx`をオーナー（アカウントの持ち主）と管理者・メンバー・編集者の関係にし、`apps/web/test/invite-page.test.tsx`・`team-section.test.tsx`の図のテストを直す。`docs/team-roles.md`を書き直す。
- [ ] T038 [P] `apps/web/test/solo-owner-unchanged.test.tsx`を直し、チームに入っていないオーナーの画面が008の前と同じ（チームの区分の1行「チームに入っていません」「チームを作る」を除く。Constitution 4.0.1原則V）ことを確かめる（SC-005）。
- [ ] T039 `e2e/tests/team-flow.ts`・`e2e/tests/team.spec.ts`を011の流れに書き直す（管理者がチームを作る → 2人が自分のアカウントを入れて参加 → 1人を編集者にして担当 → オーナーが見せる → メンバーが読む → 編集者が案を登録・承認できない → 管理者が引き継いで抜ける）。`e2e/scripts/team-open.ts`の`--setup`を同じ用意にする（quickstart.md 2）。`pnpm e2e -- team`で通す（SC-007）。
- [ ] T040 [P] `docs/ui-design.md`の画面のURLの表（`/teams/*`・`/invite/:token`、`/partner/*`を消す）と、`README.md`のチーム運用の説明（`pnpm team:demo`の用意の中身）を直す。
- [ ] T041 `pnpm lint`・`pnpm typecheck`・`pnpm test`・`pnpm build`・`pnpm e2e -- team`・`pnpm e2e -- token`を流し、`specs/011-team-revision/verification.md`に結果（件数・気づいたこと・計画からの変更）と手動の確認（quickstart.md 2。7の参加までの時間（SC-001）を含む）の予定を書く。

---

## Dependencies & Execution Order

### Phaseの依存

- **Setup（Phase 1）**：すぐ始められる。T001・T002は並行できる。
- **Foundational（Phase 2）**：Setupの後。T003 → T004・T005 → T006 → T007（判定の後に表）。T008（APIの片付け）はT006の後、T009はT008の後、T010（Webの片付け）はT009の後。T011はT003の後ならいつでも。**すべてのStoryの前提**。
- **US1（Phase 3）**：Phase 2の後。
- **US2（Phase 4）**：US1（チームと参加）の後。
- **US3（Phase 5）**：US1の後。US2と並行できる（`team.tsx`を触るT023とT029は順に）。
- **US4（Phase 6）**：US1の後。
- **US5（Phase 7）**：US1の後（US2の担当も確かめるので、US2の後が望ましい）。
- **Polish（Phase 8）**：T036〜T038・T040はUS1の後ならいつでも。T039はUS1〜US5の後。T041は最後。

### Storyの中の順

- テスト（失敗を確かめる）→ サービス → ルート → 画面。

### 並行の例

```text
# Phase 1
T001 limits.ts・errors.ts ／ T002 permissions.ts

# US1 のテスト
T012 teams.test.ts ／ T013 invites.test.ts

# US2・US3 のテスト
T021 team-roles.test.ts ／ T027 team-share.test.ts ／ T033 team-leave.test.ts
```

## Implementation Strategy

### MVP First（US1＋US2＋US3）

1. Phase 1・Phase 2を終え、008のチームを除く既存のテストが通ることを確かめる（個人運用は変わらない）。
2. US1（作る・招く・入る）→ US2（ロールと担当）→ US3（見せる・読む）。
3. quickstart.md 2の1〜3で、3人のブラウザでの流れを確かめる。

### Incremental Delivery

1. MVP（US1〜US3）
2. US4 → サイドバーと知らせの仕上げ。
3. US5 → 抜ける・外す・引き継ぐ。
4. Phase 8 → 009のカード・図と文書・E2E・検証の記録。

## Notes

- [P]はファイルと依存が独立しているときだけ付けた。
- テストは各Storyの実装より先に書き、失敗を確かめる。
- チームの書き込み（`team_members`・`team_accounts`・担当の`memberships`）は`team-service.ts`と`invite-service.ts`以外から書かない。
- タスクの完了の印は、コード・テストの結果・確認の記録を見てから付ける。
