---

description: "Task list for feature 010 token account add"
---

# Tasks:自分のMetaアプリのトークンでアカウントを追加

**Input**: [spec.md](./spec.md)、[plan.md](./plan.md)、[research.md](./research.md)、[data-model.md](./data-model.md)、[contracts/api.md](./contracts/api.md)、[contracts/ui-routes.md](./contracts/ui-routes.md)、[quickstart.md](./quickstart.md)

**Tests**: 001〜009と同じく、テストを先に書いて失敗を確かめてから実装する（TDD）。特にSC-003（二重登録の3通り）、SC-004（平文を出さない）、SC-005（方法の切り替えでデータが残る）、SC-006（延長）、SC-007（追加の画面が変わらない）、FR-015（失敗の待ち）、FR-012（確かめ直し）を自動テストで確かめる。実際のMetaアプリでの確認とSC-002（手順のページ）はquickstart.mdの手動の確認で行う。

**Organization**: User Storyごとに分ける。MVPはUS1＋US2（どちらもP1）。

## Format: `[ID] [P?] [Story] Description`

- **[P]**:別ファイルで、未完了のタスクに依存せず並行できる。
- **[Story]**: [US1]〜[US5]はspec.mdのUser Storyに対応する。
- すべてのタスクに、変更または確認する正確なパスを書く。

## Phase 1: Setup

**Purpose**:定数・エラーのcode・トークンの形の判定。

