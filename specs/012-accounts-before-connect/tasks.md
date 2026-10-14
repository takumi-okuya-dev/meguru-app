---

description: "Task list for feature 012 accounts before connect"
---

# Tasks:アカウントを先に作る

**Input**: [spec.md](./spec.md)、[plan.md](./plan.md)、[research.md](./research.md)、[data-model.md](./data-model.md)、[contracts/api.md](./contracts/api.md)、[contracts/ui-routes.md](./contracts/ui-routes.md)、[quickstart.md](./quickstart.md)

**Tests**: 001〜011と同じく、テストを先に書いて失敗を確かめてから実装する（TDD）。特にSC-002（未接続で002〜004が使える）、SC-003（つないだ前後の件数）、SC-004（二重につながらない）、SC-005（未接続からThreadsへの問い合わせが0回）、SC-006（`@null`などが出ない）、SC-007（接続中だけの人の画面が変わらない）を自動テストで確かめる。

**Organization**: User Storyごとに分ける。MVPはUS1＋US2＋US3（どれもP1）。

## Format: `[ID] [P?] [Story] Description`

- **[P]**:別ファイルで、未完了のタスクに依存せず並行できる。
- **[Story]**: [US1]〜[US7]はspec.mdのUser Storyに対応する。
- すべてのタスクに、変更または確認する正確なパスを書く。

## Phase 1: Setup

**Purpose**: PRDの直し・定数・エラーのcode・表示の決まり。

- [X] T001 [P] PRDを実装の前に直す（Constitution「開発ワークフロー」、research.md R9）：`_bmad-output/initiative-threads-grower-app/prd-threads-grower-app/prd-threads-grower-app.md`のFR-1（「Accountを1件も保有していない場合は…アカウント追加画面へ」→「アカウントを作る画面（名前だけ）へ」）、FR-2（名前だけでAccountを作り、Threadsへの接続は「このアカウントの設定」から後で行う。未接続でも戦略・投稿ストック・承認は使える）、§2 UJ-1のPath（「アカウント作成（名前）→戦略…→承認→Threadsにつなぐ→自動投稿」）。
- [X] T002 [P] `packages/shared/src/limits.ts`に`ACCOUNT_NAME_MAX = 50`を足す。`packages/shared/src/errors.ts`にcode `ACCOUNT_NOT_CONNECTED`（「このアカウントは、まだThreadsにつながっていません。『このアカウントの設定』からつないでください」）・`ACCOUNT_ALREADY_CONNECTED`（「このアカウントは、すでにThreadsにつながっています」）を足し、`ACCOUNT_ALREADY_REGISTERED`の文言を`details`（`[accountId, name, username]`）があれば「@{username}は、あなたのアカウント『{name}』につながっています」にする（contracts/api.md「新しいエラーコード」）。`packages/shared/test/errors.test.ts`に文言のテストを足す。
- [X] T003 [P] `packages/shared/test/account-label.test.ts`を先に書き、`packages/shared/src/account-label.ts`に`accountLabel(account: { name, username, profilePictureUrl, connectionStatus })`を作る：`{ primary: name, secondary: username ? "@" + username : null, initial: name の先頭1文字（大文字）, notConnected: connectionStatus === "not_connected" }`（research.md R2、contracts/ui-routes.md「アカウントの示し方」）。`packages/shared/src/index.ts`から出す。

---

## Phase 2: Foundational（すべてのStoryの前提）

**Purpose**: DB・共通の型・表示の置き換え。ここが終わるまでStoryに入らない。

