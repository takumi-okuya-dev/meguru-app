# モジュール地図（API）

**作成**：2026-11-10（specs/027-modular-monolith） | **対象**：`apps/api/src`

APIのコードを、どのモジュールが持つかを決めた地図。表の持ち主・入口・依存の向き・例外を、ここを正本として管理する。プロダクト全体の形は[docs/product-structure.md](./product-structure.md)、構想の正本は personal-knowledge-base の`Wiki/仕事/システム開発/アイデア/個人開発版Google Workspace構想（スイート型SaaS）.md`。

> **今の状態**：地図と境界の規則（ESLint）はできている。コードの並べ替え（2章の「行き先」への移動）は、027の後半（PR2）で行う。並べ替えが終わるまで、2章の「今の場所」が実際の場所。

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

- 入口（`index.ts`）は、**共通全体（`platform/index.ts`）・アプリごと（`apps/<名前>/index.ts`）・窓口ごと（`adapters/<名前>/index.ts`）**に1つ。
- ほかのモジュールからは入口だけを読む（`../../platform`・`../../adapters/stripe`）。土台は入口なしで、ファイルを直接読んでよい。
- 同じモジュールの中（`platform/`の小分け同士、`apps/threads/`の小分け同士）は自由に読んでよい。共通の中の区切りは、2作目で本当に共通だった部分を取り出すときに見直す。

### 1-3. データの持ち主

- 表には持ち主のモジュールが1つある（2章）。表の定義は持ち主の`schema.ts`に置き、入口から出す。
- 持ち主でないモジュールは、表を読むことはできるが、書き換えてよいのは3章の例外の列だけ。
- アプリの表が共通の表（`users`・`accounts`）を参照するのはよい。共通の表からアプリの表は参照しない。

### 1-4. 知らせ（共通 → アプリ）

共通の処理の途中でアプリの処理を呼ぶ必要があるときは、共通が知らせを出し、アプリが受け取る（`platform/hooks.ts`）。受け取る関数は、組み立てでアプリの`registerXxx()`を1回呼んで登録する。今の呼び出しと同じ場所・同じ順番・同じトランザクションで`await`する。

| 知らせ | 出すところ | Threadsでの受け取り |
|---|---|---|
| `accountDeleting` | アカウントを消す前（`deleteAccount`） | テスター招待の取り下げ（`withdrawForAccountDeletion`） |
| `userWithdrawing` | 退会する前（`withdrawal-service`） | テスター招待の片づけ（`purgeForWithdrawal`）と、Metaのデータ削除の要求の表の更新 |
| `limitsChanged` | 上限を保存したあと（`limit-service`） | 自動投稿を起こす（`notifyWake`） |
| `accountSummaryExtras` | `/api/me`のアカウントの一覧づくり | 確かめ待ちの件数（`countOwnedAccountNeedsReview`） |

### 1-5. 自動のチェック

- ESLintの規則`local/module-boundaries`（`eslint-rules/module-boundaries.js`）が、`apps/api/src`のすべてのファイルで次を止める：①ほかのモジュールの入口でないところ、②共通 → アプリ、③アプリ同士、④窓口・土台から上。
- `pnpm lint`（CIの「lint・型チェック・共通とWeb」）で流れる。規則のテストは`node --test "eslint-rules/*.test.js"`。
- 種類はパスの形で決まる。`src/apps/<名前>/`を作れば、設定を足さなくてもアプリとして当たる。テスト（`apps/api/test`）と`scripts/`にはかけない。

## 2. 表・処理・APIの入口の持ち主

### 2-1. 共通（platform）

| 小分け | 表 | 処理（今の場所 → 行き先） | APIの入口（今の場所） |
|---|---|---|---|
| identity（利用者） | `users`・`withdrawn_users` | `middleware/auth.ts` | `routes/me.ts` |
| access（権限） | — | `services/access.ts` | — |
| accounts（運用するアカウントとメンバー） | `accounts`（3章の例外あり）・`memberships` | `services/account-service.ts`（作る・名前・消す・数える・上限・`openAccount`。接続の部分はThreadsへ） | `routes/accounts.ts`（接続の確かめの部分はThreadsへ） |
| teams（チーム・招待） | `teams`・`team_members`・`team_accounts` | `services/team-service.ts`・`team-status.ts`・`invite-service.ts` | `routes/teams.ts`・`account-team.ts`・`invites.ts` |
| billing（契約と決済） | `subscriptions` | `services/billing-service.ts` | `routes/billing.ts`・`stripe-webhook.ts` |
| features（機能のON/OFF） | `feature_disables`・`group_feature_disables`・`feature_setting_events` | `services/feature-service.ts`・`feature-sql.ts` | `routes/operator-features.ts` |
| test-groups（テストのグループ） | `test_groups`・`test_group_members`・`test_group_events` | `services/test-group-service.ts` | `routes/operator-test-groups.ts`・`test-invites.ts` |
| operator（運営と上限） | `operator_settings`（3章の例外あり）・`operator_events` | `services/limit-service.ts`・`operator-events.ts`・`middleware/operator-only.ts`、`readOperatorSettings`（今は`tester-application-service.ts`の中） | `routes/operator-limits.ts` |
| referrals（紹介） | — | `services/referral-service.ts` | `routes/referrals.ts` |
| activity（活動の記録） | `activity_logs` | `services/activity-log.ts` | `routes/activity.ts` |
| withdrawal（退会） | — | `services/withdrawal-service.ts` | （`routes/me.ts`の退会） |
| hooks（知らせ） | — | `platform/hooks.ts`（新規） | — |

