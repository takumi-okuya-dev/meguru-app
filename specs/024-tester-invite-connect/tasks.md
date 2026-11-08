---

description: "Task list for feature 024 tester invites, limits and no free trial"
---

# Tasks：テスター招待での接続、アカウント数・投稿数の上限、無料体験の廃止

**Input**：[spec.md](./spec.md)、[plan.md](./plan.md)、[research.md](./research.md)、[data-model.md](./data-model.md)、[contracts/api.md](./contracts/api.md)、[contracts/ui-routes.md](./contracts/ui-routes.md)、[quickstart.md](./quickstart.md)

**Tests**：001〜023と同じく、テストを先に書いて失敗を確かめてから実装する（TDD）。特に次を自動テストで確かめる。

| 成功の基準 | 確かめること |
|---|---|
| SC-001 | パスワードの欄と、運営者がトークンを作る・付けるAPIがない |
| SC-003 | OAuthでつながった申し込みが、必ず「接続済み」になる |
| SC-005 | テスター枠の使用数が、`holds_slot`の行の数といつも一致する |
| SC-006 | 上限を、同時の操作でもAPIの直接の呼び出しでも超えない（運営者を除く） |
| SC-007 | 運営者は、招待制がOFFでも料金なしで、上限なし |
| SC-009 | 契約前の人が、許す経路のほかを1つも使えない |
| SC-011 | 前からの無料体験の人が、終わる日より前に使えなくならない |

**Organization**：spec.mdのUser Storyの優先度の順に並べる。MVPはP1のUS1・US2・US6。US1とUS2は、申し込みと招待の両輪なので続けて作る。

## Format：`[ID] [P?] [Story] Description`

- **[P]**：別ファイルで、未完了のタスクに依存せず並行できる。
- **[Story]**：[US1]〜[US6]はspec.mdのUser Storyに対応する。
- **テストの置き場所**：
  - APIのテストは`apps/api/test/integration/`に、016・019の`operator-test-groups.test.ts`・`operator-features.test.ts`と同じ形で書く。
  - 部品は`apps/api/test/helpers/tester-invites.ts`に置く（新規。申し込みの行・運営者の環境・`legacy_trial`の利用者を作る）。
  - Webのテストは`apps/web/test/`に書く。
- **画面**：モック（https://claude.ai/artifact/R6Pc9o8YomNZNDEB161eSf ）のとおり。文字は短く、ボタンは今の画面にそろえる（docs/ui-design.md §6）。

## Phase 1：Setup（共有の型と定数）

- [X] T001 [P] `packages/shared/src/tester.ts`と`packages/shared/test/tester.test.ts`を作る。次を置く。
  - `TESTER_APPLICATION_STATUSES = ["pending","invited","connected","declined","withdrawn"]`
  - `TESTER_REMOVAL_REASONS = ["account_deleted","user_withdrawn","withdrawn","token_connected","username_mismatch"]`
  - `normalizeThreadsUsername(raw)`：前後の空白と先頭の`@`を取り、小文字にそろえる。`^[a-z0-9._]{1,30}$`に合わなければ`null`（research.md R3）
  - `TESTER_APPLY_RATE = { count: 5, windowMinutes: 10 }`、`DECLINE_REASON_MAX = 200`、`TESTER_SLOT_CAPACITY_DEFAULT = 25`
- [X] T002 [P] `packages/shared/src/limits.ts`に、上限の定数を足す。
  - `DEFAULT_ACCOUNT_LIMIT = 3`、`DEFAULT_DAILY_POST_LIMIT = 10`
  - `ACCOUNT_LIMIT_MAX = 1000`、`DAILY_POST_LIMIT_MAX = 250`
  - `AUTOPOST_SLOT_LIMIT`は`DEFAULT_DAILY_POST_LIMIT`の別名として残し、T050で使う所を置き換えてから消す。
- [X] T003 [P] `packages/shared/src/errors.ts`と`packages/shared/test/errors.test.ts`を直す。
  - 足すコード：`SUBSCRIPTION_REQUIRED`（403）、`TESTER_APPLICATION_EXISTS`（409）、`TESTER_APPLICATION_NOT_PENDING`（409）、`TESTER_SLOTS_FULL`（409）、`POSTING_SLOT_LIMIT`（409、「1日に投稿できるのは{max}件までです」）
  - `ACCOUNT_LIMIT_REACHED`の文：「作れるアカウントは{max}件までです。増やしたいときは運営者に連絡してください。」にする。`BILLING_EXTRA_PRICE_JPY`の参照をなくす（contracts/api.md「新しいエラーコード」）。

## Phase 2：Foundational（すべてのUser Storyの前提）

### Tests（先に書いて失敗を確かめる）

- [X] T004 [P] `apps/api/test/migration/migration-0022.test.ts`を作る（data-model.md 1・2）。確かめること：
  - **`tester_applications`**：
    - 列と既定値
    - `threads_username`の`^[a-z0-9._]{1,30}$`
    - `decline_reason`の200文字まで
    - 部分一意`tester_applications_live_account_uq`（`status IN ('pending','invited','connected')`）
    - `removal_reason`のCHECK（`removal_reason IS NULL OR status = 'withdrawn'`）
    - FKの`ON DELETE SET NULL`（`users`・`accounts`）
  - **`operator_settings`**：`CHECK (id = 1)`、`id = 1`の行と既定値（3・10・25）、範囲（1〜1000・1〜250・1〜10000）
  - **`operator_events`**：FKの`SET NULL`
  - **`users`の列**：
    - `account_limit`（NULL可、1〜1000）・`daily_post_limit`（NULL可、1〜250）
    - `legacy_trial`：マイグレーションの前からいた行が true、そのあとに足した行が false
