---

description: "Task list for feature 008 team operations"
---

# Tasks: チーム運用

**Input**: [spec.md](./spec.md)、[plan.md](./plan.md)、[research.md](./research.md)、[data-model.md](./data-model.md)、[contracts/permissions.md](./contracts/permissions.md)、[contracts/api.md](./contracts/api.md)、[contracts/ui-routes.md](./contracts/ui-routes.md)、[quickstart.md](./quickstart.md)

**Tests**: 001〜007と同じく、テストを先に書いて失敗を確かめてから実装する（TDD）。特に SC-002（役割×APIの表）、SC-003（外した後の拒否）、SC-004（NGワード・承認）、SC-005（個人運用の画面が変わらない）、SC-006（記録）を自動テストで確かめる。見た目・スマートフォン・3つのGoogleアカウントでの流れは quickstart.md の手動の確認で確かめる。

**Organization**: User Storyごとに分ける。MVPは US1＋US2（どちらもP1）。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 別ファイルで、未完了のタスクに依存せず並行できる。
- **[Story]**: [US1]〜[US6] は spec.md のUser Storyに対応する。
- すべてのタスクに、変更または確認する正確なパスを書く。

## Phase 1: Setup

**Purpose**: 依存と定数の準備。

- [ ] T001 [P] `apps/web/package.json` に `uqr`（MIT、依存なし）を足して `pnpm install` する。最新版の書き出しの関数名（`renderSVG` など）と、生成するSVGの形（余白・色の指定）を確かめ、`specs/008-team-operations/research.md` R5 の末尾に確かめた版と関数名を1行で書き足す。
- [ ] T002 [P] `packages/shared/src/limits.ts` に定数を足す：`TEAM_EDITOR_LIMIT = 10`、`ACTIVITY_LOG_RETENTION_DAYS = 90`、`ACTIVITY_DETAILS_EXCERPT_LIMIT = 50`、`ACTIVITY_SUMMARY_CHARS = 30`、`TEAM_NAME_MAX = 50`、`PARTNER_SUMMARY_LIMIT = 100`、`ACTIVITY_PAGE_SIZE = 50`、`ACTIVITY_PAGE_MAX = 100`（plan.md「制約」）。

---

## Phase 2: Foundational（判定の1本化・スキーマ・一覧）

**Purpose**: 役割を持てるDBと、すべてのAPIが通る1つの判定を作る。この時点ではpartner・editorの行を作る操作がないので、オーナーの動作は変わらない。**このPhaseが終わるまで、User Storyに入らない。**

### 権限の表（共通）

- [ ] T003 [P] `packages/shared/test/permissions.test.ts` に失敗先行のテストを作る：役割（`owner`・`partner`・`editor`）×任せる範囲（review/settings の4通り）で、権限の集合が [contracts/permissions.md](./contracts/permissions.md)「役割ごとの権限」の表と一致すること。案の状態ごとの削除に要る権限（`needs_review` → `content`、それ以外 → `review`）。
- [ ] T004 `packages/shared/src/permissions.ts` を作る：型 `Permission = "view" | "content" | "review" | "settings" | "activity" | "owner"`、`Role = "owner" | "partner" | "editor"`、`permissionsFor(role, delegation: { review: boolean; settings: boolean } | null): Set<Permission>`、`deletePermissionFor(status)`。`packages/shared/src/index.ts` から書き出す。T003を通す。
- [ ] T005 [P] `packages/shared/src/errors.ts` にエラーコードと文言を足す：`ROLE_FORBIDDEN`（「この操作はオーナーだけができるようになりました」）、`INVITE_INVALID`、`INVITE_SELF`、`INVITE_ALREADY_MEMBER`、`PARTNER_ALREADY_EXISTS`、`TEAM_EDITOR_LIMIT`、`ASSIGNMENT_NOT_ALLOWED`、`TEAM_NOT_FOUND`、「このアカウントを開けなくなりました」（[contracts/api.md](./contracts/api.md)「新しいエラーコード」、[contracts/ui-routes.md](./contracts/ui-routes.md)）。
- [ ] T006 [P] `packages/shared/src/schemas.ts` に型（zod）を足す：`AccountAccess`（`role`・`permissions`・`owner.name`・`hasTeam`・`team`・`delegation`）、`AccountSummary`に`role`と`ownerName: string | null`、`/api/me`の`partnerTeam`・`editorWaiting`、`errorResponseSchema`に`updatedBy: { name } | null`（optional）。招待・チーム・まとめ・記録の型は各Storyで足す。

### DB

- [ ] T007 `apps/api/src/db/schema.ts` を変える（[data-model.md](./data-model.md)）：
  - `membershipRole` に `partner`・`editor` を足す（`member` はコメントで「使わない」と書いて残す）。新しい列挙型 `activityKind`（`review`・`draft`・`content`・`settings`・`member`）。
  - テーブル `teams`（`partner_user_id` NOT NULL UNIQUE・削除で連鎖、`name` text NULL「50文字まで（CHECK）」、`editor_invite_token_hash` text NULL UNIQUE、`editor_invite_token_ciphertext`・`editor_invite_token_iv` bytea NULL、`editor_invite_key_version` smallint NULL、`editor_invite_rotated_at` timestamptz NULL、「招待の4列は、すべてNULLかすべて値あり（CHECK）」）。
  - `team_editors`（PK `team_id`＋`user_id`、両方削除で連鎖、`joined_at` NOT NULL）。
  - `account_partners`（PK `account_id`＋`team_id`、両方削除で連鎖、`delegate_review`・`delegate_settings` boolean NOT NULL DEFAULT false、`joined_at` NOT NULL、`joined_notice_dismissed_at` NULL、`updated_at`、一意のインデックス `account_partners_one_per_account`（`account_id`））。
  - `account_partner_invites`（PK `account_id` 削除で連鎖、`token_hash` NOT NULL UNIQUE、`token_ciphertext`・`token_iv` bytea NOT NULL、`key_version` smallint NOT NULL、`created_by_user_id` SET NULL、`created_at` NOT NULL）。
  - `activity_logs`（`id`、`account_id` NOT NULL 削除で連鎖、`actor_user_id` SET NULL、`actor_name` NOT NULL、`actor_role` `membership_role` NOT NULL、`kind` NOT NULL、`action` text NOT NULL、`item_count` integer NOT NULL DEFAULT 1、`summary` NULL、`details` jsonb NULL、`created_at` NOT NULL DEFAULT now()、インデックス（`account_id`, `created_at` DESC）と（`account_id`, `actor_user_id`, `created_at` DESC））。
  - 列を足す：`memberships.team_id`（NULL、FK `teams.id` 削除で連鎖、CHECK `(role = 'owner') = (team_id IS NULL)`、インデックス（`team_id`, `role`））、`post_drafts.created_by_user_id`・`edited_by_user_id`、`post_metrics.feedback_version` integer NOT NULL DEFAULT 1・`feedback_updated_by_user_id`、`updated_by_user_id` を `strategy_designs`・`promotions`・`reference_posts`・`research_keywords`・`posting_schedules` に、`accounts.core_rules_updated_by_user_id`（いずれも uuid NULL、FK `users.id`、SET NULL）。
