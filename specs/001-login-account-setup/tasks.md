---
description: "ログインとThreadsアカウント登録の実装タスク"
---

# タスク（Tasks）：ログインとThreadsアカウント登録

**入力**：`specs/001-login-account-setup/`の設計文書
**前提**：[plan.md](./plan.md)、[spec.md](./spec.md)、[research.md](./research.md)、[data-model.md](./data-model.md)、[contracts/api.md](./contracts/api.md)、[contracts/ui-routes.md](./contracts/ui-routes.md)、[quickstart.md](./quickstart.md)

**テスト**：quickstart.mdの「自動テスト」の表にあるテストを、該当するユーザーストーリーのフェーズで先に書く（失敗することを確認してから実装する）。

**構成**：ユーザーストーリーごとにフェーズを分け、各ストーリーを単独で実装・テストできるようにする。

## 書式：`[ID] [P?] [Story] 説明`

- **[P]**：並行して進められる（別ファイルで、未完了のタスクに依存しない）
- **[Story]**：対応するユーザーストーリー（US1〜US4）
- 説明には、変更するファイルのパスを含める

## パスの規約（plan.mdの構成）

- API：`apps/api/src/`、テストは`apps/api/test/`
- Web：`apps/web/src/`、テストは`apps/web/test/`
- 共通：`packages/shared/src/`
- E2E：`e2e/`

---

## Phase 1：セットアップ（共通の土台）

**目的**：モノレポと開発環境を用意する（research.md R1・R12）

- [X] T001 リポジトリのルートに`package.json`（`private: true`、`dev`・`test`・`e2e`・`lint`のスクリプト）と`pnpm-workspace.yaml`（`apps/*`・`packages/*`）を作り、`.gitignore`に`node_modules/`・`dist/`・`.wrangler/`・`.dev.vars`・`.env.local`を追記する
- [X] T002 [P] ルートに`tsconfig.base.json`（`strict: true`、`moduleResolution: "bundler"`、`target: "ES2022"`）を作る
- [X] T003 [P] ルートにESLint（`eslint.config.js`、TypeScript用）とPrettier（`.prettierrc`）を設定する
- [X] T004 [P] `packages/shared/package.json`・`packages/shared/tsconfig.json`・`packages/shared/src/index.ts`を作り、zodを依存に加える
- [X] T005 `apps/api`を作る：`apps/api/package.json`（hono、drizzle-orm、@neondatabase/serverless、zod、Clerkのバックエンドミドルウェア、`@threads-grower/shared`）、`apps/api/tsconfig.json`、`apps/api/wrangler.toml`（`compatibility_date`、Cron Trigger `crons = ["0 18 * * *"]`）、`apps/api/src/index.ts`（空のHonoアプリと空の`scheduled`ハンドラーをexport）
- [X] T006 [P] `apps/api/.dev.vars.example`に、contracts/api.mdの「環境変数・Secret」の表の全項目（`CLERK_SECRET_KEY`、`CLERK_PUBLISHABLE_KEY`、`THREADS_APP_ID`、`THREADS_APP_SECRET`、`THREADS_REDIRECT_URI`、`THREADS_AUTH_BASE_URL`、`THREADS_GRAPH_BASE_URL`、`TOKEN_ENCRYPTION_KEYS`、`TOKEN_ENCRYPTION_KEY_VERSION`、`IDENTIFIER_HASH_KEY`、`DATABASE_URL`、`WEB_ORIGIN`）を、説明のコメント付きで書く
- [X] T007 `apps/web`をVite + React 19 + TypeScriptで作る：`apps/web/package.json`（react-router v7、@tanstack/react-query、`@clerk/react` v6、hono（RPCクライアント用）、`@threads-grower/shared`）、`apps/web/vite.config.ts`、`apps/web/index.html`、`apps/web/src/main.tsx`
- [X] T008 [P] `apps/web`にTailwind CSS v4とshadcn/uiを導入し（`apps/web/components.json`、`apps/web/src/index.css`）、`apps/web/src/components/ui/`にbutton・input・dialog・dropdown-menu・sheet・toast（sonner）・avatar・alertを追加する。ダークモードはOSの設定に従う（`prefers-color-scheme`）
- [X] T009 [P] `apps/web/.env.example`に`VITE_CLERK_PUBLISHABLE_KEY`と`VITE_API_BASE_URL`を書く
- [X] T010 [P] ルートに`docker-compose.yml`を作る：Postgres 17と`local-neon-http-proxy`（`db.localtest.me:4444`）。research.md R12
- [X] T011 [P] `apps/api/vitest.config.ts`を`@cloudflare/vitest-pool-workers`で設定し、テスト用の環境変数（偽のThreadsサーバーのURL、テスト用の鍵）を`apps/api/test/env.ts`にまとめる
- [X] T012 [P] `apps/web/vitest.config.ts`をjsdomとTesting Libraryで設定し、`apps/web/test/setup.ts`を作る
- [X] T013 [P] `e2e/playwright.config.ts`と`e2e/package.json`（`@playwright/test`、`@clerk/testing`）を作り、`webServer`でWeb・API・偽のThreadsサーバーを起動する設定を書く

**完了条件**：`pnpm install`が通り、`pnpm -r build`（中身は空でよい）と`docker compose up -d`が成功する

