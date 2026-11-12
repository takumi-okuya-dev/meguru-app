---

description: "Task list for feature meguru/029 Threads pattern ①"
---

# Tasks：Threadsをパターン①にそろえる（2作目より前に）

**Input**：[spec.md](./spec.md)、[plan.md](./plan.md)、[research.md](./research.md)、[data-model.md](./data-model.md)、[contracts/platform-entry.md](./contracts/platform-entry.md)、[contracts/api-routes.md](./contracts/api-routes.md)、[contracts/module-boundaries.md](./contracts/module-boundaries.md)、[quickstart.md](./quickstart.md)

**Tests**：動きを変えない作り直しなので、今あるテスト（共通517件・Web 803件・API 1,285件・E2E 19件）が主な確かめ。新しい仕組み（利用権・出来事・利用の数・マイグレーション・境界の規則・`/api/threads/me`）のテストは、**先に書いて失敗を確かめてから**作る。

**Organization**：PRは5つ（research.md R12）。PRの順に Phase を並べ、各タスクに spec.md の User Story を付ける。**PR1＝Phase 1〜2、PR2＝Phase 3、PR3＝Phase 4、PR4＝Phase 5、PR5＝Phase 6〜7**。各PRは、下書き → セルフレビュー → `run-ci` → Ready for review（Codex）の順で出す（[release-runbook.md](../../../docs/release-runbook.md) 2）。

## Format：`[ID] [P?] [Story] Description`

- **[P]**：別ファイルで、未完了のタスクに依存せず並行できる。
- **[Story]**：[US1]〜[US5]は spec.md の User Story。US4（動きを変えない・データを残す）は、すべての Phase の最後の確かめに当たる。
- 移動のしかた：ファイルの移動は`git mv`で行い、読みこみ先の相対パスは機械的に直す。中身を変えるタスクは、その旨を書く。

---

# PR1：共通の土台（動きは変えない）

## Phase 1：Setup（基準を残す）

- [X] T000 [US5] Constitution の「アプリのデータの分け方」を、作り始める前に改める（MINOR：4.9.0）。「すべてのアプリ（Threadsを含む）はパターン①」「Threadsは029でそろえる。そろえ終えるまでは029のPRの順に移る途中の形を認める」「チームはThreadsの機能」と書く（/speckit-analyze D1。2026-11-12に済ませた）。
- [X] T001 （T004に含めた：新しい関数と今の関数を同じデータで直接比べる形にした）今の利用権の判定を、あとで比べられるように、状態ごとの結果をテストの期待する値として書き出す（契約中・未払いの読むだけ・契約前・料金なしの印・運営者・テスト用のグループ・機能のOFF・024の前の無料体験の途中）。`apps/api/test/integration/entitlement-baseline.test.ts`：今の`loadEntitlement`・`effectiveLimits`・`featureOnSql`系の結果を、同じデータで確かめる（この時点で通る）。
- [X] T002 [P] （T005とPR2のT018に含めた）今の料金の数（`countOwned`）と「使っているアプリ」（`resolveMeApps`）の判定を、利用者の種類ごと（持ち主・チームだけ・どちらもない）に確かめるテストを、`apps/api/test/integration/usage-baseline.test.ts`に書く（この時点で通る）。

## Phase 2：共通の土台（PR1）

**Goal**：共通の入口の関数・出来事・利用の数・機能と上限の「アプリ・名前」を作る。Threadsはまだ今の読み方のまま（PR2で切り替える）。

### テスト（先に書いて失敗を確かめる）

- [X] T003 [P] [US2] `apps/api/test/integration/platform-events.test.ts`：`emitEvent`を書いたトランザクションが戻ったら出来事も残らない・書いたら届け先ごとに`pending`の行ができる・`deliverPendingEvents`で受け取りが呼ばれて`done`になる・受け取りが例外なら`attempts`が増えて`next_attempt_at`が後ろへ（5分・10分・…・最大1時間）・10回で`failed`になりログが出る・`pending`がないときは何もしない（contracts/platform-entry.md 3・6）。
- [X] T004 [P] [US2] `apps/api/test/integration/entitlement.test.ts`：新しい`loadEntitlement`・`loadEntitlements`が、T001の8つの状態で今の判定と同じ`Entitlement`を返す。まとめて読んでも1人ずつと同じ。見つからない番号は`access: "none"`（contracts/platform-entry.md 2）。
- [X] T005 [P] [US2] `apps/api/test/integration/app-usage.test.ts`：`reportUsage`が`app_usage`を書く・数が変わったら`subscriptions.quantity_sync_needed`が付く・同じ数なら付かない・行がない人は数0・使っていないとみなす（contracts/platform-entry.md 4）。
- [X] T006 [P] [US2] `apps/api/test/unit/app-registry.test.ts`：`registerAppFeatures`・`registerAppLimits`の登録・何度呼んでも1回だけ・登録していない名前は確かめで落ちる・上限の範囲を確かめる（contracts/platform-entry.md 5）。

### マイグレーション

- [X] T007 [US2] `apps/api/src/platform/schema.ts`に、`platformEvents`・`platformEventDeliveries`・`appUsage`・`userAppLimits`・`appLimitDefaults`を足し、`featureDisables`・`groupFeatureDisables`・`featureSettingEvents`に`app`（`NOT NULL DEFAULT 'threads'`）を足して主キーと`CHECK`を替える（data-model.md 1-1・2）。`pnpm --filter api db:generate`でマイグレーションを作り、SQLを読む。
  - SQLの末尾に、今のデータの写しを足す（`--> statement-breakpoint`で区切る）：`app_usage`は`memberships`（持ち主の数）とチームに入っているかから全員分、`user_app_limits`は`users.account_limit`・`daily_post_limit`の値がある人、`app_limit_defaults`は`operator_settings`の2つの既定の値。