- [ ] T008 `apps/api/drizzle/0009_team_operations.sql` を `pnpm --filter api db:generate` で作り、手で直す：`ALTER TYPE membership_role ADD VALUE 'partner'`・`'editor'` を置き、同じファイルの中では新しい値（`partner`・`editor`）を書かない。CHECKは `(role = 'owner') = (team_id IS NULL)` の形（data-model.md「マイグレーションの注意」）。ローカルのPostgres 17に `pnpm --filter api db:migrate` で当て、既存の行が `owner`・`team_id` NULLのままであることを `pnpm --filter api db:psql` で確かめる。

### 判定（API）

- [ ] T009 [P] `apps/api/test/helpers/team.ts` を作る：テスト用にDBへ直接、チーム・パートナー・編集者・担当・任せる範囲を作る関数（`makePartner(accountId, userKey, { review, settings })`、`makeEditor(teamId, userKey, accountIds)`）。`memberships` の行も同じく作る。
- [ ] T010 `apps/api/test/integration/permissions-matrix.test.ts` に失敗先行のテストを作る：[contracts/permissions.md](./contracts/permissions.md)「APIごとの必要な権限」の表のすべての既存のAPIを、owner・partner（任せる範囲の4通り）・editor（担当あり）・editor（担当なし）・関係のない人で呼び、許される（2xx・バリデーションの4xxでもよい）／403 `ROLE_FORBIDDEN`（`details`に足りない権限）／404 `ACCOUNT_NOT_FOUND` を確かめる。Honoのルートの一覧から `/accounts/:accountId` または `/team` を含むルートを取り出し、表にないものがあれば失敗させる（置き換えの漏れの検出。SC-002）。`/api/team/*` は、各Storyでルートを足すときに、チームのパートナー・そのチームの編集者・別のチームのパートナー・関係のない人で呼ぶ行をこの表に足す（[contracts/permissions.md](./contracts/permissions.md)「テスト」）。
- [ ] T011 `apps/api/src/services/access.ts` に `authorizeAccount(db, user, accountId, permission)` と `AccountAccess` 型を作る：1回の問い合わせで Account、自分の `memberships`（役割・`team_id`）、オーナー（`users`の名前・`created_at`）、`account_partners`（任せる範囲・チーム名・パートナー名）、`hasTeam`（パートナーがいる、または editor の行がある）を読む。行がなければ404 `ACCOUNT_NOT_FOUND`、権限がなければ403 `ROLE_FORBIDDEN`（`details`に権限）。UUIDでないIDは404。`findOwnedAccount` は消し、`toAccountSummary` は残す（research.md R2）。トランザクションの中でも使えるよう `Db | TxDb` を受ける。同じファイルに、チームの判定 `authorizeTeam(db, user)`（チームのパートナーでなければ404 `TEAM_NOT_FOUND`）・`listTeamAccounts(db, teamAccess)`（手伝う先＋パートナー自身がオーナーのAccount、`own` の印つき）・`authorizeAssignment(db, teamAccess, editorUserId, accountId)`（編集者でなければ404 `TEAM_NOT_FOUND`、対象外のAccountは409 `ASSIGNMENT_NOT_ALLOWED`）を置く（[contracts/permissions.md](./contracts/permissions.md)「チームの判定」。/speckit-analyze C1）。`apps/api/test/integration/access.test.ts` に3つの関数の失敗先行のテストを作ってから実装する。
- [ ] T012 `apps/api/src/services/grower-access.ts` の `canEditProfile`・`requireGrowerAccess` を、`AccountAccess`（オーナーの `createdAt`）で判定する形に変える。`apps/api/test/integration/strategy.test.ts` に「無料体験の終わったユーザーが、無料体験中のオーナーのAccountを編集者として編集できる／その逆はできない」の失敗先行のケースを足してから直す（research.md R3）。`apps/api/src/services/profile-status.ts`・`posting-rules-service.ts` と、ルート（`routes/post-drafts.ts`・`promotions.ts`・`research.ts`・`strategy.ts`・`prompt.ts`・`performance.ts`）の呼び出しを合わせる。ルートのファイルはT014・T016・T017と同じなので、T013〜T017の後に順に行う（並行しない）。
- [ ] T013 [P] `apps/api/src/routes/accounts.ts` を置き換える：`GET /accounts/:id` → `view`、`POST .../open` → `view`（partner・editor のときは `users.last_account_id` だけを記録し `accounts.last_used_at` は変えない。research.md R11）、`DELETE /accounts/:id` → `owner`（`apps/api/src/services/account-service.ts` の該当箇所も）。
- [ ] T014 [P] `apps/api/src/routes/auto-post.ts`（`GET` → `view`、`notices/blocked/dismiss` → `review`）、`apps/api/src/routes/performance.ts`（`GET`・`export` → `view`、`feedback` → `content`）を置き換える。
- [ ] T015 [P] `apps/api/src/routes/posting-schedule.ts`（`GET` → `view`、`PUT` → `settings`）、`apps/api/src/routes/posting-rules.ts`（`GET` → `view`、`ng-words`・`core-rules` → `settings`）、`apps/api/src/routes/threads-check.ts`（→ `settings`）を置き換える。
- [ ] T016 [P] `apps/api/src/routes/promotions.ts`・`apps/api/src/routes/research.ts`・`apps/api/src/routes/strategy.ts`・`apps/api/src/routes/prompt.ts` を置き換える（`GET` → `view`、書き込み → `content`）。
- [ ] T017 `apps/api/src/routes/post-drafts.ts` を置き換える：一覧・`published`・`counts` → `view`、`draft-batches` の登録と `PUT post-drafts/:draftId` → `content`、`prioritize`・`review` → `review`。`POST post-drafts/delete` は対象の状態で権限を分け、`review` がなければ要確認だけを消し残りを `skipped`（理由 `ROLE_FORBIDDEN`）で返す。`DELETE draft-batches/:batchId` はまとまりがすべて要確認のときだけ `content` で許す（[contracts/permissions.md](./contracts/permissions.md)「削除の扱い」、`apps/api/src/services/draft-service.ts` も合わせる）。`apps/api/test/integration/post-drafts.test.ts` に編集者の削除のケースを先に足す（FR-002a）。
- [ ] T018 [P] `apps/api/src/services/threads-oauth.ts` の再接続の対象の確認を、対象Accountの `owner` 権限にする（パートナー・編集者は再接続できない。FR-044）。`apps/api/test/integration/reconnect.test.ts` に partner・editor が403になるケースを足す。
- [ ] T019 `apps/api/src/routes/me.ts` と `apps/api/src/services/account-service.ts` を変える：`accounts` を `memberships` のすべての役割に広げ、各行に `role`・`ownerName` を足す（オーナー → 手伝っているAccountの順、それぞれ今の並び）。`accountLimit.used` はオーナーのAccountだけ。`resolveLandingAccountId` を「`last_account_id`が開けるAccount → オーナーのAccount（今の順）→ 手伝うAccountの最初 → null」にする。`partnerTeam`・`editorWaiting` は、この時点ではチームの表から読む（行がなければNULL）。`apps/api/test/integration/me.test.ts` に partner・editor のケースを先に足す（research.md R11、FR-045）。
- [ ] T020 `apps/api/src/services/account-review-counts.ts` を、`memberships` のすべての役割のAccountに広げる（手伝っているAccountの「要確認 N件」がMVPから出るように。/speckit-analyze O1）。`apps/api/test/integration/needs-review-counts.test.ts` に、partner・editor の行の件数も返り、関係のないAccountは返らない失敗先行のケースを足してから直す。
- [ ] T021 T010〜T020の後、`pnpm --filter api test` を全件流し、T010の表のテストと既存のテストがすべて通ることを確かめる。

