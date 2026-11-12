# モジュール地図（API・Web）

**作成**：2026-11-10（specs/027-modular-monolith） | **Webの章**：2026-11-12（specs/028-meguru-shell） | **対象**：`apps/api/src`・`apps/web/src`

APIのコード（1〜6章）とWebのコード（7章）を、どのモジュールが持つかを決めた地図。表の持ち主・入口・依存の向き・例外を、ここを正本として管理する。プロダクト全体の形は[docs/product-structure.md](./product-structure.md)、構想の正本は personal-knowledge-base の`Wiki/仕事/システム開発/アイデア/個人開発版Google Workspace構想（スイート型SaaS）.md`。

## 1. 決まり

### 1-1. 5つの種類と依存の向き

| 種類 | 置き場所 | 中身 | 使ってよい相手 |
|---|---|---|---|
| 組み立て（composition） | `src/app.ts`・`src/index.ts`・`src/jobs/`・`src/db/schema.ts` | APIの入口の登録・定期処理の振り分け・モジュールのつなぎこみ | すべて（ほかのモジュールは入口から） |
| アプリ（apps） | `src/apps/<名前>/`（今は`threads`） | アプリ固有の処理・表・APIの入口 | 土台・窓口・共通（入口から）。**アプリ同士は使わない** |
| 共通（platform） | `src/platform/` | 利用者・アカウントとメンバー・権限・契約・機能のON/OFF・上限・チーム・運営・活動の記録・退会 | 土台・窓口。**アプリは使わない**（呼ぶときは知らせ。1-4） |
| 窓口（adapters） | `src/adapters/<名前>/` | 外部サービスとのやりとり（Stripe・ThreadsのAPI・Metaの署名つきリクエスト）。業務の判断は持たない | 土台 |
| 土台（kernel） | `src/kernel/` | 環境の値と設定・エラー・ログ・入力の確かめ・暗号と識別子のハッシュ・DBの接続とロック | 土台だけ |

```text
組み立て → アプリ → 共通 → 窓口 → 土台   （上から下へだけ。飛ばしてもよい）
```

### 1-2. 入口

- 入口（`index.ts`）は、**共通全体（`platform/index.ts`）・アプリごと（`apps/<名前>/index.ts`）・窓口ごと（`adapters/<名前>/index.ts`）**に1つ。モジュールの直下の`schema.ts`（表の定義）も入口として読んでよい（`db/schema.ts`が共通とThreadsの表を読み直して出すため）。
- ほかのモジュールからは入口だけを読む（`../../platform`・`../../adapters/stripe`）。土台は入口なしで、ファイルを直接読んでよい。
- 同じモジュールの中（`platform/`の小分け同士、`apps/threads/`の小分け同士）は自由に読んでよい。共通の中の区切りは、2作目で本当に共通だった部分を取り出すときに見直す。

### 1-3. データの持ち主

- 表には持ち主のモジュールが1つある（2章）。表の定義は持ち主の`schema.ts`に置き、入口から出す。
- 持ち主でないモジュールは、表を読むことはできるが、書き換えてよいのは3章の例外の列だけ。
- アプリの表が共通の表（`users`・`accounts`）を参照するのはよい。共通の表からアプリの表は参照しない。
- **ただし、2作目以降のアプリは共通の表を参照しない**（読む・外部キーのどちらも。利用者のIDを値として持ち、共通の入口の関数から受け取る）。表はアプリ専用のスキーマに置く。今後マイクロサービスにしていく可能性に備えた決まりで、詳しくは[docs/app-separation.md](./app-separation.md)。Threadsは今のまま。

### 1-4. 知らせ（共通 → アプリ）

共通の処理の途中でアプリの処理を呼ぶ必要があるときは、共通が知らせを出し、アプリが受け取る（`platform/hooks.ts`）。受け取る関数は、組み立てでアプリの`registerXxx()`を呼んで登録する（中で`registerModule("<名前>", …)`を使い、何度呼んでも1回だけ）。今の呼び出しと同じ場所・同じ順番・同じトランザクションで`await`する。受け取りが1つも登録されていない知らせを出すと例外になる（アプリの片づけを黙って飛ばさないため）。