---

## Phase 2：基盤（すべてのユーザーストーリーの前提）

**目的**：DB・暗号・認証・Threadsクライアント・画面の骨格など、全ストーリーが使う部品を作る

**⚠️ このフェーズが終わるまで、ユーザーストーリーの作業は始めない**

### 共通パッケージ

- [X] T014 [P] `packages/shared/src/plans.ts`を作る：`Plan`型（`"auto-only" | "auto-grower" | "multi-account" | "team"`）、順位（この並び順）、上限（`auto-only`=1、`auto-grower`=1、`multi-account`=5、`team`=5）、`highestPlan(plans)`、`limitFor(plan)`、`initialPlanFor(ownedPlans)`（0件なら`auto-only`、それ以外は最上位プラン。FR-014）
- [X] T015 [P] `packages/shared/src/errors.ts`を作る：エラーコードの列挙（`AUTH_REQUIRED`、`ACCOUNT_NOT_FOUND`、`ACCOUNT_LIMIT_REACHED`、`THREADS_AUTH_CANCELLED`、`THREADS_AUTH_FAILED`、`THREADS_PROFILE_FETCH_FAILED`、`THREADS_ACCOUNT_TAKEN`、`RECONNECT_ACCOUNT_MISMATCH`、`ACCOUNT_DELETED_DURING_CONNECT`、`THREADS_AUTH_REVOKED`、`THREADS_DATA_DELETION_REQUESTED`、`OAUTH_STATE_INVALID`、`CONFIRMATION_MISMATCH`）と、contracts/ui-routes.mdの「エラー文言」の表の日本語の文言・次の操作。`ACCOUNT_LIMIT_REACHED`は`max`で文言を切り替える関数にする（`max = 1`ならプラン3への案内、`max = 5`なら不要なAccountの削除の案内）
- [X] T016 [P] `packages/shared/src/schemas.ts`を作る：contracts/api.mdの型（`AccountSummary`、`AccountLimit`、`GET /api/me`のレスポンス、`POST /api/threads/connect`のリクエスト（`mode`が`new`、または`reconnect`と`accountId`）、`POST /api/accounts/:id/open`のリクエスト（`clientId`：文字列、`openSeq`：0以上の整数）、`DELETE`のリクエスト（`confirmUsername`）、エラーの形`{ error: { code, message } }`）をzodで定義する
- [X] T017 [P] `packages/shared/src/username.ts`に`normalizeUsername(s)`を作る：「前後の空白を除く → 先頭の`@`を1つだけ除く → 小文字にする」（contracts/api.mdのDELETE）。`packages/shared/test/username.test.ts`で`@takumi`・`takumi`・` @Takumi `がすべて`takumi`になることを確かめる
- [X] T018 [P] `packages/shared/test/plans.test.ts`で、上限の計算と`initialPlanFor`をテストする

### データベース

- [X] T019 `apps/api/src/db/schema.ts`にDrizzleのスキーマを書く。data-model.mdの全テーブル・列挙型・制約をそのまま反映する：`users`（`clerk_user_id`はNOT NULL・UNIQUE、`last_account_id`は「FK → `accounts.id` ON DELETE SET NULL」、`last_account_deleted_at`・`last_account_client_id`・`last_account_open_seq`（bigint）・`last_account_open_received_at`はNULL可）、`accounts`（`threads_user_id`はNOT NULL・UNIQUE、`plan`はNOT NULL、`connection_status`は「NOT NULL, 既定値`connected`」、`connection_generation`は「bigint NOT NULL, 既定値0」）、`memberships`（一意制約`(user_id, account_id)`、部分一意インデックス「`account_id WHERE role = 'owner'`」、FKはどちらもON DELETE CASCADE）、`threads_connections`（`account_id`はPKかつFK ON DELETE CASCADE、`access_token_iv`は12バイト、`key_version`はsmallint、`authorized_at`はNOT NULL）、`oauth_states`（`state_hash`がPK、`target_account_id`は「`mode = reconnect`のときだけ必須（CHECK制約）」）、`threads_deletion_requests`（`request_fingerprint`はNOT NULL・UNIQUE、CHECK制約「`status <> 'completed'`なら`threads_user_id IS NOT NULL`、`status = 'completed'`なら`threads_user_id IS NULL`」、インデックス`threads_user_hmac`と`(status, last_attempted_at)`）、`threads_revocations`（インデックス`(threads_user_hmac, issued_at)`）
- [X] T020 `apps/api/drizzle.config.ts`を作り、`apps/api/package.json`に`db:generate`・`db:migrate`・`db:psql`のスクリプトを足して、最初のマイグレーションを`apps/api/drizzle/`に生成する
- [X] T021 `apps/api/src/db/client.ts`を作る：通常のクエリ用の`neon-http`版Drizzleと、対話的トランザクション用の`neon-serverless`（WebSocketのPool。リクエストごとに作って破棄する）版を返す関数。ローカルでは`local-neon-http-proxy`へ向ける`fetchEndpoint`の設定を入れる（research.md R8・R12）
- [X] T022 `apps/api/src/db/locks.ts`を作る：`lockThreadsUser(tx, threadsUserId)`（`pg_advisory_xact_lock`、キーは`threads_user_id`から作る）と`lockUserRow(tx, userId)`（`SELECT … FROM users WHERE id = $1 FOR UPDATE`）。ロックの順序は必ず「アドバイザリーロック → `users`の行ロック」とし、関数のコメントに明記する（research.md R8）