- [X] T004 `apps/api/src/db/schema.ts`をdata-model.mdのとおりにする：`connectionStatus`の列挙型に`not_connected`、`oauthMode`に`connect`を足す。`accounts`に`name`（`text NOT NULL`、既定値なし。CHECK `accounts_name_length`：「`char_length(name) BETWEEN 1 AND 50 AND name = btrim(name)`」）を足し、`threads_user_id`・`username`・`connection_method`の`NOT NULL`を外す（`threads_user_id`の一意制約、`lower(username)`の索引、`connection_status`の既定値`connected`、`connection_method`の既定値`app`は残す）。CHECK `accounts_connection_consistency`：「`(connection_status::text = 'not_connected' AND threads_user_id IS NULL AND username IS NULL AND connection_method IS NULL) OR (connection_status::text <> 'not_connected' AND threads_user_id IS NOT NULL AND username IS NOT NULL AND connection_method IS NOT NULL)`」。`pnpm --filter api db:generate`で`apps/api/drizzle/0013_accounts_before_connect.sql`を作り、列挙型の値の追加を別の文にし、`name`を「`left(COALESCE(NULLIF(btrim(display_name), ''), username), 50)`」で埋めてから`NOT NULL`にする順に直す。
- [X] T005 `apps/api/test/migration/migration-0013.test.ts`を作る（`apps/api/test/helpers/migrate.ts`で0012までを当て、データを入れて0013を当てる）：今のアカウントが`connected`・`needs_reconnect`のまま、`name`が表示名（空・空白だけならユーザー名）の先頭50文字で埋まる。`accounts`・`post_drafts`・`strategy_designs`・`activity_logs`の件数が前後で同じ。未接続のアカウントを2つ入れても一意制約にかからない。未接続で`username`だけ入れる・接続中で`threads_user_id`を`NULL`にする・`name`が空や51文字、のどれも拒まれる（data-model.md「確かめること」）。
- [X] T006 `apps/api/test/helpers/app.ts`のアカウントを作る関数に`name`（既定は`username`）を足し、未接続のアカウントを作る`createUnconnectedAccount(clerkId, { name })`（`connection_status = 'not_connected'`、3つの列は`NULL`）を足す。`apps/api/test/migration/migration-0012.test.ts`が0012までの形で動き続けることを確かめる。
- [X] T007 `packages/shared/src/schemas.ts`を直す（data-model.md「共通の型」）：`connectionStatusSchema`に`not_connected`、`accountSummarySchema`に`name`、`username`・`displayName`・`profilePictureUrl`を`nullable`、`connectionMethod`を`nullable().optional()`。`accountNameSchema`（前後の空白を除いて「1〜50文字」）、`createAccountRequestSchema`・`renameAccountRequestSchema`（`{ name }`）を足す。`deleteAccountRequestSchema`を`{ confirmName }`にする。チームの型（`teamMemberAccountSchema`・`teamAssignmentsSchema`の`accounts`・`invitePreviewSchema`の`accounts`）に`name`を足し`username`を`nullable`、招待の`accounts`に`connected: boolean`、`inviteViewerStatusSchema`に`needs_connection`。`threadsCheckSchema`の`status`と自動投稿の`stoppedReason`に`not_connected`、自動投稿の知らせに`{ kind: "not_connected" }`、`performanceSummarySchema`に`notConnected`。
- [X] T008 `apps/api/src/services/access.ts`の`toAccountSummary`に`name`を足す（見せてもらっている人にも伏せない。011の伏せ方は今のまま）。`apps/api/src/services/team-service.ts`・`apps/api/src/services/invite-service.ts`のアカウントの行に`name`を足す。`username`が`NULL`になりうる所で型が通るように直す：`apps/api/src/services/username-match.ts`（`NULL`は照合しない）、`apps/api/src/services/token-refresh.ts`、`apps/api/src/services/account-service.ts`の`completeConnection`（`target.username`の比べ方）。`pnpm --filter api typecheck`と、既存のAPIのテストが通ることを確かめる。
- [X] T009 `apps/web/test/account-label-usage.test.tsx`を先に書き（未接続のアカウントで、切り替えメニュー・設定の見出し・ホームの見出し・チームの画面のメンバーの行・担当の表の列・招待の確認のアカウントの選択・操作の記録のアカウント名に`@null`・`@undefined`・空の名前が出ない。SC-006）、`apps/web/src/components/AccountAvatar.tsx`を`accountLabel`の頭文字にし、`displayName ?? username`・`@{username}`を書いている所を`accountLabel`に置き換える：`apps/web/src/components/layout/AccountSwitcher.tsx`、`apps/web/src/pages/account-home.tsx`、`apps/web/src/pages/account-settings.tsx`の見出し、`apps/web/src/pages/team.tsx`、`apps/web/src/pages/team-assign.tsx`、`apps/web/src/pages/team-shared-account.tsx`、`apps/web/src/pages/invite.tsx`、`apps/web/src/components/team/CreateTeamDialog.tsx`・`AssignedNotice.tsx`、`apps/web/src/components/connect/ReconnectDialog.tsx`、`apps/web/src/components/ReconnectButton.tsx`、`apps/web/src/lib/callback-result.ts`（トーストを「{name}をThreadsにつなぎました」に）、`apps/web/src/pages/activity.tsx`のアカウント名、`apps/web/src/pages/performance.tsx`と`apps/web/src/components/performance/CsvExportMenu.tsx`（CSVのファイル名：ユーザー名、なければアカウントの名前）。`apps/web/src/components/ConnectionBadge.tsx`に「未接続」（灰色）を足す。`pnpm --filter web typecheck`と既存のWebのテストが通ることを確かめる。

**Checkpoint**：既存のテストが通る。接続中のアカウントの見え方は、主の名前がアカウントの名前（＝今の表示名）になる以外は変わらない。

---

## Phase 3: User Story 1 -名前だけでアカウントを作り、すぐに中身を使う(Priority: P1) 🎯 MVP

**Goal**：アカウントが0件の人が、名前だけで未接続のアカウントを作り、戦略・プロンプト・案の登録・承認まで使える。

**Independent Test**：アカウントを持たない利用者でログインし、名前だけでアカウントを作り、戦略の保存・プロンプトの生成・案の一括登録・承認ができる。

### Tests for User Story 1

