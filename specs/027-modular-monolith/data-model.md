# データモデル（モジュール地図の下書き）：Threadsアプリをモジュラーモノリスに整理する

**日付**：2026-11-10 | **計画**：[plan.md](./plan.md) | **マイグレーション**：なし（表・列・制約は変えない）

この文書は、実装で`docs/module-map.md`（モジュール地図の正本）にする内容の下書き。種類と依存の向きは[research.md](./research.md) R1、決まりは[contracts/module-boundaries.md](./contracts/module-boundaries.md)。

## 1. 表の持ち主（42表）

### 1-1. 共通（platform）：17表

| 小分け | 表 |
|---|---|
| identity（利用者） | `users`・`withdrawn_users` |
| accounts（運用するアカウントとメンバー） | `accounts`（Threadsの列は例外。1-3）・`memberships` |
| teams（チーム） | `teams`・`team_members`・`team_accounts` |
| billing（契約と決済） | `subscriptions` |
| features（機能のON/OFF） | `feature_disables`・`group_feature_disables`・`feature_setting_events` |
| test-groups（テストのグループ） | `test_groups`・`test_group_members`・`test_group_events` |
| operator（運営と上限） | `operator_settings`（`tester_slot_capacity`は例外。1-3）・`operator_events` |
| activity（活動の記録） | `activity_logs` |

### 1-2. Threads（apps/threads）：25表

| 小分け | 表 |
|---|---|
| connection（接続・トークン・Metaの要求） | `threads_connections`・`token_check_failures`・`oauth_states`・`threads_deletion_requests`・`threads_revocations` |
| strategy（戦略・宣伝・リサーチ） | `strategy_designs`・`promotions`・`reference_posts`・`research_keywords` |
| drafts（投稿の案・確かめる・投稿ルール） | `draft_batches`・`post_drafts`・`ng_words` |
| publish（予約と自動投稿） | `posting_schedules`・`publish_attempts` |
| metrics（数字の取得・分析） | `post_metrics`・`post_metric_snapshots`・`follower_snapshots`・`analysis_settings`・`post_classifications` |
| mention（時間差のメンション） | `mention_settings`・`mention_people`・`post_mentions` |
| external-media（外部媒体） | `promotion_listings`・`media_defaults` |
| tester-invites（テスター招待） | `tester_applications` |

### 1-3. 例外：持ち主でないモジュールが書き換えてよい列

| 表（持ち主） | 書き換えてよいモジュール | 列 | 将来 |
|---|---|---|---|
| `accounts`（共通） | Threads | `threads_user_id`・`username`・`display_name`・`profile_picture_url`・`connection_status`・`connection_method`・`connection_generation`・`reconnect_hint`・`insights_denied_at`・`replies_denied_at`・投稿の長さ（`post_length_target`・`short_length`・`medium_length`・`long_length`・`short_ratio`・`medium_ratio`・`long_ratio`）・CORE RULES（`core_rules`・`core_rules_version`・`core_rules_changed_at`・`core_rules_updated_by_user_id`）・宣伝の割合（`promotion_ratio_percent`・`promotion_ratio_version`・`promotion_ratio_updated_by_user_id`）・プロンプトの件数（`prompt_post_count`・`prompt_post_count_version`・`prompt_post_count_updated_by_user_id`）・`promotions_changed_at`・`research_changed_at` | Threads専用の表へ移す候補 |
| `operator_settings`（共通） | Threads | `tester_slot_capacity` | Threadsの運営の設定へ移す候補 |

- 実装のときに、`schema.ts`の列をもう一度すべて当て、漏れた列があればこの表に足す（共通が書き換える列は`id`・`name`・`created_at`・`updated_at`・`last_used_at`）。

## 2. 処理とAPIの入口の行き先

### 2-1. 土台（kernel）

| 今の場所 | 行き先 |
|---|---|
| `env.ts`・`lib/config.ts`・`lib/errors.ts`・`lib/logger.ts`・`lib/validate.ts`・`lib/crypto.ts`・`lib/identifier-hash.ts` | `kernel/` |
| `db/client.ts`・`db/locks.ts` | `kernel/db/` |

### 2-2. 窓口（adapters）

| 今の場所 | 行き先 |
|---|---|
| `lib/stripe-client.ts` | `adapters/stripe/` |
| `lib/threads-client.ts`・`lib/signed-request.ts` | `adapters/threads-api/` |

### 2-3. 共通（platform）

