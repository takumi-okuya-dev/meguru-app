---
description: "スケジュール投稿・自動投稿の実装タスク"
---

# タスク（Tasks）：スケジュール投稿・自動投稿

**入力**：`specs/005-auto-post/`の設計文書

**前提**：
- [plan.md](./plan.md)、[spec.md](./spec.md)、[research.md](./research.md)、[data-model.md](./data-model.md)
- [contracts/api.md](./contracts/api.md)、[contracts/auto-post-job.md](./contracts/auto-post-job.md)、[contracts/prompt-template.md](./contracts/prompt-template.md)、[contracts/ui-routes.md](./contracts/ui-routes.md)
- [quickstart.md](./quickstart.md)、[docs/ui-design.md](../../docs/ui-design.md)、[docs/cost-estimate.md](../../docs/cost-estimate.md)、004の[contracts](../004-review-approval/contracts/)

**テスト**：quickstart.mdの「自動テスト」の表にあるテストを、該当するフェーズで先に書く（失敗することを確認してから実装する）。

**構成**：ユーザーストーリーごとにフェーズを分け、各ストーリーを単独で実装・テストできるようにする。

## 書式：`[ID] [P?] [Story] 説明`

- **[P]**：並行して進められる（別ファイルで、未完了のタスクに依存しない）
- **[Story]**：対応するユーザーストーリー（US1〜US5）
- 説明には、変更するファイルのパスを含める

## パスの規約（plan.mdの構成）

- API：`apps/api/src/`、テストは`apps/api/test/`
- Web：`apps/web/src/`、テストは`apps/web/test/`
- 共通：`packages/shared/src/`、テストは`packages/shared/test/`

## 001〜004から使い回す部品

- **API**：
  - `findOwnedAccount`（`apps/api/src/services/access.ts`）
  - `parseBody`（`apps/api/src/lib/validate.ts`）、`AppError`・`itemNotFound`・`notFound`・`pgErrorCode`（`apps/api/src/lib/errors.ts`）
  - `updateWithVersion`（`apps/api/src/services/item-service.ts`）
  - `withTransaction`・`createDb`（`apps/api/src/db/client.ts`）、`lockAccountDrafts`（`apps/api/src/db/locks.ts`）
  - `toPostDraft`・`countDrafts`・`listAllDrafts`・`updateDraft`（`apps/api/src/services/draft-service.ts`）
  - `reviewDrafts`（`apps/api/src/services/review-service.ts`）、`listNgWords`・`addNgWords`（`apps/api/src/services/posting-rules-service.ts`）
  - `createTokenCipher`（`apps/api/src/lib/crypto.ts`）、`ThreadsAuthError`・`ThreadsApiError`・`createThreadsClient`（`apps/api/src/lib/threads-client.ts`）
  - 要再接続にするときの世代番号の条件（`apps/api/src/services/token-refresh.ts`の`markNeedsReconnect`と同じ書き方）
  - テストの`createUserWithAccount`・`setAccount`・`AFTER_TRIAL`・`resetDb`・`db`・`fake`（`apps/api/test/helpers/app.ts`）
- **Web**：
  - `PageHeader`、`useUnsavedChanges`、`FormDialogFrame`、`ConflictDialog`、`SettingRow`
  - 004の`StatusTabs`・`DraftList`・`DraftCard`・`DraftLabels`・`use-review.ts`・`messages.ts`、`formatDateTime`（`apps/web/src/lib/format.ts`）
  - `queryKeys.postDrafts`・`queryKeys.draftCounts`（`apps/web/src/lib/query.ts`）
- **共通**：`checkPublishable`（`packages/shared/src/review.ts`）、`buildPrompt`（`packages/shared/src/prompt.ts`）、`errorMessage`（`packages/shared/src/errors.ts`）

---

## Phase 1：セットアップ

**目的**：新しい依存とバインディングを足す。

- [ ] T001 [P] shadcn/uiの`Switch`を足す。
  - `apps/web/package.json`に`@radix-ui/react-switch`を足す（`pnpm --filter web add @radix-ui/react-switch`）。
  - `apps/web/src/components/ui/switch.tsx`を、shadcn/uiの`Switch`の標準の実装で作る（既存の`ui/tabs.tsx`と同じ書き方）。
- [ ] T002 [P] KVのバインディングとCronを足す（research.md R3、contracts/api.md「環境変数・バインディング」）。
  - `apps/api/wrangler.toml`：
    - `[triggers] crons = ["0 18 * * *", "*/5 * * * *"]`
    - `[[kv_namespaces]] binding = "AUTOPOST_KV"`。`id`は本番のKV namespaceのIDを入れる欄としてコメントで案内し、ローカルは`wrangler dev`のメモリ上のKVを使う。
  - `apps/api/src/env.ts`：`AUTOPOST_KV: KVNamespace`を足す。
  - `apps/api/src/lib/config.ts`：`validateConfig`に、`AUTOPOST_KV`がないときは項目名`AUTOPOST_KV`を返す確認を足す。`apps/api/test/unit/config.test.ts`に、その場合のテストを足す。
  - `apps/api/vitest.config.ts`：2つのプロジェクトの`miniflare`に`kvNamespaces: ["AUTOPOST_KV"]`を足す。
  - `docs/external-services-setup.md`：KV namespaceの作成（`wrangler kv namespace create AUTOPOST_KV`）と、`wrangler.toml`への`id`の記入を、Cloudflareの節に足す。

---

## Phase 2：基盤（すべてのユーザーストーリーの前提）

**目的**：次のものを用意し、004の画面が新しい一覧の形のまま動く状態にする。
- 共通の計算（時刻・予定・投稿の順）・上限・スキーマ
- DBのマイグレーション
- 偽のThreadsサーバーとThreadsの投稿の呼び出し
- 一覧のAPIの新しい形（投稿の順・件数）

**⚠️ このフェーズが終わるまで、ユーザーストーリーの作業は始めない**

### 共通パッケージ

- [ ] T003 [P] 共通の計算のテストを書く（失敗を確認する）。
  - `packages/shared/test/schedule.test.ts`：
    - `timeToMinutes("07:30") === 450`、`minutesToTime(450) === "07:30"`。`"24:00"`・`"7:30"`・`"07:60"`は不正
    - `validatePostingSchedule`：quickstart.mdの表の「設定の検証」の行。理由は`too_many`（11件）・`duplicate`・`too_close`（ずらすがオンで29分の間）・`required`（オンで0件）。ずらすがオフなら29分の間は通る。23:50と0:10の間（日付をまたぐ）は数えない
    - `jstDateOf(date)`：UTCの2026-10-05T15:00:00Zが日本時間の`"2026-10-06"`になる
    - `plannedSlotTime(accountId, jstDate, slotMinute, jitter)`：
      - ずらすがオフなら、ちょうどその時刻（日本時間）
      - 同じ入力で毎回同じ値。`accountId`・日付が違えば、ふつうは違う値
      - ±600秒の中。0:05と23:55でも、その日の0:00:00〜23:59:59に収まる
      - 30分あけた2つの時刻で、ずらした後も順番が入れ替わらない（1,000通りの`accountId`で確かめる）
    - `projectSchedule`：quickstart.mdの表の「予定の計算」の行（7:30・12:00・21:00、今10:00、5件で「今日12:00・今日21:00・明日7:30・明日12:00・明日21:00」）。あわせて次も確かめる。
      - 今日すでに使った時刻（試みの行がある時刻）は飛ばす
      - `effective_from`より前の予定は飛ばす
      - `paused_until`より前の予定は飛ばす
      - 今日の投稿済みの件数が時刻の数に達していれば、今日の残りは飛ばす
      - オフ・時刻0件なら空
    - `isLateNightSlot(minutes)`：119・300は`false`、120・299は`true`（FR-001b）
  - `packages/shared/test/queue.test.ts`：`compareQueueOrder`が、持ち越し（`carryover: true`）→ `prioritizedAt`の新しい順 → `reviewedAt`の古い順 → `id`の順に並べること（FR-005・FR-005a、research.md R4）。
- [ ] T004 [P] `packages/shared/src/limits.ts`に定数を足す（contracts/auto-post-job.md「定数」）。
  - `AUTOPOST_SLOT_LIMIT = 10`、`AUTOPOST_MIN_GAP_MINUTES = 30`、`AUTOPOST_JITTER_SECONDS = 600`
  - `AUTOPOST_LATE_WINDOW_MINUTES = 60`、`AUTOPOST_RETRY_MAX = 3`、`AUTOPOST_RETRY_DELAYS_MINUTES = [5, 10, 15]`
  - `AUTOPOST_DAILY_API_LIMIT = 250`、`AUTOPOST_MAX_PER_TICK = 4`、`AUTOPOST_LEASE_SECONDS = 120`
  - `AUTOPOST_GATE_MAX_SLEEP_MINUTES = 1440`、`AUTOPOST_LATE_WARN_MINUTES = 10`、`AUTOPOST_FIND_PUBLISHED_HOURS = 24`
  - `LATE_NIGHT_HINT_MINUTES = [120, 300] as const`（2:00〜4:59。終わりは含まない）
  - `PUBLISHED_PAGE_SIZE = 50`、`AUTOPOST_ATTEMPT_RETENTION_DAYS = 30`