- [X] T010 [P] [US1] `apps/api/test/integration/account-create.test.ts`を作る：`POST /api/accounts`（名前「前後の空白を除いて1〜50文字」、空・空白だけ・51文字で`VALIDATION_FAILED`（`details: ["name"]`）、201で`connectionStatus: "not_connected"`・`username: null`・`name`、作った人が`owner`、プランが`initialPlanFor`と同じ、初期の設定（宣伝投稿の割合・プロンプトで作る件数）が今の作成と同じ）、上限に達していれば`ACCOUNT_LIMIT_REACHED`、同じ人が並べて送っても上限を超えない、未接続のアカウントも上限に数える（FR-002〜FR-004、research.md R3）。
- [X] T011 [P] [US1] `apps/api/test/integration/unconnected-features.test.ts`を作る：未接続のアカウントで、戦略・宣伝内容・リサーチの保存、プロンプトの生成（アカウント名が`name`で入る。FR-037）、案の一括登録と重複の確認、承認・却下、NGワード・投稿のルールの保存、操作の記録の読み出しが、接続中と同じ応答で通る。承認済みの案がThreadsに投稿されない（SC-002、FR-031）。

### Implementation for User Story 1

- [X] T012 [US1] `apps/api/src/services/account-service.ts`に`createAccount(env, userId, name)`を作る（1つのトランザクションで`lockUserRow` → `assertCanAddAccount` → `accounts`（`name`、`connection_status: "not_connected"`、`threads_user_id`・`username`・`connection_method`は`NULL`、`plan: initialPlanFor(limit.plans)`）と`memberships`（owner））。`apps/api/src/routes/accounts.ts`に`POST /api/accounts`（`createAccountRequestSchema`、201で`AccountSummary`）を足す。
- [X] T013 [US1] `apps/api/src/services/prompt-service.ts`のアカウント名（今の`displayName ?? @username`）を`account.name`にする（FR-037、research.md R2）。`apps/api/test/integration/prompt.test.ts`の期待を直す。
- [X] T014 [P] [US1] `apps/web/src/lib/api-client.ts`に`createAccount({ name })`を足す。
- [X] T015 [US1] `apps/web/test/account-create.test.tsx`を先に書き（`account-new-limit.test.tsx`・`account-new-token.test.tsx`を置き換える）、`apps/web/src/pages/account-new.tsx`を「アカウントを作る」の画面にする：名前の入力欄1つ（`FieldWithCounter`、50文字）、空・空白だけで「作る」を押せない、送信中はボタンを止める、成功で`/accounts/:id`へ、「Threadsには、あとで『このアカウントの設定』からつなげます」、上限なら入力欄の代わりに001 FR-017の案内、0件なら「登録済み n/m件」を出さず`CenteredLayout`。「Threadsアカウントを接続」・`TESTER_NOTICE`・トークンの方法はこの画面から消す。`?next=/invite/…`は今のまま`rememberInviteReturn`（contracts/ui-routes.md「アカウントを作る」）。

**Checkpoint**：初めての人が、名前だけで作り、中身を使える（quickstart.md 2の1の前半）。

---

## Phase 4: User Story 2 -作ったアカウントを、後からThreadsにつなぐ(Priority: P1)

**Goal**：オーナーが設定の「Threadsとの接続」から、2つの方法で未接続のアカウントをつなぐ。データは残り、自動投稿はオフのまま。

**Independent Test**：未接続のアカウントで戦略と承認済みの案を作ってから、トークン（とこのアプリの接続）でつなぎ、データが残り、接続中になり、自動投稿を始められる。

### Tests for User Story 2

- [X] T016 [P] [US2] `apps/api/test/integration/threads-connect.test.ts`・`apps/api/test/integration/threads-callback-guards.test.ts`を直す：`POST /api/threads/connect`は`{ mode: "connect", accountId }`と`{ mode: "reconnect", accountId }`だけ（`new`は`VALIDATION_FAILED`）、`connect`はオーナーだけ（担当の人は`ROLE_FORBIDDEN`、関わりなしは`ACCOUNT_NOT_FOUND`）、つながっているアカウントへの`connect`は`ACCOUNT_ALREADY_CONNECTED`、上限に達していても`connect`できる。callbackで`connect`を確定すると、そのアカウントが`connected`になり、プロフィール・`connection_method: "app"`が入り、`/accounts/:id/settings?connected=connect`へ戻る。失敗は`/accounts/:id/settings?error=CODE`、許可の画面にいる間に対象のアカウントを消した・オーナーでなくなったときは`/?error=ACCOUNT_NOT_FOUND`（または`ROLE_FORBIDDEN`）、`state`が読めなければ`/?error=OAUTH_STATE_INVALID`、`mode = new`の古い`state`は`OAUTH_STATE_INVALID`（research.md R4、contracts/api.md「Threadsにつなぐ」）。
- [X] T017 [P] [US2] `apps/api/test/integration/token-connect.test.ts`・`apps/api/test/integration/token-reconnect.test.ts`を直す：`{ mode: "connect", accountId, token }`でつながり、応答の`kind`が`connect`、権限の案内（`warnings`）と短期トークンの確かめ直し（`recheck_at`）が010のまま、オーナー以外とつながっているアカウントへの`connect`は失敗の予約より先に拒まれ、失敗に数えない（FR-012・FR-015）。
- [X] T018 [P] [US2] `apps/api/test/integration/connect-keeps-data.test.ts`を作る：未接続のアカウントに戦略・宣伝内容・リサーチ・承認済みの案・却下の記録・NGワード・投稿のルール・自動投稿の時刻（オフ）・操作の記録を入れてからつなぎ、件数が同じ（SC-003）、自動投稿がオフのまま（FR-014）、`posting_schedules.effective_from`が今になる。同じ未接続のアカウントへ2つの`connect`を並べて確定させ、つながるThreadsアカウントは1つで、後の方が`ACCOUNT_ALREADY_CONNECTED`（FR-018）。

