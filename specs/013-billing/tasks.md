---

description: "Task list for feature 013 billing and withdrawal"
---

# Tasks:決済＋退会

**Input**: [spec.md](./spec.md)、[plan.md](./plan.md)、[research.md](./research.md)、[data-model.md](./data-model.md)、[contracts/api.md](./contracts/api.md)、[contracts/ui-routes.md](./contracts/ui-routes.md)、[quickstart.md](./quickstart.md)

**Tests**: 001〜012と同じく、テストを先に書いて失敗を確かめてから実装する（TDD）。特に次を自動テストで確かめる。SC-003（読むだけの書き込みがどの経路でも止まる）、SC-005（請求の数）、SC-006（知らせの重複・順番）、SC-007（退会で何も残らない）、SC-008（決済OFF・料金なし）。

**Organization**: User Storyごとに分ける。MVPはUS1＋US2＋US3（どれもP1）。

## Format: `[ID] [P?] [Story] Description`

- **[P]**:別ファイルで、未完了のタスクに依存せず並行できる。
- **[Story]**: [US1]〜[US7]はspec.mdのUser Storyに対応する。
- すべてのタスクに、変更または確認する正確なパスを書く。
- APIのテストは、既定で`BILLING_ENABLED=false`。決済のテストは、テストの中で`BILLING_ENABLED: "true"`と偽のStripeのURLを入れた環境を使う（T008）。

## Phase 1: Setup

**Purpose**: PRDの直し・使える状態の判定・権限・エラーのcode。

- [X] T001 [P] PRDを実装の前に直す（Constitution「開発ワークフロー」、research.md R14）：`_bmad-output/initiative-threads-grower-app/prd-threads-grower-app/prd-threads-grower-app.md`のFR-12（無料体験の後に契約がなければ読むだけ・自動投稿を止める、支払いが失敗したらすぐに読むだけ、無料体験中の契約は無料体験の終わりから請求、退会はすぐにすべて消す・契約はすぐ止めて返金なし、の`[ASSUMPTION]`を「2026-10-15決定」にする。料金の金額は仮の値のまま）、FR-2の「無料体験中は1件まで」、§3 Glossary「grower機能」（013で旧プランを外し、契約中・無料体験中・料金なしならすべて使える）、§9 Assumptions Indexの§4.6の行。
- [X] T002 [P] `packages/shared/test/billing.test.ts`を先に書き、`packages/shared/src/billing.ts`を作る（research.md R1・R3・R4）：
  - 定数：`BILLING_BASE_PRICE_JPY = 1000`、`BILLING_EXTRA_PRICE_JPY = 500`、`TRIAL_ACCOUNT_LIMIT = 1`、`TRIAL_ENDING_NOTICE_DAYS = 7`、`CHECKOUT_TRIAL_MIN_HOURS = 48`。
  - `trialEndsAt`・`isInTrial`を`packages/shared/src/access.ts`から移す（中身は変えない）。
  - `entitlementOf({ billingEnabled, exempt, userCreatedAt, subscription: { status, cancelAtPeriodEnd } | null, now })`：`{ state, fullAccess, readOnlyReason, accountLimit, trialEndsAt }`。R1の表のすべての行をテストにする（`past_due`・`unpaid`・`paused`は無料体験中でも`payment_failed`、`incomplete`・`incomplete_expired`・契約なしは無料体験中なら`trial`で上限1、終わっていれば`trial_ended`、`canceled`は無料体験中なら`trial`で終わっていれば`canceled`、`active`かつ解約の予約は`canceling`、`trialing`は`subscribed_trial`、料金なし・決済OFFは上限`null`）。
  - `checkoutTrialFor(trialEndsAt, now)`：残りが48時間以上なら`{ trialEnd: trialEndsAt }`、0より大きく48時間未満なら`{ trialPeriodDays: 1 }`、終わっていれば`null`。境（ちょうど48時間・ちょうど0）をテストする。
  - `nextInvoiceAmount(ownedCount)`：`BASE + EXTRA × (max(n,1) − 1)`（0件・1件・3件）。`billingQuantity(n) = max(n,1)`。
  - `trialDaysLeft(trialEndsAt, now)`：日本時間の日付で数え、終わる日を含まない（終わる日の当日は0）。
  - `packages/shared/src/index.ts`から出す。
- [X] T003 [P] `packages/shared/test/permissions.test.ts`を先に直し、`packages/shared/src/permissions.ts`に権限`remove`（アカウントの削除。オーナーだけ）を足し、`owner`の説明から削除を外す。`READ_ONLY_PERMISSIONS = ["read", "view", "activity", "remove"]`と`narrowForReadOnly(permissions)`（共通部分）を足す（research.md R2、contracts/api.md「権限」）。
- [X] T004 [P] `packages/shared/test/errors.test.ts`を先に直し、`packages/shared/src/errors.ts`にcode `BILLING_REQUIRED`・`ALREADY_SUBSCRIBED`・`NO_SUBSCRIPTION`・`BILLING_UNAVAILABLE`・`WITHDRAWAL_IN_PROGRESS`と文言を足す（contracts/api.md「新しいエラーコード」。`BILLING_REQUIRED`は`details[0]`の`trial_ended`・`payment_failed`・`canceled`・`owner_inactive`で文言を変える）。`ACCOUNT_LIMIT_REACHED`の文言を「無料体験中に作れるアカウントは1件までです。契約すると、2件目から1件につき月500円で足せます」（金額は`BILLING_EXTRA_PRICE_JPY`）、次の操作を「契約する」（`/settings/billing`）にする。`GROWER_FEATURE_REQUIRED`を一覧と文言から消す。

---

## Phase 2: Foundational（すべてのStoryの前提）

**Purpose**: DB・環境・Stripeのつなぎ方・判定の差し替え・旧プランを外す。ここが終わるまでStoryに入らない。

- [X] T005 `apps/api/src/db/schema.ts`をdata-model.mdのとおりにする：
  - `users`に`billingExempt`（`boolean NOT NULL DEFAULT false`）・`withdrawalRequestedAt`（`timestamptz NULL`）。
  - 表`subscriptions`：`user_id uuid PRIMARY KEY → users.id ON DELETE CASCADE`、`stripe_customer_id text NOT NULL UNIQUE`、`stripe_subscription_id text NULL UNIQUE`、`status text NULL`（CHECK：「`status IS NULL OR status IN ('incomplete','incomplete_expired','trialing','active','past_due','unpaid','canceled','paused')`」）、`current_period_end`・`trial_end timestamptz NULL`、`cancel_at_period_end boolean NOT NULL DEFAULT false`、`quantity integer NULL`、`quantity_sync_needed boolean NOT NULL DEFAULT false`、`pending_checkout_session_id text NULL`、`stripe_synced_at timestamptz NULL`、`created_at`・`updated_at`。
  - 表`withdrawn_users`：`clerk_user_id text PRIMARY KEY`、`withdrawn_at timestamptz NOT NULL`、`clerk_deleted_at timestamptz NULL`。
  - `accounts.plan`と列挙型`accountPlan`を消す。
  - `SKIP_REASONS`に`billing_inactive`を足す（CHECK `publish_attempts_skip_reason_valid`が作り直される）。
  - `pnpm --filter api db:generate`で`apps/api/drizzle/0014_billing.sql`を作り、`accounts.plan`の列を消してから型を消す順か確かめる。