- [ ] T005 `packages/shared/src/schedule.ts`を作り、`packages/shared/src/index.ts`から公開する（research.md R1・R2・R9）。T003の`schedule.test.ts`を通す。
  - `timeToMinutes`・`minutesToTime`（`"HH:MM"`、00:00〜23:59）
  - `validatePostingSchedule({ enabled, slotTimes, jitter }): { ok: true; slotMinutes: number[] } | { ok: false; reason: "too_many" | "duplicate" | "too_close" | "required"; times?: string[] }`。`slotMinutes`は昇順。`too_close`は該当する2つの時刻を`times`に入れる
  - 日本時間：`JST_OFFSET_MS = 9 * 3600_000`、`jstDateOf(date): string`（`YYYY-MM-DD`）、`jstMidnight(jstDate): Date`、`addDays(jstDate, n)`
  - `plannedSlotTime(accountId, jstDate, slotMinute, jitter): Date`：FNV-1a 32bitで`${accountId}:${jstDate}:${slotMinute}`をハッシュし、`hash % 1201 - 600`秒をずらす。日の範囲（0:00:00〜23:59:59）に収める。ずらすがオフなら0秒
  - `projectSchedule(input): Date[]`：入力は`{ accountId, enabled, slotMinutes, jitter, effectiveFrom, pausedUntil, now, usedSlotTimesToday: Date[], publishedToday: number, count }`。今より後の予定を、早い順に最大`count`件返す。予定は`effectiveFrom`より後・`pausedUntil`以降に限る。今日は「時刻の数 − 今日の投稿済み」件までにする
  - `isLateNightSlot(minutes): boolean`
- [ ] T006 [P] `packages/shared/src/queue.ts`を作り、`index.ts`から公開する。`compareQueueOrder(a, b)`（入力は`{ id, carryover, prioritizedAt, reviewedAt }`）。T003の`queue.test.ts`を通す。
- [ ] T007 `packages/shared/src/schemas.ts`を変える（contracts/api.md「型」）。
  - `postDraftStatusSchema`に`"publishing"`・`"published"`・`"publish_failed"`を足す。
  - `publishErrorSchema = z.enum(["network", "threads_server", "invalid_request", "container_error", "unknown"])`、`blockedReasonSchema = z.enum(["ng_word", "over_threads_limit"])`
  - `postDraftSchema`に足す：`prioritizedAt`・`publishedAt`・`threadsMediaId`・`threadsPermalink`・`publishFailedAt`（いずれも`string | null`）、`carryover: boolean`、`publishError: publishErrorSchema.nullable()`、`blockedAt: string | null`、`blockedReason: blockedReasonSchema.nullable()`、`blockedWords: string[]`
  - `draftCountsSchema`に`published`・`publishFailed`を足す。
  - `postDraftListSchema`：`publishFailed: PostDraft[]`、`schedule: Record<string, string>`、`autoPost: autoPostStateSchema`を足す（投稿済みは入れない。research.md R14）。
  - `autoPostStateSchema = { enabled, slotCount, stoppedReason: "needs_reconnect" | "rate_limited" | null }`
  - `postingScheduleSchema = { enabled, slotTimes: string[], jitter, version }`、`putPostingScheduleRequestSchema = { enabled, slotTimes, jitter, expectedVersion }`（`slotTimes`の各要素は`/^([01]\d|2[0-3]):[0-5]\d$/`）
  - `postingScheduleResponseSchema = { schedule, limits: { slots, minGapMinutes, jitterMinutes } }`
  - `autoPostNoticeSchema`（`kind`で分ける5種類。contracts/api.md）、`autoPostStatusSchema = { autoPost, next: { at, draft: { id, excerpt } } | null, approvedCount, daysLeft: number | null, notices }`
  - `publishedPostSchema = { id, body, publishedAt, threadsMediaId, threadsPermalink }`、`publishedPageSchema = { items, nextCursor: string | null }`
  - `prioritizeRequestSchema = { expectedVersion }`
  - `reviewRequestSchema`の`action`に`"requeue"`を足す（`reject`以外は却下理由なし。004の`refine`をそのまま広げる）。
  - `skipReasonSchema`に`"PUBLISHING"`を足す。
  - `promptSummarySchema`に`dailyPostCount`を足す。
- [ ] T008 [P] `packages/shared/src/errors.ts`を変える（contracts/ui-routes.md「エラー・失敗の文言」）。
  - `ERROR_CODES`に`DRAFT_PUBLISHING`を足し、`errorMessage`で「投稿の処理中です。少し待ってからもう一度お試しください。」を返す。
  - `ERROR_CODES`に`THREADS_NOT_READY`を足す。`errorMessage`は`details`の`needs_reconnect`・`no_publish_permission`ごとに、contracts/ui-routes.md「接続を確かめる」の表の文言を返す。
  - `PUBLISH_ERROR_LABELS: Record<PublishError, string>`（`network`「Threadsとの通信に失敗しました」など5つ）
  - `blockedReasonLabel(reason, words)`：`ng_word`は「NGワード（{言葉}、…）」、`over_threads_limit`は「Threadsの上限を超える本文」
  - `LATE_NIGHT_HINT = "深夜の時間帯です。見られにくい可能性があります"`

### DB

- [ ] T009 `apps/api/src/db/schema.ts`を変える（data-model.md）。
  - `postDraftStatus`の値：`["needs_review", "approved", "rejected", "publishing", "published", "publish_failed"]`
  - `publishAttemptState = pgEnum("publish_attempt_state", ["in_progress", "retry_wait", "succeeded", "carried_over", "failed", "skipped"])`
  - `postingSchedules`：data-model.mdの表のとおり。`account_id`はPKかつ`accounts.id`へのFK（CASCADE）、`enabled` boolean NOT NULL 既定false、`slot_minutes` smallint[] NOT NULL 既定`{}`、`jitter` boolean NOT NULL 既定true、`effective_from` timestamptz(6) NOT NULL 既定now()、`paused_until` timestamptz NULL可、`blocked_notice_seen_at` timestamptz(6) NULL可、`version` integer NOT NULL 既定1、`created_at`・`updated_at`。
    - CHECK：`cardinality(slot_minutes) <= 10`、`0 <= ALL(slot_minutes) AND 1439 >= ALL(slot_minutes)`、`NOT enabled OR cardinality(slot_minutes) >= 1`
    - インデックス：`(enabled) WHERE enabled`
  - `publishAttempts`：data-model.mdの表のとおり。`account_id`（CASCADE）、`slot_at` timestamptz NOT NULL、`slot_date` date NOT NULL、`slot_minute` smallint NOT NULL（0〜1439）、`draft_id`（`post_drafts.id`へのFK、SET NULL）、`is_carryover` boolean NOT NULL 既定false、`state`、`skip_reason` text、`retry_count` smallint NOT NULL 既定0（0〜3）、`next_retry_at`、`container_id` text、`publish_requested_at` timestamptz(6)、`last_error` text、`lease_until` timestamptz、`created_at`・`updated_at` timestamptz(6)。
    - 一意：`(account_id, slot_at)`
    - CHECK：
      - `state = 'skipped'`なら`skip_reason`があり`draft_id`がNULL。それ以外は`skip_reason`がNULL
      - `skip_reason`は`no_drafts`・`needs_reconnect`・`rate_limited`・`daily_limit`・`auto_post_off`のどれか
      - `last_error`は`network`・`threads_server`・`invalid_request`・`container_error`・`unknown`のどれか
      - `state = 'retry_wait'`なら`next_retry_at`がある
      - `state IN ('in_progress', 'retry_wait')`なら`draft_id`がある
    - インデックス：`(state, next_retry_at) WHERE state IN ('in_progress', 'retry_wait')`、`(account_id, slot_date)`
  - `postDrafts`に列を足す：`prioritized_at` timestamptz(6)、`carryover_attempt_id` uuid（`publish_attempts.id`へのFK、SET NULL）、`published_at` timestamptz(6)、`threads_media_id` text、`threads_permalink` text（`char_length <= 2000`）、`publish_failed_at` timestamptz(6)、`publish_error` text（上の5つの値のどれか）、`blocked_at` timestamptz(6)、`blocked_reason` text（`ng_word`・`over_threads_limit`のどれか）、`blocked_words` text[]。すべてNULL可。
  - CHECK制約`post_drafts_review_state`を、data-model.mdの「状態と記録の組み合わせ」の表のとおりに置き換える。`status::text`で比べ、NULLとの比較は`coalesce`で真か偽にする（004と同じ）。
  - CHECK制約`post_drafts_blocked_state`を足す：`blocked_*`は`needs_review`のときだけ。`blocked_at`と`blocked_reason`は両方あるか両方ないか。
  - CHECK：`threads_media_id`・`threads_permalink`は`published`のときだけ入れてよい。
  - インデックス：`(account_id, status, prioritized_at DESC NULLS LAST, reviewed_at, id)`、`(account_id, published_at DESC, id) WHERE status = 'published'`
