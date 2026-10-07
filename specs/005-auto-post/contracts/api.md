# API契約：スケジュール投稿・自動投稿

**対象feature**：[spec.md](../spec.md) ／ **データモデル**：[data-model.md](../data-model.md) ／ **これまでのAPI契約**：[002](../../002-strategy-profile/contracts/api.md)、[003](../../003-prompt-bulk-register/contracts/api.md)、[004](../../004-review-approval/contracts/api.md)

`apps/api`に足す・変えるエンドポイントの契約。入出力の形は`packages/shared`のzodのスキーマで定義し、Webと共有する。定期処理の手順は[auto-post-job.md](./auto-post-job.md)、Threads APIの呼び出しは本書の最後の節に置く。

## 共通事項

001〜004の共通事項をそのまま使う。
- 認証と、Accountの`owner`だけに許可すること（FR-025）
- `404 ACCOUNT_NOT_FOUND`・`404 ITEM_NOT_FOUND`の使い分け
- `400 VALIDATION_FAILED`（`details`に項目名）
- `409 STALE_UPDATE`（`latest`に最新の値）
- 上限は`409 ITEM_LIMIT_REACHED`
- 要再接続のAccountでも使えること

本featureの追加：

- **プラン**：すべて全プランで使える（FR-004）。grower機能の判定はしない。
- **エラーコード**：2つ足す。
  - `409 DRAFT_PUBLISHING`：処理中の下書きを編集しようとしたとき（FR-008）
  - `409 THREADS_NOT_READY`：自動投稿をオンにする保存で、接続が切れている・投稿の権限がないとき（FR-002a。`details`に`needs_reconnect`か`no_publish_permission`）
- **直列化**：下書きの状態を変える操作（本featureの`prioritize`・`requeue`を含む）は、004と同じ「Account × 下書き」のロックの中で行う。定期処理の取り出しも同じロックを使う（research.md R7）。

## 型

```ts
type PostDraftStatus =
  | "needs_review" | "approved" | "rejected"          // 004
  | "publishing" | "published" | "publish_failed";    // 005

type PublishError = "network" | "threads_server" | "invalid_request" | "container_error" | "unknown";
type BlockedReason = "ng_word" | "over_threads_limit";

type PostDraft = {
  // 004 の項目に加えて
  prioritizedAt: string | null;     // 「次に投稿する」の日時
  carryover: boolean;               // 前の時刻から持ち越したか（carryover_attempt_id がある）
  publishedAt: string | null;
  threadsMediaId: string | null;
  threadsPermalink: string | null;  // 投稿済みでも、URLを取る前は null（research.md R6）
  publishFailedAt: string | null;
  publishError: PublishError | null;
  blockedAt: string | null;         // 投稿の直前のチェックで要確認に戻した日時
  blockedReason: BlockedReason | null;
  blockedWords: string[];           // ng_word のときの言葉。ほかは []
};

type PostingSchedule = {
  enabled: boolean;
  slotTimes: string[];      // "HH:MM"（日本時間）。昇順。最大10件
  jitter: boolean;
  version: number;          // 行がないときは 0（最初の保存は expectedVersion: 0）
};

type DraftCounts = {
  // 004 の3つに加えて
  published: number;
  publishFailed: number;    // approved は publishing を含む
};

type AutoPostNotice =
  | { kind: "publish_failed"; count: number; latestError: PublishError; latestAt: string }
  | { kind: "blocked"; count: number; latestReason: BlockedReason; latestWords: string[] }
  | { kind: "needs_reconnect" }
  | { kind: "rate_limited"; until: string }
  | { kind: "no_approved"; nextSlotAt: string | null };

type AutoPostState = {
  enabled: boolean;
  slotCount: number;
  stoppedReason: "needs_reconnect" | "rate_limited" | null;
};

type SkipReason = /* 004 の6つ */ | "PUBLISHING";

type ThreadsCheck =
  | { status: "ok"; quotaUsage: number; quotaTotal: number }
  | { status: "needs_reconnect" }
  | { status: "no_publish_permission" }
  | { status: "unknown" };
```

- 時刻はAPIの入出力では`"HH:MM"`の文字列にし、DBでは分の数（`slot_minutes`）にする。変換は`packages/shared`の関数で行う。
- 日時はすべてISO 8601（UTC）。表示の日本時間への変換はWebで行う。

## 変更するエンドポイント

### GET /api/accounts/:accountId/post-drafts（003・004）

承認済みのタブの予定と、投稿に失敗の下書きを足す（FR-021、research.md R10）。投稿済みは返さない（下の`GET /post-drafts/published`。R14）。