共通の表：17。

### 2-2. Threads（apps/threads）

| 小分け | 表 | 処理（今の場所） | APIの入口（今の場所） |
|---|---|---|---|
| connection（接続・トークン・Metaの要求） | `threads_connections`・`token_check_failures`・`oauth_states`・`threads_deletion_requests`・`threads_revocations` | `services/threads-oauth.ts`・`token-connect.ts`・`token-recheck.ts`・`token-refresh.ts`・`username-match.ts`・`threads-credentials.ts`・`revocation.ts`・`threads-check-service.ts`・`data-deletion.ts`・`key-rotation.ts`、`account-service.ts`の接続の部分（`completeConnection`・`verifyConnection`など） | `routes/threads-connect.ts`・`threads-webhooks.ts`・`threads-check.ts`・`data-deletion.ts`、`routes/accounts.ts`の接続の確かめ |
| strategy（戦略・宣伝・リサーチ） | `strategy_designs`・`promotions`・`reference_posts`・`research_keywords` | `services/strategy-service.ts`・`profile-status.ts`・`materials.ts`・`item-service.ts` | `routes/strategy.ts`・`promotions.ts`・`research.ts` |
| drafts（投稿の案・確かめる・投稿ルール） | `draft_batches`・`post_drafts`・`ng_words` | `services/draft-service.ts`・`review-service.ts`・`posting-rules-service.ts`・`account-review-counts.ts` | `routes/post-drafts.ts`・`posting-rules.ts` |
| publish（予約と自動投稿） | `posting_schedules`・`publish_attempts` | `services/posting-schedule-service.ts`・`auto-post-runner.ts`・`auto-post-gate.ts`・`auto-post-status.ts`・`publish-claim.ts`・`publish-executor.ts` | `routes/posting-schedule.ts`・`auto-post.ts` |
| metrics（数字の取得・分析） | `post_metrics`・`post_metric_snapshots`・`follower_snapshots`・`analysis_settings`・`post_classifications` | `services/metrics-runner.ts`・`performance-service.ts`・`analysis-service.ts`・`prompt-service.ts` | `routes/performance.ts`・`analysis.ts`・`prompt.ts` |
| mention（時間差のメンション） | `mention_settings`・`mention_people`・`post_mentions` | `services/mention-runner.ts`・`mention-service.ts`・`mention-view.ts` | `routes/mention.ts` |
| external-media（外部媒体） | `promotion_listings`・`media_defaults` | `services/external-media.ts` | `routes/external-media.ts` |
| tester-invites（テスター招待） | `tester_applications` | `services/tester-application-service.ts` | `routes/tester-applications.ts`・`operator-tester-invites.ts` |
| operator（運営のアカウント一覧） | — | `services/operator-account-service.ts`（Threadsの接続とテスター招待を見せるため） | `routes/operator-accounts.ts` |

Threadsの表：25。共通と合わせて42表（`db/schema.ts`の`pgTable`の数と同じ）。

### 2-3. 窓口（adapters）

| 窓口 | 今の場所 |
|---|---|
| `adapters/stripe/` | `lib/stripe-client.ts` |
| `adapters/threads-api/` | `lib/threads-client.ts`・`lib/signed-request.ts` |

### 2-4. 土台（kernel）

| 今の場所 | 行き先 |
|---|---|
| `env.ts`・`lib/config.ts`・`lib/errors.ts`・`lib/logger.ts`・`lib/validate.ts`・`lib/crypto.ts`・`lib/identifier-hash.ts` | `kernel/` |
| `db/client.ts`・`db/locks.ts` | `kernel/db/` |

### 2-5. 組み立て（composition）

| 今の場所 | 行き先・役割 |
|---|---|
| `app.ts`・`index.ts` | そのまま。APIの入口の登録、定期処理の振り分け、`registerThreads()`の呼び出し |
| `services/daily-jobs.ts` | `jobs/daily-jobs.ts`（共通とThreadsの両方の毎日の処理を呼ぶ） |
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
| （なし） | | | |

## 5. 並べ替えで直すこと（027 PR2）

- **逆向きの依存**：共通にすべき処理がThreadsを呼んでいる5か所（接続の処理・アカウントの削除・退会・上限・`/api/me`の件数）。接続の処理はThreadsへ移し、残りは1-4の知らせにする。
- **Honoの型**：`AppEnv`（`app.ts`）と`AuthVariables`（`middleware/auth.ts`）は、共通とThreadsのAPIの入口の両方が使う。共通（`platform/`）に置き、`app.ts`はそれを読み直して使う（共通のAPIの入口が組み立ての`app.ts`を読むと、下から上への依存になるため）。

## 6. アプリのモジュールを足す手順

（027の後半で、並べ替えのあとの形に合わせて書く。）

## 7. この文書の更新

- モジュール・表・処理を足す・移すときは、同じPRでこの地図を直す。
- 種類・依存の向き・共通とアプリの分担を変えたら、[docs/product-structure.md](./product-structure.md)も直す。