- [ ] T010 マイグレーションを作る（data-model.md「マイグレーション」）。
  - `pnpm --filter api db:generate`で作り、2つに分ける。
    - `apps/api/drizzle/0005_auto_post_enum.sql`：`ALTER TYPE post_draft_status ADD VALUE`の3つだけ
    - `apps/api/drizzle/0006_auto_post.sql`：残りすべて（列挙型・テーブル・列・CHECK制約の置き換え・インデックス）
  - `apps/api/drizzle/meta/_journal.json`とスナップショットを、2つに合わせて直す。
  - 空のDBへの適用と、004の状態のDB（既存の下書きあり）への適用の両方が通ることを、`pnpm --filter api db:migrate`で確かめる。

### Threads APIと偽のThreadsサーバー

- [ ] T011 [P] 偽のThreadsサーバーに投稿の機能を足す（contracts/api.md「Threads APIの呼び出し」）。`apps/api/test/fake-threads/server.ts`
  - `POST /v1.0/:userId/threads`（`media_type=TEXT`・`text`）：コンテナーを作り`{ id }`を返す。状態は`FINISHED`
  - `POST /v1.0/:userId/threads_publish`（`creation_id`）：
    - `FINISHED`のコンテナーなら投稿を作り、コンテナーを`PUBLISHED`にして、`{ id: mediaId }`を返す
    - `PUBLISHED`のコンテナーへの2回目は、エラー（コード100、HTTP 400）
  - `GET /v1.0/:id?fields=status,...`：コンテナーなら`{ id, status }`、投稿なら`{ id, permalink, timestamp, text }`
  - `GET /v1.0/:userId/threads?fields=...&since=...`：投稿の新しい順
  - `GET /v1.0/:userId/threads_publishing_limit?fields=quota_usage,config`：`{ data: [{ quota_usage, config: { quota_total: 250, quota_duration: 86400 } }] }`（`quota_usage`は直近24時間に作った投稿の数）
  - トークンの確認は既存の`tokenUser`を使う（無効なら認証エラー）。
  - 制御用：
    - `POST /__control/publish-failures` `{ endpoint: "createContainer" | "publish" | "containerStatus" | "getMedia" | "publishingLimit", kind: "transient" | "auth" | "rate_limit" | "invalid", times }`。`transient`はHTTP 500・コード2、`auth`はコード190、`rate_limit`はコード4（HTTP 400）、`invalid`はコード100（HTTP 400）
    - `POST /__control/drop-publish-response` `{ times }`：公開は済ませ、応答はHTTP 502にする
    - `POST /__control/container-status` `{ containerId, status }`：状態を上書きする（`IN_PROGRESS`・`ERROR`・`EXPIRED`の確認用）
    - `GET /__control/posts`：作った投稿の一覧（本文・ユーザー・コンテナー）
    - `POST /__control/publish-permission` `{ userId, granted }`：`granted: false`のユーザーは、`threads`・`threads_publish`・`threads_publishing_limit`がコード10（HTTP 403）になる（投稿の権限がない状態）
    - `/__control/reset`で、投稿・コンテナー・失敗の注入も消す
- [ ] T012 [P] Threadsの投稿の呼び出しのテストを書く（失敗を確認する）。`apps/api/test/integration/threads-publish-client.test.ts`
  - 6つの呼び出し（`getPublishingLimit`を含む）の正常系
  - 失敗の分類（research.md R7）：コード190 → `ThreadsAuthError`、コード4 → `ThreadsRateLimitError`、HTTP 500・コード2・通信の失敗 → `ThreadsTransientError`、コード100・コード10（権限なし）→ `ThreadsApiError`
  - 10秒のタイムアウトで`ThreadsTransientError`になる（`fetchImpl`を差し替えて確かめる）
  - エラーのメッセージに、Threadsの応答の本文が入らないこと
- [ ] T013 `apps/api/src/lib/threads-client.ts`に投稿の呼び出しを足す。T012を通す。
  - `ThreadsRateLimitError`・`ThreadsTransientError`を足す。`parseOrThrow`で、コード4・17・32・613を上限、HTTP 5xx・コード1・2を一時的に分ける。`fetch`自体の失敗とタイムアウトは`ThreadsTransientError`にする。
  - `ThreadsClient`に`createTextContainer`・`publishContainer`・`getContainerStatus`・`getMedia`・`getPublishingLimit`（`data[0].quota_usage`・`data[0].config.quota_total`を返す）・`listRecentThreads`を足す（contracts/api.mdの表）。どれも`Authorization: Bearer`で、`AbortSignal.timeout(10_000)`を付ける。
  - `error_message`はログに出すだけで、戻り値・エラーには入れない。

### 一覧のAPIの新しい形

- [ ] T014 一覧・件数のテストを、新しい形に合わせて直す（失敗を確認する）。`apps/api/test/integration/post-drafts.test.ts`・`review.test.ts`・`posting-rules.test.ts`
  - `GET /post-drafts`：
    - `approved`が投稿の順（`prioritized_at`の新しい順 → `reviewed_at`の古い順）
    - `publishFailed`・`schedule`・`autoPost`があり、`published`がない
    - `counts`に`published`・`publishFailed`がある
    - `publishing`の下書きは`approved`に入り、`counts.approved`に数える
  - `PostDraft`の新しい項目（`carryover`・`blockedWords`の既定は`false`・`[]`）
  - 既存の操作で新しい列が消えること（CHECK制約の違反で500にならない。analyze I2）：
    - `blocked_*`のある要確認の下書きを編集・承認・却下すると、`blocked_*`が消える。削除もできる
    - `prioritized_at`・`carryover_attempt_id`のある承認済みの下書きを、`reopen`・編集・NGワードの追加で要確認に戻すと、2つとも消える
- [ ] T015 `apps/api/src/services/draft-service.ts`を変える。T014を通す。
  - `toPostDraft`に新しい項目を足す（`carryover = row.carryoverAttemptId !== null`）。
  - `countDrafts`：5つの件数を返す。`publishing`は`approved`に足す。
  - `listQueueRows(db, accountId)`：`status IN ('approved', 'publishing')`を、`publishing`を先頭 → 持ち越し（`carryover_attempt_id IS NOT NULL`）→ `prioritized_at DESC NULLS LAST` → `reviewed_at ASC` → `id`の順に読む。`compareQueueOrder`と同じ並び。004の`listReviewedRows(…, "approved")`の呼び出しを置き換える。
  - `listPublishFailedRows`：`publish_failed_at`の新しい順に全件
  - `listAllDrafts`：`publishFailed`を足す。`schedule`は`{}`、`autoPost`は`posting_schedules`から読んだ値で返す（予定の計算はUS4のT056で足す）。
- [ ] T016 既存の操作で、新しい列を消す（analyze I2。基盤でCHECK制約を入れた時点で、004の操作が制約違反にならないようにする）。T014を通す。
  - `apps/api/src/services/review-service.ts`の`applyChange`：`approve`・`reject`で`blockedAt`・`blockedReason`・`blockedWords`を`null`にする。`reopen`で`prioritizedAt`・`carryoverAttemptId`を`null`にする
  - `apps/api/src/services/draft-service.ts`の`updateDraft`：保存で`blocked_*`を消す。承認済みを戻すときに`prioritized_at`・`carryover_attempt_id`も消す
  - `apps/api/src/services/posting-rules-service.ts`の`addNgWords`：戻すときに`prioritized_at`・`carryover_attempt_id`も消す
  - data-model.mdの「状態と記録の組み合わせ」：`needs_review`・`rejected`では`prioritized_at`・`carryover_attempt_id`がNULL。`blocked_*`は`needs_review`のときだけ
- [ ] T017 Webを新しい一覧の形に合わせる（004の動きを保つ）。
  - `apps/web/src/lib/api-client.ts`：`PostDraftList`・`DraftCounts`の新しい形
  - `apps/web/src/pages/stock.tsx`・`apps/web/src/components/stock/DraftList.tsx`：`approved`は返ってきた並びのまま出す（Webで並べ替えない）
  - `apps/web/test/stock.test.tsx`：モックのレスポンスを新しい形にし、既存のテストが通ること
  - サイドバーの件数は`needsReview`のままで、投稿に失敗・投稿済みを数えないこと（FR-023）を、既存のサイドバーのテストに足す

**チェックポイント**：`pnpm test`がすべて通り、004の画面がそのまま動く。

---

## Phase 3：ユーザーストーリー1 - 投稿する時刻を決めて、承認済みの下書きを自動で投稿させる（優先度：P1）🎯 MVP