- [X] T008 [US2] `apps/api/test/migration/migration-00NN.test.ts`（T007の番号）：前の番号まで当ててデータを入れ、当てたあとに`app_usage`・上限の表の値が元の列と一致し、機能のON/OFFの行が`app = 'threads'`で残ることを確かめる。

### 実装

- [X] T009 [US2] `apps/api/src/platform/events/`を作る：`emitEvent(tx, type, payload)`・`registerConsumer(consumer, type, handler)`（何度呼んでも1回だけ）・`deliverPendingEvents(env)`（届け先ごとに`pending`で時刻の来たものを古い順に、1回の上限つきで届ける）。T003を通す。
- [X] T010 [US2] `apps/api/src/index.ts`の5分ごとの定期処理の最初に`deliverPendingEvents`を足す。`apps/api/src/jobs/daily-jobs.ts`に、届け先がすべて`done`で30日たった出来事を消す処理を足す。
- [X] T011 [US2] `apps/api/src/platform/entitlement/`を作る：`loadEntitlement`・`loadEntitlements`（billing・features・operator・test-groupsの今の判定を呼んでまとめる。共通の中なので、共通の表をJOINしてよい）。T004を通す。
- [X] T012 [US2] `apps/api/src/platform/usage/`を作る：`reportUsage`と、`app_usage`を読む関数。T005を通す。料金の数は、まだ今の`countOwned`のまま（PR2で切り替える）。
- [X] T013 [US2] `apps/api/src/platform/registry/`を作る：`registerAppFeatures`・`registerAppLimits`と、登録の一覧を読む関数。T006を通す。
- [X] T014 [US2] （PR1では、上限の書き込みを古い列と新しい表の両方にし、新しい`loadAppEntitlement`だけが新しい表を読む形にした。今の判定の読み方を新しい表に替えるのはPR2）機能のON/OFFと上限の処理（`platform/features/`・`platform/operator/limit-service.ts`・`operator-limit-routes.ts`・`operator-feature-routes.ts`）を、`app`の列と新しい上限の表を読む形にする。書き込みは、古い列（`users.account_limit`など）にも同じ値を書く（PR5で古い列を消すまで）。値の確かめは登録の一覧で行う（共通のコードからThreadsの名前を消すのはPR2）。
- [X] T015 [US2] `apps/api/src/platform/index.ts`から、新しい入口の関数（`emitEvent`は共通の中だけ。アプリには`registerConsumer`の型・`loadEntitlement(s)`・`reportUsage`・`peopleNames`・`Entitlement`型）を出す。`personName`をまとめて読む`peopleNames`と、ログインしている人を返す`currentUser(c)`（今の認証のミドルウェアが入れる`AuthUser`を読むだけ）を足す。
- [X] T016 [US4] PR1の確かめ：`pnpm lint`・`pnpm typecheck`・`pnpm test`・`pnpm e2e`が通る。道筋の一覧（`routes.snapshot.txt`）が変わらない（quickstart.md 1）。

**Checkpoint**：共通の土台ができた。Threadsはまだ使っていないので、動きは変わらない。→ PR1を出す。

---

# PR2：持ち主の移動（コード）

> **PR2 は2つに分けた**（2026-11-12、実装の途中で決めた）。PR2 の時点では表どうしの外部キーがまだ残っている（外すのは PR3）ので、
> 退会で共通が先に利用者の行を消すと、メンバーの行が一緒に消えて Threads が片づけられず、チームの管理者の外部キー（RESTRICT）で退会も失敗する。
> そこで、**PR2a＝持ち主の移動（動きは変えない）**、**PR2b＝出来事への切り替え（利用者の行を消すのは Threads の片づけが届いたあと）** にした。
> - PR2a：T018（アカウントの作成・削除・Metaのデータ削除で伝える。チームの出入りは /api/me と毎日の数え直しで直す）・T020・T022・T023・T024 のうち利用の数と上限の写し直し（マイグレーション 0027）・T025・T026・T029・T034・T035
> - PR2b：T017・T019・T021・T024 のうち `threads_settings`・T027・T028・T030〜T033・T036・T037・T069・T070・T071
> - **PR2b をさらに2つに分けた**（2026-11-12、PR2b の途中で決めた。変える範囲が広く、レビューと戻しを小さくするため）。
>   - PR2b＝出来事への切り替えと利用権：T017・T019・T028・T030・T031・T032・T033（マイグレーション 0028 は `threads_received_events` だけ）
>   - PR2c＝共通の表を読まない形にする：T021・T024 のうち `threads_settings`・T027・T036・T069・T070・T071・T037
  - **PR2c もさらに2つに分けた**（2026-11-12、PR2c の途中で決めた）。
    - PR2c＝Threadsの側：T024 のうち `threads_settings`・T036 のうちThreadsのコード・T071（マイグレーション 0029）。Threads の利用者ごとの直列化は、共通の `users` の行ロックをやめて Threads のアドバイザリーロック（`lockThreadsMember`）にした。名前は `peopleNames`・`peopleProfiles`、チームのON/OFFは新しい入口の関数 `loadAppFeatures` で読む。`effectiveSlotMinutes` は Threads（`publish/slot-minutes.ts`）へ移した。`tester_slot_capacity` は、Threads が共通の表を書けないので両方には書かず、新しい表だけに書く（古い列は PR5 で消す。前の版が読む値は、デプロイの間だけ古いままになる。テスト版だけの例外）。同じく、マイグレーション 0029 を当ててから新しい版に切り替わるまでの間に、前の版が古い列に書いた「最後に開いたアカウント」とテスター枠は、新しい表に入らない（テスト版だけの例外として受け入れる）。Threads のロックは、共通の上限・機能のON/OFFの変更とは直列にならない（モジュールをまたぐトランザクションを使わない決まりの結果。同じ瞬間の変更が一方の判定に間に合わないことがあるだけで、次の操作で正しくなる）。退会の片づけも Threads のロックを取り、最後に開いたアカウントの記録はロックの中で、まだそのアカウントに関わっているときだけ書く
    - PR2d＝共通の側：T027 のうち機能のON/OFFの読み書きをアプリの番号で絞る（運営の画面と、ログインした人の features が扱うアプリは、登録の一覧の `featureSettingsApp()`。同じ名前の機能を2つのアプリが登録したら止める）・T036 のうち共通の入口（`platform/index.ts`）を、使われている入口の関数だけを名前で書き出す形にした（表の定義と SQL の部品を出さない。使われなくなった `featureOnSql`・`disabledFeaturesSql` を消した）・T037
    - **T021・T069・T070 と、共通のコードから Threads の機能の名前（`FEATURES`）をなくすことは、Web を直す PR4 に回した**（運営者の機能のON/OFFの API の形と、運営の画面を一緒に作り直すため）