- [X] T006 `apps/api/test/migration/migration-0014.test.ts`を作る（`apps/api/test/helpers/migrate.ts`で0013までを当て、データを入れて0014を当てる）。確かめること：
  - アカウント・`post_drafts`・`memberships`・`team_members`の件数が前後で同じ。
  - `accounts.plan`の列と型`account_plan`がない。
  - 今の利用者の`billing_exempt`が`false`。
  - `subscriptions.status`に表にない値を入れると拒まれる。
  - `publish_attempts.skip_reason = 'billing_inactive'`が入る。
  - `users`を消すと`subscriptions`の行が消える。
- [X] T007 `apps/api/test/helpers/app.ts`・`apps/api/test/helpers/team.ts`から`plan`の指定と`setAccount`の`plan`を外し、関数を足す：
  - `setBillingExempt(userId, on)`。
  - `insertSubscription(userId, { status, cancelAtPeriodEnd?, currentPeriodEnd?, stripeCustomerId?, stripeSubscriptionId? })`。
  - `endTrial(userId)`（`users.created_at`を1か月と1日前にする）。
  - 既存のテストで`plan: "auto-grower"`などを使っている所（`apps/api/test/integration/*.test.ts`の`prompt`・`post-drafts`・`profile-status`・`analysis-records`・`posting-schedule`・`research`・`promotions`・`strategy`・`metrics-runner`・`auto-post-runner`・`performance`・`review`・`posting-rules`）から`plan`を外す。`GROWER_FEATURE_REQUIRED`を期待しているテストは、T013で`BILLING_REQUIRED`の決済ONのテストに移すので、ここでは消す。
- [X] T008 環境と設定（research.md R11、contracts/api.md「環境変数・Secret」）：
  - `apps/api/src/env.ts`に`BILLING_ENABLED`（`"true" | "false"`）・`STRIPE_SECRET_KEY?`・`STRIPE_WEBHOOK_SECRET?`・`STRIPE_PRICE_ID?`・`STRIPE_API_BASE_URL?`・`STRIPE_PORTAL_CONFIGURATION_ID?`・`STRIPE_TAX_RATE_ID?`を足す。
  - `apps/api/src/lib/config.ts`の`validateConfig`で、`BILLING_ENABLED`が`"true"`・`"false"`以外（未設定を含む）なら問題にする。`"true"`のときだけ、`STRIPE_SECRET_KEY`（`/^sk_(test|live)_[A-Za-z0-9]{10,}$/`）・`STRIPE_WEBHOOK_SECRET`（`/^whsec_/`）・`STRIPE_PRICE_ID`（`/^price_/`）を確かめる。`billingModeOf(env)`（`{ enabled: env.BILLING_ENABLED === "true" }`）を足す。
  - `apps/api/test/unit/config.test.ts`に、未設定・違う値・ONで鍵がない・ONで見本の値のテストを足す（FR-063）。
  - `apps/api/test/env.ts`の`testBindings`に`BILLING_ENABLED: "false"`、`STRIPE_API_BASE_URL`（引数）、テスト用の`STRIPE_SECRET_KEY`・`STRIPE_WEBHOOK_SECRET`・`STRIPE_PRICE_ID`を足す。
  - `apps/api/.dev.vars.example`に`BILLING_ENABLED=false`とStripeの見本を足す。
- [X] T009 [P] `apps/api/src/lib/stripe-client.ts`を作り、`apps/api/test/unit/stripe-client.test.ts`を先に書く（research.md R5）：
  - `createStripeClient(env)`の7つの呼び出し：`createCustomer({ userId, email }, idempotencyKey)`、`createCheckoutSession(params)`、`expireCheckoutSession(id)`、`createPortalSession({ customer, returnUrl, configuration? })`、`listSubscriptions(customerId)`、`updateSubscriptionQuantity(subscriptionId, itemId, quantity)`（`proration_behavior=none`）、`cancelSubscription(subscriptionId)`。
  - 本文は`application/x-www-form-urlencoded`（入れ子は`a[b][0]`の形）。`Stripe-Version`を固定する。接続先は`STRIPE_API_BASE_URL ?? "https://api.stripe.com"`。
  - 4xx・5xx・通信の失敗は`StripeError`（`status`・`code`）にする。鍵を例外の文やログに出さない。
  - `verifyWebhookSignature(body, header, secret, now)`：`t=`と`v1=`を読み、`HMAC-SHA256(secret, "${t}.${body}")`を一定時間で比べ、時刻の差が300秒を超えたら拒む。合う・合わない・古い・形の誤り・`v1`が複数をテストする。
- [X] T010 [P] `apps/api/test/fake-stripe/server.ts`を作る（`apps/api/test/fake-threads/server.ts`と同じ形。メモリの中に顧客・契約・セッションを持つ）。
  - T009の7つの呼び出しに答える。
  - Checkoutの`url`は偽のサーバーの`/checkout/:id`にする。開くと契約を作り（`trial_end`があれば`trialing`、なければ`active`）、`success_url`へ302で戻し、設定されていれば宛先にWebhook（`checkout.session.completed`と`customer.subscription.created`）を署名つきで送る。
  - テストから状態を変える口：`setSubscriptionStatus`・`failNext`・`reset`・`requests`。
  - `apps/api/test/fake-stripe/serve.ts`（手元・E2E用に単独で立てる）を作り、`apps/api/package.json`に`fake-stripe`の命令を足す。
  - `apps/api/test/global-setup.ts`で偽のStripeを立て、`apps/api/vitest.config.ts`の`testBindings`に渡す。
- [X] T011 判定する人に決済のモードを持たせる（research.md R2）：
  - `apps/api/src/middleware/auth.ts`で、`c.set("user", …)`に`billing: billingModeOf(c.env)`を入れる（`AuthVariables`の型を直す）。
  - `apps/api/src/services/access.ts`の`RequestUser`を`{ id: string; billing: BillingMode }`にする。
  - 型の誤りになる所を、モードを受け取る形に直す：`apps/api/src/services/account-service.ts`（`deleteAccount`・`completeConnection`・`createAccount`）、`apps/api/src/services/threads-oauth.ts`、`apps/api/src/services/token-connect.ts`、ほか`{ id: … }`を渡している所。
  - `pnpm --filter api typecheck`が通ることを確かめる。