**目標**：「このアカウントの設定」で時刻を決めてオンにすると、時刻に承認済みの先頭の1件がThreadsに公開され、投稿済みのタブに出る。

**単独のテスト**：時刻を数分後に1つ設定してオンにし、承認済みを1件置く。時刻を過ぎて定期処理を動かすと、投稿済みになり、Threadsの投稿へのリンクが出る（spec US1「Independent Test」）。

**原則Iのため**：公開の直前のチェック（`checkPublishable`で当たれば要確認に戻す）は、取り出しの一部としてこのストーリーで入れる。US2では、その結果の表示と知らせを足す。

### テスト（先に書いて失敗を確認する）

- [ ] T018 [P] [US1] 投稿のスケジュールのAPIのテストを書く。`apps/api/test/integration/posting-schedule.test.ts`
  - `GET`：行がなければ`{ enabled: false, slotTimes: [], jitter: true, version: 0 }`と`limits`
  - `PUT`：
    - 3つの時刻でオンにでき、`slotTimes`は昇順、`version`は1
    - 検証：`too_many`・`duplicate`・`too_close`・`required`で`400 VALIDATION_FAILED`（`details`と`reason`）
    - 同じ`expectedVersion`の2回目は`409 STALE_UPDATE`（`latest`付き）
    - `effective_from`は、オフ → オン・時刻の変更・ずらすかの切り替えのときだけ今になる。オンのまま同じ内容の保存では変わらない
    - コミットの後、KVの`autopost:wake`に`{ at }`が書かれる。KVの書き込みを2回失敗させても（`AUTOPOST_KV.put`を差し替える）、3回目で書ける。4回失敗しても`200`
    - 投稿の権限の確認（FR-002a）：`enabled: true`の保存で、権限なし（`/__control/publish-permission`）は`409 THREADS_NOT_READY`（`details: ["no_publish_permission"]`）で保存されない。トークンの無効は`needs_reconnect`で、Accountが要再接続になる。一時的な失敗は保存され、`connectionCheck.status`が`unknown`。`enabled: false`の保存では確かめず`connectionCheck: null`。どの場合も偽のThreadsに投稿が作られない
  - 他人のAccountは`404 ACCOUNT_NOT_FOUND`。無料体験の後のプラン1でも使える（FR-004）
- [ ] T019 [P] [US1] 定期処理のテストを書く（成功の経路）。`apps/api/test/integration/auto-post-runner.test.ts`
  - 準備の部品（ファイルの中のヘルパー）：
    - 承認済みの下書きを作る
    - 設定を入れる（`effective_from`を過去にする）
    - `runAutoPost(testEnv, now)`を時刻を渡して呼ぶ
    - 偽のThreadsの`/__control/posts`を読む
  - quickstart.mdの表の次の行：
    - 「時刻になったら1件だけ」（投稿済みに`threadsMediaId`・`threadsPermalink`・`publishedAt`がある。SC-006）
    - 「投稿しない場合」（オフ、承認済み0件で`skipped`の`no_drafts`、要確認・却下・投稿に失敗は公開されない。SC-001）
    - 「遅れた処理」（59分後は公開、61分後は公開しない、2つの時刻が過ぎていても新しい1つだけ）
    - 「設定の変更の後」（`effective_from`より前の予定は60分以内でも公開しない）
    - 「日の件数」（その日に時刻を足しても、投稿済みは時刻の数を超えない。SC-008）
    - 「同時の処理」（`runAutoPost`を2つ同時に呼んでも公開は1回）
  - 1回の処理で最大4件：同じ時刻のAccountが5つあると4件だけ公開し、ログに`deferred`。次の回（5分後の`now`）で残りが公開される
  - 遅れのログ：予定から11分後に公開すると`warn`（`auto-post: late publish`）。61分後の処理で`warn`（`auto-post: slots expired`）（`logger`を差し替えて確かめる）
  - 直前のチェック（原則I）：先頭の下書きが、DBで書き換えてNGワードを含むとき、それは公開されず要確認に戻り、次の下書きが公開される（詳しい確認はUS2のT038）
- [ ] T020 [P] [US1] 関所のテストを書く。`apps/api/test/integration/auto-post-gate.test.ts`（quickstart.mdの表の「関所」）
  - `nextCheckAt`が未来で`wake`がなければ、DBに触れずに終わる（`createDb`を呼ばないことを、DBの呼び出しを数える差し替えで確かめる）
  - `wake.at > runStartedAt`なら、DBの処理をする
  - KVの値が壊れている・読めないときは、DBの処理をする
  - DBの処理の後の`nextCheckAt`は、次の予定の時刻（間に一定の間隔の見直しが入らない）。予定がなければ`now + 24時間`
  - `gate`の書き込みに失敗させると、次の回もDBの処理が動く
- [ ] T021 [P] [US1] 「接続を確かめる」のAPIのテストを書く。`apps/api/test/integration/threads-check.test.ts`（quickstart.mdの表の「接続を確かめる」、FR-002b）
  - `ok`（`quotaUsage`・`quotaTotal`）、`no_publish_permission`、`needs_reconnect`（Accountが要再接続になる。世代番号が変わっていれば変えない）、`unknown`（HTTP 500）
  - Accountがすでに要再接続なら、Threadsを呼ばずに`needs_reconnect`
  - 偽のThreadsに投稿が作られない。他人のAccountは`404 ACCOUNT_NOT_FOUND`
- [ ] T022 [P] [US1] 処理中の下書きと投稿済みの一覧のテストを書く。`apps/api/test/integration/post-drafts.test.ts`
  - `publishing`の下書きの編集は`409 DRAFT_PUBLISHING`、`review`（承認・却下・戻す）は`skipped: PUBLISHING`（FR-008）
  - 投稿済みの下書きの編集・削除・`reopen`は、それぞれ`404`・削除されない・`skipped: STALE`（FR-020）
  - `GET /post-drafts/published`：投稿済み120件で、50件・50件・20件に分かれ、最後の`nextCursor`は`null`。並びは`published_at`の新しい順で、同じ日時は`id`の順（quickstart.mdの表の「投稿済みのAPI」）
  - 他人のAccountの`GET /post-drafts/published`は`404 ACCOUNT_NOT_FOUND`（FR-025）
- [ ] T023 [P] [US1] Webのテストを書く。
  - `apps/web/test/account-settings.test.tsx`：
    - 「投稿のスケジュール」の区分の3つの行の表示
    - ダイアログで時刻を3つ足してオンにして保存できる
    - 検証の4つの文言（29分の間で`too_close`の文言が出て「保存」が無効）
    - 2:00・4:59の時刻にだけ深夜の案内が出て、保存はできる（FR-001b）
    - `409`で`ConflictDialog`が出る
    - 「接続を確かめる」の4つの結果の表示と、確かめている間の無効化（FR-002b）
    - オンにする保存の`409 THREADS_NOT_READY`で、ダイアログが閉じず、理由と「再接続」が出る。`connectionCheck.status`が`unknown`なら閉じて注意の通知が出る（FR-002a）
  - `apps/web/test/stock.test.tsx`：
    - 4つのタブと`?tab=published`
    - 投稿済みのタブを開いたときだけ`GET /post-drafts/published`を呼ぶ
    - カードに「{日時}に投稿」と「Threadsで開く」（`target="_blank" rel="noopener noreferrer"`）、URLがないときは「URLを取得中」
    - 「もっと見る」で続きを足す
    - 空の状態の文言

### 実装

- [ ] T024 [US1] 投稿の権限の確認を作る（research.md R15、contracts/api.md「POST /threads-check」）。T021を通す。
  - `apps/api/src/services/threads-check-service.ts`に`checkThreadsPublish(env, accountId, threads): Promise<ThreadsCheck>`
    - Accountが要再接続なら、Threadsを呼ばずに`needs_reconnect`
    - トークンを復号して`getPublishingLimit`を呼び、research.md R15の表のとおりに分ける
    - 認証エラーなら、読んだ`connection_generation`を条件に要再接続にする（`verifyConnection`と同じ書き方）
  - `apps/api/src/routes/threads-check.ts`に`POST /accounts/:accountId/threads-check`（`findOwnedAccount`）。`apps/api/src/app.ts`に登録する
- [ ] T025 [US1] `apps/api/src/services/posting-schedule-service.ts`を作る（research.md R1、contracts/api.md）。
  - `getPostingSchedule(db, accountId)`：行がなければ既定値（`version: 0`）
  - `savePostingSchedule(env, ctx, accountId, req)`：`validatePostingSchedule`で確かめる。行がなければ`expectedVersion: 0`で作り、あれば`version`を条件に更新する（`updateWithVersion`）。`effective_from`の更新は、data-model.mdの3つの場合だけ。
  - `enabled: true`の保存では、検証の後、保存の前に`checkThreadsPublish`を呼ぶ。`needs_reconnect`・`no_publish_permission`なら`409 THREADS_NOT_READY`（`details`に結果）で保存しない。`unknown`なら保存し、レスポンスの`connectionCheck`に入れる。`enabled: false`の保存では呼ばず`connectionCheck: null`（FR-002a）
  - `notifyWake(env, ctx)`：コミットの後、`ctx.waitUntil`で`AUTOPOST_KV.put("autopost:wake", JSON.stringify({ at }))`。失敗したら0.5秒・1秒・2秒あけて最大3回まで書き直し、それでも失敗したら`logger.error`