>   - 退会：共通は退会を記録して `user.withdrawn` を書き、すぐ届ける。`users` の行は、すべての届け先で片づけが済んだあとで消す（`deleteUserRowIfCleaned`。届かなければ5分ごとの届けと日次の続きでやり直す）。Threads の片づけは、担当とチームの人の行も自分で外す（PR3 で外部キーを外すため）
>   - `platform/hooks.ts` は、呼び出しが0になったので `runHook` を消し、`registerModule` だけを残した。`apps/threads/threads-hooks.ts` は `register.ts` に名前を変え、`registerConsumer` で出来事の受け取りを登録する
> - 見つかったこと：`users`（共通）に、Threadsの「最後に開いたアカウント」の列が5つある（`last_account_id`・`last_account_deleted_at`・`last_account_client_id`・`last_account_open_seq`・`last_account_open_received_at`）。PR2a では今のまま（`users.last_account_id`から`accounts`への外部キーは境界の例外）にし、PR2b の T071 で Threads 専用の表へ移す。

## Phase 3：Threadsの持ち物にして、共通とのやりとりを入口と出来事にする（PR2）

**Goal**：アカウント・メンバー・チーム・権限・活動の記録の処理をThreadsへ移し、知らせ5種類をなくし、定期処理のJOINをやめ、料金の数を`app_usage`にする。表の置き場所はまだ`public`。

**Independent Test**：知らせ（`runHook`）の呼び出しが0か所。退会・アカウントの削除・上限の変更・Metaのデータ削除のテストが、期待する結果を変えずに通る。

### テスト（先に書いて失敗を確かめる）

- [X] T017 [P] [US2] `apps/api/test/integration/withdrawal-events.test.ts`：退会がすぐ終わり、`user.withdrawn`が書かれる。届けると、その人が持ち主のアカウント（テスター招待の片づけ・Metaのデータ削除の要求の完了を含む）が消え、メンバー・チームから外れ、作った人の欄が空になり、`app_usage`が0・使っていないになる。同じ出来事を2回届けても結果が同じ（spec US2-1・US2-2、SC-004）。
- [X] T018 [P] [US2] `apps/api/test/integration/threads-usage.test.ts`：アカウントを作る・消す・Metaのデータ削除・チームに入る・抜けるたびに、応答を返す前に`app_usage`が今の数と状態になる。料金の数（Stripeへ送る数）が`app_usage`から決まり、今と同じ金額。毎日の数え直しで、ずれた数が直る（spec FR-011、T002と同じ結果）。
- [X] T019 [P] [US2] `apps/api/test/integration/limits-changed-event.test.ts`：運営者が上限を保存すると`limits.changed`が書かれ、届けると自動投稿が起こされる（今の`limitsChanged`のテストの期待する結果と同じ）。
- [X] T020 [P] [US3] `apps/api/test/integration/threads-me.test.ts`：`GET /api/threads/me`が、同じデータで今の`/api/me`のThreadsの部分（`accounts`・`landingAccountId`・`accountLimit`・`threadsAccessMode`・`threadsConnectMethods`・`teams`・`features`・`dailyPostLimit`・`testerInvites`）と同じ値を返す。`GET /api/threads/me/withdrawal-preview`が、今の`/api/me/withdrawal-preview`の消えるアカウントの部分と同じ値を返す（contracts/api-routes.md 2）。

### 共有の型

- [ ] T021 [US3] `packages/shared/src/apps/threads/`を作り、`threadsMeResponseSchema`（今の`meResponseSchema`のThreadsの部分を写す）と`FEATURES`（`packages/shared/src/features.ts`から移す）を置く。`packages/shared/src/index.ts`から出す。今の`meResponseSchema`はPR5まで変えない。

### 移動（中身は変えない）