### 暗号・秘密情報・ログ

- [X] T023 [P] `apps/api/test/unit/crypto.test.ts`を書く：同じ平文を同じ鍵で2回暗号化するとIVも暗号文も異なる、AADに別の`account_id`を使うと復号に失敗する、鍵リングに旧バージョンの鍵があれば旧暗号文を復号できる、鍵が欠けたバージョンはエラーになる、現在のバージョンの鍵がない設定は起動時の検証で失敗する（quickstart.mdの「暗号文の付け替え」「IVの一意性」「鍵のローテーション」）
- [X] T024 `apps/api/src/lib/crypto.ts`を作る：`TOKEN_ENCRYPTION_KEYS`（JSON。各鍵は32バイトのbase64）と`TOKEN_ENCRYPTION_KEY_VERSION`を読み、起動時に検証する。`encrypt(plaintext, accountId)`はAES-256-GCMで、IVを暗号化のたびに`crypto.getRandomValues`で12バイト新しく作り、AADに`account_id`を使い、`{ ciphertext, iv, keyVersion }`を返す。`decrypt`は行の`key_version`の鍵を選ぶ（research.md R5）
- [X] T025 [P] `apps/api/src/lib/identifier-hash.ts`に`threadsUserHmac(threadsUserId)`を作る（`HMAC-SHA256(IDENTIFIER_HASH_KEY, threads_user_id)`のhex。research.md R7）
- [X] T026 [P] `apps/api/test/unit/logger.test.ts`を書いてから`apps/api/src/lib/logger.ts`を作る：`access_token`・`code`・`client_secret`・`signed_request`・`state`・`authorizeUrl`のキーを持つ値と、URLのクエリ文字列を自動でマスクする構造化ロガー（research.md R5、contracts/api.mdの秘密情報）

### Threadsクライアントと偽サーバー

- [X] T027 `apps/api/src/lib/threads-client.ts`を作る：ベースURL（`THREADS_AUTH_BASE_URL`・`THREADS_GRAPH_BASE_URL`）を環境変数から取る。`buildAuthorizeUrl(state)`（`client_id`、`redirect_uri`、`scope=threads_basic,threads_content_publish,threads_manage_insights`、`response_type=code`、`state`）、`exchangeCode(code)`（`POST /oauth/access_token`）、`exchangeLongLived(shortToken)`（`GET /access_token?grant_type=th_exchange_token`）、`refresh(token)`（`GET /refresh_access_token?grant_type=th_refresh_token`）、`getProfile(token)`（`GET /v1.0/me?fields=id,username,name,threads_profile_picture_url`、トークンは`Authorization`ヘッダーで渡す）。認証エラー（OAuthエラー190など）は`ThreadsAuthError`として区別する。リクエストURLはログに出さない（research.md R3・R5・R6）
- [X] T028 `apps/api/test/fake-threads/server.ts`に偽のThreadsサーバー（Hono）を作る：認可画面（許可・拒否を選べる）、コード交換、長期トークン交換、更新、プロフィール、テストから「トークンを無効にする」「失敗させる」「遅延させる」を指示できる制御用エンドポイント（research.md R12）
- [X] T029 [P] `apps/api/src/lib/signed-request.ts`を作り、`apps/api/test/unit/signed-request.test.ts`で確かめる：`signed_request`をApp SecretのHMAC-SHA256で検証し、`user_id`と`issued_at`（なければ`undefined`）を返す。検証の失敗は例外にする

### API・Webの骨格

- [X] T030 `apps/api/src/middleware/auth.ts`を作る：Clerkのセッショントークンを検証し、失敗したら`401 AUTH_REQUIRED`。成功したら`clerk_user_id`で`users`を探し、なければ作る（JIT作成）。`email`はClerkの値で更新する（research.md R2）
- [X] T031 `apps/api/src/index.ts`に共通部分を組み込む：CORS（`WEB_ORIGIN`だけ許可）、エラーハンドラー（`{ error: { code, message } }`の形。メッセージに秘密情報を含めない）、`/api`のルーティング、HonoのRPC用の型（`AppType`）のexport
- [X] T032 [P] `apps/api/src/services/access.ts`に`findOwnedAccount(db, userId, accountId)`を作る：Membershipで絞り込み、なければ`ACCOUNT_NOT_FOUND`（存在の有無を漏らさない。data-model.mdの`memberships`）
- [X] T033 [P] `apps/web/src/lib/api-client.ts`を作る：HonoのRPCクライアントにClerkのトークンを付ける。`401`を受けたら「セッションの有効期限が切れました。もう一度ログインしてください」と表示して`/sign-in`へ遷移する（contracts/ui-routes.mdの規則7）
- [X] T034 [P] `apps/web/src/lib/query.ts`にTanStack Queryのクライアントを作る
- [X] T035 `apps/web/src/main.tsx`と`apps/web/src/router.tsx`を作る：ClerkProvider、QueryClientProvider、ルート一覧（`/sign-in`、`/`、`/accounts/new`、`/accounts/:accountId`、`/accounts/:accountId/settings`、`/data-deletion/:code`、それ以外は404）。認証が必要なルートは、未ログインなら内容を描画する前に`/sign-in`へ置き換え遷移するガードで包む（FR-003、contracts/ui-routes.mdの規則1）
- [X] T036 [P] `apps/web/src/components/layout/AppShell.tsx`と`Sidebar.tsx`を作る：左サイドバー＋右メインパネル、狭い画面ではサイドバーをドロワー（Sheet）にする。サイドバーの中身（Account一覧・追加・ユーザーメニュー）は空の枠だけ用意する（contracts/ui-routes.mdの「レイアウトの骨格」）
- [X] T037 [P] `apps/web/src/lib/callback-result.ts`を作る：URLの`connected`・`error`のクエリを読み、トーストで表示してからURLから消すフック（contracts/ui-routes.mdの「callbackの結果表示」）
- [X] T038 [P] `apps/web/src/pages/not-found.tsx`に404画面を作る（「自分のAccountへ戻る」リンク付き）