| 知らせ | 出すところ | Threadsでの受け取り |
|---|---|---|
| `accountDeleting` | アカウントを消す前（`deleteAccount`・Metaからのデータ削除の`deleteAccountsOfThreadsUser`・退会の`withdrawal-service`の3か所すべて） | テスター招待の取り下げ（`withdrawForAccountDeletion`） |
| `userWithdrawing` | 退会で、持っているアカウントを消す前（`platform/withdrawal/withdrawal-service.ts`） | テスター招待の片づけ（`purgeForWithdrawal`） |
| `userAccountsDeleted` | 退会で、持っているアカウントを消したあと（同上） | Metaのデータ削除の要求が処理中なら完了にする |
| `limitsChanged` | 上限を保存したあと（`platform/operator/limit-service.ts`） | 自動投稿を起こす（`notifyWake`） |
| `accountOpened` | アカウントを開いたあと、応答を返す前（`POST /api/accounts/:id/open`） | 保存しているトークンで接続を確かめる（`verifyConnection`） |

### 1-5. 自動のチェック

- ESLintの規則`local/module-boundaries`（`eslint-rules/module-boundaries.js`）が、`apps/api/src`のすべてのファイルで次を止める：①ほかのモジュールの入口でないところ、②共通 → アプリ、③アプリ同士、④窓口・土台から上。`import type`・`export … from`・`import("…")`（型の中を含む）・`import x = require("…")`も対象。
- `strictPlacement`を有効にしている：組み立ての場所（`app.ts`・`index.ts`・`jobs/`・`db/schema.ts`）のほかに、どのモジュールにも入っていないファイルがあれば知らせる。
- `pnpm lint`（CIの「lint・型チェック・共通とWeb」）で流れる。規則のテストは`node --test "eslint-rules/*.test.js"`。
- 種類はパスの形で決まる。`src/apps/<名前>/`を作れば、設定を足さなくてもアプリとして当たる。テスト（`apps/api/test`）と`scripts/`にはかけない。

## 2. 表・処理・APIの入口の持ち主

パスは`apps/api/src`から。APIの入口のファイルは`*-routes.ts`。

### 2-1. 共通（platform）

| 小分け | 表 | 処理とAPIの入口 |
|---|---|---|
| `identity/`（利用者） | `users`・`withdrawn_users` | `auth.ts`（認証のミドルウェア・`AppEnv`の型）・`me-routes.ts`（`/api/me`・退会） |
| `access/`（権限） | — | `access.ts`（`authorizeAccount`：誰がどのアカウントで何をできるか） |
| `accounts/`（運用するアカウントとメンバー） | `accounts`（3章の例外あり）・`memberships` | `account-service.ts`（作る・名前・消す・数える・上限・最後に開いたアカウント・Metaからのデータ削除でのアカウントの削除`deleteAccountsOfThreadsUser`）・`account-routes.ts` |
| `teams/`（チーム・招待） | `teams`・`team_members`・`team_accounts` | `team-service.ts`・`team-status.ts`・`invite-service.ts`・`team-routes.ts`・`account-team-routes.ts`・`invite-routes.ts` |
| `billing/`（契約と決済） | `subscriptions` | `billing-service.ts`・`billing-routes.ts`・`stripe-webhook-routes.ts` |
| `features/`（機能のON/OFF） | `feature_disables`・`group_feature_disables`・`feature_setting_events` | `feature-service.ts`・`feature-sql.ts`・`operator-feature-routes.ts` |
| `test-groups/`（テストのグループ） | `test_groups`・`test_group_members`・`test_group_events` | `test-group-service.ts`・`operator-test-group-routes.ts`・`test-invite-routes.ts` |
| `operator/`（運営と上限） | `operator_settings`（3章の例外あり）・`operator_events` | `limit-service.ts`・`operator-settings.ts`・`operator-events.ts`・`operator-only.ts`（運営者だけの関所）・`operator-limit-routes.ts` |
| `referrals/`（紹介） | — | `referral-service.ts`・`referral-routes.ts` |
| `activity/`（活動の記録） | `activity_logs` | `activity-log.ts`・`activity-routes.ts` |
| `withdrawal/`（退会） | — | `withdrawal-service.ts` |
| （直下） | — | `index.ts`（入口）・`schema.ts`（17表）・`hooks.ts`（知らせ） |

### 2-2. Threads（apps/threads）