### Implementation for User Story 2

- [X] T019 [US2] `packages/shared/src/schemas.ts`の`connectRequestSchema`・`tokenConnectRequestSchema`を`connect`・`reconnect`（どちらも`accountId`）にし、`tokenConnectResponseSchema`の`kind`を`connect`・`reconnect`にする。`apps/api/src/services/threads-oauth.ts`の`startConnect`を、`connect`・`reconnect`とも`authorizeAccount(..., "owner")`で対象を確かめ、`connect`は対象が`not_connected`でなければ`ACCOUNT_ALREADY_CONNECTED`にする（上限は判定しない）。
- [X] T020 [US2] `apps/api/src/services/account-service.ts`の`completeConnection`に`mode = connect`の手順を足し、`mode = new`の手順（`last_account_deleted_at`の確認、上限の再判定と作成、`existing`の更新）を消す：ロックの順（Threadsユーザー → ユーザー名 → 利用者の行）のまま、取り消し・削除の要求の確認 → 対象を`FOR UPDATE`で読み、`authorizeAccount(tx, ..., "owner")` → 対象が`not_connected`でなければ`ACCOUNT_ALREADY_CONNECTED` → 照合（US3で仕上げる）→ `writeConnection` → チームがあれば記録`threads_connected`（`{ method }`）。`ConnectionRequest.mode`を`connect | reconnect`、`CompleteConnectionResult.kind`を`connect | reconnect`にする（research.md R4）。
- [X] T021 [US2] `apps/api/src/routes/threads-connect.ts`のcallbackの戻り先を直す（成功：`/accounts/:id/settings?connected=connect|reconnect`、失敗：`/accounts/:id/settings?error=CODE`、対象が消えた・オーナーでなくなった（`ACCOUNT_NOT_FOUND`・`ROLE_FORBIDDEN`）・`state`が読めない・想定外の失敗：`/?error=…`）。`apps/web/src/pages/landing.tsx`で`?error=`をトーストに出してから振り分ける。`apps/api/src/services/token-connect.ts`を`connect`にし、判定（オーナーか、`connect`なら`not_connected`か）を`reserveCheck`より先に行う。
- [X] T022 [P] [US2] `apps/web/src/lib/api-client.ts`の`connect`・`tokenConnect`の型を新しいモードにし、`apps/web/src/components/connect/TokenConnectForm.tsx`に`mode="connect"`（`accountId`つき）を足す。`apps/web/src/components/connect/ReconnectDialog.tsx`は`reconnect`のまま、表示名を`accountLabel`にする。
- [X] T023 [US2] `apps/web/test/connect-methods.test.tsx`を先に書き、`apps/web/src/components/connect/ConnectMethods.tsx`を作る：「未接続」の印、つなぐとできることの説明、「Threadsで許可する」（`api.connect({ mode: "connect", accountId })`の`authorizeUrl`へ）、検証期間中なら`TESTER_NOTICE`、開くと出る「自分のMetaアプリのトークンでつなぐ」（`TokenConnectForm mode="connect"`）、エラーの`Alert`（`?error=`とトークンの応答）。オーナー以外には「オーナーがThreadsにつなぐと使えます」だけ（FR-015、contracts/ui-routes.md「Threadsとの接続」）。
- [X] T024 [US2] `apps/web/test/account-settings.test.tsx`を先に直し、`apps/web/src/pages/account-settings.tsx`の「Threadsとの接続」の区分（`id="threads"`）を、未接続なら`ConnectMethods`、接続中・要再接続なら今のままにする。つないだ直後（`?connected=connect`、またはトークンの成功）に「✓ {name}をThreadsにつなぎました（@username）」「自動投稿はオフのままです…」と「自動投稿を始める」（投稿の時刻の区分へ移り、設定のダイアログを開く）を出し、010の`warn`の案内を下に出す（Clarifications 2026-10-14、FR-014）。`apps/web/src/lib/callback-result.ts`を`connected=connect|reconnect`にし、`connected=new`の扱いを消す。
- [X] T025 [US2] 招待へ戻す処理（011 T019）を移す：`apps/web/src/pages/account-home.tsx`の`connected === "new"`で`takeInviteReturn`する処理を消し、`apps/web/src/pages/account-settings.tsx`のつないだ直後（`connect`の成功）に、覚えた招待があれば「つながりました」の代わりにそこへ移す（`apps/web/src/lib/invite-return.ts`、research.md R7）。

**Checkpoint**：作ってからつなげる。データは残り、自動投稿はオフのまま（quickstart.md 2の2・3）。

---

## Phase 5: User Story 3 -同じThreadsアカウントの二重の登録を防ぐ(Priority: P1)