**完了条件**：`pnpm --filter api test`のunitテストが通る。ローカルでAPIとWebが起動し、未ログインで`/`を開くと`/sign-in`に遷移する

---

## Phase 3：ユーザーストーリー1 - 初回ログインと最初のThreadsアカウント登録（優先度：P1）🎯 MVP

**目標**：新規ユーザーがGoogleでログインし、Threadsアカウントを接続してAccountを登録し、そのAccountの画面に入れる

**単独での確認方法**：新しいGoogleアカウントでログインし、Threadsアカウントを1件接続して、Accountのホーム（プロフィールと接続状態だけ）が表示されることを確かめる

### US1のテスト（先に書き、失敗することを確かめる）

- [X] T039 [P] [US1] `apps/api/test/integration/threads-connect.test.ts`を書く：`mode = new`で`authorizeUrl`が返り、`oauth_states`には`state`のSHA-256だけが保存され有効期限は10分。偽サーバーで許可 → callbackでAccount・Membership（`owner`）・`threads_connections`が作られ、`/accounts/:id?connected=new`へ302。拒否 → `THREADS_AUTH_CANCELLED`。同じ`state`で2回目のcallback → `OAUTH_STATE_INVALID`。プロフィール取得の失敗 → `THREADS_PROFILE_FETCH_FAILED`でAccountは作られない
- [X] T040 [P] [US1] `apps/api/test/integration/threads-callback-guards.test.ts`を書く：別ユーザーが登録済みの`threads_user_id` → `THREADS_ACCOUNT_TAKEN`。自分の既存Accountと同じ`threads_user_id` → Accountは増えず接続だけ更新して`connected=updated`。`authorized_at`以降に発行された`threads_revocations`がある → `THREADS_AUTH_REVOKED`。未完了の削除要求がある、または`completed_at >= oauth_states.created_at`の削除要求がある → `THREADS_DATA_DELETION_REQUESTED`。`users.last_account_deleted_at`が`oauth_states.created_at`より新しい → `ACCOUNT_DELETED_DURING_CONNECT`（quickstart.mdの該当行）
- [X] T041 [P] [US1] `apps/api/test/integration/secrets.test.ts`を書く：偽サーバーが返したトークン文字列と`state`の値が、`authorizeUrl`以外のAPIのレスポンスとログの出力に含まれない（FR-010、SC-005）
- [X] T042 [P] [US1] `apps/api/test/integration/me.test.ts`を書く：Accountが0件なら`landingAccountId`は`null`、Clerkの新しいユーザーで呼ぶと`users`行が作られる

### US1の実装