- **200**：

  ```json
  {
    "needsReview":   [ /* 004と同じ */ ],
    "approved":      [ /* PostDraft[]。投稿の順（research.md R4）。publishing を含む */ ],
    "rejected":      [ /* 004と同じ */ ],
    "publishFailed": [ /* PostDraft[]。publishFailedAt の新しい順。すべて */ ],
    "schedule": { "<draftId>": "2026-10-06T03:00:00.000Z" },
    "autoPost": { "enabled": true, "slotCount": 3, "stoppedReason": null },
    "counts": { "needsReview": 12, "approved": 30, "rejected": 640, "published": 210, "publishFailed": 1 },
    "limits": { "needsReview": 500, "approved": 500 },
    "ngWords": [ /* 004と同じ */ ],
    "canGeneratePrompt": true,
    "promptPostCount": 30
  }
  ```

- `schedule`は、自動投稿がオンで止まっていないときだけ、`approved`の先頭から順に予定の時刻を入れる（research.md R9）。処理中の下書きは入れない。オフ・停止中は`{}`。
- 004で「承認した日時の新しい順」だった`approved`の並びは、本featureで投稿の順に変わる（Webも同時に変える）。

### GET /api/accounts/:accountId/post-drafts/counts（004）

`DraftCounts`の5つを返す。サイドバーは引き続き`needsReview`だけを使う（FR-023）。

### PUT /api/accounts/:accountId/post-drafts/:draftId（003・004）

- **409** `DRAFT_PUBLISHING`：処理中の下書き（FR-008）。`latest`は`PostDraft`。
- 投稿済み・投稿に失敗の下書きは、却下と同じく`404 ITEM_NOT_FOUND`（編集の対象外）。
- 承認済みの下書きを要確認に戻すとき、`prioritized_at`・`carryover_attempt_id`も消す。要確認の下書きを保存するときは、`blocked_*`を消す。

### POST /api/accounts/:accountId/post-drafts/delete（003・004）

変更なし。対象は要確認と却下だけで、処理中・投稿済み・投稿に失敗のIDは無視する（FR-020）。

### POST /api/accounts/:accountId/post-drafts/review（004）

`action`に`requeue`を足し、`reopen`の元の状態を広げる（FR-015、research.md R4）。

| `action` | 元の状態 | 後の状態 | 記録 |
|---|---|---|---|
| `approve`・`reject` | 要確認 | 004と同じ | 要確認の`blocked_*`を消す |
| `reopen` | 承認済み・却下・**投稿に失敗** | 要確認 | `reviewed_at`・失敗の記録・`prioritized_at`・`carryover_attempt_id`を消す |
| `requeue`（新規） | 投稿に失敗 | 承認済み | 失敗の記録を消し、`prioritized_at`を今にする。`reviewed_at`は元のまま |

- `requeue`は、承認済みの上限（500件）を数える（超えれば`skipped: LIMIT`）。
- `requeue`ではNGワードの判定をしない。投稿の直前のチェック（FR-007）で確かめる。
- 処理中の下書きは`skipped: PUBLISHING`。投稿済みの下書きは`skipped: STALE`（元の状態に当たらない）。
- 再試行の扱い（`requestId`）は004と同じ。

### GET /api/accounts/:accountId/prompt（003・004）

- `summary`に`dailyPostCount`（時刻の数）を足す。
- プロンプトの文面は、[prompt-template.md](./prompt-template.md)のとおり、時刻が1件以上のとき宣伝の節が変わる（FR-024）。

## 追加するエンドポイント

### GET /api/accounts/:accountId/posting-schedule

「このアカウントの設定」の「投稿のスケジュール」に使う（FR-001）。

- **200**：`{ "schedule": PostingSchedule, "limits": { "slots": 10, "minGapMinutes": 30, "jitterMinutes": 10 } }`
- 行がなければ`{ "enabled": false, "slotTimes": [], "jitter": true, "version": 0 }`。

### PUT /api/accounts/:accountId/posting-schedule

投稿の設定を保存する（FR-001〜FR-003・FR-012）。

- **リクエスト**：`{ "enabled": boolean, "slotTimes": string[], "jitter": boolean, "expectedVersion": number }`
- **検証**（`validatePostingSchedule`。research.md R1）：
  - `slotTimes`は`"HH:MM"`（00:00〜23:59）・最大10件・重複なし（並びは問わず、保存の時に昇順にする）
  - `enabled: true`なら1件以上
  - `jitter: true`なら、隣り合う時刻の間が30分以上
  - 違反は`400 VALIDATION_FAILED`。`details`は`slotTimes`・`enabled`のどれか。理由は`reason`（`too_many`・`duplicate`・`too_close`・`required`）で返す