| 小分け | 処理 | APIの入口 |
|---|---|---|
| identity | `middleware/auth.ts` | `routes/me.ts` |
| access | `services/access.ts` | — |
| accounts | `services/account-service.ts`（作る・名前・消す・数える・上限・最後に開いたアカウントの記録`openAccount`。接続の部分はThreadsへ） | `routes/accounts.ts`（接続の確かめの部分はThreadsへ。research.md R4-1） |
| teams | `services/team-service.ts`・`team-status.ts`・`invite-service.ts` | `routes/teams.ts`・`account-team.ts`・`invites.ts` |
| billing | `services/billing-service.ts` | `routes/billing.ts`・`stripe-webhook.ts` |
| features | `services/feature-service.ts`・`feature-sql.ts` | `routes/operator-features.ts` |
| test-groups | `services/test-group-service.ts` | `routes/operator-test-groups.ts`・`test-invites.ts` |
| operator | `services/limit-service.ts`・`operator-events.ts`・`middleware/operator-only.ts`・`readOperatorSettings` | `routes/operator-limits.ts` |
| referrals | `services/referral-service.ts` | `routes/referrals.ts` |
| activity | `services/activity-log.ts` | `routes/activity.ts` |
| withdrawal | `services/withdrawal-service.ts` | （`routes/me.ts`の退会） |
| hooks | 知らせの登録の仕組み（新規。research.md R4） | — |

### 2-4. Threads（apps/threads）

| 小分け | 処理 | APIの入口 |
|---|---|---|
| connection | `threads-oauth.ts`・`token-connect.ts`・`token-recheck.ts`・`token-refresh.ts`・`username-match.ts`・`threads-credentials.ts`・`revocation.ts`・`threads-check-service.ts`・`data-deletion.ts`・`key-rotation.ts`・`account-service`の接続の部分 | `threads-connect.ts`・`threads-webhooks.ts`・`threads-check.ts`・`data-deletion.ts` |
| strategy | `strategy-service.ts`・`profile-status.ts`・`materials.ts`・`item-service.ts` | `strategy.ts`・`promotions.ts`・`research.ts` |
| drafts | `draft-service.ts`・`review-service.ts`・`posting-rules-service.ts`・`account-review-counts.ts` | `post-drafts.ts`・`posting-rules.ts` |
| publish | `posting-schedule-service.ts`・`auto-post-runner.ts`・`auto-post-gate.ts`・`auto-post-status.ts`・`publish-claim.ts`・`publish-executor.ts` | `posting-schedule.ts`・`auto-post.ts` |
| metrics | `metrics-runner.ts`・`performance-service.ts`・`analysis-service.ts`・`prompt-service.ts` | `performance.ts`・`analysis.ts`・`prompt.ts` |
| mention | `mention-runner.ts`・`mention-service.ts`・`mention-view.ts` | `mention.ts` |
| external-media | `external-media.ts` | `external-media.ts` |
| tester-invites | `tester-application-service.ts` | `tester-applications.ts`・`operator-tester-invites.ts` |
| operator | `operator-account-service.ts`（Threadsの接続とテスター招待を見せるため） | `operator-accounts.ts` |

### 2-5. 組み立て（composition）

| 今の場所 | 行き先 |
|---|---|
| `app.ts`・`index.ts` | そのまま（入口の登録と`registerThreads()`） |
| `services/daily-jobs.ts` | `jobs/daily-jobs.ts`（共通とThreadsの両方の定期処理を呼ぶ） |
| `db/schema.ts` | 共通とThreadsの`schema.ts`を読み直して出すだけ（drizzle-kitとテスト用） |

## 3. 知らせ（共通 → アプリ）

| 名前 | 出すところ | Threadsでの受け取り | トランザクション |
|---|---|---|---|
| `accountDeleting` | `deleteAccount` | `withdrawForAccountDeletion` | 同じ`tx` |
| `userWithdrawing` | `withdrawal-service` | `purgeForWithdrawal`と、データ削除の要求の表の更新 | 同じ`tx` |
| `limitsChanged` | `limit-service`の保存のあと | `notifyWake` | なし（今と同じく保存のあと） |
| `accountSummaryExtras` | `/api/me`の一覧づくり | 確かめ待ちの件数（`countOwnedAccountNeedsReview`） | なし（読むだけ） |

## 4. 境界の例外（並べ替えのあとに残るもの）

| 場所 | 内容 | 理由 | 解消の予定 |
|---|---|---|---|
| `accounts`・`operator_settings`の列 | 1-3のとおり | 表を分けると新しいマイグレーションになる | 2作目のときに見直す |

- ESLintで止められる違反は0件にする（spec SC-002）。上の例外は列の書き換えの約束で、ESLintの対象ではない。