### 判定（Web）

- [ ] T022 [P] `apps/web/src/lib/api-client.ts` に `getAccountAccess(accountId)`（`GET /api/accounts/:id/access`、T006のスキーマで検証）を足し、`apps/web/src/lib/query.ts` にクエリキー `access(accountId)` を足す。
- [ ] T023 `apps/web/src/lib/use-account-access.ts` を作る：`access` を読み、`can(permission)` を返す。API の403 `ROLE_FORBIDDEN` を受けたら、トースト「この操作はオーナーだけができるようになりました」を出し、`access` と表示中のクエリを読み直す。開いていたAccountで404 `ACCOUNT_NOT_FOUND` を受けたら、トースト「このアカウントを開けなくなりました」を出して `/` へ移す（[contracts/ui-routes.md](./contracts/ui-routes.md)「共通の振る舞い」2・3、FR-046）。`apps/web/test/account-access.test.tsx` に失敗先行のテストを作ってから実装する。
- [ ] T024 `apps/api/src/routes/account-team.ts` を作り、`GET /api/accounts/:accountId/access`（`view`、`Cache-Control: no-store`）を置く。`apps/api/src/app.ts` に登録する。T010の表にこのAPIを足す。
- [ ] T025 `apps/web/src/pages/account-layout.tsx` と `apps/web/src/components/guards.tsx` を、`/api/me` の `accounts`（全役割）にあるAccountを開けるように広げる。`apps/web/test/guards.test.tsx` に partner の行で開けるケースを足す。

**Checkpoint**: 既存の画面・APIはオーナーでこれまでどおり動く。役割×APIの表のテストが通る。

---

## Phase 3: User Story 1 - オーナーがパートナーを招き、一緒に運用する (Priority: P1) 🎯 MVP

**Goal**: オーナーが常設の招待リンク（QRコードつき）を作り、相手が確認画面からGoogleでログインして参加するとパートナーになる。パートナーは作る・直すができ、承認・設定はできない。オーナーは手伝っている人を見て、外せる。

**Independent Test**: 個人運用のオーナーが招待リンクを作り、別のユーザーがリンクから参加する。参加した人が投稿の案を登録・編集でき、承認のボタンが出ず、承認の要求が403になる。オーナーが外すと、次の要求から404になる。

### Tests for User Story 1

- [ ] T026 [P] [US1] `apps/api/test/integration/invites.test.ts` に失敗先行のテストを作る（パートナー）：招待リンクの作成（2回呼んでも1本）・作り直し（前の文字列が `INVITE_INVALID`）・取り消し・パートナーがいるときの作成は `PARTNER_ALREADY_EXISTS`。`GET /api/invites/:token` がログインなしで Account・招いた人だけを返し、`viewer.status` が `anonymous`・`can_join`・`self`・`already_member` になる。参加で `account_partners`・`memberships(partner)` ができ、招待の行が消える。初めてのパートナーはチーム名つきでチームができ、2つ目のAccountでは同じチームを使う。同時に2人が参加すると1人だけ成功する。DBに文字列の平文がないこと（`token_hash` と暗号文だけ）。
- [ ] T027 [P] [US1] `apps/api/test/integration/team.test.ts` に失敗先行のテストを作る（オーナー側）：`GET /accounts/:id/team` が全役割で読め、パートナー・担当の編集者を返す。`DELETE /accounts/:id/partner`（`owner`）で `account_partners` と、そのチーム経由の `memberships`（partner・editor）が消え、任せる範囲もなくなり、外した人の次の要求が404になる（SC-003）。オーナーのAccountの削除で、手伝いの関係・招待・担当も消える。`joined-notice/dismiss` の後は `joinedNotice.show = false`。
- [ ] T028 [P] [US1] `apps/web/test/team-section.test.tsx` に失敗先行のテストを作る：個人運用のオーナーの「このアカウントの設定」は「運用を手伝ってもらう」の区分だけが増え、ほかの区分は今と同じ（SC-005のスナップショット）。あわせて `apps/web/test/solo-owner-unchanged.test.tsx` を作り、個人運用のオーナー（`hasTeam = false`）では、サイドバーの見出し「チーム」と役割の枠、切り替えメニューの見出し、投稿ストックの案内「承認と却下は…」と「作成 …」「編集 …」、ホームの参加の知らせが出ないことを確かめる（SC-005、FR-006。/speckit-analyze G1）。招待なし → 招待中 → パートナーあり の表示、「外す」の確認、パートナー・編集者には一覧だけが出ること（[contracts/ui-routes.md](./contracts/ui-routes.md)「このアカウントの設定」）。
- [ ] T029 [P] [US1] `apps/web/test/invite-link-dialog.test.tsx` に失敗先行のテストを作る：リンク・「コピー」（押すと「コピーしました」）・QRコード（`role="img"`、`aria-label`「招待リンクのQRコード」）・`navigator.share` があるときだけ「送る」・「リンクを作り直す」でトースト「新しいリンクを作りました。前のリンクは使えません。」。
- [ ] T030 [P] [US1] `apps/web/test/invite-page.test.tsx` に失敗先行のテストを作る：ログインなしで確認画面が出る、`anonymous` は「Googleでログインして参加」、初めてのパートナーにはチーム名の入力欄（任意、50文字）、`already_member`・`self`・`INVITE_INVALID` の文言、参加後にAccountのホームへ移る。
- [ ] T031 [P] [US1] `apps/web/test/stock-roles.test.tsx` に失敗先行のテストを作る：`review` がないとき、要確認のカードにチェックボックス・「却下」「承認」がなく「オーナーの確認待ち」と出る、まとめての操作のバーが出ない、承認済みに「次に投稿する」がない、投稿ストックの上部に「承認と却下は、オーナー（名前）さんが行います。…」、`⋯` に「編集」「削除」がある。`settings` がないとき、設定の行は操作のボタンがなく「変更できるのはオーナーです」と出る（FR-041）。

