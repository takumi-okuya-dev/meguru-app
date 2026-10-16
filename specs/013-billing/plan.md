# 実装計画（Implementation Plan）：決済＋退会

**ブランチ**：`feature/013-billing` | **日付**：2026-10-15 | **仕様**：[spec.md](./spec.md) | **UI全体設計**：[docs/ui-design.md](../../docs/ui-design.md)

**入力**：`specs/013-billing/spec.md`の機能仕様（Clarifications 2026-10-15を含む）、Constitution 4.0.1、[013のメモ](./notes.md)

## 概要（Summary）

無料体験（登録から1か月・アカウント1件まで）と、Stripeでの有料の契約（段階制の1つの料金：1件目1,000円・2件目から500円、税込み）を作り、契約がない・支払いが失敗した利用者のアカウントを読むだけにする。あわせて、利用者の退会を作る。旧プラン（4つのプラン・アカウントごとのプラン）は外す。

- **判定**：`entitlementOf`（`packages/shared/src/billing.ts`）の1つの関数で、利用者の状態（決済OFF・料金なし・無料体験・契約中・解約の予約・読むだけ）を決める（research.md R1）。
- **守り**：`authorizeAccount`にオーナーの契約を結合し、オーナーが読むだけなら権限を`read`・`view`・`activity`・`remove`（新しい権限：アカウントの削除）に絞る。足りなければ`403 BILLING_REQUIRED`。判定する人の値に決済のモードを持たせ、今の約30か所の呼び出しを変えない（R2）。
- **契約**：Stripe Checkout（ホスト型）で契約し、カードの変更・解約・領収書はカスタマーポータル。無料体験中の契約は、残りが48時間以上なら試用の終わりを無料体験の終わりにそろえる（Stripeの制約。R4・R7）。
- **反映**：Webhookを受けたら、Stripeから今の契約を読み直して書く（冪等で、順番の入れ替わりに強い）。古い読み直しで上書きしない。日に1回の合わせ直し（R5）。Stripeの公式SDKは使わず、`fetch`の薄いクライアントと偽のStripe（テスト・手元・E2E）。
- **数**：アカウントを作る・削除するたびに、Stripeの契約の数を`max(n,1)`に変える（日割りなし）。届かなければ印を残し、日次で合わせる（R6）。
- **定期処理**：読むだけのオーナーの自動投稿の時刻とパフォーマンスの取得を外す。確定の時にも確かめ、`billing_inactive`で飛ばす（R8）。
- **退会**：受け付け（印）→ Stripeの契約を止める → 1つのトランザクションでアカウントを消し（011の引き継ぎ）、記録の名前を「退会した人」にし、利用者を消す → Clerkのユーザーを消す。どの段も2回目に走っても同じで、途中で止まれば画面か日次の処理で続きから終わる（R10）。
- **環境**：`BILLING_ENABLED`（必須）とStripeの鍵を環境の設定で切り替える。料金なしの印は`users.billing_exempt`と運用のスクリプト（R11）。
- **画面**：「契約と支払い」（`/settings/billing`）、無料体験の終わりの帯・読むだけの帯、アカウントを作る画面の上限と料金、退会のダイアログ、利用規約の節、特定商取引法に基づく表記（R13、[contracts/ui-routes.md](./contracts/ui-routes.md)）。

## 技術コンテキスト（Technical Context）

**言語・バージョン**：TypeScript 6.0（フロントエンド・バックエンドとも）。Node.js 22 LTS。001〜012と同じ。

**主な依存**：001〜012と同じ。新しい依存は足さない（StripeはfetchのクライアントでR5、Clerkのユーザーの削除は今の`@clerk/backend`）。

**ストレージ**：Neon（Postgres 17）。[data-model.md](./data-model.md)のとおり、マイグレーション`0014_billing`の1本。
- 表：`subscriptions`・`withdrawn_users`を足す
- 列：`users.billing_exempt`・`users.withdrawal_requested_at`を足す、`accounts.plan`と列挙型`account_plan`を消す
- CHECK：`publish_attempts`の飛ばす理由に`billing_inactive`
- Workers KVは使わない（自動投稿の関所は今のまま）