**Goal**：つなごうとしたThreadsアカウントが、自分の別のアカウントや他の利用者のアカウントにつながっていたら、止めて案内する。

**Independent Test**：@cafe_bにつながっている自分のアカウントがあるとき、別の未接続のアカウントを@cafe_bにつなごうとして止められる。他の利用者の@cafe_bでも止められる。

### Tests for User Story 3

- [X] T026 [P] [US3] `apps/api/test/integration/token-duplicate.test.ts`を直し、`apps/api/test/integration/connect-duplicate.test.ts`を作る：`connect`で、自分の別のアカウントとユーザーIDかユーザー名で一致したら`ACCOUNT_ALREADY_REGISTERED`（`details: [そのアカウントのID, 名前, ユーザー名]`）、他の利用者なら`THREADS_ACCOUNT_TAKEN`（登録した人を明かさない）、どちらも未接続のアカウントとデータが変わらない。ユーザー名だけ一致して、登録済みのアカウントのユーザー名がもう違えば、つながる（010 FR-023）。このアプリの接続とトークンの組み合わせ（app→token、token→app、token→別のMetaアプリのtoken）の3通り（SC-004、FR-020〜FR-022）。
  - 実装メモ：`connect-duplicate.test.ts`は作らず、同じ確かめを`token-duplicate.test.ts`（トークンの3通り・他の利用者・ユーザー名だけ）と`threads-callback-guards.test.ts`（このアプリの接続での他の利用者・自分の別のアカウント）に入れた。

### Implementation for User Story 3

- [X] T027 [US3] `apps/api/src/services/account-service.ts`の`completeConnection`の`connect`の照合を仕上げる：今の`candidates`（ユーザーIDか`lower(username)`）で、対象以外に一致があれば、自分のものなら`ACCOUNT_ALREADY_REGISTERED`（`details: [id, name, username]`）、他の利用者なら`THREADS_ACCOUNT_TAKEN`。`existing`の接続の更新（001 FR-013）は`connect`ではしない（Clarifications：止めて案内する）。`refreshUsernameOnlyMatch`は今のまま確定の前に呼ぶ。接続し直し（`reconnect`）の`duplicateError`も`details: [id, name, username]`にそろえ、`apps/api/test/integration/token-duplicate.test.ts`の期待を直す（contracts/api.md）。
- [X] T028 [US3] `apps/web/src/components/connect/ConnectMethods.tsx`で、`ACCOUNT_ALREADY_REGISTERED`のとき、重なったアカウントの名前とそのアカウント（`/accounts/:id/settings`）へのリンクを出す。`apps/web/test/connect-methods.test.tsx`に足す（US3-1）。

**Checkpoint**：MVP（US1〜US3）。quickstart.md 2の1〜4。

---

## Phase 6: User Story 4 -未接続のあいだの案内(Priority: P2)

**Goal**：未接続のアカウントで、ホーム・自動投稿・パフォーマンスに案内を出し、Threadsが要る操作を止める。

**Independent Test**：未接続のアカウントで、ホーム・投稿の時刻・パフォーマンス・投稿ストックを開き、案内と入口が出る。つないだ後は消える。

### Tests for User Story 4

- [X] T029 [P] [US4] `apps/api/test/integration/unconnected-threads-calls.test.ts`を作る：未接続のアカウントがあるときに、毎日の処理（期限の延長・プロフィールの取り直し・反応数の取得・トークンの確かめ直し）、自動投稿の処理、`POST /api/accounts/:id/open`、`POST /api/accounts/:id/threads-check`を動かし、偽のThreads（`apps/api/test/fake-threads`）への問い合わせが0回で、失敗や`needs_reconnect`として記録されない（SC-005、FR-035）。
  - 実装メモ：偽のThreadsに、制御用以外の要求の数（`callCounts().total`）を足して0回を確かめた。自動投稿の処理は、オンの行があっても未接続のアカウントを見ない（試みも作らない）ようにした（`auto-post-runner.ts`）。
- [X] T030 [P] [US4] `apps/api/test/integration/posting-schedule.test.ts`・`threads-check.test.ts`・`auto-post-status.test.ts`・`performance.test.ts`に足す：未接続で`threads-check`が`{ status: "not_connected" }`、`PUT posting-schedule`の`enabled: true`が`THREADS_NOT_READY`（`details: ["not_connected"]`）で`enabled: false`の時刻は保存できる、`GET auto-post`の`notices`の先頭が`{ kind: "not_connected" }`、`GET performance`が`notConnected: true`で数字が空、`GET performance/export`が`ACCOUNT_NOT_CONNECTED`（FR-032・FR-033、contracts/api.md「Threadsが要る機能」）。
  - 実装メモ：4つのファイルに分けず、`apps/api/test/integration/unconnected-guidance-api.test.ts`にまとめた。

### Implementation for User Story 4