- [X] T043 [US1] `apps/api/src/services/threads-oauth.ts`に`startConnect(userId, { mode: "new" })`を作る：32バイトの乱数の`state`を作り、SHA-256（hex）を`oauth_states`に`expires_at = 作成から10分`で保存し、`buildAuthorizeUrl`を返す（research.md R4）
- [X] T044 [US1] `apps/api/src/services/threads-oauth.ts`に`consumeState(state)`を作る：`DELETE … RETURNING`で取得し、ない・期限切れなら`OAUTH_STATE_INVALID`
- [X] T045 [US1] `apps/api/src/services/account-service.ts`に`completeConnection(...)`を作る（research.md R8の手順を1つの対話的トランザクションで）：(1) `lockThreadsUser`、(2) `lockUserRow`、(3) `threads_revocations`に`authorized_at`以降の取り消しがあれば`THREADS_AUTH_REVOKED`、(4) 未完了の削除要求、または`completed_at >= oauth_states.created_at`の削除要求があれば`THREADS_DATA_DELETION_REQUESTED`（照合は`threads_user_hmac`）、(5) `users.last_account_deleted_at > oauth_states.created_at`なら`ACCOUNT_DELETED_DURING_CONNECT`、(6) `threads_user_id`で既存Accountを探す、(7) 自分のAccountなら接続を条件なしで上書きし`connection_generation`を1増やす、他人なら`THREADS_ACCOUNT_TAKEN`、(8) なければ`initialPlanFor`でプランを決め、Account・`owner`のMembership・接続を作る。接続には`encrypt`の結果、`scopes`、`expires_at`、`issued_at`、`authorized_at`（callbackがリダイレクトを受け取った時刻）を保存する。上限の判定はUS3で加えるため、ここでは呼び出し口（`assertCanAddAccount`、初期実装は常に許可）だけを置く
- [X] T046 [US1] `apps/api/src/routes/threads-connect.ts`に`POST /api/threads/connect`（`mode = new`）と`GET /api/threads/callback`を作る：callbackはリダイレクトを受け取った時刻を`authorized_at`として記録し、`error`クエリなら`THREADS_AUTH_CANCELLED`、それ以外は`consumeState` → `exchangeCode` → `exchangeLongLived` → `getProfile` → `completeConnection`の順に処理し、contracts/api.mdの表どおりに302でWebへ戻す
- [X] T047 [P] [US1] `apps/api/src/routes/me.ts`に`GET /api/me`を作る：`accounts`は`last_used_at`の新しい順。`landingAccountId`は`last_account_id` → `last_used_at`がもっとも新しいもの → `created_at`がもっとも新しいもの → `null`の順で決める（research.md R10）。`accountLimit`の`max`・`used`も返す
- [X] T048 [P] [US1] `apps/api/src/routes/accounts.ts`に`GET /api/accounts/:accountId`を作る（副作用なし、`findOwnedAccount`を使う）
- [X] T049 [P] [US1] `apps/web/src/pages/sign-in.tsx`を作る：「Googleでログイン」ボタンだけの中央寄せの画面。ログイン済みなら`/`へ。Googleでのログインの失敗は「Googleでのログインに失敗しました。もう一度お試しください。」を表示する（FR-001）
- [X] T050 [US1] `apps/web/src/pages/landing.tsx`を作る：`GET /api/me`の`landingAccountId`があれば`/accounts/:id`、なければ`/accounts/new`へ置き換え遷移する（FR-004・FR-005）
- [X] T051 [US1] `apps/web/src/pages/account-new.tsx`を作る：「Threadsアカウントを接続」ボタンで`POST /api/threads/connect`（`mode = new`）を呼び、`window.location.assign(authorizeUrl)`で遷移する。テスター制限の案内（「現在は検証期間中のため、招待されたThreadsアカウントのみ接続できます。…」と問い合わせ先）を常に表示する。Accountが0件のときはサイドバーなしの1カラム（contracts/ui-routes.md）
- [X] T052 [US1] `apps/web/src/pages/account-home.tsx`を作る：プロフィール画像（読み込めなければイニシャル）・表示名・@ユーザー名・接続状態を表示する。`callback-result`で`connected=new`なら「@{username} を追加しました」
- [X] T053 [US1] `apps/web/src/router.tsx`に「Account 0件のガード」を加える：Accountが0件のユーザーが`/accounts/:accountId`系を開いたら`/accounts/new`へ置き換え遷移する（US1 シナリオ3、規則3）

**チェックポイント**：US1だけで、ログインからAccountの画面まで動く（SC-001）

---

## Phase 4：ユーザーストーリー2 - 再訪時のログインと保護された画面（優先度：P2）

**目標**：再ログインで最後に使ったAccountに戻り、未ログインでは保護された画面を見られず、ログアウトできる

**単独での確認方法**：ログアウト → 保護された画面へのアクセスが`/sign-in`へ誘導される → 再ログインで最後に使ったAccountの画面に戻る

### US2のテスト

- [X] T054 [P] [US2] `apps/api/test/integration/account-open.test.ts`を書く：`open`が2回失敗しても3回目で記録され`landingAccountId`がそのAccountになる。同じ`clientId`で古い`openSeq`のリクエストは記録を変えない。先に受け取ったリクエストが後から完了しても（偽の遅延を使う）、後で受け取ったBの記録が残る。`clientId`が替われば`openSeq`が小さくても反映される（再読み込み）。トークンを無効にしてから`open`すると、そのレスポンスで`needs_reconnect`になり`GET /api/me`にも反映される（quickstart.mdの該当行、FR-018、SC-007）
- [X] T055 [P] [US2] `apps/web/test/guards.test.tsx`を書く：未ログインでは認証が必要なルートの内容を描画せずに`/sign-in`へ遷移する。ログアウト後に「戻る」でも内容が出ない（FR-003・FR-006、SC-003）
- [X] T056 [P] [US2] `apps/web/test/use-account-open.test.tsx`を書く：画面を離れると、待機中・実行中の再試行が中止される

### US2の実装