**テスト**：012と同じ構成。
- 共通：Vitest（`entitlementOf`の表のすべての行、`checkoutTrialFor`の48時間の境、`nextInvoiceAmount`、`trialDaysLeft`、エラーの文言）
- API：Vitest＋`@cloudflare/vitest-pool-workers`＋ローカルのPostgres＋偽のStripe（`test/fake-stripe/`。global-setupで偽のThreadsと同じく立てる）。既定は`BILLING_ENABLED=false`で、決済のテストだけ`true`。確かめるのは次のとおり。読むだけの権限の表（関わり×API）。上限と同時の作成。Checkout（試用・数・前のセッションの期限切れ）。Webhook（署名・重複・順番・知らない顧客）。数の反映と合わせ直し。自動投稿・パフォーマンスの絞り込み。退会（各段の失敗とやり直し・引き継ぎ・記録の名前・JITの作り直しの防止）。設定の確認。マイグレーションのテスト（`migration-0014.test.ts`）。テストの準備（`test/helpers`）から`plan`を外し、契約・料金なしの状態を作る関数を足す
- Web：Vitest＋Testing Library。「契約と支払い」の状態ごとの表示、`?checkout=success`の読み直し、2つの帯（7日・閉じる・理由ごとの文言）、アカウントを作る画面の3つの場合、退会のダイアログ（メールアドレスの一致・チームの行き先・失敗）、`BILLING_REQUIRED`のダイアログ、個人運用の画面にチームの説明が出ない
- E2E：Playwright。`billing.spec.ts`（偽のStripeのCheckoutの画面がすぐに完了してsuccess_urlへ戻る）、`withdraw.spec.ts`。001〜012のE2Eは`BILLING_ENABLED=false`のまま通す

**対象プラットフォーム**：Web＝Cloudflare Pages、API＝Cloudflare Workers（無料プラン）。Cronは足さない（日次の処理に足す）。

**プロジェクトの種類**：Webアプリ（`apps/web`・`apps/api`・`packages/shared`のpnpmモノレポ）

**性能の目標**：
- 「契約する」・「支払いの画面を開く」は、Stripeへの問い合わせ1〜3回で、ふつう2秒以内に移る
- Checkoutから戻って「契約中」と出るまで10秒以内（読み直しはStripeへの問い合わせ1回。SC-002）
- `authorizeAccount`の問い合わせは1回のまま（結合を2つ足すだけ）
- Webhookは署名の確認（WebCrypto）とStripeへの問い合わせ1回で返す（Workers無料プランのCPU時間の範囲）

**制約**：
- 判定は1か所（Constitution原則V）。`entitlementOf`と`authorizeAccount`の外に、契約の条件を書かない
- カードの情報をアプリで持たない。Stripeの鍵とWebhookの秘密はSecretだけに置き、ログに出さない
- 決済OFFの環境で、001〜012の振る舞い・E2Eが変わらない
- 定数：`BILLING_BASE_PRICE_JPY = 1000`、`BILLING_EXTRA_PRICE_JPY = 500`、`TRIAL_ACCOUNT_LIMIT = 1`、`TRIAL_ENDING_NOTICE_DAYS = 7`、`CHECKOUT_TRIAL_MIN_HOURS = 48`、`WITHDRAWAL_RESUME_AFTER_MINUTES = 60`、`WITHDRAWN_USER_RETENTION_HOURS = 25`

**規模**：001〜012と同じ（利用者は数十人まで）。日次の合わせ直しは契約の数だけStripeに問い合わせる（Stripeの上限に十分に収まる）。

## Constitution Check

*GATE：Phase 0の前に確かめ、Phase 1の後にもう一度確かめた。Constitution 4.0.1。*

