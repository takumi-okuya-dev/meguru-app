# データとモジュールの形（Data Model）：めぐるの外枠とWebの分割

**日付**：2026-11-12 | **計画**：[plan.md](./plan.md) | **調べたこと**：[research.md](./research.md)

## 1. データベース

### `users`に列を1つ足す（マイグレーション`0025`、PR3）

| 列 | 型 | null | 既定 | 意味 |
|---|---|---|---|---|
| `last_app_id` | `text` | 可 | `null` | 最後に使ったアプリのID（`APP_CATALOG`のID。例：`threads`）。`PUT /api/me/last-app`だけが書く |

- 持ち主：共通（`platform/identity`）。`platform/schema.ts`の`users`に足す。
- CHECKの制約は置かない（research.md R6）。知らないIDはAPIで断る。
- 今の利用者は`null`から始まる。`null`のときの入口は`using`の最初（今はThreads）なので、今の利用者の入口は変わらない。
- 退会・データの削除：`users`の行と一緒に消えるので、足す処理はない。

## 2. アプリの一覧（`@meguru/shared`、PR3）

`packages/shared/src/apps.ts`

| 項目 | 例（Threads） | 意味 |
|---|---|---|
| `id` | `"threads"` | アプリのID。URLのパス・`last_app_id`・`/api/me`の`apps`で使う |
| `name` | `"めぐる Threads"` | すべてのアプリの画面とアプリの切り替えに出す名前（spec FR-017） |
| `basePath` | `"/threads"` | 画面のURLの頭 |
| `summary` | 「Threadsの投稿を、人格を保ったまま育てる」など | すべてのアプリの画面の1行の説明 |
| `details` | できることの箇条書き（3〜5行） | 「詳しく見る」で開く説明 |
| `priceLabel` | `"アカウント1件につき月1,000円"` | `BILLING_UNIT_PRICE_JPY`から作る |
| `released` | `true` | 利用者に出してよいか。`false`のアプリはAPIの`available`にもWebのルートにも出ない |

- `AppId`の型は`APP_CATALOG`のIDから作る。
- `lastAppRequestSchema`（`{ app: AppId }`）も同じファイルに置く。

## 3. `/api/me`の`apps`（PR3）

| 項目 | 型 | 決め方 |
|---|---|---|
| `available` | `AppId[]` | `APP_CATALOG`の`released`のアプリ（一覧の順） |
| `using` | `AppId[]` | `available`のうち、使っているアプリ。Threadsは開けるアカウント（オーナー・担当）が1件以上 |
| `last` | `AppId \| null` | `users.last_app_id`。`available`に入っていなければ`null` |
| `landing` | `AppId \| null` | `last`が`using`に入っていれば`last`、なければ`using[0]`、なければ`null` |

## 4. アプリの入口（Web、`AppModule`、PR1で形を作りPR3で埋める）

`apps/web/src/shell/app-module.ts`に型を置き、各アプリが`apps/<名前>/index.ts`で値を出す。

| 項目 | Threadsでの中身 | 外枠での使い道 |
|---|---|---|
| `id` | `"threads"` | `APP_CATALOG`から名前・パス・説明・料金を引く |
| `icon` | Threadsのアイコンの部品 | アプリの切り替え・すべてのアプリの画面 |
| `basePath` | `"/threads"` | 今開いているアプリの判定 |
| `routes` | `/threads`の下の、ログインの要るルート（ホーム・アカウント・チーム・`/threads/complete`） | ログインの関所の中に入れる |
| `readingRoutes` | `/guide/threads-token` | ログインの関所の外の、環境の帯つきの入れ物に入れる |
| `publicRoutes` | `/invite/:token`・`/guide/threads-token`・`/data-deletion/:code` | ログインの関所の外に入れる |
| `legacyRedirects` | `[{ from: "/accounts", to: "/threads/accounts" }, { from: "/teams", to: "/threads/teams" }]` | ログインの関所の外に、転送のルートを作る（PR2） |
| `settingsSections` | テスター招待・アカウント一覧（運営、並び順つき）と、その画面 | 共通の設定の項目と`/settings/<slug>`のルートに足す |

- 外枠は`AppModule`の一覧を、組み立てからコンテキストで受け取る（`AppRegistryProvider`）。アプリのコードは読まない。
- サイドバーの中身（頭・中身・下の項目＝`AppSidebar`）は、`AppModule`ではなく、アプリの画面の枠が`AppShell`の`sidebar`に渡す（Threadsは`ThreadsShell`。2026-11-12の実装で決めた：テストがアプリの一覧なしで画面の枠を描くため）。
- 今開いているアプリは、URLの頭（`basePath`）で決める。どのアプリのパスでもない画面（`/apps`・`/settings`）では、サイドバーは出さない（今の設定の画面と同じ）。

## 5. 前のURLと新しいURLの対応（PR2）

| 前のURLの形 | 新しいURLの形 |
|---|---|
| `/accounts/new` | `/threads/accounts/new` |
| `/accounts/:accountId` と `/accounts/:accountId/*` | `/threads/accounts/:accountId` と `/threads/accounts/:accountId/*` |
| `/teams/:teamId` と `/teams/:teamId/*`（`/teams/:teamId/accounts/:accountId`を含む） | `/threads/teams/:teamId` と `/threads/teams/:teamId/*` |