- [X] T005 [P] `apps/api/test/unit/config.test.ts`に`testerInvitesEnabledOf`を足す（research.md R4）。
  - `THREADS_ACCESS_MODE`が`testers`か未設定で、`app`を出していればON。
  - `public`か、`token`だけならOFF。

### Implementation

- [X] T006 `apps/api/src/db/schema.ts`に、data-model.md 1・2のとおり次を足す。`apps/api/drizzle/0022_tester_invites.sql`と`drizzle/meta`を生成する（T004を通す）。
  - 列挙：`tester_application_status`・`tester_removal_reason`
  - 表：`tester_applications`・`operator_settings`・`operator_events`
  - `users`の列：`account_limit`・`daily_post_limit`・`legacy_trial`
  - `legacy_trial`は、既定値 true で足してから既定値を false に変える。
  - `operator_settings`は`id = 1`の行を入れる。
- [X] T007 `apps/api/src/lib/config.ts`に`testerInvitesEnabledOf(env)`を足す（T005を通す）。`apps/api/src/middleware/auth.ts`のJIT作成で`legacyTrial: false`を明示する（016の`signedUpOpen`と同じ作法。research.md R8）。
- [X] T008 [P] `apps/api/src/services/operator-events.ts`を作る（research.md R14）。
  - `recordOperatorEvent(tx, { actorUserId, subjectUserId?, applicationId?, action, detail? })`
  - `countRecentApplyActions(db, userId, since)`：`action IN ('apply','cancel')`
  - `listOperatorEvents(db, { actions, limit: 50 })`
- [X] T009 `packages/shared/src/schemas.ts`に、contracts/api.mdの入出力のスキーマを足す。
  - 申し込みのGET・POST
  - 運営者の一覧（`view`・`items`・`slots`・`counts`）と、`invite`の`force`、`decline`の`reason`（200文字まで）
  - `tester-settings`の`slotCapacity`（1〜10000）
  - 上限の既定値（1〜1000・1〜250）・利用者ごとの上限（`number | null`）
  - `me`の`limits`・`testerInvites`

**Checkpoint**：マイグレーションが当たり、今いる人に`legacy_trial`が付き、既定値の行がある。振る舞いはまだ何も変わらない。

## Phase 3：User Story 1 - 利用者が招待を申し込み、承認して、Threadsで許可してつなぐ（P1）🎯 MVP

**Goal**：つなぐ前のアカウントで、ユーザー名で申し込み、招待済みになったら承認の手順を見て「Threadsで許可する」でつなぎ、自動で「接続済み」になる。

**Independent Test**：招待の管理がONの環境で、申し込む → （テストのヘルパーで「招待済み」にする）→ OAuthでつなぐと「接続済み」になる。

### Tests（先に書いて失敗を確かめる）

- [X] T010 [P] [US1] `apps/api/test/integration/tester-applications.test.ts`を作る（contracts/api.md「利用者の申し込み」）。確かめること：
  - **GET**：申し込みなし → `application: null`、いちばん新しい申し込みを返す、取り下げだけなら`null`
  - **POST**：
    - `@Shop_Tokyo` → `shop_tokyo`
    - 形が違う → `VALIDATION_FAILED`
    - 生きている申し込みがある → `TESTER_APPLICATION_EXISTS`
    - 「見送り」のあとは作れる
    - つながっているアカウント → `VALIDATION_FAILED`
    - 他人のアカウント → `ACCOUNT_NOT_FOUND`
  - **DELETE**：
    - 「申し込み中」 → `withdrawn`（理由なし、`holds_slot`は false のまま）
    - 「招待済み」 → `withdrawn`・`removal_reason = withdrawn`（`holds_slot`は true のままで「外してよい」に出る）
    - それ以外 → `TESTER_APPLICATION_NOT_PENDING`
  - **回数の制限**：申し込みと取り消しの合計が10分に5回を超えたら`429 RATE_LIMITED`
  - **OFFの環境**：`THREADS_ACCESS_MODE=public`、または`token`だけなら、3つとも`404`
  - **記録**：`operator_events`に`apply`・`cancel`が残る
- [X] T011 [P] [US1] `apps/api/test/integration/tester-connect.test.ts`を作る（research.md R5、data-model.md 5）。確かめること：
  - 「招待済み」でOAuthでつながり、ユーザー名が同じ（大文字と小文字は区別しない） → `connected`
  - 「申し込み中」のままOAuthでつながった → `connected`と`holds_slot = true`
  - ユーザー名が違う → `withdrawn`・`username_mismatch`・`connected_username`
  - トークンでつながった → `withdrawn`・`token_connected`
  - アカウントを消した → `withdrawn`・`account_deleted`
  - 退会した：
    - 枠を使っていない行（申し込み中・見送り・取り下げ）は消える
    - 枠を使っている行は`withdrawn`・`user_withdrawn`になり、`user_id`・`account_id`が空で、ユーザー名だけが残る
    - `operator_events`の`detail`に、ユーザー名・名前・メールアドレスが入っていない（data-model.md §5、research.md R15）
  - 接続の確定が失敗したら、申し込みも変わらない（同じトランザクション）