| 原則 | 確かめたこと | 結果 |
|---|---|---|
| I. NGワードの一貫性 | NGワードの確認は、契約の有無にかかわらず今のまま。読むだけの間は投稿しないので、確認を飛ばす経路もない。料金なしの印・決済OFFでも同じ | 合格 |
| II.人間承認ゲート | 読むだけの間は承認・却下もできない（承認せずに投稿される経路はない）。戻った後も承認済みの案だけが投稿され、過ぎた時刻はまとめて投稿しない | 合格 |
| III.外部LLM前提 | 変更なし | 合格 |
| IV.契約／ロール分離 | 契約は`subscriptions`（利用者に1行）、権限は`memberships`・`team_members`のまま別。読むだけは「オーナーの契約」で決まり、担当の人の契約では決まらない（チームの人は手伝う先の料金を払わない）。支払い・契約はオーナー本人だけ（`/api/billing/*`は自分の契約だけを扱う） | 合格 |
| V.個人運用起点のシンプルさ | 決済による制限は`authorizeAccount`の1か所に足す（原則Vの指示のとおり）。個人運用の画面に足すのは「契約と支払い」の設定の項目と帯だけで、チームのものは出さない | 合格 |
| VI.改善フィードバック | 読むだけの間はパフォーマンスの取得が止まるが、取得済みの低調の投稿と却下の記録は残り、戻った後のプロンプトに入る | 合格 |
| 技術スタック・運用コスト | 決済はStripe（Billing + Checkout。カスタマーポータルはBillingの一部）。新しい依存・月額の固定費を足さない。決済の手数料は売上に連動する費用（制約のとおり） | 合格 |
| 開発ワークフロー | spec-kitの順。`main`＋`feature/*`。PRD FR-12を実装の前に直す（R14）。`develop`の導入はこのfeatureの後（Constitutionのブランチ運用のとおり、公開・課金を始めるとき） | 合格 |

Phase 1の後の確認：data-model・contractsに、原則に反するものはない。Constitutionの改定は要らない。

## プロジェクトの構成（Project Structure）

### 文書（このfeature）

```text
specs/013-billing/
├── notes.md             # specifyの前のメモ（決めたこと）
├── spec.md
├── plan.md              # この文書
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   ├── api.md           # Phase 1
│   └── ui-routes.md     # Phase 1
├── checklists/
│   └── requirements.md
└── tasks.md             # /speckit-tasks で作る
```

### ソースコード（変更する主なところ）