- [X] T057 [US2] `apps/api/src/services/account-service.ts`に`openAccount(userId, accountId, { clientId, openSeq }, receivedAt)`を作る：`users`を1つの条件付き`UPDATE`で更新する。条件は「`receivedAt > last_account_open_received_at`（NULLなら真）」かつ「`clientId`が`last_account_client_id`と違う、または`openSeq > last_account_open_seq`」。更新したら`accounts.last_used_at = receivedAt`（research.md R10）
- [X] T058 [US2] `apps/api/src/services/account-service.ts`に`verifyConnection(accountId)`を作る：`connection_generation`を読み、トークンで`getProfile`。成功ならプロフィールを更新、`ThreadsAuthError`なら`needs_reconnect`に。どちらの書き込みも読んだ`connection_generation`を条件にする。それ以外の失敗は状態を変えない（research.md R6・R14）
- [X] T059 [US2] `apps/api/src/routes/accounts.ts`に`POST /api/accounts/:accountId/open`を作る：処理を始めた時点のサーバー時刻を`receivedAt`とし、`openAccount`と`verifyConnection`を行って最新の`AccountSummary`を返す
- [X] T060 [US2] `apps/web/src/lib/use-account-open.ts`を作る：`clientId`はページを読み込むたびに作る乱数ID（メモリーだけに持ち、`sessionStorage`には保存しない）、`openSeq`はAccountの画面を開くたびに1つ増やす。失敗したら指数バックオフで最大3回まで再試行し、それでも失敗したらウィンドウにフォーカスが戻ったときにもう一度呼ぶ。画面を離れたら`AbortController`で中止する。ホバーなどの先読みでは呼ばない（contracts/ui-routes.mdの規則5）
- [X] T061 [US2] `apps/web/src/pages/account-home.tsx`と`account-settings.tsx`の共通の親（`apps/web/src/pages/account-layout.tsx`）で`use-account-open`を呼び、レスポンスで接続状態とプロフィールを差し替える
- [X] T062 [P] [US2] `apps/web/src/components/layout/UserMenu.tsx`を作る：ユーザー名とログアウト。ログアウトはClerkのセッションを終了し、TanStack Queryのキャッシュを全部消してから`/sign-in`へ置き換え遷移する（FR-006、規則6）

**チェックポイント**：US1・US2が単独でも組み合わせても動く（SC-003・SC-004）

---

## Phase 5：ユーザーストーリー3 - プランに応じた複数Accountの登録（優先度：P3）

**目標**：プランの上限まで複数のAccountを登録でき、上限では認可に進む前に案内が出る

**単独での確認方法**：`multi-account`のユーザーで2件目を接続でき、プラン1のユーザーでは追加が拒否されて案内が出る

### US3のテスト

- [X] T063 [P] [US3] `apps/api/test/integration/account-limit.test.ts`を書く：プラン1で1件持つユーザーの`mode = new` → `409 ACCOUNT_LIMIT_REACHED`。`multi-account`のAccountを持てば5件まで作れ、2件目以降のプランは最上位プランを引き継ぐ（FR-014〜FR-016）。上限1件のユーザーで2つのcallbackを同時に処理しても、作られるAccountは1件だけ（FR-017、research.md R8）
- [X] T064 [P] [US3] `apps/web/test/account-new-limit.test.tsx`を書く：`max = 1`ならプラン3の案内、`max = 5`なら不要なAccountの削除の案内が出て、接続ボタンは無効

### US3の実装

- [X] T065 [US3] `apps/api/src/services/account-service.ts`に`accountLimitFor(db, userId)`を作り、`assertCanAddAccount`を本実装にする：`owner`として保有するAccountの最上位プランから上限を計算し、`used >= max`なら`ACCOUNT_LIMIT_REACHED`（FR-015・FR-016）
- [X] T066 [US3] `apps/api/src/routes/threads-connect.ts`の`mode = new`で、認可URLを作る前に`assertCanAddAccount`を呼ぶ（FR-017）。`completeConnection`の手順(8)の直前でも、`users`の行ロックを持ったまま再判定する（research.md R8）
- [X] T067 [P] [US3] `apps/web/src/components/layout/AccountSwitcher.tsx`を作る：サイドバーにAccount一覧（`needs_reconnect`には警告アイコン）と「＋ 追加」を出し、選んだら`/accounts/:id`へ遷移するだけにする（記録は遷移先の`open`で行う。規則5）
- [X] T068 [US3] `apps/web/src/pages/account-new.tsx`に上限の表示を加える：`accountLimit.used >= accountLimit.max`なら接続ボタンを無効にし、`max`に応じた案内と「登録済みのAccountの接続を更新したい場合は、そのAccountの設定画面から認可し直せます」を表示する。APIの`409`を受けた場合も同じ表示（規則8）
- [X] T069 [P] [US3] `apps/api/scripts/set-plan.ts`を作り、`apps/api/package.json`に`admin:set-plan <accountId> <plan>`を足す：`plan`を4値のどれかに変更する。管理画面は作らない（research.md R9）

**チェックポイント**：US1〜US3がそれぞれ単独で動く（SC-006）

---

## Phase 6：ユーザーストーリー4 - Threads接続の再接続とAccountの削除（優先度：P4）

**目標**：無効になった接続を検知して「要再接続」と表示し、同じThreadsアカウントで認可し直せる。Accountを確認のうえ削除できる。Metaからの解除・データ削除の通知を正しく処理する

**単独での確認方法**：接続を無効化 → 「要再接続」が出る → 再接続で戻る。Accountを削除すると一覧から消える

### US4のテスト