- [ ] T026 [US1] `apps/api/src/routes/posting-schedule.ts`を作り、`apps/api/src/app.ts`に登録する。`GET`・`PUT /api/accounts/:accountId/posting-schedule`（`findOwnedAccount`・`parseBody`）。T018を通す。
- [ ] T027 [US1] `apps/api/src/services/auto-post-gate.ts`を作る（contracts/auto-post-job.md 手順0・7）。
  - `readGate(env)`：`{ gate, wake }`を読む。壊れた値・読めないときは`null`
  - `shouldRun(state, now)`
  - `writeGate(env, { nextCheckAt, runStartedAt })`
  - `computeNextCheckAt(input)`：次の予定の時刻・やり直しの時刻・続きの処理の有無・`now + 24時間`のうち、もっとも早いもの
- [ ] T028 [US1] `apps/api/src/services/publish-claim.ts`を作る（contracts/auto-post-job.md 手順3、research.md R6・R7）。
  - `claimSlot(env, attempt)`：`withTransaction`の中で`lockAccountDrafts`を取り、手順3の表のうち、自動投稿がオンか（`auto_post_off`）と、その日の投稿済みの件数（`daily_limit`）を確かめる。満たさなければ試みを`skipped`（理由付き）にする。要再接続・`paused_until`・24時間の250件は、US3のT050で足す。
  - `listQueueRows`の順に、`status = 'approved'`の下書きだけを読み（`publishing`は除く）、先頭から`checkPublishable(body, listNgWords(tx, accountId))`で確かめる。
    - 当たった下書き：要確認に戻す。`blocked_at = now`・`blocked_reason`・`blocked_words`（`ng_word`のとき当たった語の`word`）を入れ、`reviewed_at`・`prioritized_at`・`carryover_attempt_id`・`last_review_request_id`を消し、`version + 1`
    - 問題のない下書き：`publishing`にし（`version + 1`）、試みに`draft_id`・`is_carryover`を入れる。持ち越しなら`carryover_attempt_id`を消す
    - 承認済みが尽きたら`skipped`（`no_drafts`）
  - 「規約に注意」では止めない（spec エッジケース）。
- [ ] T029 [US1] `apps/api/src/services/publish-executor.ts`を作る（成功の経路。contracts/auto-post-job.md 手順4）。
  - トークンを復号する（`createTokenCipher`、AADは`accountId`）。
  - `container_id`がなければ`createTextContainer` → `container_id`を保存 → `publish_requested_at = now`を保存 → `publishContainer`の順にする。**`container_id`の保存より前に公開を送らない**（research.md R6）。
  - 成功の記録：1回の更新（`status = 'publishing'`を条件に）で、下書きを`published`（`published_at`・`threads_media_id`を入れ、`prioritized_at`・`carryover_attempt_id`を消し、`version + 1`。data-model.mdのCHECK制約。analyze I1）、試みを`succeeded`にする。続けて`getMedia`で`threads_permalink`を保存する（失敗しても記録はそのまま）。
  - 失敗の分岐は、ここでは`ThreadsApiError`を確かな失敗（`publish_failed`・`invalid_request`。`prioritized_at`・`carryover_attempt_id`を消す）にするだけ。ほかの分岐はUS3のT048で足す。
  - ログには下書き・試み・AccountのIDだけを出す（本文・トークンは出さない）。
- [ ] T030 [US1] `apps/api/src/services/auto-post-runner.ts`を作る（contracts/auto-post-job.md 手順0〜7）。T019・T020を通す。
  - `runAutoPost(env, now)`：
    - 関所（T027）
    - 続きの処理（`lease_until`が切れた`in_progress`、`next_retry_at`が来た`retry_wait`）
    - 時刻の処理：オンのAccountの今日・昨日の予定を`plannedSlotTime`で求め、来ている時刻のうち最新の1つだけについて、`INSERT … ON CONFLICT (account_id, slot_at) DO NOTHING`で試みを作る。そのAccountに`in_progress`・`retry_wait`の試みがあるときは作らない（research.md R6「同じAccountの試みは、1つずつ進める」。analyze U1）
    - 予定の古い順に最大4件まで、取り出し（T028）と公開（T029）を進める
    - URLが空の投稿済み（7日以内）を最大2件取り直す
    - 関所の書き込み
  - `lease_until`は、条件付きの更新（`lease_until IS NULL OR lease_until < now`）で取る。
  - Accountごと・試みごとに`try/catch`で囲み、1件の失敗で全体を止めない。
  - ログ（contracts/auto-post-job.md「ログ」）：
    - 件数の`info`
    - `deferred`・`expired`
    - 遅れが10分を超えたら`warn`（`auto-post: late publish`）
    - `expired`が1件以上なら`warn`（`auto-post: slots expired`）
    - 関所で終えたときは`debug`（`auto-post: gate closed`）
- [ ] T031 [US1] `apps/api/src/index.ts`の`scheduled`で`controller.cron`を見て分ける：`"*/5 * * * *"`なら`runAutoPost(env, new Date(controller.scheduledTime))`、それ以外は既存の`runDailyJobs`。
- [ ] T032 [US1] 処理中・投稿済みの下書きへの操作を拒む（FR-008・FR-020）。T022を通す。
  - `apps/api/src/services/draft-service.ts`の`updateDraft`：対象が`publishing`なら`409 DRAFT_PUBLISHING`（`latest`付き）。投稿済み・投稿に失敗は今までどおり`404`（対象の状態に入れない）。
  - `apps/api/src/services/review-service.ts`：今の状態が`publishing`なら`skipped: PUBLISHING`。
  - `deleteDrafts`は変えない（要確認・却下だけ）。
- [ ] T033 [US1] 投稿済みの一覧のAPIを作る。T022を通す。
  - `apps/api/src/services/draft-service.ts`に`listPublishedPage(db, accountId, { before, limit })`：`status = 'published'`を`published_at DESC, id`で、カーソル（`published_at`と`id`のbase64url）の後から`limit + 1`件読む。返す列は`publishedPostSchema`の5つだけ（research.md R14）。
  - `apps/api/src/routes/post-drafts.ts`に`GET /accounts/:accountId/post-drafts/published`（`limit`は1〜50、既定50）。
- [ ] T034 [P] [US1] 日時の表示を足す。`apps/web/src/lib/format.ts`に`formatRelativeJst(date, now)`：「今日 12:00」「明日 7:30」「10月8日 21:00」「2027年1月3日 7:30」（contracts/ui-routes.md「日時の書き方」）。`apps/web/test`にテストを足す。
- [ ] T035 [US1] 設定の画面を作る（contracts/ui-routes.md「このアカウントの設定」）。T023の`account-settings.test.tsx`を通す。
  - `apps/web/src/lib/api-client.ts`：`getPostingSchedule`・`putPostingSchedule`・`checkThreads`
  - `apps/web/src/lib/query.ts`：`queryKeys.postingSchedule(accountId)`・`queryKeys.autoPost(accountId)`
  - `apps/web/src/components/settings/PostingScheduleSection.tsx`：3つの`SettingRow`と「編集」。「接続を確かめる」と結果の1行（FR-002b）。要再接続のときの案内
  - `apps/web/src/components/settings/PostingScheduleDialog.tsx`：
    - `Switch`×2
    - 時刻の一覧と`<input type="time">`の追加
    - 入力のたびに`validatePostingSchedule`で検証の文言を出す
    - 深夜の案内（`isLateNightSlot`・`LATE_NIGHT_HINT`）
    - 「保存」、保存後の通知
    - `ConflictDialog`、`useUnsavedChanges`
    - オンにする保存の`409 THREADS_NOT_READY`（ダイアログの上部に理由と「再接続」）と、`connectionCheck.status`が`unknown`のときの通知（FR-002a）
  - `apps/web/src/pages/account-settings.tsx`：「投稿のルール」の上に`PostingScheduleSection`を置く
- [ ] T036 [US1] 投稿済みのタブを作る（contracts/ui-routes.md「投稿済みのタブ」）。T023の`stock.test.tsx`を通す。
  - `apps/web/src/lib/api-client.ts`：`listPublished(accountId, before?)`
  - `apps/web/src/components/stock/use-published.ts`：`useInfiniteQuery`で、タブを開いたときだけ読む。状態の変更の後には読み直さない
  - `apps/web/src/components/stock/PublishedCard.tsx`
  - `apps/web/src/components/stock/StatusTabs.tsx`：「投稿済み {n}」と`?tab=published`。`md`未満でタブの行を横にスクロールできるようにする
  - `apps/web/src/components/stock/DraftList.tsx`・`apps/web/src/pages/stock.tsx`：投稿済みのタブ、空の状態