- [X] T022 [US1] 招待のトークンの部品（`newInviteToken`・`sealInviteToken`・`openInviteToken`・`inviteUrl`）を、`apps/api/src/platform/teams/invite-service.ts`から`apps/api/src/kernel/invite-token.ts`へ移し、テストのグループと紹介の読みこみ先を直す（research.md R1）。
- [X] T023 [US1] `git mv`で、`apps/api/src/platform/accounts/`→`apps/api/src/apps/threads/accounts/`、`platform/access/`→`apps/threads/access/`、`platform/teams/`→`apps/threads/teams/`、`platform/activity/`→`apps/threads/activity/`。読みこみ先を直す（共通の部品は`../../platform`の入口から、Threadsの中は相対で）。表の定義（`accounts`・`memberships`・`teams`・`teamMembers`・`teamAccounts`・`activityLogs`）を、`platform/schema.ts`から`apps/threads/schema.ts`へ移す（まだ`public`のまま）。
- [X] T024 [US1] （PR2aで、末尾の「`app_usage`と上限の表の写し直し」をマイグレーション 0027 として済ませた。`threads_settings`へ移す部分は PR2c のマイグレーション 0029。古い列には書かない（上の PR2c の注））`operator_settings.tester_slot_capacity`を、Threadsの`threads_settings`（まだ`public`。data-model.md 3）へ移すマイグレーションを作る（表を作り、値を写す。古い列はPR5まで残し、両方に書く）。`apps/threads/tester-invites/`の読み書きを新しい表に替える。
  - 同じマイグレーションの末尾で、**`app_usage`を`memberships`とチームから数え直して写し直す**（PR1とPR2の間に作った・消したアカウントの分のずれを消す。料金の数を`app_usage`に切り替えるT025の前提。/speckit-analyze G1）。`user_app_limits`・`app_limit_defaults`も、古い列から写し直す（PR1のデプロイの間に前の版が古い列だけに書いた分。U4）。
  - マイグレーションのテスト（`apps/api/test/migration/`）：PR1のあとに`memberships`を足し・消しても、当てたあとに`app_usage`が今の数になる。

### 共通の側（Threadsを読まない形にする）

- [X] T025 [US2] `apps/api/src/platform/billing/billing-service.ts`の料金の数（`countOwned`）を、`app_usage`の`threads`の`quantity`に替える。契約を始めるとき（Checkout）も同じ。T018の料金の部分を通す。
- [X] T026 [US2] `apps/api/src/platform/operator/limit-service.ts`の、持ち主のアカウントの数を数える部分（運営者の利用者の一覧など）を、`app_usage`に替える。アカウントの数の上限の判定（作れるか）は、Threadsへ移す（`apps/threads/accounts/`）。
- [ ] T027 [US2] 機能のOFFを読む・消す処理（`feature-sql.ts`の`disabledFeaturesSql`・`featureOnSql`、`feature-service.ts`の`readUser`・`saveFeatureSettings`の削除・`saveGroupFeatures`・`groupDisabledFeatures`）を、すべてアプリの番号で絞る形にする（PR1のセルフレビューの指摘。2本目のアプリが同じ名前の機能を使っても混ざらないように）。`apps/api/src/platform/features/feature-sql.ts`の、`memberships`をJOINする部分（アカウントの持ち主の機能）を消し、Threadsの側で`loadEntitlement`を使う形にする。共通のコードからThreadsの機能の名前（`autopost`など）を消し、登録の一覧を使う（spec FR-012）。
- [X] T028 [US2] `apps/api/src/platform/withdrawal/withdrawal-service.ts`を、契約の解約・利用者の退会の記録・`emitEvent(tx, "user.withdrawn", { userId })`までにする（Threadsのアカウントを消す部分をなくす）。
- [X] T029 [US2] `apps/api/src/platform/identity/me-routes.ts`：`apps.using`を`app_usage.using`から決める。`/api/me`のThreadsの部分は、PR5まで今の形で返すため、組み立て（`apps/api/src/app.ts`）からThreadsの「`/api/me`に足す中身を作る関数」を渡して呼ぶ（共通はThreadsを読まない）。`/api/me/withdrawal-preview`も同じ（PR5で共通の分だけにする）。

### Threadsの側（共通の入口だけを使う形にする）