### Implementation for User Story 1

- [ ] T032 [P] [US1] `packages/shared/src/schemas.ts` に招待とチームの型を足す：`PartnerInvite`（`url`・`createdAt`）、`InvitePreview`（[contracts/api.md](./contracts/api.md)「GET /api/invites/:token」の形）、`InviteAcceptRequest`（`teamName` は任意、「50文字まで、空ならNULL」）、`AccountTeam`（`partner`・`delegation`・`editors`・`joinedNotice`）。
- [ ] T033 [US1] `apps/api/src/services/invite-service.ts` を作る：文字列は32バイトの暗号学的乱数のbase64urlに接頭辞 `p_`・`e_`、照合用はSHA-256の16進（`apps/api/src/lib/identifier-hash.ts` の `sha256Hex`）、表示用は `createTokenCipher`（`apps/api/src/lib/crypto.ts`）で暗号化。URLは `{WEB_ORIGIN}/invite/{token}`。パートナーの招待の作成（あれば返す）・作り直し・取り消し・確認（`viewer.status` を含む）・参加（1つのトランザクションで招待の行を `FOR UPDATE`、パートナーがいないこと・自分が関係者でないことを確かめ、チームがなければ作り、`account_partners` と `memberships(partner, team_id)` を作り、招待の行を消す）（research.md R4・R7）。
- [ ] T034 [US1] `apps/api/src/services/team-service.ts` を作る（この時点ではパートナーの部分）：`getAccountTeam(access)`、`removePartner(tx, accountId)`（`account_partners` と、そのチーム経由の `memberships` の partner・editor を同じトランザクションで消す）、`dismissJoinedNotice`。`memberships` の partner・editor の行は、このファイルと `invite-service.ts` 以外から書かない（plan.md「構成の判断」）。
- [ ] T035 [US1] `apps/api/src/routes/account-team.ts` に足す：`GET`・`POST`・`DELETE /accounts/:id/partner-invite`、`POST .../partner-invite/rotate`（すべて `owner`）、`GET /accounts/:id/team`（`view`）、`DELETE /accounts/:id/partner`（`owner`）、`POST /accounts/:id/partner/joined-notice/dismiss`（`owner`）。T010の表にこれらの行を足す。
- [ ] T036 [US1] `apps/api/src/routes/invites.ts` を作る：`GET /api/invites/:token`（ログイン不要。認証のミドルウェアを通さず、ログインしていれば `viewer` を埋めるため任意で認証を読む）、`POST /api/invites/:token/accept`（ログイン必須）。`apps/api/src/app.ts` に登録する。T026・T027を通す。
- [ ] T037 [P] [US1] `apps/web/src/lib/api-client.ts` に招待・チームの呼び出しを足す（パートナーの招待の取得・作成・作り直し・取り消し、確認、参加、Accountのチーム、パートナーを外す、知らせを閉じる）。
- [ ] T038 [P] [US1] `apps/web/src/components/team/QrCode.tsx` を作る：`uqr` でSVGを作り、白地に黒、96px以上、`role="img"` と `aria-label`「招待リンクのQRコード」（research.md R5）。
- [ ] T039 [US1] `apps/web/src/components/team/InviteLinkDialog.tsx` を作る（パートナー・編集者の招待で共用）：PCは中央のダイアログ、767px以下は全画面のシート。読むだけのリンクの入力欄、「コピー」（`navigator.clipboard.writeText`、失敗したら入力欄を選択状態にする）、`navigator.share` があれば「送る」、`QrCode`、説明（呼び出し側から渡す）、「リンクを作り直す」、「閉じる」。T029を通す（research.md R6）。
- [ ] T040 [US1] `apps/web/src/components/team/TeamSection.tsx` と `apps/web/src/components/team/RemovePartnerDialog.tsx` を作り、`apps/web/src/pages/account-settings.tsx` の「Threadsとの接続」の後に置く。状態ごとの表示は [contracts/ui-routes.md](./contracts/ui-routes.md)「このアカウントの設定」の表のとおり（招待の文言「運用を手伝ってもらう方に、このリンクをLINEやメールで送ってください。…」、「パートナーができること」「あなただけができること」の2列）。任せる範囲のスイッチは US3 で足すので、ここでは置き場所だけ作る。T028を通す。
- [ ] T041 [US1] `apps/web/src/pages/invite.tsx` を作り、`apps/web/src/router.tsx` に `/invite/:token` を `RequireAuth` の外に足す。「参加する」はログインしていなければClerkのサインインへ（戻り先 `/invite/:token`）、「別のGoogleアカウント」はログアウトしてから同じ戻り先へ（research.md R7）。T030を通す。
- [ ] T042 [US1] `apps/web/src/components/layout/Sidebar.tsx` に、partner・editor のとき切り替えの下の枠「パートナーとして手伝っています」／「編集者として担当しています」と「オーナー：（名前）」を足す（FR-040）。オーナーには出さない。あわせて `apps/web/src/components/layout/AccountSwitcher.tsx` の、手伝っているAccount（`role` が owner でない）の行の2行目に「@ユーザー名 · オーナー （名字）」を出す（見出しでの2つのまとまりはUS5のT078。/speckit-analyze F1）。
- [ ] T043 [US1] `apps/web/src/pages/stock.tsx` と `apps/web/src/components/stock/DraftCard.tsx`・`DraftList.tsx`・`StatusTabs.tsx`・`PromptCard.tsx`・`messages.ts` を、`use-account-access` の `can("review")` で出し分ける（[contracts/ui-routes.md](./contracts/ui-routes.md)「投稿ストック」）。削除は要確認の案だけに出す（FR-002a）。T031の投稿ストックの部分を通す。
- [ ] T044 [US1] `apps/web/src/components/settings/PostingScheduleSection.tsx`・`PostingRulesSection.tsx`・`SettingRow.tsx` と `apps/web/src/pages/account-settings.tsx` を `can("settings")` で読むだけにし、「変更できるのはオーナーです」を添える。「Threadsとの接続」の再接続・Accountの削除は `can("owner")` のときだけ出す。T031の設定の部分を通す。
- [ ] T045 [P] [US1] `apps/web/src/components/team/PartnerJoinedNotice.tsx` を作り、`apps/web/src/pages/account-home.tsx` のオーナーのホームに出す（「（名前）さん（チーム名）がパートナーとして参加しました」「設定を開く」「×」。FR-047(1)）。partner・editor のホームでは、要再接続のバナーを「オーナーの再接続を待っています」にし、`apps/web/src/components/ReconnectButton.tsx` を出さない（FR-044）。`apps/web/test/account-home.test.tsx` にケースを足す。