- [ ] T037 [US1] 「承認済みが0件」の知らせを出す（US1 シナリオ5）。
  - `apps/api/src/services/auto-post-status.ts`：`getAutoPostStatus(db, account, now)`。まず`autoPost`と`notices`（`no_approved`だけ。オン・接続が正常・承認済み0件のとき、`projectSchedule`の最初の時刻を`nextSlotAt`に）を返す。`next`・`approvedCount`・`daysLeft`はUS4のT057で足す（それまでは`null`・件数・`null`）。
  - `apps/api/src/routes/auto-post.ts`：`GET /accounts/:accountId/auto-post`。`apps/api/src/app.ts`に登録する。
  - `apps/api/test/integration/auto-post-status.test.ts`：`no_approved`が出る・出ない（オフ、承認済みあり）。他人のAccountは`404 ACCOUNT_NOT_FOUND`（FR-025）。
  - `apps/web/src/components/AutoPostNotices.tsx`：`GET /auto-post`の`notices`を出す部品（`no_approved`の文言。contracts/ui-routes.md「知らせ」）。
  - `apps/web/src/pages/stock.tsx`（プロンプトのカードの上）と`apps/web/src/pages/account-home.tsx`に置く。

**チェックポイント**：時刻を決めてオンにすると、承認済みの先頭の1件だけが公開され、投稿済みのタブに出る（quickstart.md 手動の確認1・3の1〜2）。

---

## Phase 4：ユーザーストーリー2 - 投稿の直前にもう一度確かめ、問題のある下書きは投稿しない（優先度：P1）

**目標**：投稿の時点でNGワード・Threadsの上限に当たる下書きは要確認に戻り、理由が投稿ストックとホームでわかる。

**単独のテスト**：承認済みの下書きの本文をNGワードを含むものにしておき、時刻を過ぎても投稿されず、要確認に戻って理由が出ることを確かめる（spec US2「Independent Test」）。

### テスト（先に書いて失敗を確認する）

- [ ] T038 [P] [US2] 直前のチェックのテストを書く。`apps/api/test/integration/auto-post-runner.test.ts`
  - quickstart.mdの表の「直前のチェック」：NGワード・Threadsの上限（501文字）のそれぞれで、要確認に戻り`blocked_reason`・`blocked_words`が記録され、同じ時刻に次の下書きが公開される（SC-002）
  - 1つの時刻で2件続けて当たっても、3件目が公開される
  - 規約に注意だけの下書きは公開される
  - 「NGワードの追加と取り出しの同時実行」：`addNgWords`と`runAutoPost`を同時に呼び、公開された本文に、その時点で登録済みのNGワードが含まれない（research.md R7）
- [ ] T039 [P] [US2] 知らせのテストを書く。`apps/api/test/integration/auto-post-status.test.ts`
  - `blocked`：`blocked_notice_seen_at`より後に戻した下書きの件数・最新の理由・語
  - `POST /auto-post/notices/blocked/dismiss`で消え、下書きの`blockedReason`は残る。行がなくても`204`で、`version`は変わらない
  - 他人のAccountの`dismiss`は`404 ACCOUNT_NOT_FOUND`（FR-025）
- [ ] T040 [P] [US2] Webのテストを書く。
  - `apps/web/test/stock.test.tsx`：要確認のカードの先頭に「投稿の直前に{理由}が見つかったため、要確認に戻しました（{日時}）」
  - `blocked`の知らせの文言、「確認する」で要確認のタブへ、「閉じる」で`dismiss`を呼ぶ

### 実装

- [ ] T041 [US2] 知らせに`blocked`を足し、閉じるAPIを作る。T039を通す。
  - `apps/api/src/services/auto-post-status.ts`：`blocked`の知らせ
  - `apps/api/src/routes/auto-post.ts`：`POST /accounts/:accountId/auto-post/notices/blocked/dismiss`（`posting_schedules`の行がなければ作る。`blocked_notice_seen_at = now`、`version`は変えない）
- [ ] T042 [US2] 画面に理由と知らせを出す。T040を通す。
  - `apps/web/src/components/stock/DraftLabels.tsx`（または`DraftCard.tsx`）：要確認のカードの、直前のチェックの理由（`blockedReasonLabel`）
  - `apps/web/src/components/AutoPostNotices.tsx`：`blocked`の文言・「確認する」・「閉じる」
  - `apps/web/src/components/stock/use-review.ts`：操作の後に`queryKeys.autoPost`も読み直す

**チェックポイント**：quickstart.md 手動の確認3の3〜4。

---

## Phase 5：ユーザーストーリー3 - 投稿できなかったときに気づき、対処する（優先度：P1）

**目標**：一時的な失敗はやり直し、最後は「投稿に失敗」として知らせる。要再接続・上限では止めて知らせる。結果がわからなくても二重に公開しない。

**単独のテスト**：Threadsへの公開を失敗させ続け、決まった回数のやり直しの後に「投稿に失敗」として投稿ストックとホームに出ること、「もう一度投稿の順に入れる」で次の時刻に投稿されることを確かめる（spec US3「Independent Test」）。

### テスト（先に書いて失敗を確認する）

- [ ] T043 [P] [US3] 失敗とやり直しのテストを書く。`apps/api/test/integration/auto-post-runner.test.ts`（quickstart.mdの表の次の行）
  - 「一時的な失敗」：2回失敗して3回目で成功（`now`を5分・10分進める）
  - 「持ち越しと失敗」：
    - 4回失敗で`carried_over`になり、下書きは承認済みで`carryover: true`
    - 次の時刻ではその下書きを試し、ほかの下書きは公開しない
    - そこでも失敗すると`publish_failed`（`publish_error = network`か`threads_server`）
    - その次の時刻は次の下書き
  - 「確かな失敗」：コード100ですぐ`publish_failed`（`invalid_request`）
  - 「認証の失敗」：Accountが`needs_reconnect`になり（世代番号が同じとき）、下書きは承認済み、試みは`skipped`（`needs_reconnect`）
  - 「上限」：`paused_until`が翌日0時（日本時間）になり、今日の残りの時刻は`skipped`（`rate_limited`）、翌日の最初の時刻で公開
  - 「要再接続」：要再接続の間は`skipped`。再接続（`writeConnection`）の後は、再接続より前の時刻を公開しない
  - 自動投稿をオフにしても、`retry_wait`の試みは最後まで進む
  - 「同じAccountの試みを1つずつ」：時刻をずらさず間を10分にした2つの時刻で、1つ目がやり直し中なら2つ目の試みは作られず、1つ目が終わった後に処理される。持ち越しのときは、待っていた2つ目の時刻でその下書きを試す（research.md R6）
- [ ] T044 [P] [US3] 二重の公開の防止のテストを書く。`apps/api/test/integration/auto-post-runner.test.ts`（SC-003）
  - 「応答の喪失」：`/__control/drop-publish-response`で公開の応答を502にすると、試みは`in_progress`のまま（`publish_requested_at`あり）で、下書きは`publishing`。次の回で`PUBLISHED`とわかり、一覧から見つけて`published`になる。偽のThreadsの投稿は1件
  - 「未公開」：試みに`container_id`だけを入れた状態（DBで作る）で次の回を動かすと、同じコンテナーで公開し、投稿は1件
  - `IN_PROGRESS`のコンテナーは次の回に回す。`EXPIRED`は新しいコンテナーで、やり直しとして扱う。`ERROR`は`publish_failed`（`container_error`）
  - 状態の確認が認証エラーになっても、下書きは`publishing`のまま（結果を確かめるまで解かない）
  - `PUBLISHED`で一覧に見つからない状態が24時間続くと、IDなしで`published`になり、`error`のログが出る
- [ ] T045 [P] [US3] 失敗への操作のテストを書く。`apps/api/test/integration/review.test.ts`
  - `requeue`：`publish_failed` → `approved`、`prioritized_at`が今、失敗の記録が消え、`reviewed_at`は元のまま。承認済みが500件なら`skipped: LIMIT`。同じ`requestId`の再試行は`updated`
  - `reopen`：`publish_failed` → `needs_review`。`reviewed_at`・失敗の記録・`prioritized_at`・`carryover_attempt_id`が消える
- [ ] T046 [P] [US3] 知らせのテストを書く。`apps/api/test/integration/auto-post-status.test.ts`
  - `publish_failed`（件数・最新の理由と日時）、`needs_reconnect`（オンのときだけ）、`rate_limited`（`until`）
  - 並びは`needs_reconnect`・`rate_limited`・`publish_failed`・`blocked`・`no_approved`