- [X] T030 [US2] `apps/api/src/apps/threads/access/access.ts`（`authorizeAccount`）を、持ち主の利用権を`loadEntitlement`で読む形にする（`users`・`subscriptions`を読まない）。**持ち主が退会した（利用権が`none`で、退会の記録がある）アカウントは、出来事が届いて消えるまでの間も、チームのほかの人を含めて誰にも見せない**（今は退会で即座に消えるので、見えない。spec 境目のケース、/speckit-analyze U1）。T017に、退会のあと出来事が届く前に、チームのほかの人がそのアカウントを開けない場面を足す。
- [X] T031 [US2] `apps/api/src/apps/threads/publish/auto-post-runner.ts`・`metrics/metrics-runner.ts`・`mention/mention-runner.ts`の、`users`・`subscriptions`・`memberships`とのJOINと`featureOnSql`系をやめ、Threadsの表だけで候補を読んでから`loadEntitlements`で持ち主をまとめて調べる形にする（research.md R4）。1件ずつ判定している`publish/publish-claim.ts`・`publish-executor.ts`・`auto-post-routes.ts`・`posting-schedule-routes.ts`（`loadOwnerEntitlement`・`ownerAutopostOn`・`effectiveLimits`）は、`loadEntitlement`に替える。今の定期処理と投稿のテストを、期待する結果を変えずに通す。
- [X] T032 [US2] `apps/api/src/apps/threads/events/`を作る：`markReceived`（`threads_received_events`。まだ`public`）・`onUserWithdrawn`・`onLimitsChanged`（contracts/platform-entry.md 3）。`received_events`の表を作るマイグレーションを、T024と同じPRで足す。T017・T019を通す。
- [X] T033 [US2] 知らせをなくす：`accountDeleting`・`accountOpened`はThreadsの中の処理に（アカウントを消す関数・開くAPIの中で直接呼ぶ）、`userWithdrawing`・`userAccountsDeleted`は`onUserWithdrawn`に、`limitsChanged`は`onLimitsChanged`に（research.md R8）。`apps/api/src/apps/threads/threads-hooks.ts`を消し、`apps/api/src/app.ts`で`registerAppFeatures`・`registerAppLimits`・`registerConsumer`を呼ぶ（contracts/module-boundaries.md 4）。`platform/hooks.ts`はPR5で消す（この時点で呼び出しが0になる）。
- [X] T034 [US2] Threadsが利用の数を伝える：アカウントを作る・消す（Metaのデータ削除の`deleteAccountsOfThreadsUser`を含む）・持ち主が変わる・チームに入る・抜ける処理で、トランザクションのあと・応答の前に`reportUsage`を呼ぶ。毎日のまとめ処理（`jobs/daily-jobs.ts`からThreadsの関数を呼ぶ）で全員を数え直す。T018を通す。
- [X] T035 [US3] `apps/api/src/apps/threads/me/`を作る：`GET /api/threads/me`・`GET /api/threads/me/withdrawal-preview`。`apps/api/src/apps/threads/index.ts`から出し、`app.ts`でつなぐ。T020を通す。`pnpm --filter api routes:snapshot`で一覧を書き直す（2本増える）。
- [X] T069 [US2] 運営の画面のための登録の一覧を返すAPI `GET /api/operator/app-registry`（共通。運営者だけ）を足す：登録されたアプリごとに、機能（名前・表示名・説明）と上限（名前・表示名・範囲）を返す。`registerAppFeatures`・`registerAppLimits`に表示名・説明を渡す形にする（contracts/platform-entry.md 5・api-routes.md 1）。テスト：`apps/api/test/integration/operator-app-registry.test.ts`（運営者でなければ403、今の3つの機能と2つの上限が今の表示名で返る）。
- [ ] T070 [US2] 外枠の運営の画面（`apps/web/src/shell/settings/features.tsx`・`limits.tsx`）を、`FEATURE_LABELS`・「アカウントの数」・`ACCOUNT_LIMIT_MAX`などのThreadsの名前を直接書かず、T069のAPIの一覧で出す形にする。見た目と文言は今のまま（spec FR-012・FR-021、/speckit-analyze G2）。画面のテストを直す（期待する結果は変えない）。T021で`FEATURES`・`FEATURE_LABELS`をThreadsへ移すのは、このタスクのあと。
- [X] T071 [US1] `users`の「最後に開いたアカウント」の5列（`last_account_id`ほか）を、Threads専用の表（`threads_user_states`。まだ`public`。PR3でスキーマ`threads`へ）へ写すマイグレーションを作り、Threadsの読み書き（`openAccount`・`deleteAccount`・`buildThreadsMe`の`landingAccountId`）を新しい表に替える。古い列はPR5で消す（data-model.md 1-1）。
- [X] T036 [US1] Threadsのコードの`platform/schema`の読みこみ（`users`・`subscriptions`・`memberships`・`operatorSettings`）が0か所になったことを確かめる（`grep`）。共通の`index.ts`から、表の定義とSQLの部品（`featureOnSql`など）を出すのをやめる。
- [ ] T037 [US4] PR2の確かめ：`pnpm lint`・`pnpm typecheck`・`pnpm test`・`pnpm e2e`。知らせの呼び出し（`runHook`）が0か所（quickstart.md 1）。

**Checkpoint**：コードの上では、Threadsは共通の表を読まず、共通とのやりとりは入口と出来事だけになった。→ PR2を出す。

---

# PR3：置き場所の移動（DB）

## Phase 4：スキーマ`threads`へ移し、外部キーを外す（PR3）

**Goal**：Threadsの表をすべてスキーマ`threads`に置き、共通との外部キーを0本にする。境界の規則を強める。

**Independent Test**：マイグレーションのテストで、31表の件数と中身が残り、共通 ⇄ Threadsの外部キーが0本。ESLintの規則が、アプリ → 共通の表、共通 → アプリの表を止める。

### テスト（先に書いて失敗を確かめる）

- [X] T038 [P] [US1] `eslint-rules/module-boundaries.test.js`に足す：止める＝`apps/threads/x`→`../../platform/schema`、`platform/x`→`../apps/threads/schema`、`platform/x`→`../db/schema`。通る＝`apps/threads/x`→`../../platform`（入口）、`db/schema.ts`→`../platform/schema`・`../apps/threads/schema`（組み立て）（contracts/module-boundaries.md 3）。
- [X] T039 [P] [US4] `apps/api/test/migration/migration-00NN.test.ts`（PR3の番号）：前の番号まで当てて、31表と`threads_settings`・`threads_received_events`にデータを入れ、当てたあとに、スキーマ`threads`の同じ表で件数と中身が一致する・共通 ⇄ Threadsの外部キーが0本（quickstart.md 1のSQL）・Threadsの中の外部キー（`accounts`への`cascade`など）が残る（spec SC-001・SC-005）。

### 実装

