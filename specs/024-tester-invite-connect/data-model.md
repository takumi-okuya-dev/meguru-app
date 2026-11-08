# データモデル：テスター招待での接続、アカウント数・投稿数の上限、無料体験の廃止

**日付**：2026-11-08 | **計画**：[plan.md](./plan.md) | **マイグレーション**：`0022_tester_invites`（足すだけ）

## 1. 新しい表

### 1-1. `tester_applications`（招待の申し込み。research.md R1・R2・R15）

| 列 | 型 | 制約・既定値 | 意味 |
|---|---|---|---|
| `id` | uuid | PK、`gen_random_uuid()` | |
| `user_id` | uuid | NULL可、FK `users.id` ON DELETE SET NULL | 申し込んだ人。退会すると NULL（枠を使っている行だけが残る。§5） |
| `account_id` | uuid | NULL可、FK `accounts.id` ON DELETE SET NULL | 申し込んだアカウント（012）。消すと NULL |
| `threads_username` | text | NOT NULL、`^[a-z0-9._]{1,30}$` | 申し込んだユーザー名（小文字にそろえたもの。R3） |
| `status` | text（CHECK で5つ） | NOT NULL、既定 `pending` | `pending`（申し込み中）・`invited`（招待済み）・`connected`（接続済み）・`declined`（見送り）・`withdrawn`（取り下げ） |
| `holds_slot` | boolean | NOT NULL、既定 false | Metaのテスター枠を使っているか（「招待した」で true、「戻す」「外した」で false） |
| `removal_reason` | text（CHECK で5つ） | NULL可 | 外してよい理由：`account_deleted`・`user_withdrawn`・`withdrawn`・`token_connected`・`username_mismatch` |
| `decline_reason` | text | NULL可、200文字まで | 見送りの理由（利用者に見せる） |
| `connected_username` | text | NULL可 | 実際につながったThreadsのユーザー名（違ったときの表示に使う） |
| `status_changed_at` | timestamptz | NOT NULL、既定 now() | 状態が変わった日時 |
| `created_at`・`updated_at` | timestamptz | 今の表と同じ | |

**インデックス・制約**：

- `tester_applications_live_account_uq`：`UNIQUE (account_id) WHERE status IN ('pending','invited','connected')`。アカウント1件に、生きている申し込みは1つまで（FR-005）。
- `tester_applications_status_idx`：`(status, created_at)`。運営者の一覧に使う。
- `tester_applications_username_idx`：`(threads_username)`。同じユーザー名の申し込みを探すのに使う（FR-012）。
- `tester_applications_slot_idx`：`(holds_slot) WHERE holds_slot`。枠の使用数を数えるのに使う。
- `CHECK (removal_reason IS NULL OR status = 'withdrawn')`。理由が入るのは取り下げの行だけ（`connected`のままアカウントを消した・退会したときも、状態を`withdrawn`にして理由を入れる）。

**状態の移り変わり**：

```text
（申し込む）→ pending ──招待した（運営者）──→ invited ──OAuthでつながる（同じ名前）──→ connected
              │  ▲                   │  │                              │
              │  └──戻す（運営者）───┘  │                              │ アカウントを消す・退会
              │                         │ 取り消す（利用者）              ▼
              │ 取り消す（利用者）        ▼                       withdrawn ＋ removal_reason
              ├──────────────────→ withdrawn（invited からなら removal_reason = withdrawn → 「外してよい」）
              ├──見送る（運営者）──→ declined
              └──トークンでつながる・違う名前でつながる・アカウントを消す──→ withdrawn ＋ removal_reason
```

- **「外してよい」の行**：`holds_slot = true AND removal_reason IS NOT NULL`。運営者が「外した」を押すと`holds_slot = false`にする。退会した人の行（`user_id IS NULL`）は、ここで行ごと消す（R15）。
- **`pending`のままOAuthでつながったとき**（すでにテスターだった）：`invited`を経ずに`connected`にし、`holds_slot = true`にする（R5）。
- **取り消し**：利用者が取り消せるのは`pending`と`invited`。`pending`からは理由なしの`withdrawn`（枠を使っていないので「外してよい」にならない）、`invited`からは`removal_reason = withdrawn`の`withdrawn`（枠を使っているので「外してよい」になる）。

### 1-2. `operator_settings`（運営者が決める値。1行だけ。research.md R6）

| 列 | 型 | 制約・既定値 | 意味 |
|---|---|---|---|
| `id` | smallint | PK、`CHECK (id = 1)` | 1行だけ |
| `default_account_limit` | integer | NOT NULL、既定 3、1〜1000 | アカウントの数の上限の既定値 |
| `default_daily_post_limit` | integer | NOT NULL、既定 10、1〜250 | 1日の投稿数の上限の既定値 |
| `tester_slot_capacity` | integer | NOT NULL、既定 25、1〜10000 | テスター枠の数（運営者が決める目安） |
| `updated_at` | timestamptz | NOT NULL、既定 now() | |

マイグレーションで`id = 1`の行を入れる（既定値のまま）。

### 1-3. `operator_events`（記録。research.md R14）

| 列 | 型 | 制約・既定値 | 意味 |
|---|---|---|---|
| `id` | uuid | PK | |
| `actor_user_id` | uuid | NULL可、FK `users.id` ON DELETE SET NULL | 操作した人（運営者か利用者） |
| `subject_user_id` | uuid | NULL可、FK `users.id` ON DELETE SET NULL | 上限を変えられた人・申し込んだ人 |
| `application_id` | uuid | NULL可、FK `tester_applications.id` ON DELETE SET NULL | 申し込み |
| `action` | text | NOT NULL | `apply`・`cancel`・`invite`・`decline`・`revert`・`removed`・`slot_capacity`・`default_limits`・`user_limits` |
| `detail` | jsonb | NULL可 | 変えた値（前と後）、見送りの理由。**Threadsのユーザー名・名前・メールアドレスは入れない**（申し込みは `application_id` でたどる。退会・「外した」で行が消えると、たどれなくなる。research.md R15） |
| `created_at` | timestamptz | NOT NULL、既定 now() | |