**Checkpoint**: US1の Independent Test が通る。T026〜T031が通る。

---

## Phase 4: User Story 2 - パートナーが編集者を招き、担当を割り当てる (Priority: P1)

**Goal**: チームに1本の常設リンクで編集者が参加し、パートナーがチェックの表で担当を決める。担当のない編集者には待機の案内を出す。パートナー自身のAccountも担当にできる。

**Independent Test**: パートナーがリンクを共有し、2人が同じリンクで参加する。1人をAccount Aの担当にすると、その人はAで案を登録・編集でき承認できず、Bは開けない。もう1人には待機の案内が出る。

### Tests for User Story 2

- [ ] T046 [P] [US2] `apps/api/test/integration/invites.test.ts` に編集者のケースを足す（失敗先行）：チームのリンクは最初の `GET /api/team/invite` で作られ、作り直しで前の文字列が `INVITE_INVALID`。同じリンクで複数人が参加でき、担当はつかない。10人目の後は `TEAM_EDITOR_LIMIT`、上限ちょうどで2人が同時に参加しても10人を超えない。チームのパートナー本人は `INVITE_SELF`、参加済みは `INVITE_ALREADY_MEMBER`。
- [ ] T047 [P] [US2] `apps/api/test/integration/team.test.ts` に失敗先行のケースを足す：`/api/team/*` はチームのパートナー以外は404 `TEAM_NOT_FOUND`。担当の付け外しで `memberships(editor, team_id)` ができる・消える。手伝う先でもパートナー自身のAccountでもないAccountは `ASSIGNMENT_NOT_ALLOWED`。パートナー自身のAccountを担当にできる（Clarifications）。編集者を外すと `team_editors` とそのチーム経由の editor の行が消え、次の要求から404（SC-003）。オーナーがパートナーを外すと、そのAccountの editor の行だけ消え `team_editors` は残る。`/api/me` の `partnerTeam.unassignedEditorCount` と `editorWaiting.partnerName`。
- [ ] T048 [P] [US2] `apps/web/test/partner-editors.test.tsx` に失敗先行のテストを作る：上部バーの「編集者 N/10人」と「編集者を招待」、招待リンクの行、編集者×Accountのチェックの表（44px角、`role="checkbox"`、`aria-label`「（名前）を（Account）の担当にする」）、自分のAccountの列に「自社」、押すとすぐ保存し失敗したら戻してトースト、「担当を決めてください」、「⋯」→「外す」の確認、チーム名の変更（[contracts/ui-routes.md](./contracts/ui-routes.md)「編集者と担当」）。
- [ ] T049 [P] [US2] `apps/web/test/editor-waiting.test.tsx` に失敗先行のテストを作る：`/api/me` の `editorWaiting` があり、自分のAccountも手伝い先もないとき、`/` で「（パートナーの名前）さんが担当を決めるのを待っています」と「読み込み直す」が出て、Threadsの接続を求めない。担当が決まった後に読み込み直すと、担当のAccountへ移る（FR-026・FR-047(3)）。

### Implementation for User Story 2

- [ ] T050 [P] [US2] `packages/shared/src/schemas.ts` にチームの型を足す：`Team`（`id`・`name`・`partnerName`・`editorLimit`・`editors[{ userId, name, joinedAt, accountIds }]`・`accounts[{ id, displayName, username, profilePictureUrl, ownerName, own }]`・`unassignedEditorCount`）、`TeamInvite`（`url`・`rotatedAt`）、`TeamNameUpdate`（`name` 50文字まで）。
- [ ] T051 [US2] `apps/api/src/services/invite-service.ts` に編集者の招待を足す：チームのリンクの作成（最初の表示のとき）・作り直し・確認・参加（チームの行を `FOR UPDATE`、人数 `TEAM_EDITOR_LIMIT` と自分がパートナー・編集者でないことを確かめて `team_editors` を作る。担当は付けない）（research.md R7）。
- [ ] T052 [US2] `apps/api/src/services/team-service.ts` に足す：`getTeam(teamAccess)`（Accountの列は `listTeamAccounts` から作る）、`renameTeam`、`assign(teamAccess, editorUserId, accountId)`（同じトランザクションで `access.ts` の `authorizeAssignment` を通してから `memberships(editor, team_id)` を作る。Accountの可否を自分で判定しない）、`unassign`、`removeEditor`（`team_editors` とそのチーム経由の editor の行を消す）。`/api/me` 用の `partnerTeam`・`editorWaiting` の読み込み。
- [ ] T053 [US2] `apps/api/src/routes/team.ts` を作る：`GET`・`PATCH /api/team`、`GET /api/team/invite`、`POST /api/team/invite/rotate`、`PUT`・`DELETE /api/team/editors/:userId/accounts/:accountId`、`DELETE /api/team/editors/:userId`（[contracts/api.md](./contracts/api.md)「パートナーのチーム」）。すべてのルートで最初に `authorizeTeam` を通す。T010の表に `/api/team/*` の行を足す。`apps/api/src/app.ts` に登録し、`apps/api/src/routes/me.ts` の `partnerTeam`・`editorWaiting` を T052 につなぐ。T046・T047を通す。
- [ ] T054 [P] [US2] `apps/web/src/lib/api-client.ts` にチームの呼び出しを足す（チームの取得・名前の変更・リンクの取得と作り直し・担当の付け外し・編集者を外す）。
- [ ] T055 [US2] `apps/web/src/pages/partner/partner-layout.tsx` を作る：型Dの2列（左に「← アプリに戻る」、小見出し「パートナー · （チーム名）」、「手伝っているアカウント」「編集者と担当」（担当未定の人数））。767px以下は型Dと同じ2段。`apps/web/src/router.tsx` に `/partner`（→ `/partner/accounts`）・`/partner/accounts`（US5で中身を作るまでは空の状態の案内）・`/partner/editors` を足し、チームのパートナーでなければ `/` へ移す。
- [ ] T056 [US2] `apps/web/src/pages/partner/partner-editors.tsx` を作る：上部バー、説明、招待リンクの行、チェックの表、「⋯」の外す、チーム名の変更、招待のダイアログ（`InviteLinkDialog` に [contracts/ui-routes.md](./contracts/ui-routes.md)「編集者と担当」の本文と注記を渡す）。T048を通す。
- [ ] T057 [US2] `apps/web/src/components/team/EditorWaiting.tsx` を作り、`apps/web/src/pages/landing.tsx` で `landingAccountId` がなく `editorWaiting` があるときに出す。T049を通す。
- [ ] T058 [US2] `apps/web/src/components/layout/AccountSwitcher.tsx` に、パートナー（`partnerTeam` あり）のとき「手伝っているアカウントをまとめて見る」（`/partner/accounts` へ）を足す。グループ分けの見た目は US5 で仕上げる。