- [X] T040 [US1] `apps/api/src/apps/threads/schema.ts`を`pgSchema("threads")`の表にする（31表と`settings`・`received_events`）。`users`への`references`をすべて外す（列は`uuid`のまま）。`platform/schema.ts`の`operatorEvents.applicationId`の`references`と、`eslint-disable-next-line`の例外を外す（data-model.md 1-3、research.md R3）。
- [X] T041 [US1] `pnpm --filter api db:generate`でマイグレーションを作る。**SQLを読み、`CREATE SCHEMA "threads"`と`ALTER TABLE … SET SCHEMA "threads"`になっていて、`DROP TABLE`・`CREATE TABLE`（移す表について）がないことを確かめる**。対話が要るときは、端末を持つ形で「移した」を選ぶ。できないときは`--custom`で手で書き、そのあと`db:generate`で差がないことを確かめる（research.md R2）。`threads_settings`は`settings`へ、`threads_received_events`は`received_events`へ名前を変える。T039を通す。
- [X] T042 [US1] 手で書いたSQL（マイグレーションのテスト・`apps/api/test/helpers`・E2Eの`e2e/tests/helpers.ts`のDBを空にする処理・`apps/api/scripts/seed-performance.ts`・`apps/api/src/jobs/key-rotation.ts`など）の表の名前に、スキーマ`threads`を付ける。`grep`で`public`の名前のまま残っていないことを確かめる。
- [X] T043 [US1] `eslint-rules/module-boundaries.js`に、T038の2つの違反を足す（`db/schema.ts`を経由した読みこみも止める）。T038を通す。`pnpm lint`で違反が0件。
- [ ] T044 [US4] 作業場所でも確かめる：`pnpm worktree:new probe`で作り、その作業場所のDBにスキーマ`threads`ができ、`pnpm --filter api test`が通ることを確かめ、`pnpm worktree:remove probe`で片付ける（quickstart.md 2、spec FR-020）。
- [X] T045 [US4] PR3の確かめ：`pnpm lint`・`pnpm typecheck`・`pnpm test`・`pnpm e2e`。`pnpm --filter api db:generate`が「変更なし」。手元のDBで外部キーの本数が0（quickstart.md 1）。
- [ ] T046 [US4] PR3の説明に、前の版のAPIが新しいDBで壊れる例外（デプロイの間の数分）と、テスト環境での確かめの手順（quickstart.md 3）を書く。

**Checkpoint**：→ PR3を出す。マージの前に、テスト環境の件数を控え、テストユーザーに知らせる。

**PR3の実装で分かったこと**：
- マイグレーションは`0030_threads_schema`。drizzle-kitの対話は使わず`--custom`で手で書き、記録（snapshot）を表の移動・名前の変更・外部キーの外しに合わせて直した。`db:generate`が「変更なし」（T041）。
- 外部キーは27本外した（Threads → `users`の25本と、`users.last_account_id`・`operator_events.application_id`）。Threadsの中の37本は残る。
- **外部キーが自動でしていたことを、退会の片づけ（`withdrawal-cleanup.ts`）に足した**（research.md R3）：`token_check_failures`・`oauth_states`の行を消す、作った人・直した人の欄（18列）と`activity_logs.actor_user_id`・`tester_applications.user_id`を空にする。これらの列に索引はないが、退会は年に数回なので、表を読み通しても困らない。
- 列挙型（`membership_role`など）は`public`のまま（表ではないので外部キーにならない。移すと手間が増えるだけ）。
- 0030 は、外部キーを外す前に、退会の途中の人（Threadsの片づけは済み・`users`の行はまだ）の残りを片づける（外部キーがしていたこと）。片づけがまだの人は、新しい退会の片づけが行う。
- 運営のアカウント一覧が、手で書いたSQLで共通の`users`を読んでいたので、共通の入口の関数（`searchPeople`・`peopleProfiles`）に変えた（ESLintは読みこみしか見ないので、手で書いたSQLは止められない）。
- **受け入れたこと（PR #99 のセルフレビュー）**：
  - 退会の片づけが済んだ直後（同じ瞬間）に書かれた行（チームの管理者が担当を付けた・接続の途中の記録）は残る。以前は`users`の行を消すときに外部キーが消していた。起きるのは退会と同じ瞬間の操作だけで、残っても誰もその人としてログインできない。テスター招待の行に消えた人の番号が残ると、運営者の操作の記録（`operator_events.subject_user_id`は`users`への外部キーのまま）が失敗するが、同じ瞬間の申し込みのときだけ。
  - 共通の`users.last_account_id`は、外部キーを外したあと、消えたアカウントの番号が残ることがある。もう誰も読まず、PR5で列ごと消す。

- [ ] T047 [US4] テスト環境：PR3のマージの前に件数とマージの直前の時刻（UTC）を控え、マージのあとに件数の一致・外部キー0本・主な流れを確かめ、結果をPR3の説明に書く（quickstart.md 3。ユーザーと一緒に行う）。

---

# PR4：道筋とWeb

## Phase 5：APIの道筋を`/api/threads/…`に、Webの呼び出しを`apps/threads/`に（PR4）

> **PR4は2つに分けた**（Webのテストのモックの書き換えが約60ファイルと大きいため）：
> - PR4a＝APIの側：T048・T049・T069（新しい道筋は、Threadsの道筋をまとめた1つの部品を `/` と `/threads` の両方につなぐ形。道筋の一覧で、新しい105本が古い道筋と同じ数の処理を持つことを確かめた）
> - PR4b＝Webの側。さらに2つに分けた：
>   - PR4b-1＝T050・T053・T054（APIの呼び出し106本とキー38個を `apps/threads/lib/` へ移し、Threadsの呼び出しは `/api/threads/…` を呼ぶ。テストのモックを `@/apps/threads/lib/api` に分けた。期待する結果は変えていない）
>   - PR4b-2＝T051・T021 のうち `threadsMeResponseSchema`（Threadsの画面は、アカウント・チーム・使える機能などを `useThreadsMe()`（`/api/threads/me`）から読む。キーは `["me", "threads"]` で、共通の自分を取り直すと一緒に取り直す）
>   - PR4b-3＝T052・T070・T021 のうち `FEATURES` の移動・T056
>   - **PR5 に回したこと（PR #103 のセルフレビュー）**：Threads の画面は、PR5 まで `/api/me` と `/api/threads/me` の両方を読む（サーバーで Threads の中身を2回作る）。PR5 で `/api/me` から Threads の中身を消すときに、Threads の中身だけが変わったところ（アカウントを開く・名前を変える・チーム）の取り直しを `["me"]` から `threadsQueryKeys.me` に替える