- [X] T012 `apps/api/src/services/access.ts`の`authorizeAccount`に、オーナーの使える状態を足す（research.md R2）：
  - 同じ1回の問い合わせに、`ownerU.billingExempt`と`subscriptions`（オーナーの`user_id`で左結合）の`status`・`cancel_at_period_end`を足す。
  - `entitlementOf`でオーナーの状態を求め、`fullAccess`でなければ`narrowForReadOnly`で権限を絞る。
  - 絞る前にはあって、絞った後にない権限を要られたら`AppError("BILLING_REQUIRED", 403, …, undefined, [reason])`を投げる。`reason`は、判定した人がオーナーなら`readOnlyReason`、ほかの人なら`owner_inactive`。
  - `AccountAccess`に`readOnly: { reason } | null`を足す。
  - `apps/api/src/services/billing-service.ts`を作り、`loadEntitlement(db, userId, mode, now)`（`users`と`subscriptions`を読んで`entitlementOf`する）を置く。上限（T018）・定期処理（T034・T035）・チームの入口（T036）・`GET /api/me`（T019）はこれを使う。
  - `apps/api/src/routes/accounts.ts`の`DELETE /api/accounts/:accountId`を`owner`から`remove`に変える。
  - `apps/api/src/routes/account-team.ts`の`GET /api/accounts/:accountId/access`の応答に`readOnly`を足し、`packages/shared/src/schemas.ts`の`accountAccessResponseSchema`に`readOnly: z.object({ reason: z.enum(["trial_ended","payment_failed","canceled","owner_inactive"]) }).nullable()`を足す。
- [X] T013 `apps/api/test/integration/read-only-access.test.ts`を作る（決済ON）。T012の前に書いて失敗を確かめる。
  - オーナーが無料体験の終わった利用者のアカウントで、オーナー・担当の人（編集者・自分を担当にした管理者）・見せてもらっている人のそれぞれについて、`read`・`view`・`activity`のAPI（投稿ストック・戦略・パフォーマンス・CSV・操作の記録）が200になる。
  - 同じ人たちの`content`・`review`・`settings`・`owner`のAPIが`403 BILLING_REQUIRED`になる。対象は、案の登録・承認・却下・戦略の保存・NGワード・投稿のルール・自動投稿の設定・接続の確認・名前の変更・Threadsとの接続の開始・トークンでの接続。
  - `details`は、オーナーには`trial_ended`、ほかの人には`owner_inactive`になる。
  - `DELETE /api/accounts/:id`は通る。
  - 担当の人が読むだけで、オーナーがすべて使えるアカウントでは、担当の人の`content`が通る。
  - 支払いの失敗（`past_due`）・解約後（`canceled`）・料金なし・決済OFF・契約中のそれぞれで結果が表のとおりになる（SC-003、FR-040・FR-042）。
- [X] T014 旧プランを外す（research.md R12、FR-004）：
  - `packages/shared/src/plans.ts`・`packages/shared/test/plans.test.ts`を消す。
  - `packages/shared/src/access.ts`の`hasGrowerAccess`と`packages/shared/test/access.test.ts`の該当部分を消す（`trialEndsAt`のテストは`billing.test.ts`へ移す）。
  - `apps/api/src/services/grower-access.ts`を消す。
  - `requireGrowerAccess`・`canEditProfile`の呼び出しを外す：`apps/api/src/routes/strategy.ts`・`research.ts`・`promotions.ts`・`prompt.ts`・`performance.ts`・`posting-rules.ts`・`post-drafts.ts`、`apps/api/src/services/posting-rules-service.ts`。書き込みは`authorizeAccount`の権限で守られる。
  - `post-drafts.ts`の`canGeneratePrompt`と`posting-rules-service.ts`の`canEditCoreRules`は、`access.permissions.has("content")`・`has("settings")`から求める。
  - `apps/api/src/services/profile-status.ts`の`access`を`{ canEdit: access.permissions.has("content"), inTrial: state === "trial" \|\| state === "subscribed_trial", trialEndsAt }`にする（`trialDaysLeft`も足す）。
  - `apps/api/scripts/set-plan.ts`と`apps/api/package.json`の`admin:set-plan`を消す。
  - `pnpm --filter api typecheck`と`pnpm --filter api test`が通ることを確かめる。
- [X] T015 [P] Webの旧プランの表示を外す：`apps/web/src/components/GrowerRequiredNotice.tsx`を消し、使っている所（`apps/web/src/pages/strategy.tsx`・`promotions.tsx`・`research.tsx`・`account-settings.tsx`・`account-home.tsx`、`apps/web/src/components/settings/PostingScheduleSection.tsx`・`PostingRulesSection.tsx`、`apps/web/src/lib/save-error.ts`）から外す。読むだけの帯・ダイアログはUS3（T037・T038）で足す。それまでは、書き込みのボタンは`can()`の出し分けだけで消える。`apps/web/test/strategy.test.tsx`・`promotions.test.tsx`・`research.test.tsx`の`GROWER_FEATURE_REQUIRED`の期待を消す。`pnpm --filter web test`が通ることを確かめる。

**Checkpoint**：`BILLING_ENABLED=false`で、001〜012の自動テストとE2Eが今のまま通る。決済ONで、読むだけの権限の表（T013）が通る。

---

## Phase 3: User Story 1 -無料体験で使い始め、終わる日と上限がわかる(Priority: P1) 🎯 MVP

**Goal**：無料体験中はアカウント1件まで、すべての機能が使え、終わる日と残りの日数がわかる。

**Independent Test**：新しい利用者でアカウントを1件作り、すべて使えること、2件目が止まり契約の案内が出ること、ホームと「契約と支払い」に終わる日が出ることを確かめる。

### Tests for User Story 1

- [X] T016 [P] [US1] `apps/api/test/integration/account-limit-billing.test.ts`を作る（決済ON）。確かめること（FR-010〜FR-014、SC-001）：
  - 無料体験中で1件（未接続でも）あれば、`POST /api/accounts`が`409 ACCOUNT_LIMIT_REACHED`（`max: 1`）。2つ並べて送っても作られるのは1件まで。
  - チームで担当のアカウントは数えない。
  - 契約中（`trialing`・`active`・`canceling`）・料金なしなら3件目も作れる。
  - 無料体験が終わって契約がなければ`403 BILLING_REQUIRED`。
  - このfeatureの前に2件ある無料体験中の人は、今の2件をそのまま使え、3件目は作れない。
  - 決済OFFなら上限なし。
- [X] T017 [P] [US1] `apps/api/test/integration/me-billing.test.ts`を作る：`GET /api/me`の`billing`（`mode`・`state`・`readOnlyReason`・`trialEndsAt`・`trialDaysLeft`）と`accountLimit`（`{ max: 1 | null, used }`）が、無料体験中・契約中・料金なし・読むだけ・決済OFFで正しい。`GET /api/accounts/:id/profile-status`（ホームの入力状況）の`access`に`trialDaysLeft`。

