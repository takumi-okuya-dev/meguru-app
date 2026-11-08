# API契約：テスター招待での接続、アカウント数・投稿数の上限、無料体験の廃止

**日付**：2026-11-08 | **計画**：[../plan.md](../plan.md)

001〜023のAPIの書き方に従う。
- エラーは`{ error: { code, message, details? } }`。
- 日時はISO 8601。
- 運営者のAPIは`/api/operator/*`。運営者でなければ`403 OPERATOR_ONLY`（016）。

## 環境変数（値・意味を変えるもの）

| 変数 | 変える前 | 変えた後 |
|---|---|---|
| `OPERATOR_CLERK_USER_IDS` | 料金なしは招待制がONのときだけ | 料金なしと上限なしは、どの環境でもかかる（テスト版に入れる判定は今のまま。research.md R11） |
| `THREADS_ACCESS_MODE` | 審査の前の案内（002 FR-028） | 加えて、`testers`なら招待の管理がON（`app`を出しているとき。R4） |
| `THREADS_CONNECT_METHODS`（テスト版） | `token` | 未設定（両方）。本番も未設定 |
| `THREADS_APP_ID`・`THREADS_APP_SECRET`（テスト版） | 見本の値・未設定 | ThreadsAutomationの値（R12） |
| `STRIPE_PRICE_ID` | 段階制（1,000円＋500円） | 1件1,000円の料金（R10） |

新しい変数は足さない。

## 新しいエラーコード

| code | HTTP | いつ | 画面 |
|---|---|---|---|
| `SUBSCRIPTION_REQUIRED` | 403 | 契約前の人が、許す経路のほかを呼んだ | 契約前の画面に替える（ui-routes.md 1） |
| `TESTER_APPLICATION_EXISTS` | 409 | そのアカウントに、生きている申し込みがすでにある | 申し込みを読み直して出す |
| `TESTER_APPLICATION_NOT_PENDING` | 409 | 「申し込み中」「招待済み」でない申し込みを取り消そうとした・運営者が状態の合わない操作をした | 読み直して出す |
| `TESTER_SLOTS_FULL` | 409 | 枠がいっぱいで、`force`なしで「招待した」を押した。`details: [used, capacity]` | 「テスター枠がいっぱいです」と、続けるかを聞く |
| `POSTING_SLOT_LIMIT` | 409 | 投稿の時刻の数が、オーナーの1日の投稿数の上限を超えた。`details: [max]` | 「1日に投稿できるのは◯件までです」 |
| `RATE_LIMITED` | 429 | 申し込みと取り消しが10分に5回を超えた | 「少し時間をおいてから、もう一度お試しください」 |

**変えるもの**：
- `ACCOUNT_LIMIT_REACHED`：文を「作れるアカウントは{max}件までです。増やしたいときは運営者に連絡してください」にする。前からの無料体験で1件のときは、今の無料体験の文から「月500円」を除いたもの。
- `VALIDATION_FAILED`（400）・`USER_NOT_FOUND`（404）は、今のものを使う。
- `ACCOUNT_LIMIT_REACHED` は、前からの無料体験の上限（1件）が効いたとき `details: ["trial"]` を付ける（画面は「契約する」を出す）。

## 認証のミドルウェア（変えるもの）

- 契約の状態と`legacy_trial`を、利用者の問い合わせに結合で足す。
- 使える状態が`unsubscribed`なら、次の経路のほかを`403 SUBSCRIPTION_REQUIRED`で止める（research.md R9）。
  - `GET /api/me`・`GET /api/me/withdrawal-preview`・`POST /api/me/withdraw`
  - `GET /api/billing`・`POST /api/billing/checkout`・`POST /api/billing/sync`・`POST /api/billing/portal`
  - `GET /api/test-invites/:token`・`POST /api/test-invites/:token/join`
  - `GET /api/invites/:token`（参加の`POST /api/invites/:token/accept`は止める）
- 判定の順：退会の途中 → テスト版に入れない → 契約前。

## GET /api/me（変えるもの）