**Goal**：ThreadsのAPIをThreadsの道筋の下にそろえ、Webの呼び出しとキー、`/api/me`のThreadsの部分の読み方をThreadsのフォルダへ移す。古い道筋は残す。

**Independent Test**：道筋の一覧に新しい道筋が足され、古い道筋も残る。Webの共通の部品にThreadsの道筋がない。Webのテストと E2E が、期待する結果を変えずに通る。

### API

- [X] T048 [US3] ThreadsのAPIの入口を、`/api/threads/accounts/…`・`/api/threads/teams/…`・`/api/threads/invites/…`・`/api/threads/me/needs-review-counts`・`/api/threads/operator/{accounts,tester-applications,tester-settings}`にもつなぐ（contracts/api-routes.md 1）。古い道筋にも同じ処理をつないだまま残す。`/api/threads/…`の今の6本（接続・Metaの通知）と`/api/data-deletion`は変えない。
- [X] T049 [US3] `pnpm --filter api routes:snapshot`で一覧を書き直し、新しい道筋が足され、古い道筋が残り、Metaの戻り先・通知先とStripeの通知先が変わっていないことを確かめる。古い道筋と新しい道筋で、同じ応答になることを、代表のAPI（アカウントの一覧・投稿の案の一覧・チームの一覧）でテストする（`apps/api/test/integration/threads-routes-alias.test.ts`）。

### Web

- [X] T050 [US3] `apps/web/src/apps/threads/lib/api.ts`を作り、`apps/web/src/lib/api-client.ts`からThreadsのAPIの呼び出しを移す（呼ぶ道筋は`/api/threads/…`）。共通の`request`・`ApiError`は共通の部品から使う。`apps/web/src/apps/threads/lib/query-keys.ts`を作り、`apps/web/src/lib/query.ts`からThreadsのキーを移す（contracts/api-routes.md 4）。
- [X] T051 [US3] `apps/web/src/apps/threads/lib/use-threads-me.ts`（`/api/threads/me`）を作り、Threadsのデータを`/api/me`から読んでいるファイル（`apps/threads/sidebar/index.tsx`・`components/connect/ReconnectDialog.tsx`・`components/connect/ConnectMethods.tsx`・`pages/home.tsx`・`pages/account-new.tsx`・`pages/account-layout.tsx`・`pages/team-shared-account.tsx`ほか）を替える。外枠（入口の振り分け・すべてのアプリ・アプリの切り替え）は今どおり`/api/me`の`apps`を読む。
- [ ] T052 [US3] `apps/web/src/shell/app-module.ts`に`withdrawalPreview`を足し（contracts/module-boundaries.md 5）、Threadsの`AppModule`で渡す。`apps/web/src/components/billing/WithdrawDialog.tsx`が、`/api/me/withdrawal-preview`と、登録されたアプリの`withdrawalPreview`を並べて出す形にする（見た目と文言は変えない）。
- [X] T053 [US3] Webのテストのモックを直す：Threadsの呼び出しを`@/lib/api-client`でモックしているテスト（約60ファイル）を、`@/apps/threads/lib/api`のモックに替える。`/api/me`の中のThreadsのデータを使うテストの手助け（`apps/web/test/helpers/`）は、`useThreadsMe`の値を入れる形にする。期待する結果は変えない（spec FR-022）。
- [X] T054 [P] [US3] `apps/web/test/api-client-common.test.ts`：共通の`api-client.ts`に、Threadsの道筋（`/api/threads/`・`/api/accounts/`・`/api/teams/`）を呼ぶ関数がないことを確かめる（contracts/module-boundaries.md 5）。
- [ ] T055 [US4] PR4の確かめ：`pnpm lint`・`pnpm typecheck`・`pnpm test`・`pnpm e2e`（quickstart.md 1）。
- [ ] T056 [US3] テスト環境：PR4のマージのあと、画面が新しい道筋だけを呼んでいることを、ブラウザの開発者ツールのネットワークで確かめる（古い道筋を消す前の確認。quickstart.md 4-1。ユーザーと一緒に行う）。

**Checkpoint**：→ PR4を出す。

---

# PR5：片づけと文書

## Phase 6：古いものを消す（PR5）

**Goal**：古い道筋・`/api/me`のThreadsの部分・上限の古い列・知らせの仕組みを消す。