- [ ] T070 [P] [US4] `apps/api/test/integration/reconnect.test.ts`を書く：`mode = reconnect`は`connected`でも`needs_reconnect`でも使え、上限に達していても通る。別のThreadsアカウントで認可 → `RECONNECT_ACCOUNT_MISMATCH`で接続は変わらない（FR-013・FR-020）
- [ ] T071 [P] [US4] `apps/api/test/integration/account-delete.test.ts`を書く：`confirmUsername`が違えば`422`で何も消えない。一致（`@`の有無・大文字小文字は問わない）すれば関連行がすべて消え、`users.last_account_deleted_at`が記録される。`mode = new`の認可の開始後に削除すると、そのcallbackは`ACCOUNT_DELETED_DURING_CONNECT`（FR-022、research.md R13）
- [ ] T072 [P] [US4] `apps/api/test/integration/token-refresh.test.ts`を書く：期限まで7日を切った接続は更新され、認証エラーなら`needs_reconnect`。Cronが読んだ後に再接続、または「アンインストールで接続行が消えて再接続で作り直された」場合も、Cronの結果は反映されない（research.md R6、ABA）
- [ ] T073 [P] [US4] `apps/api/test/integration/uninstall.test.ts`を書く：通知でAccountが`needs_reconnect`になり接続行が消える。再接続より前の`issued_at`の通知は適用されない。Accountがなくても`threads_revocations`に記録される。`issued_at`がなければトークンで確認する（research.md R7）
- [ ] T074 [P] [US4] `apps/api/test/integration/data-deletion.test.ts`を書く：Accountと関連行が消え状況確認APIが`completed`。同じ`signed_request`の再送は同じ確認コードで新しい行を作らない。`pending`のまま15分経った要求と`failed`の要求をCronが`completed`にする。2つのWorkerが同じ古い要求を処理しても、claimに失敗した側は何も削除しない。完了の時点では`threads_user_hmac`が残り、完了から15分以上後のCronで消える（quickstart.mdの該当行）

### US4の実装：再接続と削除

- [ ] T075 [US4] `apps/api/src/services/threads-oauth.ts`の`startConnect`に`mode = reconnect`を加える：`findOwnedAccount`で確認し、`oauth_states.target_account_id`に保存する。上限の判定はしない
- [ ] T076 [US4] `apps/api/src/services/account-service.ts`の`completeConnection`に再接続の分岐を加える：`target_account_id`のAccountの`threads_user_id`と、認可されたユーザーIDが違えば`RECONNECT_ACCOUNT_MISMATCH`。同じなら接続を上書きし、`connected`に戻して`connection_generation`を1増やす。302先は`/accounts/:id/settings?connected=reconnect`（失敗時は`?error=`）
- [ ] T077 [US4] `apps/api/src/routes/accounts.ts`に`DELETE /api/accounts/:accountId`を作る：`normalizeUsername`で比較し、違えば`422 CONFIRMATION_MISMATCH`。1つのトランザクションで`lockUserRow` → `users.last_account_deleted_at = now()` → Accountを削除（research.md R13）
- [ ] T078 [US4] `apps/web/src/pages/account-settings.tsx`を作る：接続状態、接続状態に関係なく常に表示する「Threadsとの接続を認可し直す」ボタン（`needs_reconnect`なら「再接続」として強調）、Accountの削除ダイアログ（「確認のため、@{username} と入力してください」。`normalizeUsername`で一致するまで「削除する」を無効にし、入力はそのまま送る。削除後は`/`へ）（規則9・10）
- [ ] T079 [US4] `apps/web/src/pages/account-layout.tsx`に`needs_reconnect`のバナーを加える：「Threadsとの接続が切れています。再接続するまで、このAccountの自動処理は止まります。」と「再接続」ボタン（FR-019）

### US4の実装：定期処理とMetaからの通知

- [ ] T080 [US4] `apps/api/src/services/token-refresh.ts`を作る：`expires_at`が7日以内で`issued_at`から24時間以上経った接続を更新し、プロフィールも取り直す。更新時の認証エラー、または`expires_at`を過ぎた接続は`needs_reconnect`。書き込みはすべて読んだ`connection_generation`を条件にし、更新件数0なら捨てる。トークンの暗号化はIVを毎回新しく作る（research.md R5・R6）
- [ ] T081 [US4] `apps/api/src/routes/threads-webhooks.ts`に`POST /api/threads/webhooks/uninstall`を作る（contracts/api.mdの手順1〜7）：`lockThreadsUser`の下で`threads_revocations`に記録し、`issued_at < authorized_at`なら適用しない。`issued_at`がなければ受信時刻で記録し、トークンでプロフィール取得を試して判断する
- [ ] T082 [US4] `apps/api/src/services/data-deletion.ts`を作る：`receive(signedRequest)`は`request_fingerprint`（`signed_request`全体のSHA-256）で`INSERT … ON CONFLICT DO NOTHING`し、重複なら既存の確認コードを返す。`attempt(confirmationCode, observedLastAttemptedAt)`は1つのトランザクションで`lockThreadsUser` → `SELECT … FOR UPDATE`で読み直し → `last_attempted_at`を条件にした`UPDATE … RETURNING`でclaim → Accountを削除し所有者の`users.last_account_deleted_at`を記録 → `completed`・`completed_at`・平文の`threads_user_id`をNULL（hmacは残す）。失敗したらロールバックし、別のトランザクションで`failed`・`attempts + 1`・`last_attempted_at = now()`（`status <> 'completed'`を条件に）（research.md R7）
- [ ] T083 [US4] `apps/api/src/routes/threads-webhooks.ts`に`POST /api/threads/webhooks/data-deletion`を、`apps/api/src/routes/data-deletion.ts`に`GET /api/data-deletion/:confirmationCode`（`status`・`receivedAt`・`completedAt`だけを返す）を作る
- [ ] T084 [US4] `apps/api/src/index.ts`の`scheduled`ハンドラーに日次の処理をまとめる（contracts/api.mdの「定期処理」1〜6）：トークン更新、期限切れの`oauth_states`と受信から15分以上経った`threads_revocations`の削除、`last_attempted_at`から15分以上経った`pending`・`failed`の削除要求の再試行（`attempt`）、完了から15分以上経った`threads_user_hmac`のNULL化、消去件数と残っている最古の行の経過時間のログ（25時間超はエラー）。1件の失敗で全体を止めない
- [ ] T085 [P] [US4] `apps/web/src/pages/data-deletion.tsx`を作る：`GET /api/data-deletion/:code`の結果で「処理中」（`pending`・`failed`）か「削除が完了しました（日時）」を表示する
- [ ] T086 [P] [US4] `apps/api/scripts/rotate-token-key.ts`を作り、`apps/api/package.json`に`admin:rotate-token-key`を足す：鍵が欠けているバージョンの行があれば開始しない。古いバージョンの行を、IVを新しく作って現在の鍵で暗号化し直す（`key_version`と`connection_generation`を条件に。世代番号は上げない）。最後に旧バージョンの行の件数を表示する（research.md R5）