- [X] T012 [P] [US1] `apps/api/test/integration/me-tester-invites.test.ts`を作る。`GET /api/me`の`testerInvites.enabled`がONとOFFの環境で変わることを確かめる。
- [X] T013 [P] [US1] `apps/web/test/tester-application-panel.test.tsx`を作る（contracts/ui-routes.md 2）。確かめること：
  - 4つの状態の表示（申し込み前・申し込み中・招待済み・見送り）、取り消し（申し込み中・招待済みの両方）、形の違うユーザー名の注意、`RATE_LIMITED`の文
  - OFFなら今の「Threadsで許可する」のまま
  - トークンでつなぐ方法は閉じた形で残る
- [X] T014 [P] [US1] `apps/web/test/threads-complete.test.tsx`（なければ作る）に、次を足す（research.md R13）。
  - 対象のアカウントの申し込みが「招待済み」で`THREADS_AUTH_CANCELLED`・`THREADS_AUTH_FAILED`で戻ったら、つなぐ画面に戻り「招待を承認してから、もう一度お試しください」が出る。
  - 「招待済み」でなければ、今のエラーのまま。

### Implementation

- [X] T015 [US1] `apps/api/src/services/tester-application-service.ts`を作る（T010を通す）。
  - `getApplication(db, accountId)`
  - `apply(env, user, accountId, rawUsername)`：`normalizeThreadsUsername`を使う。回数の制限は`countRecentApplyActions`。`operator_events`に記録する
  - `cancel(env, user, accountId)`：「申し込み中」は理由なしの取り下げ、「招待済み」は`removal_reason = withdrawn`の取り下げ
  - 記録の`detail`には、ユーザー名・名前・メールアドレスを入れない
  - 部分一意の衝突は`TESTER_APPLICATION_EXISTS`にする
- [X] T016 [US1] `apps/api/src/routes/tester-applications.ts`を作る。`GET`・`POST`・`DELETE /api/accounts/:id/tester-application`を置き、オーナーだけ（`authorizeAccount`）、OFFなら`404`にする。`apps/api/src/app.ts`につなぐ。
- [X] T017 [US1] `apps/api/src/services/tester-application-service.ts`に、次の2つを足す（T011を通す）。
  - `advanceOnConnect(tx, { accountId, method, username })`
  - `withdrawForRemoval(tx, { accountId?, userId?, reason })`
  - `purgeForWithdrawal(tx, userId)`：退会のとき、枠を使っていない行を消し、枠を使っている行を`user_withdrawn`にする
- [X] T018 [US1] 申し込みを進める処理を、次の所から呼ぶ（T011を通す）。
  - `apps/api/src/services/account-service.ts`の`completeConnection`：トランザクションの中で`advanceOnConnect`（OAuthとトークンの両方。research.md R5）
  - `deleteAccount`：消す前に`withdrawForRemoval(account_deleted)`
  - `apps/api/src/services/withdrawal-service.ts`の`withdraw`：利用者の行を消す前に`purgeForWithdrawal`
- [X] T019 [US1] `apps/api/src/routes/me.ts`に`testerInvites: { enabled }`を足す（T012を通す）。
- [X] T020 [US1] `apps/web/src/components/connect/TesterApplicationPanel.tsx`を作り、`apps/web/src/components/connect/ConnectMethods.tsx`で、招待の管理がONのとき「Threadsで許可する」の場所に出す（T013を通す。モック2〜4枚目）。
  - 「招待済み」の承認の手順は次の3つ。
    1. Threadsのアプリで、設定 › アカウント › ウェブサイトのアクセス許可 › 招待 を開く
    2. 招待を承認する
    3. 下の「Threadsで許可する」を押す
  - 「招待済み」では、小さな注意「つなげなかったときは、招待を承認してから、もう一度お試しください。」と、いちばん下に「申し込みを取り消す」（枠なし）も出す。
  - `apps/web/src/lib/query.ts`に`queryKeys.testerApplication(accountId)`を足す。
- [X] T021 [US1] `apps/web/src/pages/threads-complete.tsx`で、招待済みでつなげなかったときの案内を出す（T014を通す）。

**Checkpoint**：利用者の側の流れがそろい、つなぐと申し込みが自動で進む。

## Phase 4：User Story 2 - 運営者が、申し込みを一覧で見て招待し、テスター枠を管理する（P1）🎯 MVP

**Goal**：運営者が、状態ごとの一覧で「招待した」「見送る」「戻す」「外した」を行い、テスター枠の使用数を見る。

**Independent Test**：申し込みが状態ごとに分かれ、運営者の操作が利用者の画面に届き、枠の使用数が`holds_slot`の数と合う。

### Tests（先に書いて失敗を確かめる）

- [X] T022 [P] [US2] `apps/api/test/integration/operator-tester-invites.test.ts`を作る（contracts/api.md「運営者の招待の管理」）。確かめること：
  - **一覧**：
    - `view`ごとの中身と並び（`pending`は古い順）、200件まで
    - `counts`・`slots`
    - `duplicate`（同じユーザー名のほかの生きている申し込み）
    - `alreadyConnected`（そのユーザー名のアカウントがすでにつながっている）
    - 退会した人の`applicant: null`
    - `threadsAppId`（環境の`THREADS_APP_ID`。見本の値・未設定なら`null`）
  - **招待した**：`holds_slot`が true になる。枠がいっぱいで`force`なしなら`TESTER_SLOTS_FULL`（`details: [used, capacity]`）、`force`ありなら進む
  - **見送る**：理由は200文字まで
  - **戻す**：`invited` → `pending`、`holds_slot`が false になる
  - **外した**：`holds_slot`が false になる。退会した人の行は行ごと消える
  - **状態が合わない操作**：`TESTER_APPLICATION_NOT_PENDING`
  - **枠の数**：`PUT /api/operator/tester-settings`（1〜10000）
  - **運営者でない人**：`OPERATOR_ONLY`
  - **OFFの環境**：`enabled: false`で読める
  - **記録と使用数**：すべての操作が`operator_events`に残る。SC-005（使用数 = `holds_slot`の数）