- [ ] T047 [P] [US3] Webのテストを書く。`apps/web/test/stock.test.tsx`・`apps/web/test/account-home.test.tsx`
  - 承認済みのタブの先頭の「投稿に失敗（{n}件）」と、「{日時}に失敗：{理由}」
  - 「もう一度投稿の順に入れる」で`requeue`、「⋯」の「要確認に戻す」で`reopen`
  - 持ち越しのカードに「前回の投稿に失敗したため、次の時刻にもう一度試します」
  - 処理中のカードは「投稿の処理中」で、操作が無効
  - `DRAFT_PUBLISHING`・`skipped: PUBLISHING`の通知
  - ホームと投稿ストックの、3種類の知らせの文言と「再接続」「確認する」

### 実装

- [ ] T048 [US3] `apps/api/src/services/publish-executor.ts`に失敗の扱いを足す（contracts/auto-post-job.md 手順4「失敗の扱い」）。T043を通す。
  - 一時的：`retry_count < 3`なら`retry_wait`（`next_retry_at = now + 5・10・15分`、`last_error`）。`retry_count = 3`なら、持ち越しでない試みは`carried_over`（下書きは`approved`、`carryover_attempt_id = 試み`）、持ち越しの試みは`failed`（下書きは`publish_failed`）
  - 確かな失敗：`failed`、下書きは`publish_failed`（`publish_failed_at`・`publish_error`）
  - 認証：Accountを`needs_reconnect`にする（読んだ`connection_generation`を条件に）。試みは`skipped`（`needs_reconnect`）、下書きは`approved`
  - 上限：`posting_schedules.paused_until`を翌日の0時（日本時間）にする。試みは`skipped`（`rate_limited`）、下書きは`approved`
  - 下書きを戻す・失敗にする更新は、`status = 'publishing'`を条件にし、`version + 1`
  - 下書きを`publish_failed`にするときは、どの経路でも`prioritized_at`・`carryover_attempt_id`を消す（data-model.mdのCHECK制約。analyze I1）
- [ ] T049 [US3] `apps/api/src/services/publish-executor.ts`に結果の確認を足す（contracts/auto-post-job.md 手順4「結果の確認」、research.md R6）。T044を通す。
  - `publishContainer`の`ThreadsTransientError`は「結果がわからない」として、`publish_requested_at`を残して`lease_until`を消す（やり直しの回数は増やさない）
  - `publish_requested_at`のある試み：`getContainerStatus`の5つの状態ごとの処理。`PUBLISHED`は`listRecentThreads(since = publish_requested_at - 5分)`で、前後の空白を除いた本文が一致するもっとも古い投稿を探す
  - `container_id`だけの試み：`FINISHED`なら公開、`IN_PROGRESS`は次の回、`EXPIRED`は`container_id`を消して作り直し、`ERROR`は確かな失敗
  - 状態の確認の呼び出しが失敗しても、下書きは`publishing`のまま。認証の失敗ならAccountを要再接続にする
  - `PUBLISHED`のまま24時間見つからなければ、IDなしで`published`にし、`logger.error`
  - 「結果がわからない」の発生・解決を`warn`で出す
- [ ] T050 [US3] 停止と再開を足す。T043を通す。
  - `apps/api/src/services/publish-claim.ts`：手順3の表の残りの3つを足す（要再接続 → `needs_reconnect`、`paused_until`が来ていない → `rate_limited`、直前24時間の投稿済みが250件 → `rate_limited`）
  - `apps/api/src/services/account-service.ts`の`writeConnection`：同じトランザクションで、`posting_schedules`の行があれば`effective_from = now`にする（`version`は変えない。FR-016）
- [ ] T051 [US3] `requeue`と`reopen`の広げを足す（research.md R4、contracts/api.md「POST /post-drafts/review」）。T045を通す。
  - `apps/api/src/services/review-service.ts`：
    - `TARGET.requeue = "approved"`、`FROM.requeue = ["publish_failed"]`、`FROM.reopen`に`"publish_failed"`を足す
    - `requeue`は承認済みの上限を数え、`prioritized_at = now`にし、失敗の記録を消す
    - `reopen`は失敗の記録も消す（`prioritized_at`・`carryover_attempt_id`は、基盤のT016で消している）
- [ ] T052 [US3] 知らせに3種類を足す。`apps/api/src/services/auto-post-status.ts`。T046を通す。
- [ ] T053 [US3] 画面を作る（contracts/ui-routes.md「承認済みのタブ」の2、「知らせ」）。T047を通す。
  - `apps/web/src/components/stock/DraftList.tsx`：承認済みのタブの先頭に「投稿に失敗」のまとまり（選択のバーの対象外）
  - `apps/web/src/components/stock/DraftCard.tsx`：失敗のカードの操作、持ち越し・処理中の表示
  - `apps/web/src/components/stock/use-review.ts`：`requeue`、`skipped: PUBLISHING`の文言
  - `apps/web/src/components/stock/messages.ts`：文言
  - `apps/web/src/components/AutoPostNotices.tsx`：`needs_reconnect`（001の再接続の操作）・`rate_limited`・`publish_failed`

**チェックポイント**：quickstart.md 手動の確認4・5。US1〜US3（すべてP1）が揃うまで、本番で自動投稿をオンにしない（plan.md「実装の進め方」）。

---

## Phase 6：ユーザーストーリー4 - 投稿の順と次の投稿予定を見る（優先度：P2）

**目標**：承認済みのタブで投稿の順と予定が見え、「次に投稿する」で先頭に移せる。ホームに「次の投稿」が出る。

**単独のテスト**：時刻を3つ、承認済みを5件にし、承認済みのタブで承認した順に並び、先頭から「今日 12:00」「今日 21:00」「明日 7:30」…の予定が出ることを確かめる（spec US4「Independent Test」）。

### テスト（先に書いて失敗を確認する）

- [ ] T054 [P] [US4] 予定と「次に投稿する」のAPIのテストを書く。
  - `apps/api/test/integration/post-drafts.test.ts`：
    - `schedule`が`approved`の先頭から予定の時刻を持つ（`publishing`は入らない、オフ・停止中は`{}`）
    - `prioritize`：承認済みが先頭に移り、`version + 1`。2回目も先頭のまま。要確認・却下は`404`、処理中は`409 DRAFT_PUBLISHING`、古い`expectedVersion`は`409 STALE_UPDATE`
    - 他人のAccountの`prioritize`は`404 ACCOUNT_NOT_FOUND`（FR-025）
  - `apps/api/test/integration/auto-post-status.test.ts`：`next`（日時と40文字までの書き出し）・`approvedCount`・`daysLeft`（承認済み5・時刻3で1、時刻0で`null`）
  - 他人のAccountの`GET /auto-post`は`404 ACCOUNT_NOT_FOUND`（FR-025）
- [ ] T055 [P] [US4] Webのテストを書く。
  - `apps/web/test/stock.test.tsx`：
    - 承認済みのカードの「{日時}に投稿予定」
    - オフのときの案内と設定へのリンク
    - 「⋯」の「次に投稿する」（先頭のカードには出ない）と、その後の通知
  - `apps/web/test/account-home.test.tsx`：「次の投稿」のカードの4つの状態（予定あり・承認済み0件・停止中・オフ）と「あと{d}日分」

### 実装

- [ ] T056 [US4] `GET /post-drafts`に予定を入れる（research.md R9）。`apps/api/src/services/draft-service.ts`の`listAllDrafts`と`apps/api/src/services/auto-post-status.ts`。T054を通す。
  - `projectSchedule`の材料（設定、今日の`publish_attempts`の`slot_at`、今日の投稿済みの件数）を読む。
  - `approved`のうち`publishing`でないものに、先頭から予定を割り当てる。
  - `autoPost.stoppedReason`を入れる。
- [ ] T057 [US4] `GET /auto-post`に`next`・`approvedCount`・`daysLeft`を足す。`apps/api/src/services/auto-post-status.ts`。T054を通す。
- [ ] T058 [US4] 「次に投稿する」のAPIを作る。
  - `apps/api/src/services/draft-service.ts`に`prioritizeDraft(env, accountId, id, expectedVersion)`：`lockAccountDrafts`の中で、`status = 'approved'`かつ`version`が一致する行の`prioritized_at = now`・`version + 1`。`publishing`なら`DRAFT_PUBLISHING`
  - `apps/api/src/routes/post-drafts.ts`に`POST /accounts/:accountId/post-drafts/:draftId/prioritize`
  - T054を通す。
- [ ] T059 [US4] 承認済みのタブを作る（contracts/ui-routes.md「承認済みのタブ」の1・3）。T055の`stock.test.tsx`を通す。
  - `apps/web/src/components/stock/messages.ts`：004の`APPROVED_TAB_NOTICE`を、オン・オフ・停止中の3つの案内に置き換える
  - `apps/web/src/components/stock/DraftCard.tsx`：予定の表示（`formatRelativeJst`）、「⋯」の「次に投稿する」
  - `apps/web/src/lib/api-client.ts`：`prioritizeDraft`
  - 「次に投稿する」の後は、一覧を読み直し、移したカードまでスクロールして枠を一瞬強調し、「次の投稿にしました（{日時}の予定）」と通知する