- [X] T031 [US4] `apps/api/src/services/threads-check-service.ts`で、`not_connected`なら問い合わせずに`{ status: "not_connected" }`を返す。`apps/api/src/services/posting-schedule-service.ts`の`savePostingSchedule`で`THREADS_NOT_READY`の`details`に`not_connected`を入れ、`toAutoPostState`の`stoppedReason`に`not_connected`を足す。`apps/api/src/services/auto-post-status.ts`で未接続なら知らせ`{ kind: "not_connected" }`を先頭に足す。`apps/api/src/services/performance-service.ts`の`getPerformanceSummary`に`notConnected`を足し、未接続なら数えない。`apps/api/src/routes/performance.ts`の書き出しで`ACCOUNT_NOT_CONNECTED`を返す（research.md R5）。
- [X] T032 [P] [US4] `apps/web/src/components/NotConnectedNotice.tsx`（「Threadsにつなぐと使えます」と、オーナーには「Threadsとの接続」（`/accounts/:id/settings#threads`）へのリンク）と`apps/web/src/components/NotConnectedBanner.tsx`（ホームの控えめな帯。「未接続：Threadsにつなぐと、承認した案を自動で投稿し、反応を分析できます」と、オーナーには「Threadsにつなぐ」）を作る。
- [X] T033 [US4] `apps/web/test/account-home.test.tsx`を先に直し、`apps/web/src/pages/account-home.tsx`で、未接続なら一番上に`NotConnectedBanner`を出し、`nextStep`の前に「承認済みの案が1件以上（`GET /post-drafts/counts`の`approved`）で未接続なら『Threadsにつないで自動投稿を始めましょう』（`/accounts/:id/settings#threads`）」を足す。0件なら今のまま（Clarifications 2026-10-14、FR-034）。
- [X] T034 [US4] `apps/web/test/performance.test.tsx`・`apps/web/test/settings.test.tsx`・`apps/web/test/auto-post-notices.test.tsx`を先に直し、`apps/web/src/pages/performance.tsx`（未接続なら`NotConnectedNotice`だけ。数字・グラフ・一覧・書き出しのメニューを出さない）、`apps/web/src/components/settings/PostingScheduleSection.tsx`・`PostingScheduleDialog.tsx`（未接続なら`NotConnectedNotice`、オンのスイッチを`disabled`にして理由を`aria-describedby`で示す。時刻は保存できる）、`apps/web/src/components/AutoPostNotices.tsx`（`not_connected`の知らせ「承認した案は、Threadsにつないで自動投稿をオンにすると投稿されます」とリンク）を直す。
- [X] T035 [US4] `apps/web/src/pages/account-layout.tsx`の要再接続のバナー、`apps/web/src/components/ReconnectButton.tsx`、`PostingScheduleSection.tsx`の再接続の文言、`apps/web/src/components/connect/TokenWarnings.tsx`（権限の案内）が`not_connected`で出ないことを確かめ、出ていれば直す。`apps/web/test/account-access.test.tsx`に未接続の場合を足す（FR-036）。
  - 実装メモ：確かめは`apps/web/test/account-switcher.test.tsx`（レイアウトのバナー）と`settings-connect.test.tsx`（設定の「接続し直す」）に入れた。

**Checkpoint**：未接続の間に、使えない機能が壊れて見えない（quickstart.md 2の5）。

---

## Phase 7: User Story 5 -ユーザー名がないアカウントの表示(Priority: P2)

**Goal**：アカウントの名前を主にし、未接続を見分けられる。オーナーが名前を直せる。削除はアカウントの名前で確かめる。

**Independent Test**：未接続と接続中のアカウントを1つずつ持ち、切り替えメニュー・ホーム・設定・削除の確認で見え方を確かめ、名前を直すと表示が変わる。

### Tests for User Story 5

- [X] T036 [P] [US5] `apps/api/test/integration/account-rename.test.ts`を作り、`apps/api/test/integration/account-delete.test.ts`を直す：`PATCH /api/accounts/:id { name }`はオーナーだけ（担当の人・見せてもらっている人は拒まれる）、名前「1〜50文字」、チームがあるアカウントなら記録`account_renamed`（`{ from, to }`）。`DELETE`は`{ confirmName }`で、前後の空白を除いたアカウントの名前と一致しなければ`CONFIRMATION_MISMATCH`、未接続のアカウントも消せる（FR-040・FR-043）。
  - 実装メモ：削除の確認（`confirmName`）は Phase 2 で型を変えたときに先に直した（`account-delete.test.ts`・`profile-cascade.test.ts`・`team-leave.test.ts`）。権限の表（`test/helpers/routes.ts`）に`PATCH /api/accounts/:accountId`（owner）を足した。

### Implementation for User Story 5