- [X] T023 [P] [US2] `apps/web/test/settings-tester-invites.test.tsx`を作る（contracts/ui-routes.md 5）。確かめること：
  - 枠の表示と「枠の数を変える」、「Metaでテスターを加える」のリンク
  - タブと件数、行ごとの操作
  - 見送りの理由のダイアログ、枠がいっぱいの確認のダイアログ
  - 「外してよい」の理由の文
  - 「見送り・取り下げを見る」
  - OFFの環境の表示（操作のボタンなし）
  - 運営者でない人には「運営」の区分が出ない

### Implementation

- [X] T024 [US2] `apps/api/src/services/tester-application-service.ts`に、運営者の操作を足す（T022を通す）。
  - `listForOperator(db, view)`
  - `invite(env, operator, id, { force })`
  - `decline(env, operator, id, reason)`
  - `revert(env, operator, id)`
  - `markRemoved(env, operator, id)`
  - `setSlotCapacity(env, operator, n)`
  - `slotUsage(db)`
- [X] T025 [US2] `apps/api/src/routes/operator-tester-invites.ts`を作る（`GET /api/operator/tester-applications`、`POST …/:id/invite|decline|revert|removed`、`PUT /api/operator/tester-settings`）。運営者の確かめ方は016の`operator-test-groups.ts`と同じにする。`apps/api/src/app.ts`につなぐ。
- [X] T026 [US2] `apps/web/src/pages/settings/tester-invites.tsx`を作る（T023を通す。モック5枚目）。
  - 「Metaでテスターを加える」のURLは、一覧の応答の`threadsAppId`から作る（contracts/api.md）。`null`ならリンクを出さない。
  - 足すところ：`apps/web/src/pages/settings/sections.ts`の`OPERATOR_SETTINGS_GROUP`（使える機能・グループ・テスター招待・上限の順）、`apps/web/src/router.tsx`の`/settings/tester-invites`。

**Checkpoint**：MVPの招待の流れ（US1＋US2）が、手元とテストで最初から最後まで動く。

## Phase 5：User Story 6 - 無料体験なしで、契約してから使い始める（P1）🎯 MVP

**Goal**：新しく登録した人は契約するまで使えず、料金はアカウント1件につき月1,000円。前からの無料体験の人はそのまま。

**Independent Test**：決済がONの環境で、新しい人は`SUBSCRIPTION_REQUIRED`で止まり、契約するとその場で請求されて使える。`legacy_trial`の人は無料体験のまま。

### Tests（先に書いて失敗を確かめる）

- [X] T027 [P] [US6] `packages/shared/test/billing.test.ts`を直す（data-model.md 3）。
  - `entitlementOf`の9つの順。`legacyTrial: false`で契約がなければ`unsubscribed`（`fullAccess: false`・`readOnlyReason: "not_subscribed"`・`accountLimit: 0`）。`legacyTrial: true`なら今のとおり。
  - `nextInvoiceAmount(0) = 1000`、`nextInvoiceAmount(3) = 3000`。
- [X] T028 [P] [US6] `apps/api/test/integration/subscription-required.test.ts`を作る（research.md R9、contracts/api.md「認証のミドルウェア」）。確かめること：
  - **新しい人**：許す経路（me・退会・billingの4つ・test-invites・`GET /api/invites/:token`）は通り、ほか（`POST /api/accounts`、`POST /api/teams`、`POST /api/invites/:token/accept`、`GET /api/me/referral`など）は`403 SUBSCRIPTION_REQUIRED`
  - **止めない人**：`legacy_trial`の人、料金なしの人、運営者、決済がOFFの環境
  - **判定の順**：退会の途中 → テスト版に入れない → 契約前
  - **契約したあと**：（Webhookで`active`）すぐ使える
- [X] T029 [P] [US6] 今の決済のテストを直す。
  - `apps/api/test/integration/billing-checkout.test.ts`：契約前の人のCheckoutに試用が付かない（その場で請求）。`legacy_trial`で無料体験中の人は今のとおり
  - `apps/api/test/integration/billing-summary.test.ts`：`prices: { perAccount: 1000 }`、次の請求の見込みが「数 × 1,000円」、契約前は`state: "unsubscribed"`・`trialEndsAt: null`
  - `apps/api/test/integration/me-billing.test.ts`
  - `apps/api/test/integration/account-limit-billing.test.ts`
  - `fullAccessSql`と`entitlementOf`の照合（`apps/api/test/integration/codex-pr16.test.ts`）に、`legacy_trial`の true・false の場合を足す
- [X] T030 [P] [US6] `apps/api/test/integration/billing-quantity.test.ts`に足す（research.md R10）。
  - 契約の項目の料金が`STRIPE_PRICE_ID`と違えば、数の合わせ直しで新しい料金に替わる（`proration_behavior: none`）。
  - 同じなら替えない。
  - 偽のStripe（`apps/api/test/fake-stripe`）に、項目の料金の読み書きを足す。
- [X] T031 [P] [US6] `apps/web/test/subscribe-required.test.tsx`を作る（contracts/ui-routes.md 1）。確かめること：
  - `me.billing.state === "unsubscribed"`でも、`SUBSCRIPTION_REQUIRED`を受け取っても、契約前の画面になる
  - 料金「アカウント1件につき 月1,000円」、「契約する」、ログアウトと退会が下にある
  - `/settings/billing`は開ける