**インデックス**：
- `(actor_user_id, action, created_at)`：申し込みの回数の制限に使う
- `(created_at DESC)`：運営者の画面の記録に使う

## 2. 変える表

### 2-1. `users`

| 列 | 型 | 制約・既定値 | 意味 |
|---|---|---|---|
| `account_limit` | integer | NULL可、1〜1000 | この人だけのアカウントの数の上限。NULLなら既定値 |
| `daily_post_limit` | integer | NULL可、1〜250 | この人だけの1日の投稿数の上限。NULLなら既定値 |
| `legacy_trial` | boolean | NOT NULL、既定 true | 024の前からいた人（無料体験を使える）。列の既定値は true のままにし（今いる人と、新しいAPIに替わる前に古いAPIが作った人を締め出さない）、新しいAPIは利用者を作るときに必ず false を渡す（016 の `signed_up_open` と同じ作法。research.md R8） |

### 2-2. `posting_schedules`

- CHECK `posting_schedules_slot_count` を「10件まで」から「250件まで（Threadsの24時間の上限）」に広げる。オーナーの1日の投稿数の上限は、保存の処理で確かめる（運営者は250件まで登録できる。FR-019・FR-024）。

## 3. 共有の型（`packages/shared`）

- **`BillingState`**：`unsubscribed`を足す。`ReadOnlyReason`に`not_subscribed`を足す。
- **`EntitlementInput`**：`legacyTrial: boolean`を足す。`entitlementOf`の順は次のとおり。
  1. 決済OFF → `billing_disabled`
  2. 料金なし（運営者を含む） → `exempt`
  3. `trialing` → `subscribed_trial`
  4. `active` → `active`・`canceling`
  5. 支払いの失敗 → 読むだけ（`payment_failed`）
  6. `legacyTrial`で1か月の間 → `trial`（上限1件）
  7. `canceled` → 読むだけ（`canceled`）
  8. `legacyTrial` → 読むだけ（`trial_ended`）
  9. それ以外 → `unsubscribed`
- **料金**：`BILLING_UNIT_PRICE_JPY = 1000`。`BILLING_BASE_PRICE_JPY`・`BILLING_EXTRA_PRICE_JPY`はなくす。`nextInvoiceAmount(n) = 1000 × max(n, 1)`。
- **上限の定数**：
  - `DEFAULT_ACCOUNT_LIMIT = 3`、`DEFAULT_DAILY_POST_LIMIT = 10`
  - `DAILY_POST_LIMIT_MAX = 250`、`ACCOUNT_LIMIT_MAX = 1000`
  - `TESTER_SLOT_CAPACITY_DEFAULT = 25`
  - `TESTER_APPLY_RATE = { count: 5, windowMinutes: 10 }`
  - `DECLINE_REASON_MAX = 200`
- **`AUTOPOST_SLOT_LIMIT`**：`DEFAULT_DAILY_POST_LIMIT`に置き換え、`validatePostingSchedule(input, { maxSlots })`で上限を受け取る。
- **申し込み**：
  - `TESTER_APPLICATION_STATUSES`
  - `TESTER_REMOVAL_REASONS`
  - `normalizeThreadsUsername(raw)`：前後の空白・先頭の`@`を取り、小文字にそろえる。形が違えば`null`

## 4. 判定に使う値の求め方

| 値 | 求め方 | 場所 |
|---|---|---|
| アカウントの数の上限 | 運営者なら`null`。それ以外は`min(使える状態の上限, coalesce(users.account_limit, default_account_limit))`。使える状態の上限は、前からの無料体験なら1、それ以外は`null`。読むだけ・契約前なら0 | `limit-service.ts`・`accountLimitFor` |
| 1日の投稿数の上限 | Accountのオーナーが運営者なら250。それ以外は`coalesce(owner.daily_post_limit, default_daily_post_limit)` | `limit-service.ts`（保存）・`auto-post-runner.ts`（時刻の処理。結合で読む） |
| テスター枠の使用数 | `count(*) WHERE holds_slot` | `tester-application-service.ts` |
| 招待の管理がONか | `THREADS_ACCESS_MODE !== "public"`かつ`connectMethodsOf`に`app` | `config.ts`・`testerInvitesEnabledOf` |
| 料金なし | `users.billing_exempt OR clerk_user_id IN 運営者`（招待制にかかわらない） | `billingExemptSql` |

## 5. 消す・退会するときの扱い

- **アカウントを消す（`deleteAccount`）**：消す前に、生きている申し込みを`withdrawn`にし、`removal_reason = account_deleted`を入れる（枠を使っていれば「外してよい」になる）。
- **退会（`withdrawal-service`）**：利用者の行を消す前に、同じトランザクションで次を行う（research.md R15）。
  - 枠を使っていない申し込みの行（`holds_slot = false`）を、すべて消す。
  - 枠を使っている行は`withdrawn`にし、`removal_reason = user_withdrawn`を入れる（「外してよい」に出る）。`user_id`と`account_id`はFKで空になり、残るのはThreadsのユーザー名だけ。運営者が「外した」を押したら行を消す。
  - `operator_events`は`detail`にユーザー名などを持たず、`actor_user_id`・`subject_user_id`はFKで空になる。
- **取り下げ・見送りで、枠を使っていない行**：退会するまでは残す（利用者が申し込み直したときの履歴）。
