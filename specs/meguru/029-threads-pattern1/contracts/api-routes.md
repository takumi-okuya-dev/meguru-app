# 取り決め：APIの道筋と `/api/me` の分け方（029）

**対象**：`apps/api`のAPIの道筋と、Webの呼び出し。判断は[research.md](../research.md) R8〜R10、spec FR-014〜FR-017・FR-024。

## 1. 道筋の移り先

2026-11-12のAPIの一覧（`apps/api/test/repo/routes.snapshot.txt`）から。

| 今の道筋 | 本数 | 持ち主（あと） | 新しい道筋 |
|---|---|---|---|
| `/api/accounts/…` | 77 | Threads | `/api/threads/accounts/…` |
| `/api/teams/…` | 18 | Threads | `/api/threads/teams/…` |
| `/api/invites/…`（チームの招待） | 2 | Threads | `/api/threads/invites/…` |
| `/api/me/needs-review-counts` | 1 | Threads | `/api/threads/me/needs-review-counts` |
| `/api/operator/accounts` | 1 | Threads | `/api/threads/operator/accounts` |
| `/api/operator/tester-applications/…` | 5 | Threads | `/api/threads/operator/tester-applications/…` |
| `/api/operator/tester-settings` | 1 | Threads | `/api/threads/operator/tester-settings` |
| （新） | — | Threads | `GET /api/threads/me`・`GET /api/threads/me/withdrawal-preview` |
| `/api/threads/…`（接続・Metaの通知） | 6 | Threads | **変えない**（Metaに登録した戻り先・通知先。spec FR-016） |
| `/api/data-deletion` | 1 | Threads | **変えない**（Metaのデータ削除の状況確認のページ。利用者に渡したURL） |
| `/api/me`・`/api/me/last-app`・`/api/me/referral`・`/api/me/withdraw`・`/api/me/withdrawal-preview` | 5 | 共通 | 変えない（`/api/me`と`withdrawal-preview`の中身は2章） |
| `/api/billing/…`・`/api/stripe/webhook` | 5 | 共通 | 変えない（Stripeに登録した通知先） |
| `/api/operator/feature-settings`・`limits`・`test-groups`・`users` | 16 | 共通 | 変えない |
| （新） | — | 共通 | `GET /api/operator/app-registry`（登録されたアプリの機能と上限の一覧。運営の画面のため。運営者だけ） |
| `/api/test-invites/…`・`/api/referral-page`・`/api/health` | 4 | 共通 | 変えない |

- 新しい道筋の`accounts`・`teams`・`invites`・`me`・`operator`は、今の`/api/threads/…`（`callback`・`complete`・`connect`・`token-connect`・`webhooks/…`）とぶつからない。
- 画面のURL（`/threads/…`・招待のリンク`/invite/:token`など）は変えない。

## 2. `/api/me` と `/api/threads/me`

### `GET /api/me`（共通。PR5のあと）

```jsonc
{
  "user": { "id": "…", "email": "…", "displayName": "…" },
  "billing": { … },              // 今のまま
  "withdrawalInProgress": false,
  "testGroups": { "enabled": true, "admitted": true, "operator": false },
  "operator": false,
  "apps": { "available": ["threads"], "using": ["threads"], "last": "threads", "landing": "threads" }
}
```

- `apps.using`は`app_usage.using`から決める（[platform-entry.md](./platform-entry.md) 4）。
- **PR5まで**は、今のThreadsのデータ（`accounts`・`landingAccountId`・`accountLimit`・`threadsAccessMode`・`threadsConnectMethods`・`teams`・`features`・`dailyPostLimit`・`testerInvites`）も今の形で返す（前の画面のため）。組み立ての層（`app.ts`）が、Threadsの関数を呼んで足す。PR5で消す。

### `GET /api/threads/me`（Threads。PR2で足す）

```jsonc
{
  "accounts": [ … ],             // 今の /api/me の accounts と同じ形
  "landingAccountId": "…",
  "accountLimit": { "max": 3, "used": 1 },
  "threadsAccessMode": "testers",
  "threadsConnectMethods": ["app", "token"],
  "teams": [ … ],
  "features": ["autopost", "strategy", "team"],
  "dailyPostLimit": 10,
  "testerInvites": { "enabled": true }
}
```

- 形は`@meguru/shared`の`threadsMeResponseSchema`（新しく作る。`packages/shared/src/apps/threads/`）。今の`meResponseSchema`のThreadsの部分を写す。
- ログインしていなければ401。退会の途中・テスト版に入れない人は、今の`/api/me`と同じ関所の結果。

### 退会の前の確かめ

| 道筋 | 持ち主 | 中身 |
|---|---|---|
| `GET /api/me/withdrawal-preview` | 共通 | 契約の状態など、共通の分（PR5のあと） |
| `GET /api/threads/me/withdrawal-preview` | Threads | 消えるアカウントの一覧など、Threadsの分 |

- 画面（外枠の設定の「退会」）は、両方を読んで今と同じ内容を出す。外枠はThreadsを読まないので、Threadsは`AppModule`の`withdrawalPreview`（中身を読む関数と、出す部品）を外枠に渡す（[module-boundaries.md](./module-boundaries.md) 3）。

## 3. 古い道筋（PR4〜PR5）

- PR4で、新しい道筋に同じ処理をつなぐ。古い道筋も、同じ処理のまま残す（APIが画面より先にデプロイされるため）。
- 古い道筋と新しい道筋で、応答・状態コード・エラーコードは同じ（道筋の一覧のテストで、両方があることを確かめる）。
- PR5で古い道筋を消す。消す前に、テスト環境の画面が新しい道筋だけを呼んでいること（ブラウザの開発者ツールのネットワークか、APIのログ）を確かめる。

## 4. Webの呼び出し

| 今 | あと |
|---|---|
| `apps/web/src/lib/api-client.ts`の`api.*`（共通とThreadsが混ざる） | 共通の分だけ残す。Threadsの分は`apps/web/src/apps/threads/lib/api.ts`（`threadsApi.*`） |
| `apps/web/src/lib/query.ts`の`queryKeys.*` | 共通の分だけ残す。Threadsの分は`apps/web/src/apps/threads/lib/query-keys.ts` |
| `me.accounts`・`me.landingAccountId`・`me.teams`などを読む11ファイル | `useThreadsMe()`（`/api/threads/me`） |
| 外枠の入口の振り分け・すべてのアプリ・アプリの切り替え | 今のまま`/api/me`の`apps` |

- APIの基本のURL・認証のトークンの付け方・エラーの扱い（`ApiError`）は、共通の部品（`lib/api-client.ts`の`request`）を、Threadsの`api.ts`から使う（共通の部品なので、アプリから使ってよい）。
- テストのモック：Threadsのテストは`@/apps/threads/lib/api`をモックする形に直す（期待する結果は変えない）。

## 5. テスト

- 道筋の一覧のテスト（`routes.snapshot.txt`）：PR4で新しい道筋が足され、PR5で古い道筋が消えること。
- `/api/threads/me`：今の`/api/me`のThreadsの部分と同じ値を返すこと（同じデータで比べる）。
- `/api/me`：PR5のあと、Threadsのデータが入っていないこと。`apps.using`が今と同じ判定になること（自分のアカウントがある人・チームだけの人・どちらもない人）。
- Web：外枠と画面のテストが、期待する結果を変えずに通ること。E2E（19件）が通ること。