- [X] T032 [P] [US6] `apps/web/test/billing-page.test.tsx`・`billing-banners.test.tsx`・`landing.test.tsx`を直す。
  - 新しく登録する人が見る画面に「無料体験」「1か月無料」「月500円」が出ない（SC-010）。
  - 無料体験の帯は`state === "trial"`の人だけに出る。

### Implementation

- [X] T033 [US6] `packages/shared/src/billing.ts`を直す（T027を通す）。
  - 足すもの：`BillingState`の`unsubscribed`、`ReadOnlyReason`の`not_subscribed`、`EntitlementInput.legacyTrial`、`BILLING_UNIT_PRICE_JPY = 1000`
  - 変えるもの：`entitlementOf`の順、`nextInvoiceAmount`
  - なくすもの：`BILLING_BASE_PRICE_JPY`・`BILLING_EXTRA_PRICE_JPY`（使う所をすべて直す）
  - `packages/shared/src/schemas.ts`の`me.billing`と`BillingSummary.prices`（`{ perAccount }`）を合わせる。
- [X] T034 [US6] `apps/api/src/services/billing-service.ts`を直す（T029を通す）。
  - `BillingFacts`に`legacyTrial`を足し、`loadEntitlement`で読む。
  - `fullAccessSql`の無料体験の条件に`users.legacy_trial`を足す。
  - `toMeBilling`・`billingSummary`は、契約前の人の`trialEndsAt`を`null`にする。
- [X] T035 [US6] `apps/api/src/middleware/auth.ts`を直す（T028を通す）。
  - 利用者の問い合わせに`subscriptions`を結合して`legacy_trial`と契約の状態を読み、`entitlementFromFacts`で`unsubscribed`なら、許す経路のほかを`403 SUBSCRIPTION_REQUIRED`で止める。
  - 許す経路は、`SELF_SERVICE_ALLOWED`と、billing・test-invites・`GET /api/invites/:token`。
  - 問い合わせは1回のまま（plan.md「性能の目標」）。
- [X] T036 [US6] `apps/api/src/services/billing-service.ts`の`syncQuantity`で、契約の項目の料金が`env.STRIPE_PRICE_ID`と違えば、新しい料金へ`proration_behavior: "none"`で切り替える（T030を通す）。`apps/api/src/lib/stripe-client.ts`に項目の料金を替える呼び出しを足す。
- [X] T037 [US6] Webに契約前の扱いを足す（T031を通す。モック1枚目）。
  - `apps/web/src/components/billing/SubscribeRequired.tsx`を作る。
  - `apps/web/src/lib/api-client.ts`に`SUBSCRIPTION_REQUIRED`の印（`getSubscriptionRequired`・`subscribeSubscriptionRequired`。`TEST_ACCESS_REQUIRED`と同じ作り）を足す。
  - `apps/web/src/components/guards.tsx`で、`me.billing.state === "unsubscribed"`か印があれば出す（`/settings/billing`は通す）。
- [X] T038 [US6] 料金と無料体験の文言を直す（T032を通す。contracts/ui-routes.md 7）。
  - 料金を1件1,000円にし、無料体験の条項・表示をなくすか、前からの人だけにする：
    - `apps/web/src/pages/landing.tsx`
    - `apps/web/src/pages/terms.tsx`（前からの無料体験の経過措置を一文で残す）
    - `apps/web/src/pages/legal-commerce.tsx`
    - `apps/web/src/pages/settings/billing.tsx`
    - `apps/web/src/pages/account-new.tsx`
    - `apps/web/src/pages/account-home.tsx`
    - `apps/web/src/components/stock/PromptCard.tsx`
    - `apps/web/src/components/billing/BillingRequiredDialog.tsx`
    - `apps/web/src/components/billing/TrialEndingBanner.tsx`
  - 料金の金額は共有の`BILLING_UNIT_PRICE_JPY`から出す。
- [X] T039 [US6] `docs/external-services-setup.md`の10-2を「1件につき1,000円（数による定額）」の作り方に直し、すでにある契約は数の合わせ直しで切り替わることを書く（research.md R10）。`apps/api/wrangler.toml`の`STRIPE_PRICE_ID`の注記を直す（値はT073で入れる）。

**Checkpoint**：MVP（US1・US2・US6）がそろい、本番の公開に要る流れが通る。

## Phase 6：User Story 3 - 運営者が、アカウントの数と1日の投稿数の上限を決める（P2）

**Goal**：全員共通の既定値と利用者ごとの値で、アカウントの数と1日の投稿数を制限する。

**Independent Test**：既定値をアカウント2件・投稿3件にすると、3件目と4つ目の時刻が止まる。その人だけ上げると通る。

### Tests（先に書いて失敗を確かめる）

- [X] T040 [P] [US3] `apps/api/test/integration/account-limits.test.ts`を作る（research.md R6・R7、data-model.md 4）。確かめること：
  - **上限の決まり方**：
    - 既定値で止まる（`ACCOUNT_LIMIT_REACHED`、`details`の`max`）
    - 利用者ごとの値が優先される
    - 前からの無料体験の1件とは、小さい方が効く
  - **かける人・かけない人**：料金なしの人・グループの人にもかかる。運営者にはかからない
  - **未接続**：未接続のアカウントも数える
  - **同時の操作**：同時に10件作っても上限を超えない
  - **上限を下げたとき**：今あるアカウントは残る（FR-021）
  - **`GET /api/me`の`limits`**：運営者は`accountLimit: null`