| 小分け | 表 | 処理とAPIの入口 |
|---|---|---|
| `connection/`（接続・トークン・Metaの要求） | `threads_connections`・`token_check_failures`・`oauth_states`・`threads_deletion_requests`・`threads_revocations` | `connection-service.ts`（接続の確定・開いたときの確かめ）・`threads-oauth.ts`・`token-connect.ts`・`token-recheck.ts`・`token-refresh.ts`・`username-match.ts`・`threads-credentials.ts`・`revocation.ts`・`threads-check-service.ts`・`data-deletion.ts`（アカウントの削除は共通の`deleteAccountsOfThreadsUser`に頼む）・`threads-connect-routes.ts`・`threads-webhook-routes.ts`・`threads-check-routes.ts`・`data-deletion-routes.ts` |
| `strategy/`（戦略・宣伝・リサーチ） | `strategy_designs`・`promotions`・`reference_posts`・`research_keywords` | `strategy-service.ts`・`profile-status.ts`・`materials.ts`・`item-service.ts`・`strategy-routes.ts`・`promotion-routes.ts`・`research-routes.ts` |
| `drafts/`（投稿の案・確かめる・投稿ルール） | `draft_batches`・`post_drafts`・`ng_words` | `draft-service.ts`・`review-service.ts`・`posting-rules-service.ts`・`account-review-counts.ts`・`post-draft-routes.ts`・`posting-rule-routes.ts`・`needs-review-count-routes.ts`（`GET /api/me/needs-review-counts`） |
| `publish/`（予約と自動投稿） | `posting_schedules`・`publish_attempts` | `posting-schedule-service.ts`・`auto-post-runner.ts`・`auto-post-gate.ts`・`auto-post-status.ts`・`publish-claim.ts`・`publish-executor.ts`・`publish-cleanup.ts`（毎日の片づけ）・`posting-schedule-routes.ts`・`auto-post-routes.ts` |
| `metrics/`（数字の取得・分析） | `post_metrics`・`post_metric_snapshots`・`follower_snapshots`・`analysis_settings`・`post_classifications` | `metrics-runner.ts`・`performance-service.ts`・`analysis-service.ts`・`prompt-service.ts`・`performance-routes.ts`・`analysis-routes.ts`・`prompt-routes.ts` |
| `mention/`（時間差のメンション） | `mention_settings`・`mention_people`・`post_mentions` | `mention-runner.ts`・`mention-service.ts`・`mention-view.ts`・`mention-routes.ts` |
| `external-media/`（外部媒体） | `promotion_listings`・`media_defaults` | `external-media-service.ts`・`external-media-routes.ts` |
| `tester-invites/`（テスター招待） | `tester_applications` | `tester-application-service.ts`・`tester-application-routes.ts`・`operator-tester-invite-routes.ts` |
| `operator/`（運営のアカウント一覧） | — | `operator-account-service.ts`（Threadsの接続とテスター招待を見せるため）・`operator-account-routes.ts` |
| （直下） | — | `index.ts`（入口）・`schema.ts`（25表）・`threads-hooks.ts`（知らせの受け取り。`registerThreads()`） |

共通17表＋Threads25表＝42表（`db/schema.ts`がまとめて出す）。

### 2-3. 窓口（adapters）

| 窓口 | ファイル |
|---|---|
| `adapters/stripe/` | `index.ts`・`stripe-client.ts` |
| `adapters/threads-api/` | `index.ts`・`threads-client.ts`・`signed-request.ts` |

### 2-4. 土台（kernel）

`config.ts`・`env.ts`・`errors.ts`・`logger.ts`・`validate.ts`・`crypto.ts`・`identifier-hash.ts`・`db/client.ts`（DBの接続。表の定義は渡さない）・`db/locks.ts`・`db/columns.ts`（表の定義の共通の部品）

### 2-5. 組み立て（composition）

| ファイル | 役割 |
|---|---|
| `app.ts` | APIの入口の登録。初めに`registerThreads()`を呼ぶ |
| `index.ts` | Workersの入口（`fetch`・`scheduled`）。定期処理の初めに`registerThreads()`を呼ぶ |
| `jobs/daily-jobs.ts` | 毎日の処理（共通の退会のやり直しとThreadsのトークンの更新・片づけなど）。各モジュールの入口の関数を順に呼ぶだけ。初めに`registerThreads()`を呼ぶ |
| `jobs/key-rotation.ts` | 暗号の鍵の入れ替え（`scripts/rotate-token-key.ts`から使う）。共通（チーム・テストのグループの招待のトークン）とThreads（接続のトークン）の両方の表を書き換えるので、組み立てに置く |
| `db/schema.ts` | 共通とThreadsの`schema.ts`を読み直して出すだけ（drizzle-kitとテスト用） |

