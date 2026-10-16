# API契約：決済＋退会

**日付**：2026-10-15 | **計画**：[../plan.md](../plan.md)

001〜012のAPIの書き方（エラーは`{ error: { code, message, details? } }`、日時はISO 8601）に従う。権限の判定は011の`authorizeAccount`に、オーナーの使える状態を足す（[research.md](../research.md) R1・R2）。

## 新しいエラーコード

| code | HTTP | いつ | 画面の文言 |
|---|---|---|---|
| `BILLING_REQUIRED` | 403 | 読むだけのアカウントで書き込みをした。読むだけの利用者が、アカウントを作る・チームを作る・チームに参加しようとした。`details: [reason]`（`trial_ended`・`payment_failed`・`canceled`。オーナー以外には`owner_inactive`） | オーナー：理由ごと（下の「帯の文言」）。チームの人：「オーナーの契約の状態により、このアカウントは今、読むだけです」 |
| `ALREADY_SUBSCRIBED` | 409 | 契約中・支払いの失敗中に「契約する」を押した（R4） | 「すでに契約しています。契約の確認・カードの変更は『支払いの画面を開く』から行えます」 |
| `NO_SUBSCRIPTION` | 409 | 契約（Stripeの顧客）がないのに支払いの画面を開こうとした | 「まだ契約していません」 |
| `BILLING_UNAVAILABLE` | 503 | Stripeにつながらない・Stripeが誤りを返した | 「支払いの手続きにつながりませんでした。少し待ってから、もう一度お試しください」 |
| `WITHDRAWAL_IN_PROGRESS` | 409 | 退会の途中の人が、退会のAPI以外を呼んだ（R10） | 「退会の手続きの途中です。『退会する』をもう一度押して、手続きを終えてください」 |

今のcodeの使い方の変更：

- `ACCOUNT_LIMIT_REACHED`（001）：無料体験中に2件目を作ろうとしたときだけになる（`max = 1`）。文言は「無料体験中に作れるアカウントは1件までです。契約すると、2件目から1件につき月500円で足せます」（500円は`BILLING_EXTRA_PRICE_JPY`から）、次の操作は「契約する」（`/settings/billing`）。
- `GROWER_FEATURE_REQUIRED`（002）：使わなくなり、codeの一覧から消す（R12）。
- `ROLE_FORBIDDEN`（011）：関わりで足りない権限のときだけ。契約による制限は`BILLING_REQUIRED`。
- `CONFIRMATION_MISMATCH`（001）：退会の確認（メールアドレス）にも使う。
- `CONFIG_ERROR`（001）：`BILLING_ENABLED`・Stripeの設定の誤り（R11）も`details`に入る。

## 権限（011 permissions.mdへの追加）

| 権限 | 追加・変更 |
|---|---|
| `remove` | **新規**。アカウントの削除。オーナーだけ。読むだけでも残る |
| `owner` | アカウントの削除を外す（Threadsとの接続・名前の変更・チームに見せる、のうち`authorizeAccount`を通るもの） |

オーナーが読むだけのとき、関わりから求めた権限を`{read, view, activity, remove}`との共通部分に絞る。絞られた権限を要るAPIは`403 BILLING_REQUIRED`。

## 契約と支払い

| API | 判定 | 説明 |
|---|---|---|
| `GET /api/billing` | ログイン済み | 「契約と支払い」の内容（下の`BillingSummary`）。決済がOFFでも200（`mode = "disabled"`） |
| `POST /api/billing/checkout` | ログイン済み・決済ON | Checkoutのセッションを作り`{ url }`を返す（R4）。契約中なら`ALREADY_SUBSCRIBED`、Stripeにつながらなければ`BILLING_UNAVAILABLE` |
| `POST /api/billing/sync` | ログイン済み・決済ON | Stripeから今の契約を読み直して、`BillingSummary`を返す（Checkoutから戻ったとき・画面を開いたとき。R5）。顧客がなければ読み直さずに返す |
| `POST /api/billing/portal` | ログイン済み・決済ON | カスタマーポータルのセッションを作り`{ url }`を返す（R7）。顧客がなければ`NO_SUBSCRIPTION` |
| `POST /api/stripe/webhook` | Stripeの署名・決済ON | 知らせを受けて、その顧客を読み直す（R5）。署名が合わなければ400。知らない顧客は200で何もしない |