- [X] T037 [US5] `apps/api/src/services/account-service.ts`に`renameAccount`を作り（`authorizeAccount(..., "owner")`、チームがあれば記録）、`deleteAccount`の確認を`confirmName`にする。`apps/api/src/routes/accounts.ts`に`PATCH /api/accounts/:accountId`を足し、`DELETE`の本文を直す。`apps/web/src/pages/activity.tsx`に`account_renamed`・`threads_connected`の文言を足す。
- [X] T038 [US5] `apps/web/test/account-settings.test.tsx`を先に直し、`apps/web/src/pages/account-settings.tsx`の一番上に「アカウントの名前」の区分（オーナーだけ。入力欄と「保存」、保存後に`queryKeys.me`とアカウントのクエリを取り直す）を足し、削除の確認を「確認のため、{name} と入力してください」・プレースホルダー`{name}`にし、未接続ならトークンの注意（010 FR-050）を出さない（contracts/ui-routes.md「このアカウントの設定」）。`apps/web/src/lib/api-client.ts`に`renameAccount`を足し、`deleteAccount`を`confirmName`にする。
  - 実装メモ：区分は`apps/web/src/components/settings/AccountNameSection.tsx`に分けた。見出しは「アカウントの名前」、入力欄のラベルは「名前」（同じ名前だと見出しとぶつかるため）。テストは`settings-connect.test.tsx`。
- [X] T039 [US5] `apps/web/test/account-switcher.test.tsx`を先に直し、`apps/web/src/components/layout/AccountSwitcher.tsx`の一覧の各行と今のアカウントで、未接続に「未接続」の印（`ConnectionBadge`）を出す（US5-1）。
  - 実装メモ：`ConnectionBadge`ではなく、切り替えメニューの2行目に「未接続」を出す形にした（@ユーザー名の位置。Phase 2 の T009 で実装し、`account-label-usage.test.tsx`で確かめる）。

**Checkpoint**：未接続のアカウントを迷わず見分けられる。

---

## Phase 8: User Story 6 -2つ目以降のアカウントも名前だけで作る(Priority: P2)

**Goal**：切り替えメニューの入口を「アカウントを作る」にする。

**Independent Test**：アカウントを1つ持つ利用者が、切り替えメニューから2つ目を名前だけで作る。上限なら作れない。

- [X] T040 [US6] `apps/web/test/account-switcher.test.tsx`・`apps/web/test/account-create.test.tsx`に足してから、`apps/web/src/components/layout/AccountSwitcher.tsx`の「Threadsアカウントを追加」を「アカウントを作る」（`/accounts/new`）にする。上限に達していても出し、押した先で案内する。2つ目以降はサイドバーの中（`AppShell`）で「登録済み n/m件」を出す（US6-1〜US6-4）。

---

## Phase 9: User Story 7 -未接続のアカウントとチーム(Priority: P3)

**Goal**：未接続のアカウントはチームを作る・入る・足すで選べない。つないだアカウントがない人には、つなぐ案内を出す。

**Independent Test**：未接続のアカウントだけを持つ利用者が招待リンクを開き、参加できず、つなぐ案内が出る。つないだ後にリンクへ戻ると参加できる。

### Tests for User Story 7

- [X] T041 [P] [US7] `apps/api/test/integration/teams.test.ts`・`apps/api/test/integration/invites.test.ts`に足す：未接続のアカウントで`POST /api/teams`・`POST /api/teams/:teamId/accounts`・`POST /api/invites/:token/accept`が`ACCOUNT_NOT_CONNECTED`（`details: [accountId]`）。`GET /api/invites/:token`が、アカウントがあって未接続だけなら`needs_connection`（未接続のアカウントを`connected: false`で返す）、0件なら`needs_account`、つないだものがあれば`ready`で各行に`name`・`connected`（FR-050〜FR-052）。
  - 実装メモ：`teams.test.ts`・`invites.test.ts`には足さず、`apps/api/test/integration/team-unconnected.test.ts`にまとめた。

### Implementation for User Story 7

- [X] T042 [US7] `apps/api/src/services/invite-service.ts`の`assertOwnFreeAccounts`で`not_connected`のアカウントを`ACCOUNT_NOT_CONNECTED`で拒み、`ownedAccountsWithTeam`に`name`・`connected`を足し、`previewTeamInvite`の`needs_connection`を足す（research.md R7）。
- [X] T043 [US7] `apps/web/test/invite-page.test.tsx`・`apps/web/test/team-section.test.tsx`を先に直し、`apps/web/src/pages/invite.tsx`（`needs_account`：「先に、自分のアカウントを作り、Threadsにつないでください」と`/accounts/new?next=/invite/:token`、`needs_connection`：「先に、自分のアカウントをThreadsにつないでください」と最初の未接続のアカウントの`/accounts/:id/settings#threads`（押す前に`rememberInviteReturn`）、`ready`：未接続のアカウントを`disabled`で「Threadsにつなぐと入れられます」）と`apps/web/src/components/team/CreateTeamDialog.tsx`（同じ選べない形。つないだアカウントがなければ「先にThreadsにつないでください」と作るボタンを止める）を直す（contracts/ui-routes.md「招待の確認とチームを作る」）。
  - 実装メモ：チームの画面の「アカウントを足す」の一覧（`apps/web/src/pages/team.tsx`）でも、未接続のアカウントを選べなくした（FR-052。テストは`team-page.test.tsx`）。

**Checkpoint**：011の「1人1Threadsアカウント」が、未接続のアカウントでも守られる（quickstart.md 2の6）。

---

## Phase 10: Polish & Cross-Cutting Concerns