## 3. 例外：持ち主でないモジュールが書き換えてよい列

ESLintでは列までは止められないので、ここに書いてレビューで確かめる。

| 表（持ち主） | 書き換えてよいモジュール | 列 | 将来 |
|---|---|---|---|
| `accounts`（共通） | Threads | 接続：`threads_user_id`・`username`・`display_name`・`profile_picture_url`・`connection_status`・`connection_method`・`connection_generation`・`reconnect_hint`・`insights_denied_at`・`replies_denied_at` | Threads専用の表へ移す候補 |
| 〃 | Threads | 投稿の長さ：`post_length_target`・`short_length`・`medium_length`・`long_length`・`short_ratio`・`medium_ratio`・`long_ratio` | 〃 |
| 〃 | Threads | CORE RULES：`core_rules`・`core_rules_version`・`core_rules_changed_at`・`core_rules_updated_by_user_id` | 〃 |
| 〃 | Threads | 宣伝の割合：`promotion_ratio_percent`・`promotion_ratio_version`・`promotion_ratio_updated_by_user_id` | 〃 |
| 〃 | Threads | プロンプトの件数：`prompt_post_count`・`prompt_post_count_version`・`prompt_post_count_updated_by_user_id` | 〃 |
| 〃 | Threads | 変わった日時：`promotions_changed_at`・`research_changed_at` | 〃 |
| `operator_settings`（共通） | Threads | `tester_slot_capacity` | Threadsの運営の設定へ移す候補 |

- `accounts`で共通が書き換える列は、`id`・`name`・`last_used_at`・`created_at`・`updated_at`。
- `operator_settings`で共通が書き換える列は、`id`・`default_account_limit`・`default_daily_post_limit`・`updated_at`。

## 4. 境界の例外

ESLintで止められる違反は0件にする。今すぐ直せないものは、ここに理由とともに書く（5件以下）。

| 場所 | 内容 | 理由 | 解消の予定 |
|---|---|---|---|
| `platform/schema.ts` → `apps/threads/schema.ts` | `operator_events.application_id`の外部キーのためだけに、共通の表の定義がThreadsの`tester_applications`を読む（`eslint-disable-next-line`で1か所だけ） | 外部キーを外すと新しいマイグレーションになる（027の範囲外）。参照は遅延（`references(() => …)`）なので、読みこみが循環しても壊れない | 運営の記録をアプリごとに分けるか、外部キーを見直すとき（2作目のあと） |

## 5. 027での並べ替えの記録

- 2026-11-10、027のPR2で、このとおりに並べ替えた。動きは変えていない（テストの数・`db:generate`で変更なし・APIの入口の一覧（`apps/api/test/repo/routes.snapshot.txt`）が同じ）。
- 逆向きの依存の解消：接続の処理（`completeConnection`・`verifyConnection`）と確かめ待ちの件数の入口はThreadsへ移し、残りは1-4の知らせにした。
- DBの接続（`kernel/db/client.ts`）には表の定義を渡さないようにした（`db.query`のリレーションの問い合わせは使っていない。土台が表の定義に依存しないため）。
- 境界の規則は`strictPlacement`を有効にした。

## 6. アプリのモジュールを足す手順

2作目（例：`people`）を足すときの手順。

1. `apps/api/src/apps/<名前>/`を作り、次を置く。
   - `schema.ts`：そのアプリの表。`pgSchema("<名前>")`でアプリ専用のスキーマに置き、共通の表（`platform/schema`）は参照しない。利用者のIDは`user_id`に値として持つ（外部キーなし。[docs/app-separation.md](./app-separation.md) 4）。共通の部品は`../../kernel/db/columns`。
   - 小分けのフォルダー（処理と`*-routes.ts`）。
   - `index.ts`：組み立てが使うもの（APIの入口を作る関数、知らせを受け取るなら`registerXxx()`）だけを出す。