- **投稿の権限の確認**（FR-002a、research.md R15）：`enabled: true`の保存では、検証の後、保存の前に`threads_publishing_limit`を呼んで確かめる。
  - `needs_reconnect`・`no_publish_permission`なら保存せず、**409** `THREADS_NOT_READY`（`details: ["needs_reconnect"]`か`["no_publish_permission"]`）。`needs_reconnect`のときは、Accountを要再接続にする。
  - `unknown`なら保存し、レスポンスに`connectionCheck`を入れる。
  - `enabled: false`の保存では確かめない。
- **200**：`{ "schedule": PostingSchedule, "connectionCheck": ThreadsCheck | null }`（確かめなかったときは`null`）
- **409** `STALE_UPDATE`：`latest`は`PostingSchedule`
- 保存した時刻を`effective_from`にするのは、オフからオン、時刻の変更、ずらすかの切り替えのとき（data-model.md）。
- コミットの後、Workers KVの`autopost:wake`に`{ at: コミットした時刻 }`を書く（research.md R3）。
  - `ctx.waitUntil`で行い、失敗したら最大3回まで書き直す（同じキーへの書き込みは1秒に1回までのため）。
  - それでも失敗したら、エラーのログを出す。保存は成功として返す。その後、だれかの予定の時刻にDBの処理が動いた時点（または24時間以内）で、新しい設定が読み込まれる（research.md R3「見直しをやめた理由」）。

### GET /api/accounts/:accountId/auto-post

ホームの「次の投稿」のカードと、知らせ（投稿ストック・ホーム）に使う（FR-018・FR-022、research.md R8・R9）。

- **200**：

  ```json
  {
    "autoPost": { "enabled": true, "slotCount": 3, "stoppedReason": null },
    "next": {
      "at": "2026-10-06T03:00:00.000Z",
      "draft": { "id": "…", "excerpt": "本文の書き出し（40文字まで）" }
    },
    "approvedCount": 30,
    "daysLeft": 10,
    "notices": [ /* AutoPostNotice[]。0件の知らせは入れない */ ]
  }
  ```

- `next`は、自動投稿がオフ・停止中・承認済みが0件のとき`null`。承認済みが0件でオンのときは、`no_approved`の知らせに次の時刻を入れる。
- `daysLeft`は「承認済みの件数 ÷ 時刻の数」の切り捨て。時刻が0件なら`null`。
- 知らせの並びは、`needs_reconnect`・`rate_limited`・`publish_failed`・`blocked`・`no_approved`の順（重いものから）。

### POST /api/accounts/:accountId/auto-post/notices/blocked/dismiss

「投稿の直前に要確認へ戻した」の知らせを閉じる（FR-018「ユーザーが確認するまで」）。

- **リクエスト**：なし
- **204**：`posting_schedules.blocked_notice_seen_at`を今にする（行がなければ作る。`version`は変えない）。
- 下書きごとの理由（`blockedReason`）は消さない。その下書きの状態が変わるまで、カードに出し続ける。

### GET /api/accounts/:accountId/post-drafts/published

投稿済みのタブ（FR-020）。タブを開いたときと「もっと見る」のときだけ読む（research.md R10・R14。Neonの通信量を抑えるため）。

- **クエリ**：`before`（任意。前のページの`nextCursor`）、`limit`（任意。1〜50、既定50）
- **200**：`{ "items": PostDraft[], "nextCursor": string | null }`
  - `items`は`published_at`の新しい順（同じ日時は`id`の順）。
  - `nextCursor`は、最後の項目の`published_at`と`id`を組にした不透明な文字列。続きがなければ`null`。
  - `before`が読めない（形が壊れている・IDがUUIDでない）ときは **400** `VALIDATION_FAILED`（`details: ["before"]`）。
- 件数は`GET /post-drafts`の`counts.published`を使う。
- 列は画面で使うもの（`id`・`body`・`publishedAt`・`threadsPermalink`・`threadsMediaId`）に絞ってよい。型は`PostDraft`の一部（`PublishedPost`）とする。

### POST /api/accounts/:accountId/threads-check

「接続を確かめる」（FR-002b、research.md R15）。投稿はしない。

- **リクエスト**：なし
- **200**：`ThreadsCheck`
  - `ok`のとき、`quotaUsage`（直近24時間の投稿数）・`quotaTotal`（250）
  - Accountがすでに要再接続なら、Threadsを呼ばずに`needs_reconnect`
  - 認証エラーなら、Accountを要再接続にしてから`needs_reconnect`（世代番号を条件に。001 R6）