決済がOFFのときは、`GET /api/billing`以外の上の4つは`404`（ルートがないときと同じ応答。R11）。

### `BillingSummary`

```json
{
  "mode": "enabled",
  "state": "subscribed_trial",
  "readOnlyReason": null,
  "trialEndsAt": "2026-11-15T03:00:00.000Z",
  "trialDaysLeft": 10,
  "ownedAccountCount": 2,
  "subscription": {
    "status": "trialing",
    "currentPeriodEnd": "2026-11-15T03:00:00.000Z",
    "cancelAtPeriodEnd": false,
    "nextInvoiceAt": "2026-11-15T03:00:00.000Z",
    "nextInvoiceAmount": 1500
  },
  "prices": { "base": 1000, "extra": 500 }
}
```

- `mode`：`enabled`・`disabled`。`disabled`なら`state = "billing_disabled"`で、ほかは`null`。
- `state`：R1の状態（`billing_disabled`・`exempt`・`trial`・`subscribed_trial`・`active`・`canceling`・`read_only`）。
- `readOnlyReason`：`read_only`のときだけ（`trial_ended`・`payment_failed`・`canceled`）。
- `trialDaysLeft`：無料体験中だけ。日本時間の日付で数え、終わる日を含まない（終わる日の当日は0）。
- `subscription`：契約がなければ`null`。`nextInvoiceAt`は`canceling`・`canceled`なら`null`。`nextInvoiceAmount = base + extra × (max(n,1) − 1)`。

## アカウント（001・012からの変更）

| API | 判定 | 変更 |
|---|---|---|
| `POST /api/accounts` | ログイン済み | 上限をR9に置き換える。読むだけなら`BILLING_REQUIRED`、無料体験中で1件あれば`ACCOUNT_LIMIT_REACHED`（`max = 1`）。作った後、契約があれば数を合わせる（R6） |
| `DELETE /api/accounts/:accountId` | `remove` | `owner`から`remove`に変える（読むだけでも消せる）。消した後、契約があれば数を合わせる（R6） |
| `GET /api/accounts/:accountId/access` | `read` | 応答に`readOnly: { reason } \| null`を足す。オーナーには理由、ほかの人には`owner_inactive` |
| `PATCH /api/accounts/:accountId` | `owner` | 変わらない（読むだけなら`BILLING_REQUIRED`） |
| Threadsとの接続（`POST /api/threads/connect`・`POST /api/threads/token-connect`） | `owner` | 変わらない（読むだけなら`BILLING_REQUIRED`。spec US3-7） |
| 戦略・宣伝内容・リサーチの書き込み | `content` | `requireGrowerAccess`をやめ、権限の判定だけにする（R12） |

## 自分（`/api/me`）

| API | 判定 | 説明 |
|---|---|---|
| `GET /api/me` | ログイン済み | 応答の`accountLimit`を`{ max: number \| null, used }`にし、`billing: { mode, state, readOnlyReason, trialEndsAt, trialDaysLeft }`を足す（帯とアカウントを作る画面に使う）。退会の途中の人でも200（`withdrawalInProgress: true`を足す） |
| `GET /api/me/withdrawal-preview` | ログイン済み | **新規**。退会の確認の内容（下）。退会の途中でも呼べる |
| `POST /api/me/withdraw` | ログイン済み | **新規**。`{ confirmEmail }`。R10の1〜4を行い、204。メールアドレスが違えば`CONFIRMATION_MISMATCH`（422）、Stripeにつながらなければ`BILLING_UNAVAILABLE`（503。何も消していない）。2回目の呼び出しは続きから行う |

### 退会の確認の内容