```ts
billing: {
  mode: "enabled" | "disabled";
  state: "billing_disabled" | "exempt" | "trial" | "subscribed_trial" | "active" | "canceling" | "read_only" | "unsubscribed";
  readOnlyReason: "trial_ended" | "payment_failed" | "canceled" | "test_access" | "not_subscribed" | null;
  trialEndsAt: string | null;   // 前からの無料体験の人だけ値がある
  trialDaysLeft: number | null;
};
accountLimit: { max: number | null; used: number };  // 今の形のまま。max は使える状態と運営者の上限の小さい方（null は上限なし＝運営者）
dailyPostLimit: number | null;  // 自分のアカウントの1日の投稿数の上限。null は上限なし（運営者）
testerInvites: { enabled: boolean };  // 招待の管理がONか（research.md R4）
```

## GET /api/billing（変えるもの）

- `prices`を`{ perAccount: 1000 }`にする（`base`・`extra`をなくす）。
- `subscription.nextInvoiceAmount`は「数 × 1,000円」。
- 契約前の人は`state: "unsubscribed"`、`trialEndsAt: null`。

## POST /api/billing/checkout（変えるもの）

- 契約前の人は、試用を付けずにその場で請求する（`checkoutTrialFor`は`trial`の人だけ。今のまま）。
- 数は`max(件数, 1)`（今のまま）。

## 利用者の申し込み（新規）

すべて、そのアカウントのオーナーだけが呼べる（`authorizeAccount`、オーナー）。招待の管理がOFFなら`404`。

### GET /api/accounts/:id/tester-application

```ts
// 200
{
  enabled: boolean;
  application: null | {
    id: string;
    threadsUsername: string;
    status: "pending" | "invited" | "connected" | "declined" | "withdrawn";
    declineReason: string | null;
    createdAt: string;
    statusChangedAt: string;
  };
}
```

- 返すのは、そのアカウントのいちばん新しい申し込み。
- 取り下げしかなければ`application: null`（申し込み前と同じ画面になる）。

### POST /api/accounts/:id/tester-application

```ts
// 入力
{ threadsUsername: string }  // 前後の空白・先頭の@は取る。1〜30文字の英小文字・数字・.・_（大文字は小文字にする）
// 201：GET と同じ application
```

- **エラー**：
  - `VALIDATION_FAILED`（形が違う）
  - `TESTER_APPLICATION_EXISTS`（生きている申し込みがある）
  - `RATE_LIMITED`（10分に5回）
  - `ACCOUNT_NOT_FOUND`
- **すでにつながっているアカウント**：`VALIDATION_FAILED`。
- **「見送り」のあと**：新しい申し込みとして作れる。

### DELETE /api/accounts/:id/tester-application

- 「申し込み中」か「招待済み」の申し込みを取り下げる。`204`。
  - 「申し込み中」から：`withdrawn`（枠は使っていないので「外してよい」にならない）
  - 「招待済み」から：`withdrawn`・`removal_reason = withdrawn`（枠を使っているので「外してよい」に出る）
- **エラー**：`TESTER_APPLICATION_NOT_PENDING`（「接続済み」・見送り・取り下げ）、`RATE_LIMITED`。

## 接続（変えるもの）

- **`POST /api/threads/complete`（OAuth）**：つないだあと、同じトランザクションで申し込みを進める（research.md R5）。応答は変えない。
- **`POST /api/threads/token-connect`**：つないだあと、そのアカウントの生きている申し込みを取り下げにする（`token_connected`）。
- **`DELETE /api/accounts/:id`**：生きている申し込みを取り下げにする（`account_deleted`）。
- **退会**：枠を使っていない申し込みの行を消し、枠を使っている行を取り下げにする（`user_withdrawn`。data-model.md §5）。

## 運営者の招待の管理（新規）

### GET /api/operator/tester-applications?view=pending|invited|connected|removable|closed