### Implementation for User Story 1

- [X] T018 [US1] `apps/api/src/services/account-service.ts`の`ownedPlans`・`accountLimitFor`・`assertCanAddAccount`を置き換える（research.md R9）。利用者の状態はT012の`loadEntitlement`で読む。`assertCanAddAccount`は、`read_only`なら`BILLING_REQUIRED`、`accountLimit`があり所有の数が上限以上なら`ACCOUNT_LIMIT_REACHED`（`max`）を投げる。`createAccount`から`plan`を外す。鍵（`lockUserRow`）の中で数えるのは今のまま。
- [X] T019 [US1] `apps/api/src/routes/me.ts`の`GET /api/me`で、`accountLimit`を`{ max: entitlement.accountLimit, used }`にし、`billing`を足す。`withdrawalInProgress`も足す（今は常に`false`。US5で使う）。`packages/shared/src/schemas.ts`の`me`の応答の型を直す。
- [X] T020 [P] [US1] `apps/web/test/account-create.test.tsx`を先に直し、`apps/web/src/pages/account-new.tsx`に場合分けを足す（contracts/ui-routes.md「アカウントを作る」）。`state = trial`で`used >= 1`なら、入力欄の代わりに上限の文と「契約する」（`/settings/billing`）を出す。`state = read_only`なら、入力欄の代わりに理由の文と「契約する」か「支払いの画面を開く」を出す。アカウントが0件の人はサイドバーなしの1カラムのまま（spec Edge Cases）。
- [X] T021 [P] [US1] `apps/web/test/trial-ending-banner.test.tsx`を先に書き、`apps/web/src/components/billing/TrialEndingBanner.tsx`を作る（contracts/ui-routes.md「無料体験の終わりの帯」）。
  - 出す条件：`state = trial`で`trialDaysLeft <= 7`。
  - 文言：「無料体験はあと〇日で終わります。続けて使うには契約してください」。0日なら「無料体験は今日で終わります」。
  - 「契約する」と閉じるボタンを置く。閉じたら、日本時間のその日は出さない（`localStorage`の`trial-banner-dismissed:<YYYY-MM-DD>`。読み書きの失敗は毎回出す）。
  - サイドバーの右のメインの一番上に置く。置き場所は`apps/web/src/components/layout/`の共通のレイアウト（アカウントの画面・設定・チームの画面）。
- [X] T022 [P] [US1] `apps/web/src/pages/account-home.tsx`の「無料体験中：〇月〇日まで」に「（あと〇日）」を足す（`trialDaysLeft`）。`apps/web/test/account-home.test.tsx`を直す。
- [X] T023 [US1] `apps/web/test/billing-page.test.tsx`を先に書き、`apps/web/src/pages/settings/billing.tsx`を作る。表示は、状態のカード・料金の説明のカード・規約へのリンク。`billing_disabled`・`exempt`・`trial`の3つの状態の表示を作る（contracts/ui-routes.md「契約と支払い」。残りの状態はUS2〜US4で足す）。
  - `apps/web/src/pages/settings/sections.ts`に「契約と支払い」を足す（`slug: "billing"`、`CreditCardIcon`、検索語：料金・支払い・契約・解約・領収書・カード）。
  - `apps/web/src/router.tsx`に`/settings/billing`を足す。
  - `apps/web/src/lib/api-client.ts`に`billing()`（`GET /api/billing`）を足す。
- [X] T024 [US1] `apps/api/src/routes/billing.ts`を作り、`GET /api/billing`（`BillingSummary`。contracts/api.md）を返す。`apps/api/src/app.ts`につなぐ。`packages/shared/src/schemas.ts`に`billingSummarySchema`を足す。`apps/api/test/integration/billing-summary.test.ts`で、決済OFF・料金なし・無料体験中・契約中の応答を確かめる。

**Checkpoint**：決済ONの手元で、無料体験の利用者が1件まで作れ、2件目で止まり、帯とホーム・「契約と支払い」に終わる日が出る。

---

## Phase 4: User Story 2 -有料の契約をする(Priority: P1)

**Goal**：「契約する」からStripeの画面で契約し、戻ると契約中になり、2件目以降を作れる。

**Independent Test**：偽のStripeで、無料体験中・無料体験の後のそれぞれの利用者が契約し、戻って10秒以内に契約中、最初の請求日が正しく、2件目を作れる。

### Tests for User Story 2

- [X] T025 [P] [US2] `apps/api/test/integration/billing-checkout.test.ts`を作る（決済ON・偽のStripe）。確かめること（FR-021〜FR-025、research.md R4）：
  - はじめての「契約する」で顧客が1つ作られ（冪等キー`customer-<userId>`）、`subscriptions`の行ができる。
  - Checkoutの要求の中身：`mode=subscription`、数＝`max(n,1)`、`locale=ja`、`client_reference_id`、`success_url`・`cancel_url`、`proration_behavior=none`。
  - 無料体験の残りが10日なら`trial_end`＝無料体験の終わり。30時間なら`trial_period_days=1`。終わっていれば試用なし。
  - 2回目の「契約する」は前のセッションを期限切れにしてから作る。
  - 契約中（`trialing`・`active`・`canceling`）・支払いの失敗中は`409 ALREADY_SUBSCRIBED`。
  - 偽のStripeが500なら`503 BILLING_UNAVAILABLE`で、`subscriptions`の状態が変わらない。
  - 決済OFFなら404。
- [X] T026 [P] [US2] `apps/api/test/integration/billing-sync-webhook.test.ts`を作る（決済ON・偽のStripe）。確かめること（FR-023・FR-035・FR-056、SC-006、research.md R5）：
  - `POST /api/billing/sync`でStripeの今の契約が`subscriptions`に入る。
  - Webhook：署名がない・違う・5分より古いは400で、状態が変わらない。
  - 正しい署名の`customer.subscription.updated`で読み直す。同じ知らせを2回送っても結果が同じ。
  - 古い読み直し（`stripe_synced_at`が新しい方を上書きしない）を、2つの同時の`syncCustomer`で確かめる。
  - 知らない顧客は200で何もしない。
  - 1つの顧客に終わっていない契約が2つあれば、古い方を残し、新しい方を止めてエラーのログを出す。
  - 決済OFFならWebhookは404。

### Implementation for User Story 2

- [X] T027 [US2] `apps/api/src/services/billing-service.ts`に足す：
  - `ensureCustomer(env, tx, user)`：利用者の行の鍵の中で、なければStripeの顧客を作り`subscriptions`を作る。
  - `startCheckout(env, user)`：R4の確認・前のセッションの期限切れ・`checkoutTrialFor`・セッションを作り`pending_checkout_session_id`に残す。`{ url }`を返す。
  - `syncCustomer(env, db, customerId, now)`：`listSubscriptions`から、終わっていないもののうち作られたのがいちばん古いものを選び、それ以外の終わっていないものを`cancelSubscription`してログに残す。終わっていないものがなければ最新のものを選ぶ。`status`・`current_period_end`・`trial_end`・`cancel_at_period_end`・`quantity`・`stripe_subscription_id`を、`stripe_synced_at`が今回より古いときだけ書く。終わった契約なら`pending_checkout_session_id`を消す。
  - `syncUser(env, db, userId)`：顧客があれば`syncCustomer`。
  - Stripeの失敗は`AppError("BILLING_UNAVAILABLE", 503)`にする。