```json
{
  "email": "user@example.com",
  "ownedAccounts": [{ "id": "…", "name": "カフェの公式" }],
  "teams": [
    { "id": "…", "name": "AI部", "isAdmin": true, "outcome": "transfer", "nextAdminName": "田中" },
    { "id": "…", "name": "交流会", "isAdmin": true, "outcome": "delete", "nextAdminName": null },
    { "id": "…", "name": "手伝い", "isAdmin": false, "outcome": "leave", "nextAdminName": null }
  ],
  "hasActiveSubscription": true
}
```

- `outcome`：`transfer`（管理者を引き継ぐ）・`delete`（ほかに人がいない・引き継げる人がいない）・`leave`（管理者でない）。引き継ぎ先は`beforeAccountDeleted`と同じ選び方（いちばん長くいる人。20チームの管理者は飛ばす）。
- `hasActiveSubscription`：契約が終わっていない（`trialing`・`active`・`past_due`・`unpaid`・`paused`）。

## 認証のミドルウェアの変更

- `withdrawn_users`にあるClerkのユーザーIDは`401 AUTH_REQUIRED`（`users`の行を作り直さない）。
- `users.withdrawal_requested_at`がある人は、`GET /api/me`・`GET /api/me/withdrawal-preview`・`POST /api/me/withdraw`以外を`409 WITHDRAWAL_IN_PROGRESS`。
- `c.get("user")`に`billing: BillingMode`を入れる（R2）。

## チーム（011からの変更）

| API | 変更 |
|---|---|
| `POST /api/teams`・`POST /api/invites/:token/accept`・`POST /api/teams/:teamId/accounts` | 入れるアカウントのオーナー（＝自分）が読むだけなら`BILLING_REQUIRED`（`assertOwnFreeAccounts`。R9） |
| そのほか（招待・ロール・担当・外す・抜ける・引き継ぎ・名前・削除・チームに見せる） | 変わらない（契約で止めない。FR-044） |

## 定期処理（日次）に足すもの

| 処理 | 説明 |
|---|---|
| 契約の合わせ直し | 終わっていない契約と、数の合わせ直しが要る契約を、Stripeから読み直す・数を合わせる（R5・R6）。決済がOFFなら何もしない |
| 退会の続き | `withdrawal_requested_at`から1時間を過ぎた人の退会を続ける。`clerk_deleted_at IS NULL`のClerkのユーザーを消す。`clerk_deleted_at`から25時間を過ぎた`withdrawn_users`を消す（R10） |

自動投稿（5分ごと）とパフォーマンスの取得の変更はR8。

## 環境変数・Secret（足すもの）

| 名前 | 種類 | 必須 | 説明 |
|---|---|---|---|
| `BILLING_ENABLED` | 変数 | いつも | `"true"`・`"false"`。ほかの値・未設定は`CONFIG_ERROR` |
| `STRIPE_SECRET_KEY` | Secret | 決済ONのとき | `sk_live_…`（本番）・`sk_test_…`（ステージング・手元） |
| `STRIPE_WEBHOOK_SECRET` | Secret | 決済ONのとき | `whsec_…`。Webhookの宛先ごとに違う |
| `STRIPE_PRICE_ID` | 変数 | 決済ONのとき | `price_…`。段階制の料金（R3） |
| `STRIPE_API_BASE_URL` | 変数 | いいえ | 既定`https://api.stripe.com`。テストと手元の偽のStripe |
| `STRIPE_PORTAL_CONFIGURATION_ID` | 変数 | いいえ | カスタマーポータルの設定（`bpc_…`）。なければStripeの既定の設定 |
| `STRIPE_TAX_RATE_ID` | 変数 | いいえ | 適格請求書の登録をしたときの10%（内税）の税率（`txr_…`） |

## 運用のスクリプト

| コマンド | 説明 |
|---|---|
| `pnpm --filter api admin:set-billing-exempt <email> on\|off [--force]` | 料金なしの印を付け・外す。付けるときに終わっていない契約があれば止める（`--force`で付ける） |
| `pnpm --filter api admin:set-plan` | 消す（R12） |