```ts
// 200
{
  enabled: boolean;                       // 招待の管理がONか（OFFでも記録は読める）
  threadsAppId: string | null;            // 「Metaでテスターを加える」のリンクに使う（環境の THREADS_APP_ID。見本の値・未設定なら null）
  slots: { used: number; capacity: number };
  counts: { pending: number; invited: number; connected: number; removable: number };
  items: Array<{
    id: string;
    threadsUsername: string;
    status: "pending" | "invited" | "connected" | "declined" | "withdrawn";
    removalReason: "account_deleted" | "user_withdrawn" | "withdrawn" | "token_connected" | "username_mismatch" | null;
    applicant: { userId: string; name: string | null; email: string } | null;  // 退会していれば null
    connectedUsername: string | null;
    declineReason: string | null;
    duplicate: boolean;         // 同じユーザー名の、ほかの生きている申し込みがある
    alreadyConnected: boolean;  // そのユーザー名のアカウントが、すでにアプリにつながっている（申し込みのアカウントのほか）
    createdAt: string;
    statusChangedAt: string;
  }>;
}
```

- **`view`の中身**：
  - `pending`：申し込み中
  - `invited`：招待済み（外してよいを除く）
  - `connected`：接続済み（外してよいを除く）
  - `removable`：外してよい
  - `closed`：見送り・取り下げで、枠を使っていないもの
- **並び**：`pending`は古い順（先に来た人から）、ほかは状態が変わった日の新しい順。
- **件数**：200件まで。

### POST /api/operator/tester-applications/:id/invite

```ts
{ force?: boolean }
```

- `pending` → `invited`、`holds_slot = true`。
- 枠の使用数が枠の数以上で、`force`がなければ`TESTER_SLOTS_FULL`。

### POST /api/operator/tester-applications/:id/decline

```ts
{ reason?: string }  // 200文字まで
```

`pending` → `declined`。

### POST /api/operator/tester-applications/:id/revert

`invited` → `pending`、`holds_slot = false`（運営者がMetaで招待していなかった・間違えたとき）。

### POST /api/operator/tester-applications/:id/removed

- 「外してよい」の行の`holds_slot`を false にする。
- 退会した人の行（`user_id`が空）は、行ごと消す。

すべての操作の応答は、更新した`item`（一覧と同じ形）。状態が合わなければ`TESTER_APPLICATION_NOT_PENDING`。

### PUT /api/operator/tester-settings

```ts
{ slotCapacity: number }  // 1〜10000
```

## 運営者の上限（新規）

### GET /api/operator/limits

```ts
// 200
{
  defaults: { accountLimit: number; dailyPostLimit: number };
  overrides: Array<{ userId: string; name: string | null; email: string; accountLimit: number | null; dailyPostLimit: number | null }>;  // どちらかを決めている人
  events: Array<{ at: string; actor: string | null; action: string; detail: unknown }>;  // 上限の記録、新しい順に50件
}
```

### PUT /api/operator/limits

```ts
{ accountLimit: number; dailyPostLimit: number }  // 1〜1000、1〜250
```

### GET /api/operator/limits/users?email=…

- 完全一致で探す（019の探し方と同じ）。
- 返す値：`{ userId, name, email, operator: boolean, accountLimit: number | null, dailyPostLimit: number | null, ownedAccountCount: number }`。
- 見つからなければ`USER_NOT_FOUND`。

### PUT /api/operator/limits/users/:userId

```ts
{ accountLimit: number | null; dailyPostLimit: number | null }  // null は既定値に戻す
```

運営者の値を決めても、運営者には上限をかけない（保存はする）。

## 投稿のスケジュール（変えるもの）

- **`GET /api/accounts/:id/posting-schedule`**：`limits.slots`を、オーナーの1日の投稿数の上限にする（運営者は250）。
- **保存**：時刻の数が上限を超えたら`POSTING_SLOT_LIMIT`（`details: [max]`）。今より少ない時刻への変更（消す）は、上限を超えたままでも保存できる。
- **応答**：`overLimit: boolean`を足す（登録した時刻の数が上限を超えている。画面の注意に使う）。

## 定期処理（変えるもの）

- 自動投稿の時刻の処理（`auto-post-runner`）：時刻を早い順に並べ、オーナーの1日の投稿数の上限の数までだけ使う（research.md R7）。
- 数の合わせ直し（`syncQuantity`・日次）：契約の項目の料金が`STRIPE_PRICE_ID`と違えば、新しい料金へ切り替える（日割りなし。research.md R10）。