2. 共通は`../../platform`（入口）の関数からだけ使う（今の利用者・利用権など。共通の表は読まない）。共通で起きたこと（退会など）は、同じトランザクションの知らせではなく、出来事としてあとから受け取る。Threadsのモジュールは使わない（ESLintが止める）。
3. `apps/api/src/db/schema.ts`に`export * from "../apps/<名前>/schema";`を足し、`pnpm --filter api db:generate`でマイグレーションを作る。
4. `apps/api/src/app.ts`で、入口のAPIの関数を`.route("/", …)`でつなぐ。APIの道筋は`/api/<名前>/…`にする。知らせを受け取るなら、`registerThreads()`と同じ場所で`registerXxx()`を呼ぶ。
5. 入口を足したら`pnpm --filter api routes:snapshot`で一覧を書き直す。
6. この地図の2章に、表と処理を足す。

- ESLintの規則は、`apps/<名前>/`の形から自動でアプリとして当たる（設定は要らない）。
- `workspaces`・利用権（entitlement）などスイート向けの表は、2作目で本当に共通だった部分を取り出すときに考える（[docs/product-structure.md](./product-structure.md) 7）。

## 7. Webの境界（specs/028）

Webのコード（`apps/web/src`）を、外枠（めぐるの共通の画面の枠）とアプリに分けた。APIの1〜6章と同じ考え方で、種類・入口・依存の向きをESLintで守る。

### 7-1. 4つの種類と依存の向き

| 種類 | 置き場所 | 中身 | 使ってよい相手 |
|---|---|---|---|
| 組み立て | `main.tsx`・`router.tsx`・`app-registry.ts` | 出せるアプリの一覧（`registeredApps`）を作り、外枠の`buildRoutes`に渡してルーターを組む | すべて（外枠とアプリは入口から） |
| アプリ | `apps/<名前>/`（今は`threads`） | アプリの画面・ルート・サイドバーの中身・アプリでだけ使う部品 | 外枠の入口（`shell/index.ts`）・共通の部品。**アプリ同士は使わない** |
| 外枠 | `shell/` | 画面の骨格（サイドバーの枠・アプリの切り替え・ユーザーメニュー・上部バー）・入口の振り分け（`/`）・すべてのアプリ（`/apps`）・共通の設定（`/settings`）・ログインのいらない共通のページ・関所（ログイン・契約・退会・テスト版） | 共通の部品。**アプリは使わない**（アプリの一覧は組み立てから受け取る） |
| 共通の部品 | `components/`・`lib/` | 見た目の部品（`components/ui`）・APIの呼び出し（`lib/api-client.ts`）・書式・保存のエラー・確認のダイアログ・契約の帯など | 共通の部品だけ |

```text
組み立て → アプリ → 外枠の入口 → 共通の部品
組み立て → 外枠 ─────────────→ 共通の部品
```

- 外枠からアプリへは読まない。アプリが外枠に渡すものは`AppModule`（`shell/app-module.ts`）にまとめ、組み立てが一覧にして`buildRoutes(apps)`に渡す。外枠はルートのいちばん外の`AppRegistryProvider`で一覧を配る。
- アプリのサイドバーの中身（頭・中身・下の項目＝`AppSidebar`）は、アプリの画面の枠が`AppShell`の`sidebar`に渡す（Threadsは`ThreadsShell`）。
- 同じ種類の中（外枠の中、同じアプリの中、共通の部品の中）は自由に読んでよい。

### 7-2. 自動のチェック

- ESLintの規則`local/web-module-boundaries`（`eslint-rules/web-module-boundaries.js`）が、`apps/web/src`のすべてのファイルで次を止める：①アプリ同士、②外枠 → アプリ（入口も）、③アプリ → 外枠の入口でないところ、④共通の部品 → 外枠・アプリ・組み立て、⑤外枠・アプリ → 組み立て、⑥組み立て → 入口でないところ、⑦どの種類にも入らない場所のファイル（`strictPlacement`）。
- 読みこみ先は、別名（`@/…`）と相対パスの両方を`src`からのパスに直して判定する。型の宣言（`.d.ts`）は置き場所を問わない。
- 種類はパスの形で決まる。`apps/<名前>/`を作れば、設定を足さなくてもアプリとして当たる。テスト（`apps/web/test`）にはかけない。

### 7-3. 主な置き場所