- [X] T001 [P] `packages/shared/src/limits.ts`に定数を足す：`TOKEN_CHECK_FAILURE_LIMIT = 5`、`TOKEN_CHECK_WINDOW_MINUTES = 10`、`TOKEN_CHECK_LOCK_MINUTES = 10`、`TOKEN_RECHECK_DELAY_MINUTES = 120`、`TOKEN_RECHECK_RETRY_MINUTES = 10`、`TOKEN_RECHECK_BATCH = 20`、`TOKEN_MIN_LIFETIME_HOURS = 48`、`TOKEN_ASSUMED_LIFETIME_DAYS = 60`、`TOKEN_MIN_LENGTH = 32`、`TOKEN_MAX_LENGTH = 2048`（plan.md「制約」）。
- [X] T002 [P] `packages/shared/test/token.test.ts`を先に書き、`packages/shared/src/token.ts`に`cleanToken(raw)`（前後の空白・改行・引用符`"` `'` `` ` ``を取り除く）と`isTokenShaped(token)`（「32〜2048文字、英数字と`_ - . |`だけ」。research.md R1）を作り、`packages/shared/src/index.ts`から出す。
- [X] T003 [P] `packages/shared/src/errors.ts`にcode `TOKEN_INVALID`・`TOKEN_SHORT_LIVED`・`TOKEN_CHECK_LOCKED`・`ACCOUNT_ALREADY_REGISTERED`・`THREADS_UNAVAILABLE`と、contracts/api.md「文言」の文言を足す（`TOKEN_CHECK_LOCKED`は`{minutes}`、`RECONNECT_ACCOUNT_MISMATCH`のトークン用の文は`{username}`を差し込む）。`packages/shared/test/errors.test.ts`（新規）に文言のテストを書く。

---

## Phase 2: Foundational（すべてのStoryの前提）

**Purpose**: DB・Threadsのクライアント・偽のThreads・確定の処理の共通化。ここが終わるまでStoryに入らない。

- [X] T004 `apps/api/src/db/schema.ts`に、列挙型`connection_method`（`app`・`token`）、`accounts.connection_method`（「`'app'`（NOT NULL）」）・`accounts.reconnect_hint`（`text` NULL、値は`short_lived_token`だけ）、`threads_connections.recheck_at`（`timestamptz` NULL）、表`token_check_failures`（`id` uuid PK、`user_id` uuid NOT NULL → `users.id` ON DELETE CASCADE、`failed_at` timestamptz NOT NULL、`reason` text NOT NULL：`invalid_format`・`invalid`・`short_lived`・`account_mismatch`）、索引`accounts_username_lower_idx`（`lower(username)`、一意にしない）・`threads_connections_recheck_idx`（`WHERE recheck_at IS NOT NULL`）・`token_check_failures_user_time_idx`（`(user_id, failed_at)`）を足す（data-model.md）。`pnpm --filter api db:generate`で`apps/api/drizzle/0011_token_connect.sql`を作り、既存の行が`app`になることを確かめる。`apps/api/test/helpers/app.ts`の`resetDb`のTRUNCATEに`token_check_failures`を足す。
- [X] T005 [P] `apps/api/test/integration/threads-debug-client.test.ts`を先に書き、`apps/api/src/lib/threads-client.ts`の`ThreadsClient`に`debugToken(token)`（`GET /v1.0/debug_token?access_token=<T>&input_token=<T>`。`{ isValid, expiresAt: Date | null（0はnull）, issuedAt: Date | null, scopes: string[] }`を返す。エラーの分け方は他の呼び出しと同じ）を足す（research.md R3）。トークンをURLに載せるのはこの呼び出しだけなので、`logger`に出すURLからクエリを落とすことを確かめるテストを含める。
- [X] T006 [P] `apps/api/test/fake-threads/server.ts`に、(1) `POST /__test/tokens`（`{ user, appScope, lifetime: "long" | "short", debug: boolean, scopes: string[] }`でトークンを発行）、(2) `GET /v1.0/debug_token`（`debug: false`のトークンは権限のエラー）、(3) `appScope`ごとに違うユーザーIDを返す`/me`、(4) `scopes`に`threads_content_publish`・`threads_manage_insights`がなければ投稿の上限・フォロワー数で権限のエラー、(5)トークンを無効にする`POST /__test/tokens/:token/revoke`、(6)画面で作る`GET /__test/token`（ユーザー・アプリ・長期／短期・debugの有無・権限を選んでトークンを表示する簡単なHTML）を足す（research.md R13）。`apps/api/test/helpers/app.ts`の`fake`に`issueToken(opts)`・`revokeToken(token)`を足す。
- [X] T007 `apps/api/test/integration/threads-connect.test.ts`・`reconnect.test.ts`・`threads-callback-guards.test.ts`が通ったまま、`apps/api/src/services/account-service.ts`の`completeConnection`の入力を`ConnectionRequest = { userId, mode: "new" | "reconnect", targetAccountId, startedAt, method: "app" | "token" }`＋トークン・期限・`issuedAt`・`scopes`・`recheckAt`・`insightsDenied`に広げ、`writeConnection`で`connection_method`・`threads_user_id`・`scopes`・`issued_at`・`recheck_at`を書き、`reconnect_hint`を消す（research.md R5・R7）。`apps/api/src/routes/threads-connect.ts`のcallbackはstateの行から`ConnectionRequest`（`method: "app"`）を作る。
- [X] T008 `apps/api/src/db/locks.ts`に`lockThreadsUsername(tx, normalizedUsername)`（`threads_username:<name>`のアドバイザリーロック）を足し、`completeConnection`のロックの順序を「Threadsユーザー → ユーザー名 → usersの行」にする。`apps/api/src/db/locks.ts`の先頭の説明（ロックの順序）を直す（research.md R6）。
- [X] T009 [P] `packages/shared/src/schemas.ts`のAccountの要約に`connectionMethod`（`app`・`token`）と`reconnectHint`（`short_lived_token`またはNULL）を足し、`apps/api/src/services/access.ts`の`toAccountSummary`で返す。`apps/api/test/integration/me.test.ts`に、既存のAccountが`connectionMethod: "app"`・`reconnectHint: null`になることのテストを足す（contracts/api.md「変わるAPI」）。

**Checkpoint**：既存のテスト（shared・web・api）がすべて通る。OAuthの流れは変わらない。

---

## Phase 3: User Story 1 -自分のMetaアプリのトークンを貼ってアカウントを追加する(Priority: P1) 🎯 MVP

**Goal**：追加の画面の2つ目の方法から、長期トークンを貼り付けてAccountを作れる。権限がなければ案内が出る。無効・短期・形の違う文字列は弾き、10分に5回の失敗で10分待ち。

**Independent Test**：偽のThreadsで作った長期トークンを貼り付け、Accountが作られ、プロフィールが出て、投稿の権限の確認が「投稿できます」になる。

### Tests for User Story 1

- [X] T010 [P] [US1] `apps/api/test/integration/token-connect.test.ts`を作る：長期トークンで`kind: "new"`・オーナーのMembership・`connection_method = 'token'`・`expires_at`が`debug_token`の値、`debug: false`のトークンで`expires_at`が60日後・`recheck_at`が2時間後、権限のないトークンで`warnings`と`insights_denied_at`、無効・短期（「`expires_at`が今から48時間未満」）・形が違う文字列で`TOKEN_INVALID`・`TOKEN_SHORT_LIVED`、Threadsの一時的な失敗で`THREADS_UNAVAILABLE`（失敗に数えない）、上限で`ACCOUNT_LIMIT_REACHED`、同じトークンの同時の2回でAccountは1つ（FR-014）（US1-3〜US1-7、FR-010〜FR-014）。加えて`apps/api/test/integration/token-auto-post.test.ts`を作り、005の`test/helpers/auto-post.ts`（`approvedDrafts`・`setSchedule`・`run`・`publishedDrafts`）を使って、`connection_method = 'token'`のAccountで、承認済みの案が予定の時刻に投稿されること、登録済みのNGワードを含む承認済みの案は直前の確認で投稿されないこと、要確認の案は投稿されないことを確かめる（FR-042、Constitution原則I・II）。
- [X] T011 [US1] 同じファイルに失敗の待ちのテストを足す：10分の間に5回失敗すると6回目は`TOKEN_CHECK_LOCKED`（429、`details: [残りの秒]`）でThreadsに問い合わせない、10分後に確かめられる、成功しても失敗の数は消えない、形で弾いたものも数える（FR-015、research.md R9）。
- [X] T012 [P] [US1] `apps/api/test/integration/secrets.test.ts`に、`token-connect`の成功・失敗の応答・`console`へのログ・`activity_logs`・CSVの書き出しに、貼り付けたトークンの文字列が含まれないことのテストを足す（SC-004、FR-043）。
- [X] T013 [P] [US1] `apps/api/test/integration/permissions-matrix.test.ts`の表に`POST /api/threads/token-connect`（`mode: "new"`はログイン済みなら誰でも、`mode: "reconnect"`は`owner`）を足す。
- [X] T014 [P] [US1] `apps/web/test/account-new-token.test.tsx`（新規。上限の表示は既存の`account-new-limit.test.tsx`のまま）に：2つ目の方法は初め閉じていて、開くまで入力欄が出ない（SC-007）、開くと手順5つ・「詳しい手順を見る」・入力欄（`type="text"`・`autocomplete="off"`・`data-1p-ignore`・文字を隠すclass、「表示」で外れる）・説明・利用規約のリンク・「追加する」、形の違う文字列では送信しない、`TOKEN_CHECK_LOCKED`で残りの分とボタンの無効、`ACCOUNT_ALREADY_REGISTERED`で設定へのリンク、成功で`/accounts/:id?connected=new&warn=…`へ移る、のテストを書く（contracts/ui-routes.md）。
- [X] T015 [P] [US1] `apps/web/test/terms-page.test.tsx`に、`/terms`がログインなしで開け、FR-052の項目（トークンでの接続の扱い・禁止事項・データの削除の案内）が出ること、トップページの足元に「利用規約」のリンクがあることのテストを書く。

### Implementation for User Story 1

- [X] T016 [US1] `apps/api/src/services/token-connect.ts`を作る：`checkFailureLock`（usersの行ロックの中で直近10分の失敗を数える）・`recordFailure`・`inspectToken`（プロフィール → `debugToken` → `getPublishingLimit` → `getFollowersCount`。research.md R2〜R4）・`connectWithToken(env, threads, user, req)`（R1〜R9の順で、確定は`completeConnection`（`method: "token"`））。トークンは引数とローカルの変数の中だけで持ち、ログに渡さない。
- [X] T017 [US1] `packages/shared/src/schemas.ts`に`tokenConnectRequestSchema`（`{ mode: "new", token }`か`{ mode: "reconnect", accountId, token }`、`token`は1〜4096文字の文字列）と`tokenConnectResponseSchema`（`accountId`・`kind`・`username`・`warnings: ("no_publish_permission" | "no_insights_permission")[]`）を足す。`apps/api/src/routes/threads-connect.ts`に`POST /api/threads/token-connect`を足し（本文は2KBまで）、`recheck_at`を入れたら005の`autopost:wake`を書く（contracts/api.md）。
- [X] T018 [US1] `apps/web/src/lib/api-client.ts`に`tokenConnect(req)`を足す。`apps/web/src/components/connect/TokenConnectForm.tsx`を作る：手順5つ・「詳しい手順を見る」（`/guide/threads-token`、新しいタブ）・入力欄（`type="text"`・`autocomplete="off"`・`autoCorrect="off"`・`autoCapitalize="off"`・`spellCheck={false}`・`data-1p-ignore`・`data-lpignore="true"`。文字はCSSの`-webkit-text-security: disc`で隠し、「表示」で外す。パスワード欄にしないのは、ブラウザやパスワード管理ツールにトークンを保存させないため（FR-003）。対応していないブラウザでは文字が見えるので、欄の下に「周りに人がいないところで貼り付けてください」と添える）・`isTokenShaped`での先の判定・説明と利用規約のリンク・送信ボタン・エラーの`Alert`（`TOKEN_CHECK_LOCKED`は残りの時間だけボタンを無効）。`mode`と送信の後の動きはpropsで受ける（contracts/ui-routes.md）。
- [X] T019 [US1] `apps/web/src/pages/account-new.tsx`の主のボタンと検証期間の案内の下に、折りたたみの行「自分のMetaアプリのトークンで追加する」（`aria-expanded`）を足し、開くと`TokenConnectForm`（`mode: "new"`）を出す。上限に達していれば、開いても上限の案内を出す。成功で`/accounts/:id?connected=new`（`warnings`があれば`&warn=publish,insights`）へ移る。
- [X] T020 [US1] `apps/web/src/lib/callback-result.ts`と`apps/web/src/pages/account-home.tsx`で`warn`のクエリを読み、ホームの上部に`Alert`を1回出す（文言はcontracts/ui-routes.md 6）。
- [X] T021 [P] [US1] `apps/web/src/pages/terms.tsx`を作り（FR-052の項目、最終更新日2026-10-10、`CenteredLayout`の幅）、`apps/web/src/router.tsx`にログイン不要の`/terms`を足し、`apps/web/src/pages/landing.tsx`の足元に「利用規約」のリンクを置く。
- [X] T022 [P] [US1] `specs/001-login-account-setup/spec.md`のFR-008の末尾に「ただし、利用者が自分のMetaアプリで作ったトークンを貼り付ける方法（[010](../010-token-account-add/spec.md)）を除く。」を書き足す（FR-004）。

**Checkpoint**：トークンでの追加が単独で動く。OAuthの追加の画面は、2つ目の方法を開かなければ今と同じ。

---

## Phase 4: User Story 2 -同じアカウントの二重登録を防ぐ(Priority: P1)

**Goal**：ユーザーIDに加えてユーザー名で照合し、どちらの方法の組み合わせでもAccountは1つ。ユーザー名だけが一致したら相手の今の名前を確かめる。

**Independent Test**：このアプリの接続で登録済みのThreadsアカウントを、別のMetaアプリのトークン（別のユーザーID）で追加しようとして、Accountが作られない。

### Tests for User Story 2

- [X] T023 [P] [US2] `apps/api/test/integration/token-duplicate.test.ts`を作る：(a)このアプリの接続 → 同じユーザー名・別IDのトークンで`ACCOUNT_ALREADY_REGISTERED`（`details: [accountId]`）、(b)トークン → このアプリの接続で`kind: "updated"`（新しいAccountを作らず、接続の方法が`app`になる）、(c)トークン → 別の`appScope`のトークンで`ACCOUNT_ALREADY_REGISTERED`、(d)他の利用者のAccountと一致で`THREADS_ACCOUNT_TAKEN`（登録した人を明かさない）、(e)ユーザー名の大文字・小文字の違いでも一致、(f) 2つの要求が同時に同じユーザー名で来てもAccountは1つ（SC-003、FR-020〜FR-022）。
- [X] T024 [US2] 同じファイルにFR-023のテストを足す：ユーザー名だけが一致し、相手のAccountのプロフィールを取り直すと別の名前 → 相手の`username`を更新して追加を続ける。相手が要再接続・取り直せない → 一致したものとして`THREADS_ACCOUNT_TAKEN`または`ACCOUNT_ALREADY_REGISTERED`。取り直しのやり直しは1回まで。

### Implementation for User Story 2

- [X] T025 [US2] `apps/api/src/services/account-service.ts`の既存のAccountの探し方を`threads_user_id = ID OR lower(username) =正規化したユーザー名`に変え、新規の要求で自分のものと一致したら、`method: "app"`は001どおり更新（`kind: "updated"`、方法を`app`に）、`method: "token"`は`ACCOUNT_ALREADY_REGISTERED`（`details: [accountId]`）、他人なら`THREADS_ACCOUNT_TAKEN`にする。新しいIDが別のAccountの`threads_user_id`と重なるときも同じ扱いにする（research.md R6・R7）。
- [X] T026 [US2] `apps/api/src/services/token-connect.ts`と`apps/api/src/routes/threads-connect.ts`のcallbackで、確定の前に「ユーザー名だけが一致するAccount」を探し、その保存済みトークンでプロフィールを取り直して、名前が違えば`accounts.username`を更新してから確定する（1回まで。復号できない・要再接続・認証のエラーなら取り直さない）（FR-023）。
- [X] T027 [US2] `apps/web/src/components/connect/TokenConnectForm.tsx`の`ACCOUNT_ALREADY_REGISTERED`の`Alert`に「そのアカウントの設定を開く」（`/accounts/:id/settings`）を出す（US2-1）。

**Checkpoint**：MVP（US1＋US2）。二重登録の3通りで、Accountは1つしかできない。

---

## Phase 5: User Story 3 -接続し直すときに方法を選ぶ(Priority: P2)

**Goal**：オーナーが「接続し直す」で、このアプリの接続とトークンのどちらかを選べる。方法が変わってもデータは残る。

**Independent Test**：トークンで接続したAccountを、このアプリの接続で接続し直し、投稿ストック・戦略・設定・記録の件数が同じ。逆も同じ。

### Tests for User Story 3

- [X] T028 [P] [US3] `apps/api/test/integration/token-reconnect.test.ts`を作る：トークンでの接続し直し（要再接続から接続中、`connection_generation`が増える、登録の上限でも使える）、`app` → `token`と`token` → `app`の切り替えで、投稿ストック・戦略・設定・NGワード・操作の記録の件数が同じでユーザーIDが新しい値になる（SC-005、FR-033）、別のThreadsアカウントのトークンで`RECONNECT_ACCOUNT_MISMATCH`（失敗に数える）、OAuthでの接続し直しも「IDが同じ、またはユーザー名が同じ」で通る（FR-032）、パートナー・編集者は`ROLE_FORBIDDEN`（FR-034）、`reconnect_hint`が消える。トークンで接続し直したとき、`debug_token`で期限を読めなければ`recheck_at`が2時間後に入り、読めれば入らないこと（FR-012）。
- [X] T029 [P] [US3] `apps/api/test/integration/activity.test.ts`に、チームがあるAccountで、どちらの方法の接続し直しも`threads_reconnected`（`kind: settings`、`details.method`）が1行ずつ記録され、チームがなければ記録されないことのテストを足す（FR-035、research.md R11a）。
- [X] T030 [P] [US3] `apps/web/test/reconnect-dialog.test.tsx`を作る：設定の「Threadsとの接続」に「今の接続：…」が出る、ボタンでダイアログが開き2つの選択と「今の接続」のラベル、「トークンを貼り付ける」で`TokenConnectForm`（ボタン「接続し直す」）、成功でトースト「接続し直しました」、`reconnectHint`で短期トークンの文、パートナー・編集者には出ない、削除の確認に「Metaアプリ側のトークンは…」（`token`のときだけ）。要再接続のバナーは、オーナーで`connectionMethod === "token"`なら「トークンが使えなくなりました。新しいトークンを貼り付けて接続し直してください。」、`app`なら001の文のまま、パートナー・編集者には008の「オーナーの再接続待ち」のままであること（FR-041）。

### Implementation for User Story 3

- [X] T031 [US3] `apps/api/src/services/account-service.ts`の接続し直しの判定を「IDが同じ、またはユーザー名が同じ」に広げ（research.md R7）、`apps/api/src/services/token-connect.ts`の`mode: "reconnect"`をルートとトランザクションの中の両方で`authorizeAccount(..., "owner")`に通す。
- [X] T032 [US3] `apps/api/src/services/activity-log.ts`と`completeConnection`の接続し直しの枝で、チームがあるAccountだけ`threads_reconnected`（`kind: "settings"`、`details: { method }`）を同じトランザクションで記録する（OAuthのcallbackでも）。`apps/web/src/pages/activity.tsx`に文言「Threadsとの接続し直しをしました（このアプリで許可）」／「（自分のMetaアプリのトークン）」を足す。
- [X] T033 [US3] `apps/web/src/components/connect/ReconnectDialog.tsx`を作る（PCは中央のダイアログ、スマートフォンは下からのシート。見出し「Threadsとの接続し直し」、本文、2つの選択と「今の接続」、トークンを選ぶと`TokenConnectForm`（`mode: "reconnect"`））。`apps/web/src/components/ReconnectButton.tsx`をダイアログを開く形に変える（`accountId`のほかに、今の方法とユーザー名を受け取る）。
- [X] T034 [US3] `apps/web/src/pages/account-settings.tsx`の「Threadsとの接続」に「今の接続：このアプリで許可／自分のMetaアプリのトークン」と`reconnectHint`の文を出し、ボタン（「接続し直す」）でダイアログを開く。Accountの削除の確認に、`connectionMethod === "token"`のときだけ「Metaアプリ側のトークンは、必要なら自分で取り消してください。」を足す（FR-050）。
- [X] T035 [US3] 要再接続のバナー（`apps/web/src/pages/account-layout.tsx`のバナーと`packages/shared/src/errors.ts`のバナーの文言）で、オーナー・`connectionMethod === "token"`のときは「トークンが使えなくなりました。新しいトークンを貼り付けて接続し直してください。」を出す（FR-041）。パートナー・編集者は008のまま。

**Checkpoint**：どちらの方法からでも、どちらの方法へも接続し直せる。

---

## Phase 6: User Story 4 -トークンでの接続を自動で保つ(Priority: P2)

**Goal**：トークンの接続も日次で延長され、期限を確かめられなかったトークンは2時間後に確かめ直す。

**Independent Test**：期限まで7日を切ったトークンの接続が日次の処理で延長される。`debug_token`なしで追加したトークンを無効にすると、2時間後の確かめ直しで要再接続と短期トークンの文。

### Tests for User Story 4

- [ ] T036 [P] [US4] `apps/api/test/integration/token-refresh.test.ts`に、`connection_method = 'token'`の接続が001と同じ条件で延長され、プロフィールの取り直しでユーザー名が新しくなることのテストを足す（SC-006、FR-040）。
- [ ] T037 [P] [US4] `apps/api/test/integration/token-recheck.test.ts`を作る：`recheck_at`を過ぎた接続で、有効なら`recheck_at`が消える（`debug_token`が読めれば期限を直す）、認証のエラーなら要再接続・`reconnect_hint = 'short_lived_token'`・`recheck_at`が消える、一時的な失敗なら`recheck_at`が10分延びる、その間に接続し直していれば（世代番号が違う）結果を捨てる、1回で最大20件（FR-012、research.md R8）。
- [ ] T038 [P] [US4] `apps/api/test/integration/auto-post-gate.test.ts`に、関所の「次に見る時刻」に`recheck_at`の最も早い時刻が入ること、`recheck_at`がなければ今と同じ時刻になること、`token-connect`が`autopost:wake`を書くことのテストを足す。

### Implementation for User Story 4

- [ ] T039 [US4] `apps/api/src/services/token-recheck.ts`を作り（`selectRecheckDue`・`recheckOne`、世代番号を条件に書く）、`apps/api/src/services/auto-post-runner.ts`のDBの処理で呼び、関所の候補に`min(recheck_at)`を足す（research.md R8、contracts/api.md「定期処理」）。
- [X] T040 [US4] `apps/api/src/services/daily-jobs.ts`に「`token_check_failures`の`failed_at`が1日より前の行を消す」を足し、`apps/api/test/integration/token-connect.test.ts`に消えることのテストを足す。

**Checkpoint**：トークンの接続が、利用者の操作なしで接続中のまま保たれる。

---

## Phase 7: User Story 5 -トークンの作り方の詳しい手順を読む(Priority: P3)

**Goal**：Metaアプリを持っていない人が、公開のページだけでトークンを作れる。

**Independent Test**：`/guide/threads-token`がログインなしで開け、6つの手順と取り消し方・うまくいかないときが読める。

- [X] T041 [P] [US5] `apps/web/test/guide-page.test.tsx`に、`/guide/threads-token`がログインなしで開け、節（はじめに・1〜6・取り消し・うまくいかないとき）と各手順の「この手順の目的」、確かめた日が出ることのテストを書く。
- [X] T042 [US5] `apps/web/src/pages/guide-threads-token.tsx`を作り（contracts/ui-routes.md「トークンの作り方」、画面の写真なし）、`apps/web/src/router.tsx`にログイン不要の`/guide/threads-token`を足す。
- [ ] T043 [P] [US5] `docs/threads-token-guide.md`を作る：画面の手順（追加の画面の5つ・`/guide/threads-token`）の元の文、Metaの画面の名前が変わったときに直すファイル（`TokenConnectForm.tsx`・`guide-threads-token.tsx`）、確かめた日、`debug_token`の応答の形（T047の結果）。`README.md`と`docs/external-services-setup.md`から案内する。

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T044 [P] FR-060：`.specify/memory/constitution.md`を3.0.1（PATCH、Last Amended 2026-10-10）にし、原則Vの「決済（feature 009）」を「決済（feature 011）」に直す（Sync Impact Reportはファイルの先頭に残さない。research.md R12）。`specs/008-team-operations/spec.md` FR-080・`research.md` R15・`contracts/permissions.md`、`_bmad-output/initiative-threads-grower-app/prd-threads-grower-app/prd-threads-grower-app.md` §6.1の「009（決済）」を「011（決済）」に直す。`grep -rn "009（決済）\|feature 009" specs .specify _bmad-output docs`で残りがないことを確かめる。
- [ ] T045 [P] `e2e/tests/token.spec.ts`を作る：偽のThreadsの`/__test/token`で作ったトークンを貼って追加 →「今の接続：自分のMetaアプリのトークン」→ 同じアカウントの別アプリのトークンで「すでに登録されています」→ 接続し直しで「Threadsで許可する」に切り替え、投稿ストックが残る（quickstart.md 2）。`pnpm e2e -- token`で通す。
- [ ] T046 [P] `docs/ui-design.md`に、追加の画面の折りたたみ・接続し直しのダイアログ・公開の読み物のページ（`/terms`・`/guide/threads-token`）の項を足す。
- [ ] T047 実際のMetaアプリ（ThreadsAutomation）のトークンで`debug_token`を呼び、応答の形（`data`の下か、`expires_at`・`scopes`の有無）を確かめてresearch.md R3の末尾に1行で書く。形が違えばT005の`debugToken`を直す。トークンの値は記録しない（ユーザーの手を借りる）。
- [ ] T048 `pnpm lint`・`pnpm typecheck`・`pnpm test`・`pnpm build`・`pnpm e2e -- token`・`pnpm e2e -- team`を流し、`specs/010-token-account-add/verification.md`に結果（件数・気づいたこと・計画からの変更）と、手動の確認（quickstart.md 3、SC-002）の予定を書く。手動の確認で、実際のトークンを貼り付けてから追加が終わるまでの時間（planの目標はふつう3秒以内）と、追加の画面を開いてから終わるまでの時間（SC-001の2分以内）を測り、verification.mdに書く。

---

## Dependencies & Execution Order

### Phaseの依存

- **Setup（Phase 1）**：すぐ始められる。T001〜T003は並行できる。
- **Foundational（Phase 2）**：Setupの後。T004 → T007 → T008（同じファイル`account-service.ts`）。T005・T006はT004と並行できる。T009はT004（列の追加）の後に、T005・T006と並行できる。**すべてのStoryの前提**。
- **US1（Phase 3）**：Phase 2の後。
- **US2（Phase 4）**：Phase 2の後。T025・T026は`account-service.ts`・`token-connect.ts`を触るため、T016（US1）の後にする。
- **US3（Phase 5）**：US1（`TokenConnectForm`・`token-connect.ts`）の後。
- **US4（Phase 6）**：US1（`recheck_at`を入れる処理）の後。US3とは並行できる。
- **US5（Phase 7）**：Phase 2の後ならいつでも（画面は独立）。T018のリンク先になるので、US1と同じ頃に作るとよい。
- **Polish（Phase 8）**：T044・T046はいつでも。T045はUS1〜US3の後。T047はT005の後。T048は最後。

### Storyの中の順

- テスト（失敗を確かめる）→ スキーマ → サービス → ルート → 画面。

### 並行の例

```text
# Phase 1
T001 limits.ts ／ T002 token.ts ／ T003 errors.ts