- [X] T028 [US2] `apps/api/src/routes/billing.ts`に`POST /api/billing/checkout`（`{ url }`）と`POST /api/billing/sync`（`BillingSummary`）を足す。決済OFFなら404を返す。
- [X] T029 [US2] `apps/api/src/routes/stripe-webhook.ts`を作る：`POST /api/stripe/webhook`。認証のミドルウェアを通さず、本文をテキストで読み、`verifyWebhookSignature`で確かめる。知らせの種類が`checkout.session.completed`・`customer.subscription.created`・`updated`・`deleted`・`paused`・`resumed`・`invoice.paid`・`invoice.payment_failed`なら、`data.object.customer`で`syncCustomer`を呼ぶ。ほかの種類は200で何もしない。`apps/api/src/app.ts`につなぐ。CORSの対象から外す。本文と署名をログに出さない。
- [X] T030 [US2] `apps/web/src/pages/settings/billing.tsx`に、`subscribed_trial`・`active`・`read_only(trial_ended)`の表示と「契約する」を足す（押すと`POST /api/billing/checkout`の`url`へ移る。押している間は止めて「支払いの画面に移っています…」。`BILLING_UNAVAILABLE`はトースト）。
  - `?checkout=success`で開いたら、`POST /api/billing/sync`を最大10秒くり返す。`subscribed_trial`・`active`になったら「契約しました」のトーストを出してURLから消す。10秒で変わらなければ案内を出す。
  - `?checkout=canceled`はURLから消す。
  - `apps/web/src/lib/api-client.ts`に`startCheckout()`・`syncBilling()`を足す。
  - `apps/web/test/billing-page.test.tsx`に場合を足す。

**Checkpoint**：偽のStripeで、無料体験中の利用者が契約し、「無料体験中（契約済み）」になり、2件目を作れる。

---

## Phase 5: User Story 3 -契約がない・未払いのときは読むだけになり、自動投稿が止まる(Priority: P1)

**Goal**：読むだけの利用者のアカウントで、書き込み・自動投稿・パフォーマンスの取得が止まり、データは見られる。契約すればすぐに戻る。

**Independent Test**：無料体験が終わった利用者のアカウントで、データが見られ、書き込みが止まり、自動投稿・パフォーマンスの取得が動かず、チームの編集者も読むだけになる。契約するとすぐに戻る。

### Tests for User Story 3

- [X] T031 [P] [US3] `apps/api/test/integration/auto-post-billing.test.ts`を作る（決済ON、`apps/api/test/helpers/auto-post.ts`を使う）。確かめること（FR-041、research.md R8）：
  - 読むだけのオーナーのアカウントで、時刻が来てもThreadsへの問い合わせが0回で、試みの行が作られない。
  - 一覧を読んだ後・確定の前に読むだけになったら、`skip_reason = 'billing_inactive'`で飛ばす。
  - やり直し待ち（`retry_wait`）の試みは、読むだけなら投稿せずに終える。結果の確認中（`in_progress`）のものは確認だけ続ける。
  - 契約して戻った後、次の時刻から投稿し、60分を過ぎた時刻はまとめて投稿しない。
  - 承認済みの案は承認済みのまま残る。
  - 料金なし・決済OFFでは今のまま投稿する。
- [X] T032 [P] [US3] `apps/api/test/integration/metrics-runner.test.ts`に足す（決済ON）：読むだけのオーナーのアカウントで、パフォーマンスの取得とフォロワーの記録がThreadsに問い合わせない。契約中・無料体験中・料金なしでは取得する。トークンの更新（日次）は読むだけでも続く。
- [X] T033 [P] [US3] `apps/api/test/integration/team-billing.test.ts`を作る（決済ON）。確かめること（FR-043・FR-044）：
  - 読むだけの人の`POST /api/teams`・`POST /api/invites/:token/accept`・`POST /api/teams/:id/accounts`が`403 BILLING_REQUIRED`。
  - 読むだけの管理者の招待・ロールの切り替え・担当の割り当て・人を外す・管理者の引き継ぎ・チームの名前と削除・「チームに見せる」は通る。

### Implementation for User Story 3

- [X] T034 [US3] `apps/api/src/services/auto-post-runner.ts`の「2.時刻の処理」の一覧に、オーナーの`users`（`memberships.role = 'owner'`）と`subscriptions`を結合し、`entitlementOf`で読むだけのオーナーの設定を外す。`apps/api/src/services/publish-claim.ts`の`skipReasonOf`で同じ確認をし、読むだけなら`billing_inactive`にする。`apps/api/src/services/publish-executor.ts`で、`retry_wait`の試みを投稿し直す前に同じ確認をし、読むだけなら失敗として終える。オーナーの状態を読む関数は`billing-service.ts`の`loadEntitlement`を使う（決済のモードは`billingModeOf(env)`）。
- [X] T035 [US3] `apps/api/src/services/metrics-runner.ts`の`hasGrowerAccess`（2か所）とプランでの絞り込み（`inArray(accounts.plan, …)`）を、オーナーの`users`・`subscriptions`の結合と`entitlementOf(...).fullAccess`に置き換える。
- [X] T036 [US3] `apps/api/src/services/invite-service.ts`の`assertOwnFreeAccounts`に、その人の`loadEntitlement`が`fullAccess`でなければ`BILLING_REQUIRED`を投げる確認を足す（呼び出し元のチームの作成・参加・アカウントの追加の3か所が守られる）。
- [X] T037 [P] [US3] `apps/web/test/read-only-banner.test.tsx`を先に書き、`apps/web/src/components/billing/ReadOnlyBanner.tsx`を作る（contracts/ui-routes.md「読むだけの帯」）。
  - `useAccountAccess`の`access.readOnly`があれば出す。理由ごとの文言とボタンは表のとおり。`owner_inactive`はボタンなし。閉じられない。
  - アカウントの画面のレイアウト（`apps/web/src/pages/account-layout.tsx`）の一番上に置く。未接続の帯より上。