- [X] T041 [P] [US3] `apps/api/test/integration/posting-schedule.test.ts`に足す（contracts/api.md「投稿のスケジュール」）。確かめること：
  - `limits.slots`がオーナーの上限になる
  - 上限を超える保存は`POSTING_SLOT_LIMIT`
  - 上限を超えたままでも、時刻を減らす保存は通る
  - `overLimit`
  - チームの人が手伝うアカウントでは、オーナーの値が効く
  - 運営者は250まで
- [X] T042 [P] [US3] `apps/api/test/integration/auto-post-daily-limit.test.ts`を作る。
  - 時刻を8つ登録し、オーナーの上限を5にすると、自動投稿の時刻の処理が早い5つだけ試みを作る。
  - 上限を戻すと8つ使う。
  - 時刻の行は消えない（FR-020）。
- [X] T043 [P] [US3] `apps/api/test/integration/operator-limits.test.ts`を作る（contracts/api.md「運営者の上限」）。確かめること：
  - 既定値の読み書きと範囲（1〜1000・1〜250）
  - 利用者を探す（完全一致、`USER_NOT_FOUND`）
  - 利用者ごとの値の保存と、`null`で既定値に戻す
  - `overrides`の一覧
  - 記録50件
  - `OPERATOR_ONLY`
- [X] T044 [P] [US3] `packages/shared/test/schedule.test.ts`を直す。`validatePostingSchedule`が`maxSlots`を受け取り、超えたら`too_many`を返すことを確かめる。
- [X] T045 [P] [US3] `apps/web/test/settings-limits.test.tsx`を作る（contracts/ui-routes.md 6）。確かめること：
  - 既定値の保存
  - 探す・「この人だけ」と「既定値」の表示・保存・既定値に戻す
  - 運営者の注意
  - 既定値と違う人の一覧
  - 記録のトグル
- [X] T046 [P] [US3] `apps/web/test/account-settings.test.tsx`（投稿のスケジュール）と`apps/web/test/account-new.test.tsx`（なければ作る）に足す（contracts/ui-routes.md 3・4）。
  - 投稿のスケジュール：「◯件まで」、上限で「時刻を足す」を押せない、`overLimit`の注意と「投稿しません」
  - アカウントを作る：上限に達したときの注意と、押せない「作る」

### Implementation

- [X] T047 [US3] `apps/api/src/services/limit-service.ts`を作る（data-model.md 4）。
  - `getDefaults(db)`、`setDefaults(env, operator, v)`
  - `getUserLimits(db, userId)`、`setUserLimits(env, operator, userId, v)`
  - `effectiveAccountLimit(db, user, entitlement)`、`effectiveDailyPostLimit(db, ownerUserId)`
  - 運営者は`null`、投稿は250
  - 変えたことを`operator_events`に記録する
- [X] T048 [US3] `apps/api/src/services/account-service.ts`の`accountLimitFor`を、使える状態の上限と`effectiveAccountLimit`の小さい方にする（T040を通す）。`apps/api/src/routes/me.ts`に`limits`を足す。
- [X] T049 [US3] `packages/shared/src/schedule.ts`の`validatePostingSchedule`に`{ maxSlots }`を足す（T044を通す）。`packages/shared/src/schemas.ts`の`slotTimes`の`max`を`DAILY_POST_LIMIT_MAX * 2`にする。
- [X] T050 [US3] `apps/api/src/services/posting-schedule-service.ts`と`apps/api/src/routes/posting-schedule.ts`を直す（T041を通す）。
  - 保存で、オーナーの`effectiveDailyPostLimit`を超えたら`POSTING_SLOT_LIMIT`。ただし、減らす保存は通す。
  - `limits.slots`と`overLimit`を返す。
  - `AUTOPOST_SLOT_LIMIT`を使う所をなくし、`packages/shared/src/limits.ts`から別名を消す。
- [X] T051 [US3] `apps/api/src/services/auto-post-runner.ts`で、設定の読み込みにオーナーの上限（`users.daily_post_limit`・`operator_settings`・運営者）を結合で足し、`slotMinutes`を早い順に上限の数までに切る（T042を通す）。
- [X] T052 [US3] `apps/api/src/routes/operator-limits.ts`を作り（`GET/PUT /api/operator/limits`、`GET /api/operator/limits/users`、`PUT /api/operator/limits/users/:userId`）、`apps/api/src/app.ts`につなぐ（T043を通す）。
- [X] T053 [US3] `apps/web/src/pages/settings/limits.tsx`を作る（T045を通す。モック6枚目）。`sections.ts`と`router.tsx`の`/settings/limits`を足す。
- [X] T054 [US3] 利用者の画面に上限を出す（T046を通す。モック7・8枚目）。
  - `apps/web/src/components/settings/PostingScheduleDialog.tsx`：上限の数を`limits.slots`から出し、`overLimit`の注意と「投稿しません」を足す。
  - `apps/web/src/pages/account-new.tsx`：上限に達したときの注意を出す。

**Checkpoint**：上限が、画面・API・自動投稿の時刻の処理のすべてで効く。

## Phase 7：User Story 4 - 運営者は、どの環境でも料金なしで、上限なく使える（P2）

**Goal**：招待制がOFF（本番）でも、運営者は料金なしで上限なし。

**Independent Test**：決済ONで招待制OFFの環境で、運営者が契約なしに4件目のアカウントを作り、11個目の時刻を足せる。

### Tests（先に書いて失敗を確かめる）