**Checkpoint**: US1＋US2 で MVP。招待・参加・担当・作る・直す・外すが一通り動く。

---

## Phase 5: User Story 3 - オーナーが承認・設定をパートナーに任せる (Priority: P2)

**Goal**: 2つのスイッチで、承認・却下と設定をパートナーに任せる・戻す。

**Independent Test**: 「投稿の承認・却下」だけオンで、パートナーは承認でき、編集者・設定は不可。オフにすると次の承認が403。

- [ ] T059 [P] [US3] `apps/api/test/integration/team.test.ts` に失敗先行のケースを足す：`PATCH /accounts/:id/partner`（`owner`）で `delegate_review`・`delegate_settings` が変わる。オンのときパートナーの `review`（まとめて承認の確認 004 FR-004b を含む）・`settings`（自動投稿・NGワード・投稿のルール・接続を確かめる）が通り、Threadsの再接続・パートナーの操作は403のまま。オフの直後の要求は403。パートナーが承認したNGワード入りの案は承認されない（SC-004、FR-005）。
- [ ] T060 [P] [US3] `apps/web/test/team-section.test.tsx` に失敗先行のケースを足す：スイッチ2つ（`role="switch"`、`aria-checked`）、初めはオフ、注記「編集者は、どちらもできません。Threadsとの接続・支払い・パートナーを外すことは、いつもあなただけが行えます。」、切り替えの失敗で戻ってトースト。`apps/web/test/account-access.test.tsx` に「パートナーの画面で承認を押して403 → トースト → ボタンが消える」を足す。
- [ ] T061 [US3] `apps/api/src/routes/account-team.ts` に `PATCH /accounts/:id/partner`（`{ delegation: { review?, settings? } }`）を足し、`apps/api/src/services/team-service.ts` に `setDelegation` を足す。T059を通す。
- [ ] T062 [US3] `apps/web/src/components/team/TeamSection.tsx` に「パートナーに任せること」のスイッチ2つを足す（T040で作った置き場所）。切り替えたら `access` のクエリを読み直す。T060を通す。

**Checkpoint**: US3の Independent Test が通る。

---

## Phase 6: User Story 4 - 誰が何をしたかを確かめる (Priority: P2)

**Goal**: チームがあるAccountの操作を90日分記録し、オーナー・パートナーが見られる。カードに作成者・編集者、保存の衝突に先に保存した人の名前。

**Independent Test**: 編集者が案を登録・編集し、オーナーが承認・却下すると、オーナー・パートナーの操作の記録に新しい順に出る。編集者には出ない。

### Tests for User Story 4

- [ ] T063 [P] [US4] `apps/api/test/integration/activity.test.ts` に失敗先行のテストを作る：[contracts/api.md](./contracts/api.md)「操作の記録のコード」のすべての `action` が、チームがあるAccountで操作と同じトランザクションで1行書かれ（`actor_name`・`actor_role` はその時点の値）、個人運用のAccountでは書かれない。まとめて承認・登録・取り消しは1行で `item_count` と `details.excerpts`（最大50件）。同じ `requestId` の再試行では増えない。操作が失敗したら記録もない。`partner_removed` は外した後も書かれ、外す前の記録は残る（FR-054）。`GET /accounts/:id/activity` は `activity` の権限（editor は403）、90日以内だけ、`kind`・`actor` で絞り込み、カーソルで続き、`actors` の選択肢。日次の処理で91日前の行が消える（SC-006、FR-050・050a・051）。
- [ ] T064 [P] [US4] `apps/api/test/integration/strategy.test.ts`・`promotions.test.ts`・`research.test.ts`・`post-drafts.test.ts`・`posting-schedule.test.ts`・`posting-rules.test.ts`・`performance.test.ts` に失敗先行のケースを足す：2人が同じものを開いて保存すると、後の人の409 `STALE_UPDATE` に `updatedBy.name`（先に保存した人）が入る。改善メモにも `feedback_version` による409が出る（FR-007、research.md R8）。
- [ ] T065 [P] [US4] `apps/web/test/activity.test.tsx` に失敗先行のテストを作る：日付の見出し、1行の形（時刻・頭文字・「（名前）（役割）が（操作）」・対象）、まとめての行を開くと書き出しの一覧、種類のチップ（`aria-pressed`）と人の選択、続きの読み込み、空の状態、90日の注記（[contracts/ui-routes.md](./contracts/ui-routes.md)「操作の記録」）。`apps/web/test/stock-roles.test.tsx` に「チームがあるAccountのカードに『作成 （名前） · M/D HH:mm』『編集 （名前）』、個人運用では出ない」を足す。`apps/web/test/conflict-dialog.test.tsx`（なければ作る）に「`updatedBy` があれば『（名前）さんが先に保存しました』」を足す。

### Implementation for User Story 4