- どれも頭に`/threads`を足すだけ。クエリと`#…`は保つ。履歴は置き換える。
- 前のURLで、新しいURLに同じ画面がないものはない（2026-11-12のルートの一覧で確かめた）。

## 6. Webのモジュール地図の下書き（PR1）

`apps/web/src`からのパス。ファイル単位の行き先は tasks で決める。ここでは決め方と主なものを書く。

### 6-1. 組み立て

`main.tsx`・`router.tsx`（`buildRoutes(apps)`）・`app-registry.ts`（出せるアプリの`AppModule`の一覧）

### 6-2. 外枠（`shell/`）

| 小分け | 中身（今の場所から） |
|---|---|
| `shell/layout/` | `AppShell`・`CenteredLayout`・サイドバーの枠（今の`Sidebar.tsx`から、アプリの中身を除いたもの）・アプリの切り替え（新規）・`UserMenu`・`EnvBanner`・`PageHeader`・`shell-context` |
| `shell/pages/` | 入口の振り分け（新規の`/`）・すべてのアプリ（新規）・`not-found`・`sign-in`・`terms`・`legal-commerce`・`test-invite`・`referral-landing` |
| `shell/settings/` | `settings-layout`・`sections`（外枠の項目と、アプリの項目をまとめる関数）・`appearance`・`account`・`billing`・`referral`・`features`・`test-groups`・`limits` |
| `shell/guards/` | `RequireAuth`・`TestAccessRequired`・`SubscribeRequired`・`WithdrawalInProgress` |
| `shell/lib/` | `seller-info`・`use-last-app`（新規、PR3） |
| `shell/index.ts` | 入口：`AppShell`・`CenteredLayout`・`PageHeader`・`useShell`・`AppModule`の型・設定の項目の型 |

### 6-3. Threads（`apps/threads/`）

| 小分け | 中身（今の場所から） |
|---|---|
| `pages/` | `account-*`・`activity`・`analysis`・`create`・`external-media*`・`performance`・`promotions`・`research`・`stock`・`strategy`・`team*`・`invite`・`guide-threads-token`・`threads-complete`・`data-deletion`・ホーム（今の`landing`の中身）・設定の`tester-invites`・`operator-accounts` |
| `sidebar/` | `index.tsx`（`threadsSidebar`・`ThreadsShell`・`ThreadsSidebar`）・`AccountSwitcher` |
| `components/` | `analysis`・`connect`・`create`・`external-media`・`guides`・`items`・`performance`・`promotions`・`research`・`stock`・`strategy`・`team`（共通に残すものを除く）・`settings`（このアカウントの設定の区分）・`AccountAvatar`・`AutoPostNotices`・`ConnectionBadge`・`CopyPromptButton`・`NextPostCard`・`NotConnectedNotice`・`ReconnectButton`・`ShareAppCard`・`RequireFeature`・アカウントの切り替え・サイドバーの中身 |
| `lib/` | `use-account-access`・`use-account-open`・`callback-result`・`preferences`・`paths.ts`（Threadsの画面のURLを作る関数。PR2） |
| `routes.tsx` | Threadsのルート |
| `index.ts` | 入口：`threadsApp`（`AppModule`） |

### 6-4. 共通の部品（今の場所に残る）

- `components/ui/**`（見た目の部品）
- `components/`：`ErrorScreen`・`ApiErrorScreen`・`LoadingSkeleton`（`guards.tsx`から分ける）・`ConflictDialog`・`UnsavedChangesDialog`・`UnsavedChangesProvider`・`FieldWithCounter`・`SwapLabel`・`ConfirmDialog`・`HelpToggle`・`SettingRow`・`FeatureSwitches`・`FeatureUnavailable`（「この機能は今は使えません」の表示だけ）・`billing/`（`BillingRequiredDialog`・`ReadOnlyBanner`・`TrialEndingBanner`・`WithdrawDialog`）
- `lib/`：`api-client.ts`（呼び出しの土台と、共通の呼び出し：自分・契約・設定・紹介・テストのグループ・運営の機能と上限）・`query.ts`（共通のキー）・`format`・`utils`・`save-error`・`theme`・`config-check`・`invite-return`（チームとテストのグループの招待は共通）・`use-logout`・`referral-store`（`api-client` が使う）・`home-link`（新規。「この機能は今は使えません」の戻る先）・`use-media-query`・`use-unsaved-changes`

### 6-5. 分け方の決め方

1. Threadsの画面だけが使うもの → Threads。
2. 外枠の画面だけが使い、外枠の部品（`CenteredLayout`など）を使うもの → 外枠。
3. 両方が使うもの → 共通の部品。共通の部品が外枠・Threadsのものを使っていたら、使っている部分を切り分ける（例：`ApiErrorScreen`が使う「この機能は今は使えません」の表示は共通、`RequireFeature`はThreads）。
4. 切り分けられないものは、境界の例外としてモジュール地図に書く（3件以下を目標。spec SC-004）。

### 6-6. APIの呼び出しの分け方

- **2026-11-12の実装で変えた**：`lib/api-client.ts`と`lib/query.ts`は分けず、共通の部品のままにする。Webのテストの60ファイルが`vi.mock("@/lib/api-client")`で`api`をまるごと差し替えており、分けるとテストの中身を書き直すことになるため（spec SC-003）。境界の違反にはならない。
- 2作目のアプリの呼び出しは`apps/<名前>/lib/api.ts`に置く。Threadsの呼び出しを`apps/threads/`へ移すことは、移す候補としてモジュール地図に書く。