- [X] T038 [P] [US3] `apps/web/src/components/billing/BillingRequiredDialog.tsx`を作る。保存の途中で`403 BILLING_REQUIRED`を受けたら、「編集できなくなりました」と帯と同じ文言を出し、入力は画面に残す。`apps/web/src/lib/save-error.ts`で`BILLING_REQUIRED`を受けたら、このダイアログを出す。今`GrowerRequiredDialog`を出していた画面（戦略・宣伝内容・リサーチ・投稿のルール）と、投稿ストックの保存で使う。`apps/web/test/strategy.test.tsx`に場合を足す。
- [X] T039 [P] [US3] `apps/web/src/components/AutoPostNotices.tsx`に、飛ばした理由`billing_inactive`の文「契約が止まっていたため、この時刻は投稿しませんでした」を足す。`apps/web/test/auto-post-notices.test.tsx`を直す。
- [X] T040 [US3] `apps/web/src/pages/settings/billing.tsx`に`read_only(payment_failed)`・`read_only(canceled)`の表示を足す。

**Checkpoint**：MVP（US1〜US3）。決済ONの手元で、無料体験→契約→（Test clockで）支払いの失敗→読むだけ→カードを直して戻る、が通る。

---

## Phase 6: User Story 4 -アカウントの数に応じて払い、契約を確かめ・変える・解約する(Priority: P2)

**Goal**：アカウントの数が次の請求に反映され、カードの変更・領収書・解約がStripeの画面でできる。

**Independent Test**：偽のStripeで、契約中にアカウントを足すと数が増え、削除すると減る（日割りなし）。解約すると期間の終わりまで使え、終わると読むだけ。

### Tests for User Story 4

- [X] T041 [P] [US4] `apps/api/test/integration/billing-quantity.test.ts`を作る（決済ON・偽のStripe）。確かめること（FR-030・FR-036、SC-005、research.md R6）：
  - 契約中にアカウントを作る・削除すると、Stripeの数が`max(n,1)`になり、`proration_behavior=none`。
  - 0件でも数は1。
  - 偽のStripeが失敗しても、作成・削除は成功し、`quantity_sync_needed = true`が残る。日次の処理（`runDailyJobs`）で数が合い、印が消える。
  - 契約がない利用者では何も呼ばない。
  - 日次の処理が、終わっていない契約を読み直す（知らせが届かなかったときの状態の変化が反映される）。
  - 決済OFFでは何もしない。
- [X] T042 [P] [US4] `apps/api/test/integration/billing-portal.test.ts`を作る：`POST /api/billing/portal`が`return_url = <WEB_ORIGIN>/settings/billing`のセッションの`url`を返す（`STRIPE_PORTAL_CONFIGURATION_ID`があれば渡す）。顧客がなければ`409 NO_SUBSCRIPTION`。解約の予約（`cancel_at_period_end`）が`state = canceling`・すべて使えるになり、期間の終わりの後に`canceled`になると読むだけになる。

### Implementation for User Story 4

- [X] T043 [US4] `apps/api/src/services/billing-service.ts`に`markQuantityDirty(tx, userId)`と`syncQuantity(env, db, userId)`を足す。`apps/api/src/services/account-service.ts`の`createAccount`・`deleteAccount`のトランザクションで`markQuantityDirty`し、トランザクションの後に`syncQuantity`を呼ぶ（失敗はログだけ）。`syncQuantity`は、契約が終わっていなければ`updateSubscriptionQuantity(…, billingQuantity(n))`し、`quantity`を書いて印を消す。契約の項目のIDは`listSubscriptions`の結果から取る。データ削除の求め（001の`data-deletion.ts`）でアカウントが消える所でも、同じ印を付ける。
- [X] T044 [US4] `apps/api/src/services/daily-jobs.ts`に「契約の合わせ直し」を足す（決済OFFなら飛ばす）。終わっていない契約と`quantity_sync_needed = true`の行について、`syncCustomer`と`syncQuantity`を呼ぶ。1件の失敗で全体を止めない。
- [X] T045 [US4] `apps/api/src/routes/billing.ts`に`POST /api/billing/portal`（`{ url }`）を足す。`apps/web/src/pages/settings/billing.tsx`に「支払いの画面を開く」と`canceling`の表示を足す。表示は「〇月〇日に終わります（解約済み）」と「その日まで、すべての機能を使えます。解約は支払いの画面から取り消せます」。`apps/web/src/lib/api-client.ts`に`openPortal()`を足す。契約（顧客）がある人は、画面を開くたびに`POST /api/billing/sync`を1回呼び、結果で表示を更新する（FR-036。`?checkout=success`のくり返しとは別）。`apps/web/test/billing-page.test.tsx`に場合を足す（開いたときの読み直しを含む）。
- [X] T046 [P] [US4] `apps/web/src/pages/account-new.tsx`に、契約中（`subscribed_trial`・`active`・`canceling`）で`used >= 1`なら「2件目からは1件につき月500円です。次の請求から反映されます」を入力の下に出す（FR-031）。`apps/web/test/account-create.test.tsx`に場合を足す。

---

## Phase 7: User Story 5 -退会する(Priority: P2)

**Goal**：退会すると、契約が止まり、チームから外れ（管理者は引き継ぎ）、アカウントとデータとログインの情報が消える。

**Independent Test**：アカウント2件・契約中・チームの管理者の利用者で退会し、契約・チーム・データ・トークン・ログインの情報が正しく扱われ、同じGoogleで新しい利用者として始まる。

### Tests for User Story 5

- [ ] T047 [P] [US5] `apps/api/test/integration/withdrawal.test.ts`を作る（決済ON・偽のStripe）。確かめること（FR-050〜FR-056、SC-007、research.md R10）：
  - `GET /api/me/withdrawal-preview`の内容：アカウントの名前、チームごとの`transfer`・`delete`・`leave`と引き継ぎ先、`hasActiveSubscription`。
  - `POST /api/me/withdraw`は、メールアドレスが違えば`422 CONFIRMATION_MISMATCH`で何も変わらない。大文字・小文字と前後の空白は区別しない。
  - 成功の順：Stripeの契約が止まる → アカウント・`threads_connections`・投稿ストックなどが0件 → 管理者のチームは、いちばん長くいる人が管理者になる（いなければ消える）→ ほかの人のアカウントの担当が外れる → ほかの人のアカウントの`activity_logs.actor_name`が「退会した人」で`actor_user_id`が`NULL` → `users`・`subscriptions`の行がない → `withdrawn_users`に行がある → Clerkのユーザーを消す呼び出しがある。
  - Stripeが失敗したら`503 BILLING_UNAVAILABLE`で、データが残り、`withdrawal_requested_at`が付く。もう一度呼ぶと終わる。
  - Clerkの削除が失敗しても204で、日次の処理が消して`clerk_deleted_at`を書く。
  - 退会の途中の人は、`GET /api/me`・プレビュー・退会のほかが`409 WITHDRAWAL_IN_PROGRESS`。
  - `withdrawn_users`にあるClerkのユーザーIDの要求は401で、`users`が作り直されない。
  - `clerk_deleted_at`から25時間で`withdrawn_users`の行が消える。
  - 日次の処理が、`withdrawal_requested_at`から1時間を過ぎた人の退会を終える。
  - 契約のない人・決済OFFでも退会できる。
  - その人のアカウントについて、Threads側からのデータ削除の求め（001の`threads_deletion_requests`）が処理中（`pending`・`failed`）なら、退会のあとで完了（`completed`）になる（spec Edge Cases）。