- 自動投稿のオン・オフに関係なく使える。

### POST /api/accounts/:accountId/post-drafts/:draftId/prioritize

「次に投稿する」（FR-005a、research.md R4）。

- **リクエスト**：`{ "expectedVersion": number }`
- **200**：`{ "draft": PostDraft }`。`prioritized_at`を今にし、`version`を1増やす。
- **404** `ITEM_NOT_FOUND`：ない・別のAccountのもの・承認済みでない（処理中を除く）
- **409** `DRAFT_PUBLISHING`：処理中
- **409** `STALE_UPDATE`（`latest`は`PostDraft`）
- 同じ下書きにもう一度送ると、日時が新しくなり先頭のまま（再試行しても害はない）。

## 定期処理

`scheduled`の処理を、`controller.cron`で分ける。

| Cron | 処理 |
|---|---|
| `0 18 * * *`（001） | 日次の処理（001〜004）。本featureで2つ足す：30日より前の`publish_attempts`を消す（`in_progress`・`retry_wait`は、下書きが`publishing`のまま残るので消さない。持ち越しで下書きの`carryover_attempt_id`が参照している試みも、次の時刻の優先と「持ち越しは1回だけ」を決めるので消さない）、`paused_until`を過ぎた行を NULL にする |
| `*/5 * * * *`（新規） | 自動投稿（`runAutoPost(env, now)`）。手順は[auto-post-job.md](./auto-post-job.md) |

## 環境変数・バインディング

| 名前 | 種類 | 説明 |
|---|---|---|
| `AUTOPOST_KV` | KV Namespace（新規） | 定期処理の関所（`autopost:gate`・`autopost:wake`）。research.md R3 |

- `wrangler.toml`に`[[kv_namespaces]]`を足す。ローカルとテストは、Miniflareのメモリ上のKVを使う。
- 設定の確認（001の`validateConfig`）に、`AUTOPOST_KV`があることを足す。

## Threads APIの呼び出し（`apps/api/src/lib/threads-client.ts`に足す）

トークンは001と同じく`Authorization: Bearer`で渡す。どの呼び出しも、10秒でタイムアウトにする（`AbortSignal.timeout`）。

| メソッド | 呼び出し | 返す値 |
|---|---|---|
| `createTextContainer(token, userId, text)` | `POST /v1.0/{userId}/threads`（`media_type=TEXT`、`text`） | `{ containerId }` |
| `publishContainer(token, userId, containerId)` | `POST /v1.0/{userId}/threads_publish`（`creation_id`） | `{ mediaId }` |
| `getContainerStatus(token, containerId)` | `GET /v1.0/{containerId}?fields=status,error_message` | `{ status: "IN_PROGRESS" \| "FINISHED" \| "PUBLISHED" \| "ERROR" \| "EXPIRED" }`（`error_message`はログにだけ出す） |
| `getMedia(token, mediaId)` | `GET /v1.0/{mediaId}?fields=id,permalink,timestamp` | `{ id, permalink, timestamp }` |
| `getPublishingLimit(token, userId)` | `GET /v1.0/{userId}/threads_publishing_limit?fields=quota_usage,config` | `{ quotaUsage, quotaTotal }`（`config.quota_total`） |
| `listRecentThreads(token, userId, since)` | `GET /v1.0/{userId}/threads?fields=id,text,permalink,timestamp&since=…&limit=25` | `{ id, text, permalink, timestamp }[]` |

失敗は次のエラーとして投げる（research.md R7）。

| エラー | 条件 |
|---|---|
| `ThreadsAuthError`（001） | HTTP 401、コード190、`OAuthException` |
| `ThreadsRateLimitError`（新規） | コード4・17・32・613 |
| `ThreadsTransientError`（新規） | 通信の失敗・タイムアウト・HTTP 5xx・コード1・2 |
| `ThreadsApiError`（001） | 上記以外（確かな失敗。`status`を持つ） |

- 応答の本文（`error.message`）は、エラーにもログにも入れない（001と同じ）。コードと`status`だけを使う。
- 偽のThreadsサーバー（`apps/api/test/fake-threads/server.ts`）に、上の6つの呼び出しと、`/__control/publish-permission`（ユーザーごとに投稿の権限をなくす。`threads`・`threads_publish`・`threads_publishing_limit`がコード10・HTTP 403になる）、制御用の`/__control/publish-failures`（失敗の種類と回数）・`/__control/drop-publish-response`（公開は成功させ、応答だけを失わせる）・`/__control/posts`（公開した投稿の一覧）を足す。