- [X] T055 [P] [US4] `apps/api/test/integration/operator-billing-exempt.test.ts`を書き直す（research.md R11）。確かめること：
  - 招待制がOFFでも、運営者は`exempt`になる（契約前の画面も読むだけもない）
  - 運営者のリストから外れると、ほかの人と同じになる（料金なしの印が手で付いていれば料金なし）
  - テスト版に入れる判定（`testAccessSql`）は今のまま
  - 016・019で「OFFの環境では運営者に料金なしが付かない」を確かめていたテスト（`test-groups-production.test.ts`・`operator-flag.test.ts`）を、新しい振る舞いに直す
- [X] T056 [P] [US4] `apps/api/test/integration/account-limits.test.ts`と`posting-schedule.test.ts`の運営者の場合（T040・T041）が、招待制がOFFの環境でも通ることを足す。

### Implementation

- [X] T057 [US4] 運営者の判定を、招待制にかかわらず効くようにする（T055・T056を通す）。
  - `apps/api/src/lib/config.ts`の`billingModeOf`が、招待制にかかわらず`operators`を持つ。
  - `apps/api/src/services/test-group-service.ts`の`billingExemptSql`が、いつも運営者を含む。
  - `testAccessSql`の呼び出し（`mode.testGroups`のときだけ運営者を含める）は変えない。
- [X] T058 [US4] `docs/environment-switches.md`の`OPERATOR_CLERK_USER_IDS`の説明、「組み合わせたときの振る舞い」の表、「運営者を足すときの注意」を直す（FR-025）。同じ表で、テスト版の`THREADS_CONNECT_METHODS`を「両方」にし、`THREADS_ACCESS_MODE`の説明に招待の管理を足す。

**Checkpoint**：運営者は、テスト版でも本番でも料金なし・上限なし。

## Phase 8：User Story 5 - Meta App Reviewに通ったら、本番だけ招待の管理を切る（P3）

**Goal**：`THREADS_ACCESS_MODE=public`で、申し込みの画面が消え、記録は残る。

**Independent Test**：同じ環境で`public`にすると、つなぐ画面がすぐ「Threadsで許可する」になり、運営者の一覧は読めるが操作できない。

### Tests（先に書いて失敗を確かめる）

- [X] T059 [P] [US5] `apps/api/test/integration/tester-invites-off.test.ts`を作る。確かめること：
  - `public`で、利用者の申し込みのAPIが`404`、運営者の一覧が`enabled: false`で読める
  - 運営者の操作（招待した・見送るなど）は`404`
  - 「申し込み中」「招待済み」の行は消えない
  - OAuthでつながったときは、今までどおり申し込みを進める（記録を正しく保つ）
- [X] T060 [P] [US5] `apps/web/test/tester-application-panel.test.tsx`・`settings-tester-invites.test.tsx`に、OFFの環境の表示を足す（申し込みの表示が消える・「この環境では招待の管理を使っていません」）。

### Implementation

- [X] T061 [US5] `apps/api/src/routes/operator-tester-invites.ts`で、OFFなら操作を`404`にし、一覧に`enabled: false`を返す（T059を通す）。
- [X] T062 [US5] `apps/web/src/pages/settings/tester-invites.tsx`と`TesterApplicationPanel.tsx`で、OFFの表示を出す（T060を通す）。

**Checkpoint**：設定を変えるだけで、本番の招待の管理を切れる（SC-008）。

## Phase 9：Polish & Cross-Cutting

- [X] T063 [P] `apps/api/test/integration/no-password-no-token-issue.test.ts`を作る（SC-001）。
  - 運営者のAPIに、トークンを作る・付ける経路がないことを確かめる（`/api/operator/*`の経路の一覧に、`token`を受け取る・返すものがない）。
  - Webのどの画面にもパスワードの入力欄がないことを、`apps/web/test/no-password-field.test.tsx`で確かめる（`input[type=password]`がない）。
- [X] T064 [P] `apps/api/test/unit/wrangler-config.test.ts`を直す。テスト版の`THREADS_CONNECT_METHODS`が未設定で、`THREADS_ACCESS_MODE = "testers"`、本番も`testers`であることを確かめる。
- [X] T065 `apps/api/wrangler.toml`のテスト版の値を直す。
  - `THREADS_CONNECT_METHODS`を消す（両方）。
  - `THREADS_APP_ID`をThreadsAutomationの`1367107908637398`にする。
  - `THREADS_REDIRECT_URI`は今のまま。
- [X] T066 [P] `docs/external-services-setup.md`を直す（research.md R12）。
  - 3-3と9-8に、テスト版（ThreadsAutomation）の3つのコールバックのURLを書く。
    - リダイレクト：`https://threads-grower-api-staging.marron-taku.workers.dev/api/threads/callback`
    - アンインストール：`…/api/threads/uninstall`
    - 削除：`…/api/threads/data-deletion`
    - 実際の経路は`apps/api/src/routes/threads-webhooks.ts`・`data-deletion.ts`で確かめて書く。
  - `THREADS_APP_SECRET`の入れ方を書く。
  - 本番用のMetaアプリを作る手順（ユースケース「Threads APIにアクセス」、3つの権限、テスターの加え方）を足す。
  - 「`token`だけなら要りません」の段落を、024のあとの形に直す。
- [X] T067 [P] 利用者向けと全体の文書を直す。
  - `docs/user-guide.md`：
    - テスター招待の申し込みから接続までの手順
    - 料金（1件1,000円・契約してから使う）
    - アカウントと投稿の上限
  - `docs/threads-token-guide.md`：トークンの貼り付けは、自分のMetaアプリを持つ人向けの別の入口として残ることを書く。
  - `docs/architecture.md`：申し込み・上限・契約前の判定の場所を書く。
  - `docs/ui-design.md`：「運営」の区分の4つの項目と、つなぐ画面の申し込みの欄を書く。