### Implementation for User Story 5

- [ ] T048 [US5] `apps/api/src/services/withdrawal-service.ts`を作る。中身は`withdrawalPreview(db, userId)`、`withdraw(env, deps, user, confirmEmail)`（R10の1〜4）、`resumeWithdrawals(env, now)`（日次）。
  - 引き継ぎ先の選び方は`apps/api/src/services/team-service.ts`の`beforeAccountDeleted`と同じにする（プレビュー用に、選ぶ部分を関数に分けて使い回す）。
  - Clerkのユーザーの削除は、`@clerk/backend`の`createClerkClient(...).users.deleteUser`を、差し込める依存（テストでは偽）にする。`apps/api/src/app.ts`の`AppDeps`に`deleteClerkUser`を足す。
  - 3のトランザクションの最後に、管理者のチームが残っていれば同じ引き継ぎをする。
  - 3のトランザクションの中で、消すアカウントの`threads_user_id`に当たる、処理中（`pending`・`failed`）のデータ削除の求め（`threads_deletion_requests`）を完了にする（`status = 'completed'`、`completed_at`を今に。001の削除の完了と同じ書き方を`apps/api/src/services/data-deletion.ts`から使う）。
- [ ] T049 [US5] `apps/api/src/routes/me.ts`に`GET /api/me/withdrawal-preview`と`POST /api/me/withdraw`（`{ confirmEmail }`、204）を足す。`GET /api/me`の`withdrawalInProgress`を`users.withdrawal_requested_at IS NOT NULL`にする。`packages/shared/src/schemas.ts`に`withdrawalPreviewSchema`・`withdrawRequestSchema`を足す。
- [ ] T050 [US5] `apps/api/src/middleware/auth.ts`を直す（contracts/api.md「認証のミドルウェアの変更」）。`withdrawn_users`にあるClerkのユーザーIDは、`users`を探す前・作る前に`401 AUTH_REQUIRED`にする。`withdrawal_requested_at`がある人は、3つのAPIのほかを`409 WITHDRAWAL_IN_PROGRESS`にする。`apps/api/src/services/daily-jobs.ts`に`resumeWithdrawals`を足す。
- [ ] T051 [P] [US5] `apps/web/test/withdraw-dialog.test.tsx`を先に書き、`apps/web/src/components/billing/WithdrawDialog.tsx`を作る。`apps/web/src/pages/settings/account.tsx`に「退会」のカードを足す（contracts/ui-routes.md「退会」）。
  - ダイアログの中身：消えるもの・チームの行き先・契約の文・メールアドレスの入力（合うまで押せない）。
  - 押している間は閉じられない。
  - 成功したらClerkの`signOut`で`/?withdrawn=1`へ移る。
  - 失敗の文：`BILLING_UNAVAILABLE`はダイアログの中に出す。`CONFIRMATION_MISMATCH`は入力欄の下に出す。
  - `apps/web/src/lib/api-client.ts`に`withdrawalPreview()`・`withdraw()`を足す。
- [ ] T052 [P] [US5] `apps/web/src/lib/api-client.ts`の共通のエラーの扱いで、`WITHDRAWAL_IN_PROGRESS`を受けたら「退会の手続きの途中です」の画面（`apps/web/src/components/billing/WithdrawalInProgress.tsx`。「退会する」だけを出す）に替える。`apps/web/src/pages/landing.tsx`で`?withdrawn=1`なら「退会しました」のトーストを出す。`apps/web/test/landing.test.tsx`を直す。

---

## Phase 8: User Story 6 -環境ごとに決済を切り替え、テストユーザーは料金なしで使う(Priority: P2)

**Goal**：決済のON/OFFとStripeの本番・テスト用を環境の設定で切り替え、料金なしの印で払わずに使える。

**Independent Test**：決済OFFで全員が上限なくすべて使え、ONで料金なしの印の付いた利用者が契約なしで2件以上作れる。

- [ ] T053 [P] [US6] `apps/api/test/integration/billing-modes.test.ts`を作る。確かめること（FR-060〜FR-062、SC-008）：
  - 決済OFFでは、`GET /api/billing`が`mode: "disabled"`。`checkout`・`sync`・`portal`・Webhookが404。無料体験の終わった人も上限なくすべて使える。契約の行は消えない。
  - ONで料金なしの印の付いた人は、契約なしで3件作れ、無料体験の後もすべて使える。印を外すと読むだけになる。
- [ ] T054 [US6] `apps/api/scripts/set-billing-exempt.ts`を作る（`pnpm --filter api admin:set-billing-exempt <email> on|off [--force]`。`apps/api/package.json`に足す）。メールアドレスで`users`を探す。`on`のとき、終わっていない契約があれば警告を出して止める（`--force`で付ける）。結果（前の値→新しい値）を出す。`apps/api/test/integration/set-billing-exempt.test.ts`で確かめる。
- [ ] T055 [P] [US6] `docs/external-services-setup.md`に「Stripe」の節を足す（FR-064、research.md R3・R7・R11）。内容は次のとおり。
  - テスト用環境と本番の切り替え。
  - 段階制の料金の作り方（JPY・月ごと・graduated・1件目1,000円・2件目から500円・内税）と、`BILLING_*_PRICE_JPY`の定数と同じ値か確かめる手順。
  - Webhookの宛先（`<API>/api/stripe/webhook`）と知らせの種類（research.md R5の8つ）。
  - カスタマーポータルの設定（支払い方法・請求書の履歴・期間の終わりの解約・解約の取り消しを許し、数と料金の変更は許さない）。
  - Smart Retriesと、やり直しが尽きたら契約を止める設定。
  - Stripeのメール（領収書・支払いの失敗・カードの期限切れ）。
  - 手元での`stripe listen --forward-to`。
  - 環境ごとの値の表（本番＝`true`＋`sk_live_`、ステージング＝`true`＋`sk_test_`、手元とPR＝`false`）。
  - 公開の前に、今の利用者へ料金なしの印を付ける手順。
  - §9の適格請求書の項から、この節へリンクする。

---

## Phase 9: User Story 7 -料金・解約・特定商取引法の表示(Priority: P3)

**Goal**：料金・解約・返金の決まりと、特定商取引法に基づく表記を、ログインせずに読める。

**Independent Test**：利用規約に料金などの節があり、特定商取引法に基づく表記のページがあり、どちらもログインせずに開け、「契約する」の前にリンクがある。