- [ ] T066 [P] [US4] `packages/shared/src/schemas.ts` に操作の記録の型を足す（`ActivityItem`・`ActivityList`、`kind`・`action` の列挙）と、`apps/api/src/lib/errors.ts` の409 `STALE_UPDATE` に `updatedBy` を載せられるようにする。
- [ ] T067 [US4] `apps/api/src/services/activity-log.ts` を作る：`recordActivity(tx, access, { kind, action, itemCount, summary, excerpts, details, force })`（`access.hasTeam` のときだけ書く。`force` は `partner_removed` 用）、要約は投稿の書き出し `ACTIVITY_SUMMARY_CHARS`（30文字）、書き出しは最大 `ACTIVITY_DETAILS_EXCERPT_LIMIT`（50件）、`listActivity`（90日以内、`kind`・`actor`・カーソル・`limit` 既定50 最大100、`actors`）、`purgeOldActivity(db, now)`（90日より前を消す）。
- [ ] T068 [US4] `apps/api/src/services/draft-service.ts` と `apps/api/src/services/review-service.ts` に記録を足す：`drafts_registered`・`batch_undone`・`draft_edited`（承認済みを直したら `details.reopened = true`）・`drafts_deleted`・`drafts_approved`・`drafts_rejected`（理由）・`drafts_reopened`・`drafts_requeued`・`draft_prioritized`。同じ `requestId` の再試行では書かない。`post_drafts.created_by_user_id`（登録）・`edited_by_user_id`（本文の編集）を埋める（research.md R10）。
- [ ] T069 [US4] `apps/api/src/services/strategy-service.ts`・`item-service.ts`・`posting-rules-service.ts`・`posting-schedule-service.ts`・`performance-service.ts`・`threads-check-service.ts` と `apps/api/src/routes/promotions.ts`（宣伝の割合）・`apps/api/src/routes/prompt.ts`（プロンプトの件数）に記録を足す（`content`・`settings` の各コード）。各保存で `updated_by_user_id`（`accounts.core_rules_updated_by_user_id`・`post_metrics.feedback_updated_by_user_id`）を埋め、409のときは先に保存した人の名前を `updatedBy` で返す。改善メモの保存に `feedback_version` の照合を足す（FR-007）。T064を通す。
- [ ] T070 [US4] `apps/api/src/services/invite-service.ts`・`team-service.ts` に `member` の記録を足す：`partner_invite_created`・`partner_invite_rotated`・`partner_invite_canceled`・`partner_joined`・`partner_removed`（`force`、外れた編集者の名前）・`delegation_changed`（前後の値）・`assignment_added`・`assignment_removed`・`editor_removed`（担当だった各Accountに）。
- [ ] T071 [US4] `apps/api/src/routes/activity.ts` を作り（`GET /accounts/:id/activity`、`activity`）、`apps/api/src/app.ts` に登録、T010の表に足す。`apps/api/src/services/daily-jobs.ts` に「activity logs cleanup」（`purgeOldActivity`）を足す。T063を通す。
- [ ] T072 [P] [US4] `apps/web/src/lib/api-client.ts` に操作の記録の読み込みを足し、`apps/web/src/pages/activity.tsx` を作る。`apps/web/src/router.tsx` に `/accounts/:accountId/activity` を足し、`activity` がなければ `/accounts/:id` へ移す。T065の記録の部分を通す。
- [ ] T073 [US4] `apps/web/src/components/layout/Sidebar.tsx` に、`hasTeam` かつ `can("activity")` のとき見出し「チーム」と「操作の記録」（lucide-react `History`）を足す。`apps/web/src/components/team/TeamSection.tsx` の「操作の記録を見る」をつなぐ。
- [ ] T074 [US4] `apps/web/src/components/stock/DraftCard.tsx` に、`hasTeam` のとき「作成 （名前） · M/D HH:mm」と、直されていれば「編集 （名前） M/D HH:mm」（`body_edited_at`）を出す。`apps/api/src/services/draft-service.ts` の一覧の応答に `createdBy`・`editedBy`（名前）を足す。`apps/web/src/components/ConflictDialog.tsx` の見出しを、`updatedBy` があるとき「（名前）さんが先に保存しました」にし、`apps/web/src/lib/save-error.ts` で応答から渡す。T065の残りを通す。

**Checkpoint**: US4の Independent Test が通る。

---

## Phase 7: User Story 5 - パートナーが手伝っているAccountをまとめて見る (Priority: P2)

**Goal**: 切り替えメニューを「自分のアカウント」「手伝っているアカウント」に分け、パートナーのまとめの画面で手伝い先を1つの表で見る。

**Independent Test**: 3件を手伝い、自分のAccountも1件持つパートナーで、メニューが2つに分かれ、まとめの画面で3件の要確認・承認済み・次の投稿・伸び・任された範囲・担当・接続状態が見える。

- [ ] T075 [P] [US5] `apps/api/test/integration/team.test.ts` に失敗先行のケースを足す：`GET /api/team/accounts` が手伝う先だけ（自社は含めない）を要確認の多い順（同じなら表示名の順）で返し、`needsReview`・`approved`（005の計算と一致）・`nextPost`・`judgments7d`（006の `judged_at` が7日以内）・`delegation`・`editors`・接続状態が合う。100件を超えると `truncated: true`。手伝う先が1件と10件で、DBへの問い合わせの回数が変わらないこと（Accountの数ぶんにならない。plan.md「性能目標」、SC-007）。
- [ ] T076 [P] [US5] `apps/web/test/account-switcher.test.tsx` に失敗先行のケースを足す：手伝っているAccountがあれば見出し「自分のアカウント」「手伝っているアカウント」で分かれ、手伝っている行に「@ユーザー名 · オーナー （名字）」、要再接続は「オーナーの再接続待ち」、パートナーには「手伝っているアカウントをまとめて見る」と「担当未定 N人」。手伝っているAccountがなければ007と同じ（見出しなし）。`apps/web/test/partner-accounts.test.tsx` に、表の列・アイコンの `aria-label`・要再接続の表示・行のリンク・767px以下のカード・空の状態を確かめるテストを作る（[contracts/ui-routes.md](./contracts/ui-routes.md)「手伝っているアカウント」）。
- [ ] T077 [US5] `apps/api/src/services/partner-summary.ts` を作る：手伝う先のAccountを `access.ts` の `listTeamAccounts`（`own` でないもの）から受け取り、表ごとにまとめて1回ずつ問い合わせて（Accountの数ぶんにしない）、要確認・承認済みと残りの日数・次の投稿（`apps/api/src/services/auto-post-status.ts` の計算を使う）・直近7日の判定ごとの件数・任せる範囲・担当の編集者・接続状態を組み立てる。最大 `PARTNER_SUMMARY_LIMIT`（100件）（research.md R12）。`apps/api/src/routes/team.ts` に `GET /api/team/accounts` を足し、T010の表に行を足す。T075を通す。
- [ ] T078 [US5] `apps/web/src/components/layout/AccountSwitcher.tsx` を、見出しで2つのまとまりに分け、要再接続の文言（「オーナーの再接続待ち」）・「担当未定 N人」を足す（手伝っている行の2行目はT042で済み）（[contracts/ui-routes.md](./contracts/ui-routes.md)「切り替えメニュー」）。
- [ ] T079 [US5] `apps/web/src/pages/partner/partner-accounts.tsx` を作る：上部バー「N件 · 要確認の多い順」、PCは表（伸びは006の `apps/web/src/components/performance/JudgmentBadge.tsx` のアイコンと件数、`aria-label` に文字）、767px以下は1件1枚のカード、行全体がAccountのホームへのリンク、空の状態の案内。T076を通す。