- [X] T068 [P] `docs/next-features.md`のテスター招待・料金・本番の準備に関わる項目を済みにし、§I（Meta App Review）に「審査の後は`THREADS_ACCESS_MODE=public`で招待の管理を切る」を足す。
- [X] T069 `docs/release-runbook.md`に、本番に出す前の手順を足す。
  - 本番用のMetaアプリを作る
  - 3つの値とURL、`STRIPE_PRICE_ID`（本番の1件1,000円）、本番の`OPERATOR_CLERK_USER_IDS`を入れる
  - 本番の`THREADS_APP_ID`と`STRIPE_PRICE_ID`は、`apps/api/wrangler.toml`の`[env.production.vars]`を直すPRで入れる（アプリと料金を作ったあと。今の見本の値のままでは`app`を出せない）
- [X] T070 `.specify/memory/constitution.md`の先頭のSync Impact Reportを消す（4.4.0の本文は残す）。PRDの直し（`_bmad-output/.../prd-threads-grower-app.md`）と一緒にこのPRに入れる。
- [X] T071 `pnpm -r typecheck`・`pnpm -r lint`・`pnpm -r test`を通す。今のE2E（決済OFFの手元）が通ることを確かめる。
  - 2026-11-08：typecheck・lint・テスト（共有504・Web 721・API 1,228）はすべて通過。E2Eは、手元に Clerk のテスト用ユーザーの設定（`e2e/.env.local`）がなくログインで止まるため、通しては確かめていない。024に合わせて`e2e/tests/billing.spec.ts`（契約前 → 契約）と`e2e/playwright.config.ts`（8787 は `THREADS_ACCESS_MODE=public`）を直した。
- [ ] T072 [quickstart.md](./quickstart.md)の0〜5を手元で行い、結果を`quickstart.md`の末尾に記録する。
- [ ] T073 （運営者の作業。マージの前後）次を行い、`docs/staging-setup-record.md`に記録する。
  - ThreadsAutomationに3つのコールバックのURLを登録する。
  - `THREADS_APP_SECRET`をテスト版のSecretに入れる。
  - Stripeのテスト用環境に1件1,000円の料金を作り、`apps/api/wrangler.toml`のテスト版の`STRIPE_PRICE_ID`に入れる。
- [ ] T074 （マージのあと）quickstart.mdの6を、テスト版の実際のThreadsアカウントで行い、`docs/staging-setup-record.md`に記録する。あわせて、SC-002（利用者が承認からつなぐまで10分以内）とSC-004（運営者が1件を招待するまで3分以内）を測って記録する。

## Dependencies & Execution Order

### Phaseの順

1. **Setup（T001〜T003）**：すぐに始められる。3つとも並行できる。
2. **Foundational（T004〜T009）**：Setupのあと。すべてのUser Storyの前提。
3. **User Story**（Foundationalのあと）：

   | Phase | 前提 |
   |---|---|
   | US1（P1） | Foundational |
   | US2（P1） | US1の`tester-application-service.ts`（T015・T017）。同じファイルなので、US1のあとに続ける |
   | US6（P1） | Foundationalだけ。US1・US2と並行できる（触るファイルが別：決済・認証・文言） |
   | US3（P2） | Foundational。`me.ts`はUS1（T019）と、`account-new.tsx`はUS6（T038）と重なるので、その後にする |
   | US4（P2） | US3（上限の判定に運営者を入れる）・US6（料金なしの判定） |
   | US5（P3） | US1・US2 |

4. **Polish（T063〜T074）**：使いたいUser Storyがそろったあと。T073は、T065の値が入ってから。T074はマージのあと。

### User Storyの中の順

- テスト → サービス → ルート → 画面
- 同じファイル（`tester-application-service.ts`・`account-service.ts`・`me.ts`・`auth.ts`）を触るタスクは、並行しない。

## Parallel Examples

```text
# Setup：同時に
T001 packages/shared/src/tester.ts
T002 packages/shared/src/limits.ts
T003 packages/shared/src/errors.ts

# US1のテスト：同時に
T010 tester-applications.test.ts
T011 tester-connect.test.ts
T012 me-tester-invites.test.ts
T013 tester-application-panel.test.tsx
T014 threads-complete.test.tsx

# US1・US2 と US6 は、別の人（別のセッション）で並行できる
US1→US2：tester-application-service.ts・ConnectMethods.tsx・settings/tester-invites.tsx
US6    ：billing.ts・billing-service.ts・auth.ts・SubscribeRequired.tsx・文言

# US3のテスト：同時に
T040 account-limits.test.ts
T041 posting-schedule.test.ts
T042 auto-post-daily-limit.test.ts
T043 operator-limits.test.ts
T044 schedule.test.ts
T045 settings-limits.test.tsx
T046 account-settings・account-new のテスト
```

## Implementation Strategy

### MVP（US1・US2・US6）

1. Setup → Foundational。
2. US1 → US2：招待の流れを最初から最後まで通す。
3. US6：無料体験をなくし、料金を1件1,000円にする。
4. ここで止めて、quickstart.mdの1・2・4を手元で確かめる。

### 少しずつ足す

5. US3（上限）→ US4（運営者の料金なし・上限なし）。
6. US5（招待の管理のOFF）。
7. Polish：文書・設定・テスト版での確認。

### 1つのPRにまとめる理由

本番の公開の前提（招待・料金・上限）をそろえて出すため、`feature/024-tester-invite-connect`→`develop`の1つのPRにする。Constitution 4.4.0とPRDの直しも同じPRに入れる。