# Phase 2（T004 の後）
T005 debugToken ／ T006 偽のThreads ／ T009 Accountの要約

# US1 のテスト
T010・T011 token-connect.test.ts（同じファイルなので順に）／ T012 secrets.test.ts ／ T013 permissions-matrix ／ T014 account-new.test.tsx ／ T015 terms-page.test.tsx

# US4 と US3 のテスト
T028 token-reconnect ／ T029 activity ／ T030 reconnect-dialog ／ T036 token-refresh ／ T037 token-recheck ／ T038 auto-post-gate
```

## Implementation Strategy

### MVP First（US1＋US2）

1. Phase 1・Phase 2を終え、既存のテストがすべて通ることを確かめる（OAuthの流れは変わらない）。
2. US1（トークンでの追加・失敗の待ち・利用規約）→ US2（二重登録の防止）。
3. quickstart.md 2の1〜5で、偽のThreadsでの追加と二重登録の防止を確かめる。ここで、テスター招待なしで利用者が使い始められる。

### Incremental Delivery

1. MVP（US1＋US2）
2. US3 → 接続し直しで方法を選べる（トークンの期限切れから戻せる）。
3. US4 → 2時間後の確かめ直し。延長はPhase 2の時点でOAuthと同じく動く。
4. US5 → 詳しい手順のページ。
5. Phase 8 → 文書の番号・E2E・実際のMetaアプリでの確認・検証の記録。

## Notes

- [P]はファイルと依存が独立しているときだけ付けた。
- テストは各Storyの実装より先に書き、失敗を確かめる。
- トークンの平文は`token-connect.ts`の関数の中だけで持つ。ログ・エラーの`details`・記録に渡さない。
- タスクの完了の印は、コード・テストの結果・確認の記録を見てから付ける。