**Checkpoint**: US5の Independent Test が通る。

---

## Phase 8: User Story 6 - スマートフォンで通知が操作を邪魔しない (Priority: P3)

**Goal**: 375px・390px幅で、通知がヘッダー・貼り付け欄・セーフエリアを隠さない（UI全体設計 §11）。

- [ ] T080 [P] [US6] `apps/web/test/toaster-position.test.tsx` に失敗先行のテストを作る（`apps/web/test/helpers/viewport.ts` で375px・390px）：`Toaster` の `mobileOffset` の上が `calc(env(safe-area-inset-top) + 60px)`、左右16px、768px以上は今の位置のまま（research.md R13）。
- [ ] T081 [US6] `apps/web/src/components/ui/sonner.tsx` の `Toaster` に `mobileOffset`（上 `calc(env(safe-area-inset-top) + 60px)`、左右16px）を足す。T080を通す。`docs/ui-design.md` §11 に「008で対応（mobileOffset）」を書き足す。

---

## Phase 9: Polish & Cross-Cutting Concerns

- [ ] T082 [P] `docs/ui-design.md` を更新する：§2「Accountの切り替え」に2つのまとまりと「まとめて見る」、§7 のURLの表に `/invite/:token`・`/partner/accounts`・`/partner/editors`・`/accounts/:id/activity`、§3 D に「パートナーの画面（008。専用のダッシュボード画面は作らない、の例外）」、サイドバーの見出し「チーム > 操作の記録」（チームがあるAccountだけ）、§4 のアイコンの表に `History`・`LayoutGrid`。
- [ ] T083 [P] `README.md` の動作確認の節に、チーム運用を3つのGoogleアカウントで確かめる手順への案内（`specs/008-team-operations/quickstart.md`）を1行足す。
- [ ] T084 `pnpm lint`・`pnpm typecheck`・`pnpm --filter shared test`・`pnpm --filter api test`・`pnpm --filter web test`・`pnpm build` をすべて通す。T010の表のテストに、本featureで足したAccountのAPIがすべて入っていることを確かめる。
- [ ] T085 [quickstart.md](./quickstart.md) の手順1（ステージングのNeonへのマイグレーション）と手順3〜9を、3つのGoogleアカウント（別のブラウザのプロファイル）で行い、SC-001（3分以内）・SC-007・SC-008 を確かめる。
- [ ] T086 `specs/008-team-operations/verification.md` を作り、T084・T085の結果（テストの件数、手動の確認の日付と結果、確かめられなかったこと）を書く。

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1（Setup）**：すぐ始められる。
- **Phase 2（Foundational）**：Phase 1の後。すべてのUser Storyを止める。T007 → T008 → T009〜T020（置き換えは並行できる）→ T021。Webの T022〜T025 は T006 の後。
- **US1（Phase 3）**：Phase 2の後。
- **US2（Phase 4）**：US1の `invite-service.ts`・`team-service.ts`・`InviteLinkDialog` の後（同じファイルに足すため）。
- **US3（Phase 5）**：US1の後（`TeamSection` と `account-team.ts`）。US2とは独立。
- **US4（Phase 6）**：US1・US2の後（記録を書く操作がそろってから）。US3の後だと `delegation_changed` も書ける（T070）。
- **US5（Phase 7）**：US2の後（パートナーの画面の枠）。
- **US6（Phase 8）**：Phase 2の後ならいつでも（独立）。
- **Polish（Phase 9）**：入れたいStoryがすべて終わった後。

### Parallel Opportunities

- Phase 2：T003・T005・T006・T009 は並行。T013〜T016・T018 は別のファイルなので並行（T011 の後）。T012 は T013〜T017 の後（同じルートのファイルを変えるため）。
- US1：T026〜T031 のテストは並行。T037・T038・T045 は並行。
- US2：T046〜T049 のテストは並行。
- US4：T063〜T065 は並行。
- US6 は他のStoryと並行できる。

### Parallel Example: Phase 2（判定の置き換え）

```text
T011 の後に、別々のファイルで：
T013: apps/api/src/routes/accounts.ts
T014: apps/api/src/routes/auto-post.ts・performance.ts
T015: apps/api/src/routes/posting-schedule.ts・posting-rules.ts・threads-check.ts
T016: apps/api/src/routes/promotions.ts・research.ts・strategy.ts・prompt.ts
T018: apps/api/src/services/threads-oauth.ts
```

### Parallel Example: User Story 1

```text
T026: apps/api/test/integration/invites.test.ts
T027: apps/api/test/integration/team.test.ts
T028: apps/web/test/team-section.test.tsx
T029: apps/web/test/invite-link-dialog.test.tsx
T030: apps/web/test/invite-page.test.tsx
T031: apps/web/test/stock-roles.test.tsx
（すべて失敗を確かめてから実装へ）
```

---

## Implementation Strategy

### MVP First（US1＋US2）

1. Phase 1・Phase 2 を終え、役割×APIの表のテストと既存のテストがすべて通ることを確かめる（オーナーの動作は変わらない）。
2. US1（招待・参加・外す・出し分け）→ US2（チーム・編集者・担当・待機）。
3. quickstart 手順3・4・8 で、3つのGoogleアカウントの流れを確かめる。ここでPRD FR-13の中心（オーナーが招き、パートナーと編集者が作り、オーナーが承認する）を試せる。

### Incremental Delivery

1. MVP（US1＋US2）
2. US3 → 承認・設定を任せられる。
3. US4 → 誰が何をしたかが分かる。保存の衝突で名前が出る。
4. US5 → 手伝い先が増えても1画面で見られる。
5. US6 → スマートフォンの通知の重なりを直す。
6. Phase 9 → 文書・全件のテスト・手動の確認。

## Notes

- [P] はファイルと依存が独立しているときだけ付けた。
- テストは各Storyの実装より先に書き、失敗を確かめる。
- `memberships` の partner・editor の行は、`team-service.ts` と `invite-service.ts` 以外から書かない。
- タスクの完了の印は、コード・テストの結果・確認の記録を見てから付ける。