- [ ] T060 [US4] ホームの「次の投稿」のカードを作る。`apps/web/src/components/NextPostCard.tsx`を作り、`apps/web/src/pages/account-home.tsx`の「次にやること」のカードの下に置く（contracts/ui-routes.md「ホーム」）。T055の`account-home.test.tsx`を通す。

**チェックポイント**：quickstart.md 手動の確認2。

---

## Phase 7：ユーザーストーリー5 - プロンプトの宣伝の件数を、1日の投稿数で書く（優先度：P3）

**目標**：時刻が1件以上のAccountでは、プロンプトの宣伝の節が1日の投稿数で書かれる。

**単独のテスト**：時刻を4つ、宣伝投稿の割合を25%にしてプロンプトを見ると、「1日の投稿は4件の設定で、そのうち1件程度」が入っている（spec US5「Independent Test」）。

### テスト（先に書いて失敗を確認する）

- [ ] T061 [P] [US5] `packages/shared/test/prompt.test.ts`に、contracts/prompt-template.mdの例（時刻4つ・25%・30件）と、`dailyPostCount = 0`で003の文のままであること、`round`の境目（時刻2つ・25%で0.5 → 1件）を足す。
- [ ] T062 [P] [US5] `apps/api/test/integration/prompt.test.ts`に、設定の時刻の数が`summary.dailyPostCount`とプロンプトに反映されること（設定の行がなければ0）を足す。

### 実装

- [ ] T063 [US5] `packages/shared/src/prompt.ts`：入力に`dailyPostCount`を足し、`promotionSection`の見出しの文をcontracts/prompt-template.mdのとおりに切り替える。要約に`dailyPostCount`を足す。T061を通す。
- [ ] T064 [US5] `apps/api/src/services/prompt-service.ts`：`posting_schedules.slot_minutes`の数を`dailyPostCount`として渡す。T062を通す。

**チェックポイント**：quickstart.mdの表の「プロンプト」の行が通る。

---

## Phase 8：仕上げと横断的な対応

- [ ] T065 [P] Account削除との関係を確かめる。`apps/api/test/integration/profile-cascade.test.ts`に、Accountを消すと`posting_schedules`・`publish_attempts`も消えることを足す（FR-026）。
- [ ] T066 [P] 日次の処理に、古い試みの削除を足す。`apps/api/src/services/daily-jobs.ts`に「`slot_date`が30日より前の`publish_attempts`を消す」の1つ（`AUTOPOST_ATTEMPT_RETENTION_DAYS`）。テストを足す。
- [ ] T067 [P] `docs/ui-design.md`を更新する。
  - 投稿ストックの4つのタブ
  - 承認済みのタブの予定・失敗のまとまり
  - ホームの「次の投稿」
  - 「このアカウントの設定」の「投稿のスケジュール」
- [ ] T068 `pnpm lint`・`pnpm typecheck`・`pnpm test`をすべて通す。
- [ ] T069 quickstart.mdの手動の確認1〜5を行う（analyze G2）。とくに次を確かめる。
  - 手動の確認1：時刻を3つ決めてオンにするまでが2分以内（SC-007）、「接続を確かめる」と、権限がないときにオンにならないこと（FR-002a・FR-002b）
  - 手動の確認2〜5：予定の表示、自動投稿、失敗とやり直し、要再接続と上限
- [ ] T070 4つの画面幅で確かめる（quickstart.md 手動の確認8）。
- [ ] T071 本物のThreadsで1回確かめる（quickstart.md 手動の確認6）。テスター招待したアカウントで公開され、Threadsで開けること。
- [ ] T072 デプロイの後、費用と制限を確かめる（quickstart.md 手動の確認7、docs/cost-estimate.md）。
  - 本番のKV namespaceを作り、`wrangler.toml`の`id`を入れる
  - Cronの1回のCPU時間、Neonの計算時間と通信量、KVの書き込みの回数、`warn`のログ
  - SC-004（99%以上が予定から10分以内）：`auto-post: late publish`の`warn`の件数を、公開した件数で割って確かめる

---

## 依存関係と実行順

### フェーズの依存

- **Phase 1（セットアップ）**：すぐ始められる。
- **Phase 2（基盤）**：Phase 1の後。すべてのユーザーストーリーの前提。
- **Phase 3（US1）**：Phase 2の後。定期処理の骨組み（関所・runner・取り出し・公開）を作る。
- **Phase 4（US2）**：US1の取り出し（T028）の後。表示と知らせは、US1の`AutoPostNotices`（T037）の後。
- **Phase 5（US3）**：US1の公開（T029）・runner（T030）の後。
- **Phase 6（US4）**：Phase 2の後に始められる。ただし、予定の計算は試みの行（US1）を使うので、T056以降はUS1の後。
- **Phase 7（US5）**：Phase 2の後なら、いつでも始められる（ほかのストーリーと独立）。
- **Phase 8（仕上げ）**：すべての後。

### ストーリーの中の順番

- テスト → 共通の関数 → APIのサービス・ルート → Webの部品 → 画面への組み込み
- 次の同じファイルを触るタスクは、ストーリーをまたいで並行にしない。
  - API：
    - `apps/api/src/services/publish-executor.ts`（T029・T048・T049）
    - `publish-claim.ts`（T028・T050）
    - `posting-schedule-service.ts`（T025）は`threads-check-service.ts`（T024）の後
    - `auto-post-status.ts`（T037・T041・T052・T056・T057）
    - `draft-service.ts`（T015・T016・T032・T033・T051・T056・T058）
    - `review-service.ts`（T016・T032・T051）
  - Web：
    - `apps/web/src/components/AutoPostNotices.tsx`（T037・T042・T053）
    - `DraftCard.tsx`（T042・T053・T059）
    - `DraftList.tsx`（T036・T053）
    - `apps/web/src/pages/stock.tsx`
  - テスト：
    - `apps/api/test/integration/auto-post-runner.test.ts`（T019・T038・T043・T044）
    - `auto-post-status.test.ts`
    - `post-drafts.test.ts`
    - `review.test.ts`
    - `apps/web/test/stock.test.tsx`

## 並行して進められる例

### Phase 1・2

```text
T001 Switch ／ T002 KV・Cron
T003 共通のテスト ／ T004 limits ／ T008 errors ／ T011 偽のThreads ／ T012 threads-client のテスト
```

### US1

```text
T018 posting-schedule のテスト ／ T019 runner のテスト ／ T020 関所のテスト ／ T021 threads-check のテスト ／ T022 一覧のテスト ／ T023 Web のテスト
T034 format.ts（API の実装と並行）
```

### US1と並行してできるUS5

```text
T061 prompt のテスト → T063 prompt.ts → T062・T064 prompt-service
```

### US2・US3のテスト

```text
T038 ／ T039 ／ T040（US2）
T043 ／ T044 ／ T045 ／ T046 ／ T047（US3）
※ T038・T043・T044 は同じファイル（auto-post-runner.test.ts）なので、続けて書く
```

## 実装の進め方

### MVP（US1＋US2＋US3。すべてP1）

1. Phase 1・2を終える
2. Phase 3（US1 設定と自動投稿）を終える。**止めて確認**：時刻に1件だけ公開され、承認済みでない下書きは公開されない（原則II）。直前のチェックで、NGワードを含む下書きは公開されない（原則I）
3. Phase 4（US2 直前のチェックの表示と知らせ）と、Phase 5（US3 失敗・停止・二重の公開の防止）を終える
4. **止めて確認**：quickstart.mdの手動の確認1〜5

US1だけでも投稿はできる。しかし、二重の公開の防止（US3）と失敗の知らせが揃うまでは、本番で自動投稿をオンにしない。3つとも同じPRで出す。

### 少しずつ足す

1. US4（投稿の順と予定）→ US5（プロンプト）の順に足し、それぞれ単独で確かめる
2. PRのマージは、US5まで終えてからにする（spec に入っているため）
3. Phase 8で、Account削除との関係・古い試みの削除・本物のThreads・費用の確認を行う

## メモ

- [P]のタスクは、別のファイルを触り、未完了のタスクに依存しない
- 各タスク、または論理的なまとまりごとにコミットする
- 公開の直前のチェック（`checkPublishable`）を飛ばす経路・設定・テスト用の抜け道を作らない（Constitution原則I）
- `publishing`に移せるのは定期処理の取り出しだけ。APIから直接移す経路を作らない（原則II）
- `container_id`を保存する前に公開を送らない。`PUBLISHED`かもしれない間は新しいコンテナーを作らない（research.md R6）
- ログに本文・トークン・Threadsの応答の本文を出さない
- 投稿の時刻を時間帯で制限しない（FR-001b。深夜は案内だけ）