- [ ] T057 [US3] 古い道筋（`/api/accounts/…`・`/api/teams/…`・`/api/invites/…`・`/api/me/needs-review-counts`・`/api/operator/{accounts,tester-applications,tester-settings}`）を消す。`routes:snapshot`を書き直し、`threads-routes-alias.test.ts`を新しい道筋だけのテストにする。
- [ ] T058 [US3] `/api/me`からThreadsの部分を消す：`packages/shared/src/schemas.ts`の`meResponseSchema`を共通の分だけにし、`apps/api/src/app.ts`の「`/api/me`に足す中身」を消す。`/api/me/withdrawal-preview`も共通の分だけにする。Webの型の誤りが0件（Threadsは`useThreadsMe`を読んでいる）。テストを直す（期待する結果は変えない）。
- [ ] T059 [US2] `apps/api/src/platform/hooks.ts`と、そのテストを消す。
- [ ] T060 [US2] 上限の古い列（`users.account_limit`・`users.daily_post_limit`・`operator_settings.default_account_limit`・`default_daily_post_limit`・`tester_slot_capacity`）を消す：表の定義から消し、両方に書いていた処理を新しい表だけにして、`db:generate`でマイグレーションを作り、SQLを読む。`apps/api/test/migration/`にテストを足す（新しい表の値が残る）。
- [ ] T061 [US4] PR5の確かめ：`pnpm lint`・`pnpm typecheck`・`pnpm test`・`pnpm e2e`。`/api/me`にThreadsのデータがない。PR5の説明に、古い列を消すマイグレーションが前の版のAPIを壊す例外（テスト環境だけ。spec FR-019）を書く。

## Phase 7：文書（PR5）

**Goal**：2作目の開発者が、Threadsを実例にしてパターン①をなぞれるようにする（spec US5・FR-023）。

- [ ] T062 [P] [US5] `docs/app-separation.md`：Threadsをパターン①にそろえたことを書く（5章「Threadsの扱い」を書き直す、2-1の図のThreadsをパターン①の色に、3-4の道のりの「今」を更新）。実例として、Threadsの`schema.ts`・`events/`・`reportUsage`の呼び出し・`/api/threads/me`の場所を指す。
- [ ] T063 [P] [US5] `docs/module-map.md`：2章（共通16表・Threads34表・処理の行き先）、3章（持ち主でない列の例外がなくなる）、1-4（知らせ → 出来事）、4章（`operator_events`の例外がなくなる）、6章（アプリを足す手順を、Threadsを実例にしたパターン①の手順に）、7章（Webの`apps/threads/lib/`・`withdrawalPreview`）、1-1の図（contracts/module-boundaries.md 6）。
- [ ] T064 [P] [US5] `docs/product-structure.md` 6・7（共通の表の行・Threadsの扱い・まだ決めていないこと）、`docs/architecture.md`（設計の判断の表の「Threadsはパターン②のまま」を直す）、`docs/parallel-development.md`（Threadsの改善の再開と、2作目が実装を始めてよいこと）、`docs/README.md`（文書の一覧の説明の更新）。
- [ ] T065 [US5] Constitution の「アプリのデータの分け方」の、T000で書いた「そろえる・途中の形を認める」を、「Threadsもパターン①にそろえた（029）」に直す（PATCH：4.9.1）。`/speckit-constitution`の手順で、版と改めた日を直す。
- [ ] T066 [US5] 古い記述が残っていないことを確かめる：`grep`で「パターン②のまま」「`accounts`（共通）」「同じトランザクションの知らせ」「`runHook`」「`/api/accounts/`」を文書とコードのコメントから探し、今の形に直す（spec US5-2）。

**Checkpoint**：→ PR5を出す。

- [ ] T067 [US4] テスト環境：PR5のマージのあと、主な流れをもう一度通し、テスト用の利用者を1人作って退会し、10分以内にThreadsのデータが消えることを確かめる。結果をPR5の説明に書く（quickstart.md 4。ユーザーと一緒に行う）。
- [ ] T068 このfeatureの終わり：人物管理・集金管理のセッションに、実装を始めてよいことと、Threadsを実例にしたパターン①の手順（`docs/app-separation.md`・`docs/module-map.md` 6章）を知らせる（ユーザーに伝える）。

---

## Dependencies & Execution Order

- **PR1（Phase 1〜2）** → **PR2（Phase 3）** → **PR3（Phase 4）** → **PR4（Phase 5）** → **PR5（Phase 6〜7）**。各PRは、前のPRが`develop`に入ってから切る（同じブランチで積み、PRごとに`develop`へ出してもよい）。
- PR1の中：T000（Constitution。済み）→ T001・T002（基準）→ T003〜T006（テスト）→ T007・T008（マイグレーション）→ T009〜T015 → T016。
- PR2の中：T017〜T021（テスト・型）→ T022〜T024（移動）→ T025〜T029（共通の側）と T030〜T035（Threadsの側）は、T023の後なら並べて進められる（別ファイル）。T033はT032の後。T069 → T070 → T021（`FEATURES`の移動）。→ T036・T037。
- PR3：T038・T039（テスト）→ T040 → T041 → T042・T043 → T044・T045 → T046 →（マージ）→ T047。
- PR4：T048・T049（API）→ T050 → T051・T052 → T053・T054 → T055 →（マージ）→ T056。
- PR5：T056の確認のあと。T057〜T060 → T061、T062〜T066 は並べて進められる → （マージ）→ T067 → T068。

## Parallel Example

```text
PR1のテスト（別ファイル）：T003・T004・T005・T006
PR2のテスト（別ファイル）：T017・T018・T019・T020・T021
PR5の文書（別ファイル）：T062・T063・T064
```

## Implementation Strategy

- **MVP**：PR1＋PR2（コードの上でパターン①の形ができる。共通の入口と出来事をThreadsが使い、知らせがなくなる）。ここまでで、2作目が使う土台ができる。
- **データの置き場所**（PR3）は、テスト環境で件数を比べながら、ユーザーと一緒にマージする。
- **道筋とWeb**（PR4）と**片づけ**（PR5）で、見た目は変えずに切り出しやすい形を仕上げる。
- 各PRで、セルフレビュー（`/code-review`）→ CI（`run-ci`）→ Codex の順を守る。