```text
packages/shared/src/
├── billing.ts              # 新規：entitlementOf・checkoutTrialFor・nextInvoiceAmount・trialDaysLeft・料金の定数。trialEndsAt・isInTrial を access.ts から移す
├── plans.ts・access.ts     # 消す（R12）
├── permissions.ts          # remove の権限、READ_ONLY_PERMISSIONS
├── schemas.ts              # BillingSummary・me の billing と accountLimit・access の readOnly・退会のプレビューと要求
├── queue.ts など            # SKIP_REASONS に billing_inactive
└── errors.ts               # BILLING_REQUIRED・ALREADY_SUBSCRIBED・NO_SUBSCRIPTION・BILLING_UNAVAILABLE・WITHDRAWAL_IN_PROGRESS、ACCOUNT_LIMIT_REACHED の文言。GROWER_FEATURE_REQUIRED を消す

apps/api/
├── drizzle/0014_billing.sql
├── src/env.ts・src/lib/config.ts      # BILLING_ENABLED・STRIPE_*（R11）
├── src/lib/stripe-client.ts           # 新規：fetch のクライアント（7つの呼び出し）と Webhook の署名の確認
├── src/db/schema.ts                   # subscriptions・withdrawn_users、users の列、accounts.plan を消す
├── src/middleware/auth.ts             # billing のモード、withdrawn_users・退会の途中
├── src/routes/
│   ├── billing.ts                     # 新規：GET /api/billing、checkout・sync・portal
│   ├── stripe-webhook.ts              # 新規：POST /api/stripe/webhook
│   ├── me.ts                          # billing・accountLimit、withdrawal-preview・withdraw
│   └── accounts.ts                    # DELETE を remove に
├── src/services/
│   ├── billing-service.ts             # 新規：顧客・Checkout・ポータル・syncCustomer・数の反映・合わせ直し
│   ├── withdrawal-service.ts          # 新規：プレビュー・退会の4段・日次の続き
│   ├── access.ts                      # オーナーの契約の結合、権限の絞り込み、readOnly
│   ├── account-service.ts             # 上限（R9）、数の印、RequestUser の billing
│   ├── invite-service.ts              # assertOwnFreeAccounts に読むだけの確認
│   ├── auto-post-runner.ts・publish-claim.ts・publish-executor.ts  # R8
│   ├── metrics-runner.ts              # R8（hasGrowerAccess とプランの絞り込みを置き換える）
│   ├── profile-status.ts              # access を entitlement から
│   ├── daily-jobs.ts                  # 契約の合わせ直し・退会の続き
│   ├── grower-access.ts               # 消す。呼び出し（戦略・宣伝内容・リサーチ・プロンプト）も外す
│   └── threads-oauth.ts・token-connect.ts  # RequestUser の billing
├── scripts/set-billing-exempt.ts      # 新規（set-plan.ts を消す）
├── .dev.vars.example                  # BILLING_ENABLED=false と STRIPE_* の見本
└── test/
    ├── fake-stripe/                   # 新規：偽のStripe（顧客・Checkout（すぐ完了する画面）・ポータル・契約・Webhookの送信）
    ├── env.ts・global-setup.ts         # BILLING_ENABLED・STRIPE_*、偽のStripeを立てる
    └── helpers/                        # plan を外す、契約・料金なし・無料体験の終わりを作る関数

apps/web/src/
├── pages/settings/billing.tsx          # 新規：契約と支払い
├── pages/settings/account.tsx          # 退会のカード
├── pages/settings/sections.ts          # 「契約と支払い」の1行
├── pages/legal-commerce.tsx            # 新規：特定商取引法に基づく表記
├── pages/terms.tsx・pages/landing.tsx   # 規約の節、下のリンク、?withdrawn=1
├── pages/account-new.tsx               # 上限・読むだけ・料金の確認
├── pages/account-home.tsx              # 無料体験の残りの日数、grower の表示を外す
├── pages/strategy.tsx・promotions.tsx・research.tsx・account-settings.tsx  # GrowerRequired* を読むだけの帯・ダイアログに
├── components/billing/                 # 新規：TrialEndingBanner・ReadOnlyBanner・BillingRequiredDialog・WithdrawDialog
├── components/GrowerRequiredNotice.tsx # 消す
├── components/AutoPostNotices.tsx      # billing_inactive の文
├── components/layout/*                 # 帯の置き場所
├── lib/api-client.ts・lib/save-error.ts # 新しいAPI、BILLING_REQUIRED・WITHDRAWAL_IN_PROGRESS の扱い
└── router.tsx                          # /settings/billing・/legal/commerce

e2e/tests/billing.spec.ts・withdraw.spec.ts（新規）、e2e の環境に BILLING_ENABLED
docs/external-services-setup.md（Stripe・環境ごとの値）、docs/ui-design.md、specs/001・002 の spec、PRD
```

**構成の判断**：001〜012と同じモノレポ。決済の外部とのやり取り（Stripe）を`billing-service.ts`と`stripe-client.ts`に、退会の手順を`withdrawal-service.ts`に閉じ込める。使える状態の判定は`packages/shared`の純粋な関数にして、API（`authorizeAccount`・上限・定期処理）とWeb（帯・画面）が同じ表を使う。権限の絞り込みは`authorizeAccount`の中だけで行い、各ルートは今の呼び出しのまま守られる。

## 複雑さの記録（Complexity Tracking）

Constitutionの違反はないので、記録はない。