- [ ] T056 [P] [US7] `apps/web/test/terms-page.test.tsx`を先に直し、`apps/web/src/pages/terms.tsx`に「料金と支払い」「無料体験」「解約」「未払いのとき」「退会」の5つの節を足す（spec US7-2の内容。金額は`BILLING_BASE_PRICE_JPY`・`BILLING_EXTRA_PRICE_JPY`から出す）。「料金・解約・特定商取引法に基づく表示は 011（決済）で足す」のコメントを消す。
- [ ] T057 [P] [US7] `apps/web/test/legal-commerce.test.tsx`を先に書き、`apps/web/src/pages/legal-commerce.tsx`を作る（contracts/ui-routes.md「特定商取引法に基づく表記」の表。販売者の情報は`apps/web/src/lib/seller-info.ts`の定数で、空なら「（公開の前に記入）」）。`apps/web/src/router.tsx`に`/legal/commerce`（ログイン不要）を足す。`apps/web/src/pages/landing.tsx`の下と`apps/web/src/pages/settings/billing.tsx`の「契約する」の上に、「利用規約」「特定商取引法に基づく表記」のリンクを足す（SC-009）。

---

## Phase 10: Polish & Cross-Cutting Concerns

- [ ] T058 [P] `docs/ui-design.md`の設定の項目に「契約と支払い」を足し、帯の種類（無料体験の終わり・読むだけ・未接続）と並び順を足す。`specs/001-login-account-setup/spec.md`のFR-014〜FR-017と、`specs/002-strategy-profile/spec.md`のFR-024に「013で置き換えた（specs/013-billing）」の注を足す。
- [ ] T059 [P] `apps/web/test/solo-owner-unchanged.test.tsx`に足す。決済OFFでは、個人運用の人の画面に「契約と支払い」の項目のほか、帯もチームの説明も出ない。決済ONで契約中の人の「契約と支払い」に、チームの説明が出ない（FR-072）。
- [ ] T060 `e2e/tests/billing.spec.ts`を作る。偽のStripe（`pnpm --filter api fake-stripe`）と`BILLING_ENABLED=true`のAPIを使う。流れは次のとおり。
  - 無料体験の利用者でアカウントを1件作る。2件目で上限の案内。
  - 「契約と支払い」→「契約する」。偽のCheckoutからすぐに戻って「無料体験中（契約済み）」。2件目を作る。
  - 偽のStripeで`past_due`にし、Webhookを送ると読むだけの帯。
  - `active`に戻すと書き込める。
  - `e2e/playwright.config.ts`に、決済ONのAPIを立てる設定（別のポート）を足す。001〜012のE2Eは`BILLING_ENABLED=false`のまま。
- [ ] T061 `e2e/tests/withdraw.spec.ts`を作る。チームの管理者（`E2E_OWNER_EMAIL`）とメンバー（`team-flow.ts`の準備を使う）で、管理者が退会する。確かめること：
  - 確認の画面に引き継ぎ先が出る。
  - メールアドレスを入れて退会すると入口に「退会しました」。
  - メンバーの画面でチームの管理者がメンバーになっている。
  - 同じGoogleでログインすると「アカウントを作る」から始まる（Clerkのテスト用の利用者を作り直す準備を`e2e/tests/helpers.ts`に足す）。
- [ ] T062 `pnpm lint && pnpm typecheck && pnpm test`、`pnpm e2e`（`E2E_CLERK_USER_EMAIL=$E2E_OWNER_EMAIL`）を通す。quickstart.mdの「手で確かめる」の1〜9を、Stripeのテスト用環境で行う。日次の処理に、読むだけの人のデータを消すものがないことを確かめる（FR-047）。SC-002の「3分以内に契約を終える」は、手で確かめる手順の2で確かめる。結果と、計画からずれた所を`specs/013-billing/verification.md`に書く（012のverification.mdと同じ形）。

---

## Dependencies & Execution Order

### Phaseの順

- **Setup（Phase 1）**：すぐに始められる。T001〜T004は並行できる。
- **Foundational（Phase 2）**：Setupの後。T005→T006・T007（DB）、T008→T009・T010（環境とStripe）、T011→T012（判定。T013を先に書く）→T014・T015（旧プランを外す）。すべてのStoryの前提。
- **US1（Phase 3）**：Foundationalの後。
- **US2（Phase 4）**：US1のT023・T024（「契約と支払い」の画面と`GET /api/billing`）の後。
- **US3（Phase 5）**：Foundationalの後（判定と`loadEntitlement`はT012で入っている）。US2と並行できる。T040だけはT030の後。
- **US4（Phase 6）**：US2の後（契約と`syncCustomer`が要る）。
- **US5（Phase 7）**：Foundationalの後。Stripeの契約を止める部分はT027の後。
- **US6（Phase 8）**：T008の後ならいつでも。T053はUS1〜US2の後が確かめやすい。
- **US7（Phase 9）**：いつでも（T057のリンクの一部は`billing.tsx`ができてから）。
- **Polish（Phase 10）**：すべての後。

### Story間の関わり

- US1〜US3（P1）がMVP。US1だけでも「無料体験＋上限＋読むだけの判定」が動く（契約の口がないので、無料体験の後は読むだけになる）。
- US4はUS2の上に乗る。US5はUS2の`cancelSubscription`を使う。
- US6・US7は独立している。

### Story内の順

- テストを先に書いて失敗を確かめる → サービス → ルート → 画面。

## Parallel Example

```text
# Setup：
T001（PRD） / T002（billing.ts） / T003（permissions.ts） / T004（errors.ts）

# Foundational（DBと環境が済んだ後）：
T009（stripe-client.ts） / T010（fake-stripe）

# US1：
T016（上限のテスト） / T017（meのテスト） / T020（アカウントを作る画面） / T021（無料体験の帯） / T022（ホーム）

# US3：
T031（自動投稿のテスト） / T032（パフォーマンスのテスト） / T033（チームのテスト） / T037（読むだけの帯） / T038（ダイアログ） / T039（自動投稿の知らせ）
```

## Implementation Strategy

### MVP First（US1＋US2＋US3）

1. Phase 1・2を終える（決済OFFで001〜012がそのまま通ることを確かめる）。
2. US1（無料体験と上限）→ US2（契約）→ US3（読むだけ）。
3. **止めて確かめる**：決済ONの手元（偽のStripe、またはStripeのテスト用環境）で、無料体験→契約→支払いの失敗→戻る、を通す。

### Incremental Delivery

1. MVPの後にUS4（数の反映・ポータル・解約）を足すと、有料のサービスとして運用できる。
2. US5（退会）、US6（料金なし・手順書）、US7（規約・特定商取引法）で公開の準備がそろう。
3. Polishで文書・E2E・verification.mdをそろえる。

## Notes

- [P]：別ファイルで、未完了のタスクに依存しない。
- 決済の外部とのやり取りは、`billing-service.ts`・`stripe-client.ts`・`withdrawal-service.ts`の外に書かない。
- 使える状態の条件は`entitlementOf`の外に書かない（SQLに書き写さない）。
- コミットはタスクか、まとまりごとに行う。
