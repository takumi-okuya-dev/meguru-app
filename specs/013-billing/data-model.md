# Data Model：決済＋退会

**Feature**：[spec.md](./spec.md) | **調べ**：[research.md](./research.md)

マイグレーションは`0014_billing`の1本。Neon（Postgres 17）＋Drizzle。

## 変更の一覧

| 対象 | 変更 | 理由 |
|---|---|---|
| `users` | 列`billing_exempt`・`withdrawal_requested_at`を足す | 料金なしの印（R11）、退会の途中（R10） |
| `subscriptions` | 表を足す | 契約（R4・R5・R6） |
| `withdrawn_users` | 表を足す | 退会した人のログインの情報の削除と、作り直しの防止（R10） |
| `accounts` | 列`plan`を消す | 旧プランを外す（R12） |
| 列挙型`account_plan` | 消す | 同上 |
| `publish_attempts` | 飛ばす理由に`billing_inactive`を足す（CHECK制約の作り直し） | 読むだけの間の時刻（R8） |

## users（変更）

| 列 | 型 | 既定 | 説明 |
|---|---|---|---|
| `billing_exempt` | `boolean NOT NULL` | `false` | 料金なしの印。運用のスクリプトだけが変える |
| `withdrawal_requested_at` | `timestamptz NULL` | `NULL` | 退会を受け付けた時刻。退会が終わると行ごと消えるので、残っていれば「途中」 |

- 今ある利用者の`billing_exempt`は`false`。公開の前に、運用が開発者・テストユーザーに付ける（spec Assumptions）。

## subscriptions（新規）

利用者に1行まで。はじめて「契約する」を押したとき（Stripeの顧客を作ったとき）に作る。

| 列 | 型 | 説明 |
|---|---|---|
| `user_id` | `uuid PRIMARY KEY` → `users.id` ON DELETE CASCADE | 契約する利用者 |
| `stripe_customer_id` | `text NOT NULL UNIQUE` | Stripeの顧客 |
| `stripe_subscription_id` | `text NULL UNIQUE` | Stripeの契約。まだなければ`NULL` |
| `status` | `text NULL` | Stripeの契約の状態（`incomplete`・`incomplete_expired`・`trialing`・`active`・`past_due`・`unpaid`・`canceled`・`paused`）。CHECKで値を限る |
| `current_period_end` | `timestamptz NULL` | 今の期間の終わり（次の請求日・解約で終わる日） |
| `trial_end` | `timestamptz NULL` | 契約の試用の終わり（無料体験中に契約したとき） |
| `cancel_at_period_end` | `boolean NOT NULL DEFAULT false` | 解約の予約 |
| `quantity` | `integer NULL` | Stripeに伝えてある数（`max(n,1)`） |
| `quantity_sync_needed` | `boolean NOT NULL DEFAULT false` | アカウントの数を合わせ直す要がある（R6） |
| `pending_checkout_session_id` | `text NULL` | 開いているCheckoutのセッション（作り直す前に期限切れにする。R4） |
| `stripe_synced_at` | `timestamptz NULL` | Stripeから最後に読み直した時刻。これより古い読み直しでは更新しない（R5） |
| `created_at`・`updated_at` | `timestamptz NOT NULL` | 今の`timestamps`の形 |

- 索引：`stripe_customer_id`（UNIQUE。Webhookの顧客から引く）、`(status)`の部分索引は作らない（行が少ない）。
- 状態の移り変わり（Stripeの状態をそのまま写す。判定はR1の表）：

```text
（行なし）──「契約する」──▶ 顧客だけ（status NULL）
   ──Checkoutを終える──▶ trialing（無料体験中に契約）／active／incomplete（最初の支払いが済まない）
trialing ──試用の終わりに支払い──▶ active ／ past_due（失敗）
active ──支払い──▶ active ／ past_due（失敗）
past_due ──やり直しで支払い──▶ active ／ やり直しが尽きる──▶ canceled
active（cancel_at_period_end）──期間の終わり──▶ canceled
canceled ──もう一度「契約する」──▶ 新しい契約（stripe_subscription_id を置き換える）
```

## withdrawn_users（新規）

| 列 | 型 | 説明 |
|---|---|---|
| `clerk_user_id` | `text PRIMARY KEY` | 退会した人のClerkのユーザーID |
| `withdrawn_at` | `timestamptz NOT NULL` | `users`の行を消した時刻 |
| `clerk_deleted_at` | `timestamptz NULL` | Clerkのユーザーを消した時刻。`NULL`なら日次の処理がやり直す |

- 認証のミドルウェアは、ここにあるClerkのユーザーIDの要求を`401`にし、`users`の行を作り直さない（R10）。
- 日次の処理が、`clerk_deleted_at`から25時間を過ぎた行を消す。メールアドレス・名前は持たない。

## accounts（変更）

- 列`plan`と列挙型`account_plan`を消す。アカウントの数と料金は、`memberships`の`role = 'owner'`の数で決まる（未接続のものを含む。spec FR-013）。

## publish_attempts（変更）

- `SKIP_REASONS`（`packages/shared`）に`billing_inactive`を足し、CHECK制約`publish_attempts_skip_reason_valid`を作り直す。画面の飛ばした理由の文は「契約が止まっていたため」。

## 消すときの流れ（退会。R10の3）

```text
users（退会する人）
 ├─ memberships（owner）→ accounts → 戦略・投稿ストック・設定・パフォーマンス・
 │                                     threads_connections（トークン）・activity_logs …（CASCADE）
 │    └─ 先に beforeAccountDeleted：team_accounts から外し、最後の1件なら抜ける（管理者は引き継ぐ／チームを消す）
 ├─ memberships（editor。ほかの人のアカウントの担当）（CASCADE）
 ├─ team_members（CASCADE）
 ├─ subscriptions（CASCADE。Stripeの契約は先に止めてある）
 ├─ activity_logs（ほかの人のアカウント）：actor_name を「退会した人」に書き換え、actor_user_id は SET NULL
 └─ teams.admin_user_id（RESTRICT）：引き継ぎ・削除が済んでいるので残らない
```

## 判定に使う値（DBの外）

- `BillingMode`：`{ enabled: boolean }`。環境の`BILLING_ENABLED`から作る（R11）。
- `Entitlement`：R1の`entitlementOf`の結果。`{ state, fullAccess, reason, accountLimit, trialEndsAt }`。保存しない（毎回求める）。