**チェックポイント**：全ストーリーが単独で動く（SC-007）

---

## Phase 7：仕上げと横断的な確認

- [ ] T087 [P] `e2e/tests/onboarding.spec.ts`を書く：`@clerk/testing`でログインし、偽のThreadsサーバーで接続 → Accountの画面 → ログアウト → 再ログインで同じAccountに戻る（US1・US2）
- [ ] T088 [P] `e2e/tests/reconnect-delete.spec.ts`を書く：偽サーバーでトークンを無効化 → 画面を開くと「要再接続」 → 再接続 → 削除（US4）
- [ ] T089 [P] リポジトリのルートの`README.md`に、開発環境の用意（Docker、Cloudflare Tunnel、Clerk・Metaの設定）とコマンドを、quickstart.mdへのリンク付きで追記する
- [ ] T090 `pnpm lint`と`pnpm test`と`pnpm e2e`をすべて通す
- [ ] T091 quickstart.mdの「手動での確認」を、本物のGoogle・Threads（テスターのアカウント）で最後まで実施し、`wrangler dev`のログを`access_token`・`code=`・`client_secret`で検索して何も出ないことを確かめる（SC-005）

---

## 依存関係と実行順序

### フェーズの依存

- **Phase 1（セットアップ）**：依存なし。すぐ始められる
- **Phase 2（基盤）**：Phase 1の後。**すべてのユーザーストーリーをブロックする**
- **Phase 3〜6（US1〜US4）**：Phase 2の後
  - US1が最初（MVP）
  - US2は`GET /api/me`（US1のT047）を使うが、単独でテストできる
  - US3はUS1の`completeConnection`（T045）の呼び出し口に上限の判定を差し込む
  - US4はUS1の`startConnect`・`completeConnection`を拡張する。定期処理とMetaからの通知（T080〜T086）は、US4の他のタスクと並行できる
- **Phase 7（仕上げ）**：対象のストーリーが終わった後

### ストーリーの中の順序

- テストを先に書き、失敗することを確かめる
- サービス → ルート → 画面の順
- 同じファイルを触るタスク（例：`account-service.ts`のT045・T057・T058・T065・T076）は、番号順に1つずつ進める

### 並行できるもの

- Phase 1：T002・T003・T004・T006・T008〜T013
- Phase 2：共通パッケージ（T014〜T018）、暗号・ログ（T023・T025・T026）、署名の検証（T029）、Webの骨格（T033・T034・T036〜T038）
- 各ストーリーのテスト（[P]付き）は、まとめて並行に書ける

### 並行の例：US1

```text
# テストをまとめて書く
T039 threads-connect.test.ts
T040 threads-callback-guards.test.ts
T041 secrets.test.ts
T042 me.test.ts

# サービスができた後、ルートと画面を並行に
T047 routes/me.ts
T048 routes/accounts.ts（GET）
T049 pages/sign-in.tsx
```

### 並行の例：US4

```text
# 再接続・削除（T075〜T079）と、定期処理・Metaからの通知（T080〜T086）は別の人・別のセッションで並行できる
```

---

## 実装の進め方

### MVPを先に（US1だけ）

1. Phase 1・2を終える
2. Phase 3（US1）を終える
3. **止めて確認する**：quickstart.mdの「US1：初回ログインと最初の登録」を手動で確かめる
4. 自分のThreadsアカウントで実際に使い始める

### 段階的に足す

1. US2を足す → 再ログインとログアウトを確認
2. US3を足す → `admin:set-plan`で`multi-account`にして2件目（「AI部」アカウント）を接続
3. US4を足す → 再接続・削除・Metaからの通知を確認
4. Phase 7で全体を通して確認する

---

## 補足

- [P]は、別ファイルで依存がないタスクだけに付けている
- タスクを1つ（または論理的なまとまり）終えるごとにコミットする
- ブランチは`feature/001-login-account-setup`で進める（Constitution「開発ワークフロー」）
- 本物のMetaの認可画面は自動テストにしない。E2Eは偽のThreadsサーバーで行い、本物はT091で手動確認する（research.md R12）