| モジュール | 主な中身 |
|---|---|
| `shell/` | `app-module.ts`（`AppModule`・`AppRegistryProvider`・`useCurrentApp`・`useEntryAppHome`）・`routes.tsx`（`buildRoutes`）・`layout/`（`AppShell`・サイドバーの枠・`AppSwitcher`・`UserMenu`・`PageHeader`・`EnvBanner`）・`pages/`（入口の振り分け・すべてのアプリ・前のURLの転送・ログイン・利用規約・特定商取引法の表記・テスト用のグループの招待・紹介・見つかりません）・`settings/`（共通の設定）・`guards/`（関所）・`lib/`（`seller-info`・`use-last-app`） |
| `apps/threads/` | `index.ts`（`threadsApp`）・`routes.tsx`・`sidebar/`（アカウントの切り替え・機能の一覧・チーム・`ThreadsShell`）・`pages/`（アカウント・チーム・接続から戻る画面・チームの招待・トークンの作り方・データ削除の確認・運営の「テスター招待」「アカウント一覧」）・`components/`・`lib/`（`paths.ts`・`use-account-access` など） |
| `components/`・`lib/` | `components/ui`・`ApiErrorScreen`・`LoadingSkeleton`・`FeatureUnavailableNotice`・`ConfirmDialog`・`billing/`・`lib/api-client.ts`・`query.ts`・`home-link.ts`・`invite-return.ts`・`referral-store.ts`・`use-logout.ts` など |

### 7-4. URLの決まり

- アプリの画面は、自分のパスの下に置く（Threadsは`/threads/…`）。パスは`@meguru/shared`のアプリの一覧（`APP_CATALOG`）の`basePath`とそろえる。
- 前のURL（`/accounts/…`・`/teams/…`）は、アプリの`legacyRedirects`で`/threads/…`へ転送する（ログインの関所の外。少なくとも次の外枠のfeatureまで残す）。
- ログインのいらないページも、2作目からはアプリのパスの下に置く。

### 7-5. 境界の例外とこれから

- ESLintで止める違反の例外は0件。
- **Threadsの例外（URL）**：Metaに登録した・外部に配ったURL（`/invite/:token`・`/guide/threads-token`・`/data-deletion/:code`）は、Threadsのパスの外に今のまま置く。
- **移す候補**：`lib/api-client.ts`と`lib/query.ts`にThreadsの呼び出しとキーが入っている（Webのテストが`@/lib/api-client`をまるごとモックしているため、028では分けなかった）。2作目の呼び出しは`apps/<名前>/lib/api.ts`に置く。
- **使っているアプリの判定**：`/api/me`の`apps.using`は、共通（`platform/identity/me-routes.ts`）が「開けるアカウントが1件以上ならThreadsを使っている」で決めている。2作目でアプリごとの利用権を足すときに、アプリごとの判定に置き換える。
- **共通のパッケージ**：`@meguru/shared`の中身は分けていない。2作目のものは`packages/shared/src/apps/<名前>/`に置き、`@meguru/shared/<名前>`で読む（`package.json`の`exports`に足す）。今のThreads固有のもの（投稿・戦略・分析など）は移す候補。

### 7-6. Webにアプリを足す手順

1. `packages/shared/src/apps.ts`の`APP_CATALOG`に1行足す（ID・名前・パス・説明・料金・`released: false`）。
2. `apps/web/src/apps/<名前>/`を作り、`index.ts`で`AppModule`を出す（`id`・`basePath`・`icon`・`startPath`・`routes`。ルートは`/<名前>/…`の下）。画面の枠は`AppShell`に自分のサイドバーの中身（`AppSidebar`）を渡す。
3. `apps/web/src/app-registry.ts`の一覧に1行足す（**外枠のほかの場所は直さない**）。
4. APIは6章の手順で`apps/api/src/apps/<名前>/`に足し、`/api/me`の`apps.using`の判定を足す（2作目では利用権と一緒に決め直す）。
5. 業務の判断とデータのやりとりは、APIと`@meguru/shared`に置く。Webの画面やブラウザだけで動く仕組みに閉じこめない（モバイル化を見込んだ決まり。Constitutionの技術スタック制約）。
6. 出してよくなったら`released: true`にする。

## 8. この文書の更新

- モジュール・表・処理を足す・移すときは、同じPRでこの地図を直す。
- 種類・依存の向き・共通とアプリの分担を変えたら、[docs/product-structure.md](./product-structure.md)も直す。