- [X] T044 [P] 文書を直す（spec FR-060、research.md R9）：`specs/001-login-account-setup/spec.md`のFR-005・FR-018、`specs/010-token-account-add/spec.md`のFR-001・FR-013、`specs/011-team-revision/spec.md`のFR-014に「012で改めた」の注を足す。`docs/next-features.md`の「B」を消し（012のspecに移したため）、順番の表の012を「実装中」にする。`docs/ui-design.md`のアカウントの示し方とオンボーディングを直す。
- [X] T045 [P] `apps/web/src/pages/guide-threads-token.tsx`の「追加の画面で」などの文言を「『このアカウントの設定』の『Threadsとの接続』で」に直し、`apps/web/test/guide-page.test.tsx`を直す。
- [X] T046 `apps/web/test/solo-owner-unchanged.test.tsx`を直す：接続中のアカウントだけを持つ人の画面が、「アカウントの名前」の区分と切り替えメニューの「アカウントを作る」を除いて変わらない（SC-007、Constitution原則V）。
- [ ] T047 E2Eを「作ってからつなぐ」に直す：`e2e/tests/onboarding.spec.ts`（名前で作る → 課題 → 案の登録 → 承認 → ホームの「次にやること」→ 設定でトークンでつなぐ → 「自動投稿を始める」）、`e2e/tests/token.spec.ts`・`e2e/tests/reconnect-delete.spec.ts`（削除の確認を名前に）・`e2e/tests/team-flow.ts`・`e2e/tests/helpers.ts`・`e2e/scripts/team-open.ts`。既知の失敗（reconnect-deleteの「再接続」のボタンが2つ）も、この書き直しで直す。
- [ ] T048 `pnpm lint && pnpm typecheck && pnpm test`、`pnpm e2e -- onboarding`・`token`・`team`を通し、quickstart.md 2の1〜7を手で確かめ、結果を`specs/012-accounts-before-connect/verification.md`に残す。

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup（Phase 1）**：すぐに始められる。T001〜T003は並行できる。
- **Foundational（Phase 2）**：Setupの後。T004 → T005・T006 → T007 → T008 → T009 の順（型の変更がAPIとWebの両方に広がるため）。すべてのStoryの前提。
- **US1（Phase 3）**：Foundationalの後。
- **US2（Phase 4）**：US1の後（つなぐ対象の未接続のアカウントを、作るAPIで作るため。テストはヘルパーでも作れるので、T016〜T018は並行して書ける）。
- **US3（Phase 5）**：US2の後（T020の`connect`の手順の上に照合を足す）。
- **US4（Phase 6）**：Foundationalの後ならUS1〜US3と並行できる（API側は`not_connected`の扱いだけ）。ホームの「つなぐ」の入口はUS2の`#threads`を使う。
- **US5（Phase 7）**：Foundationalの後。T038はUS2のT024と同じファイルなので、T024の後。
- **US6（Phase 8）**：US1の後。
- **US7（Phase 9）**：US2の後（つないだ後に招待へ戻る処理がT025にあるため）。
- **Polish（Phase 10）**：すべてのStoryの後。

### Within Each User Story

- テストを先に書き、失敗を確かめてから実装する。
- 共通の型（`packages/shared`）→ API（サービス → ルート）→ Webの順。

### Parallel Opportunities

- Phase 1のT001〜T003。
- 各Storyのテストのタスク（[P]）。
- US4のAPI（T031）と、US5のAPI（T037）は、別のファイルなので並行できる。
- T044・T045は、ほかと独立。

## Parallel Example

```text
# Phase 1
T001 PRD ／ T002 limits.ts・errors.ts ／ T003 account-label.ts

# US1 のテスト
T010 account-create.test.ts ／ T011 unconnected-features.test.ts

# US2 のテスト
T016 threads-connect・callback-guards ／ T017 token-connect・token-reconnect ／ T018 connect-keeps-data

# US4 のテスト
T029 unconnected-threads-calls.test.ts ／ T030 posting-schedule・threads-check・auto-post-status・performance
```

## Implementation Strategy

### MVP First（US1＋US2＋US3）

1. Phase 1・Phase 2を終え、既存のテストが通ることを確かめる（接続中のアカウントの見え方はほぼ変わらない）。
2. US1（名前で作る・中身を使う）→ US2（後からつなぐ）→ US3（二重の登録を防ぐ）。
3. quickstart.md 2の1〜4を確かめる。

### Incremental Delivery

1. MVP（US1〜US3）
2. US4 → 未接続の間の案内。
3. US5・US6 → 表示と名前、入口の文言。
4. US7 → チームの入口。
5. Phase 10 → 文書・E2E・検証の記録。

## Notes

- [P]はファイルと依存が独立しているときだけ付けた。
- テストは各Storyの実装より先に書き、失敗を確かめる。
- アカウントを作る書き込みは`createAccount`、Threadsの接続の書き込みは`completeConnection`以外から書かない。上限の判定は`createAccount`だけ。
- 表示は`accountLabel`を通し、画面ごとに`displayName ?? username`・`@{username}`を書かない。
- タスクの完了の印は、コード・テストの結果・確認の記録を見てから付ける。
