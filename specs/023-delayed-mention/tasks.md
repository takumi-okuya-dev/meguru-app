---

description: "Task list for feature 023 delayed mention"
---

# Tasks：時間差のメンション

**Input**: [spec.md](./spec.md)、[plan.md](./plan.md)、[research.md](./research.md)、[data-model.md](./data-model.md)、[contracts/api.md](./contracts/api.md)、[contracts/mention-job.md](./contracts/mention-job.md)、[contracts/ui-routes.md](./contracts/ui-routes.md)、[quickstart.md](./quickstart.md)

**Tests**: 001〜022と同じく、テストを先に書いて失敗を確かめてから実装する（TDD）。特に次を自動テストで確かめる。
- SC-002：承認していない返信の文、NGワードを含む返信の文が、1つもThreadsに出ない
- SC-003：同じ投稿に、時間差のメンションの返信が2回出ない
- SC-004：同じ人が、1つのアカウントから24時間に2回以上メンションされない
- SC-006：承認の権限のない人・関わりのない人・自動投稿が使えない人が、付けたり設定を変えたりできない
- SC-007：「いつも付ける」の人がいれば、1回の操作で付き、画面を移らない

**Organization**: spec.md の User Story ごと。US1はUS2（メンションする人の設定）を使うので、US2を先に作る。MVPはUS2・US1（P1）。

## Format: `[ID] [P?] [Story] Description`

- **[P]**：別ファイルで、未完了のタスクに依存せず並行できる。
- **[Story]**：[US1]〜[US4]はspec.mdのUser Storyに対応する。
- 共通のテストは `packages/shared/test/mention.test.ts`。
- APIのテストは次のとおり。Threadsのクライアントは `apps/api/test/helpers/auto-post.ts` の差し替えを使い、チームの関わりは `helpers/team.ts`、機能のOFFは `helpers/features.ts` を使う。
  - `apps/api/test/integration/mention-settings.test.ts`（設定・人）
  - `mention-attach.test.ts`（付ける・承認）
  - `mention-runner.test.ts`（定期処理）
- Webのテストは `apps/web/test/mention.test.tsx`（カード）と `apps/web/test/mention-settings.test.tsx`（設定）。
- 画面はモック（https://claude.ai/artifact/Wgz1WNWYUDdUXwn1GgS6GP ）と contracts/ui-routes.md のとおり。ポップアップは開かない。色は今の色（`muted`・`warning`・`destructive`）だけ。
- 返信の権限（`threads_manage_replies`）について：ユーザーは「トークンに入っていた記憶がある」（2026-11-05）。ただし、実際に返信が出るかは T048 で確かめる。

## Phase 1: Setup

- [ ] T001 `packages/shared/src/limits.ts` に定数を足す（data-model.md「共有の定数」）：`MENTION_PEOPLE_MAX = 20`・`MENTION_PER_REPLY_MAX = 5`・`MENTION_MESSAGE_MAX = 100`・`MENTION_LABEL_MAX = 30`・`MENTION_DELAY_OPTIONS = [10, 30, 60, 180, 360, 720, 1440] as const`・`MENTION_DELAY_DEFAULT = 30`・`MENTION_SAME_PERSON_HOURS = 24`・`MENTION_EXPIRE_HOURS = 24`・`MENTION_PUBLISHED_DAYS = 7`・`MENTION_MAX_ATTEMPTS = 3`・`MENTION_MAX_PER_TICK = 10`。
- [ ] T002 [P] `packages/shared/test/mention.test.ts` を書き、`packages/shared/src/mention.ts` を作る（data-model.md「共有の関数」）：
  - `normalizeMentionUsername`：前後の空白と先頭の@を外して小文字にし、`^[a-z0-9._]{1,30}$` でなければ null
  - `buildMentionText(message, usernames)`：ひとこと＋改行＋`@a @b`。ひとことが空なら `@a @b` だけ
  - `mentionDueAt({ delayMinutes, sendAfter }, publishedAt)`：`sendAfter` があればそれ。なければ `publishedAt＋delayMinutes`。投稿の前なら null
  - `mentionUsernamesIn(text, people)`：文の中の `@ユーザー名` のうち一覧にある人（大文字・小文字をそろえる、重なりなし、文の順）
  - `toggleMentionInText(text, username)`：最後の行に足す（最後の行に @ がなければ行を足す）・あれば消す（空の行は残さない）
  - `MENTION_FAILURE_LABELS`：`not_found` 投稿が見つかりません・`post_failed` 投稿されませんでした・`no_permission` 返信の権限がありません・`expired` 時間が過ぎました・`ng_word` NGワード・`limit` 同じ人へのメンションが多すぎます・`error` Threadsが受け付けませんでした
  - `packages/shared/src/index.ts` から出す
- [ ] T003 [P] `packages/shared/src/schemas.ts` に入出力を足す（contracts/api.md）：
  - `mentionSettingsSchema`（応答）・`mentionSettingsRequestSchema`（`expectedVersion` は1以上かnull、`message` は前後の空白を除いて100文字まで、`delayMinutes` は `MENTION_DELAY_OPTIONS` のどれか）
  - `mentionPersonRequestSchema`（`username`・`label` は1〜30文字・`always?`）・`mentionPersonPatchSchema`
  - `postMentionSchema`（`PostDraft.mention`）と `postDraftSchema.mention`（`.nullable().default(null)`）
  - `mentionAttachRequestSchema`（`expectedVersion`・`usernames` 1〜5件・`text?` 1〜500文字）・`mentionAttachResponseSchema`（`draft`・`blocked`）
  - `mentionBulkRequestSchema`（`items` 1〜50件）
  - `packages/shared/test/mention.test.ts` に形のテストを足す

## Phase 2: Foundational

### Tests（先に書いて失敗を確かめる）

- [ ] T004 [P] `apps/api/test/migration/migration-0021.test.ts` を書く（data-model.md）：
  - `accounts.replies_denied_at`（NULL可）
  - `mention_settings`：`delay_minutes` の CHECK、初めの値
  - `mention_people`：`username` の CHECK `^[a-z0-9._]{1,30}$`、`(account_id, username)` の一意、Accountの削除で消える
  - `post_mentions`：`state`・`failure_reason` の CHECK、`delay_minutes IS NOT NULL OR send_after IS NOT NULL`、`(state='failed') = (failure_reason IS NOT NULL)`、`(state='sent') = (sent_at IS NOT NULL)`、下書きの削除で消える
- [ ] T005 [P] `apps/api/test/integration/mention-settings.test.ts` に守りを書く：
  - オーナーと担当の人は `GET /mention-settings` を読める
  - 見せてもらっている人は `ROLE_FORBIDDEN`、関わりのない人は `ACCOUNT_NOT_FOUND`、自動投稿がOFFは `FEATURE_DISABLED`
  - `settings` のない人（担当の編集者）は `PUT`・人の追加・変更・削除が `ROLE_FORBIDDEN`
  - `review` のない人は `PUT /post-drafts/:id/mention` が `ROLE_FORBIDDEN`
  - `apps/api/test/helpers/routes.ts` の表に新しいルートを足す

### Implementation

- [ ] T006 `apps/api/src/db/schema.ts` に `accounts.repliesDeniedAt`・`mentionSettings`・`mentionPeople`・`postMentions` を足し（data-model.md の列・CHECK・索引のとおり）、`pnpm --filter ./apps/api db:generate --name delayed_mention` で `apps/api/drizzle/0021_delayed_mention.sql` と `drizzle/meta` を作る（T004を通す）。
- [ ] T007 `apps/api/src/services/mention-service.ts` と `apps/api/src/routes/mention.ts` の枠を作り、判定を通す（research.md R9）：読むのは `authorizeAccount(..., "view", { feature: "autopost" })`、設定は `"settings"`、付ける・外す・やめるは `"review"`。`apps/api/src/app.ts` に足す（T005を通す）。
- [ ] T008 [P] `apps/api/src/lib/threads-client.ts` の `createTextContainer` に `opts?: { replyToId?: string }` を足し、`reply_to_id` を送る。テストの差し替え（`apps/api/test/helpers/auto-post.ts`）が `replyToId` を記録できるようにする。

**Checkpoint**: 表ができ、APIの守りが通る。

## Phase 3: User Story 2 - メンションする人・ひとこと・時間差を決める（P1）

**Goal**: このアカウントの設定で、メンションする人（「いつも付ける」つき）・ひとこと・時間差を決められる。

**Independent Test**: 設定で3人足して1人消し、1人を「いつも付ける」にし、ひとことと時間差（1時間）を保存すると、GETに反映される。

### Tests（先に書いて失敗を確かめる）

- [ ] T009 [P] [US2] `apps/api/test/integration/mention-settings.test.ts` に足す：
  - 初めの値（`message: ""`・`delayMinutes: 30`・`version: null`）
  - 保存と衝突（`STALE_UPDATE`）
  - ひとことのNGワードで `VALIDATION_FAILED`（`details: ["message"]`）
  - 人の追加：`@Minato_Place` → `minato_place`。形が違う・21人目・同じ人・そのAccountのユーザー名は `VALIDATION_FAILED`
  - 「いつも付ける」と呼び名の変更
  - `pendingCount`
  - 人を消したとき（research.md R6）：要確認の下書きでは選んだ人と文から外れ、だれも残らなければ行が消える。承認済みの下書きは同じく外れて要確認に戻る。投稿済みの `pending` は文を変えずに `canceled`
  - 操作の記録（`mention_settings_updated`）
- [ ] T010 [P] [US2] `apps/web/test/mention-settings.test.tsx` を書く（contracts/ui-routes.md「このアカウントの設定」）：
  - 時間差を選ぶと保存される
  - ひとことの「変更」→ 入力 →「保存」
  - 人を足す・「いつも付ける」を切り替える・消す（`pendingCount` があれば確認が出る）
  - 「4 / 20人」の表示
  - 返信の権限がないときの注意の帯と「作り直し方」のリンク
  - `canEdit` がなければ操作が出ない
  - 閉じたトグル「時間差のメンションについて」の箇条書き4つ

### Implementation

- [ ] T011 [US2] `apps/api/src/services/mention-service.ts` に `getMentionSettings`・`saveMentionSettings`・`addMentionPerson`・`updateMentionPerson`・`removeMentionPerson` を作り、`apps/api/src/routes/mention.ts` に `GET`・`PUT /mention-settings`、`POST /mention-people`、`PATCH`・`DELETE /mention-people/:personId` を足す（`withTransaction`・`recordActivity`。T009を通す）。
- [ ] T012 [P] [US2] `apps/web/src/lib/api-client.ts`・`query.ts` にメンションの設定と人の読み書きを足す（`queryKeys.mentionSettings(accountId)`）。
- [ ] T013 [US2] `apps/web/src/components/settings/MentionSettingsSection.tsx` を作り、`apps/web/src/pages/account-settings.tsx` の投稿のルールの区分の下に置く（`SettingCard`・`SettingRow`・`HelpToggle`。T010を通す）。

**Checkpoint**: メンションする人・ひとこと・時間差を決められる。

## Phase 4: User Story 1 - 承認するときに、時間差のメンションを付ける（P1）🎯 MVP

**Goal**: 要確認の下書きのカードで1回押して付け、下書きと一緒に承認すると、投稿の時間差のあとに返信が出る。

**Independent Test**: 2人を「いつも付ける」にし、時間差を30分にしたアカウントで、「メンションを付ける」を1回押して承認する。投稿から30分後の最初の回に、その投稿への返信「ひとこと\n@a @b」が出る。

### Tests（先に書いて失敗を確かめる）

- [ ] T014 [P] [US1] `apps/api/test/integration/mention-attach.test.ts` を書く（contracts/api.md「付ける・直す・外す」）：
  - 要確認に付けると行ができ、下書きの `version` が上がる。`text` を省くと `buildMentionText`
  - 付けたあとに設定の時間差を変えても、付けた行の `delay_minutes` は変わらない（FR-005）
  - `text` を送ると、`usernames` が文の中の一覧の人で求め直される。一覧にない @ユーザー名 は数えない。0人・6人は `VALIDATION_FAILED`（FR-011）
  - 承認済みに付ける・直すと要確認に戻る
  - 一覧にない人・6人は `VALIDATION_FAILED`
  - 選べない人（ほかの下書きで `pending`・24時間以内に `sent`）は `VALIDATION_FAILED`。応答の `blocked` に理由が入る
  - まとめて付ける（`POST /post-drafts/mentions`）：「いつも付ける」の人で付く。いない・版の違いは `skipped`
  - 外す（`DELETE`）
  - 処理中は `DRAFT_PUBLISHING`
  - 下書きの一覧・1件の応答に `mention` が入り、見せてもらっている人には null
  - 操作の記録（`mention_attached`）
- [ ] T015 [P] [US1] `apps/api/test/integration/mention-attach.test.ts` に承認を足す（research.md R5）：
  - 返信の文にNGワード → `NG_WORD`
  - 500文字を超える → `OVER_THREADS_LIMIT`
  - 規約に注意で確認なし → `POLICY_CONFIRM_REQUIRED`
  - 承認できたら `notifyWake` の印が書かれる
  - 却下すると行が消える（SC-002）
- [ ] T016 [P] [US1] `apps/api/test/integration/mention-runner.test.ts` を書く（contracts/mention-job.md 7-1〜7-4）：
  - 時間差の前は出さない
  - 過ぎた最初の回に、`replyToId` を投稿の `threads_media_id` にして出し、`sent`・`sent_at`・`reply_media_id` が入る
  - 公開の結果が分からない → 次の回に `getContainerStatus` で `PUBLISHED` なら `sent`、`FINISHED` なら送り直す。同じ投稿に2回出ない（SC-003）
  - 出す直前のNGワード → `failed`（`ng_word`）
  - 過去24時間に返信を出した人が入っていれば、文を書き換えずに `failed`（`limit`）にする。出した文は承認した文と1文字も変わらない（SC-002・SC-004）
  - 1回に10件まで、残りがあれば関所が「すぐ続ける」
  - 次の予定の時刻が関所の候補に入る
  - 段階が例外を投げても、公開の結果（`RunSummary.published`）は変わらない
- [ ] T017 [P] [US1] `apps/web/test/mention.test.tsx` を書く（contracts/ui-routes.md「投稿ストック（要確認）」）：
  - 「メンションを付ける」の1回で `PUT` が送られ、カードの中に「投稿の30分後にメンション」・丸いボタン・文が出る（SC-007）
  - 丸いボタンで入れ替え（`toggleMentionInText` で作った文と一緒に、その場で `PUT`）
  - 選べない人は押せず理由が出る
  - 「文を直す」→「文を保存」
  - 「外す」
  - NGワードの枠と、承認が押せない
  - 選んだときの「メンションを付ける」
  - メンションする人がいない・返信の権限がないときはボタンが出ない
  - `canReview` がなければ操作が出ない

### Implementation

- [ ] T018 [US1] `apps/api/src/services/mention-service.ts` に `attachMention`・`attachMentionsBulk`・`detachMention`・`blockedPeople`（research.md R6）を作り、`apps/api/src/routes/mention.ts` に `PUT`・`DELETE /post-drafts/:draftId/mention` と `POST /post-drafts/mentions` を足す（下書きの版と要確認に戻す扱いは `draft-service.ts` の本文の編集と同じ）。`apps/api/src/services/draft-service.ts` の下書きの読み出しに `post_mentions` を結合し、`toPostDraft` に `mention` を足す（`view` のない人は null）（T014を通す）。
- [ ] T019 [US1] `apps/api/src/services/review-service.ts` の `approve` で返信の文も `checkPublishable` に通し、承認できたら `notifyWake`。`reject` で `post_mentions` の行を消す（T015を通す）。
- [ ] T020 [US1] `apps/api/src/services/mention-runner.ts` に `runMentionStage(env, db, threads, { now })` を作る（contracts/mention-job.md の 7-1〜7-3。借り・二重に出さない・NGワード・同じ人の24時間・一時的な失敗のやり直し）。`apps/api/src/services/auto-post-runner.ts` の 6. の後に呼び、7-4 の関所の候補と `immediate` を足す（T016を通す）。
- [ ] T021 [P] [US1] `apps/web/src/lib/api-client.ts`・`query.ts` に付ける・外す・まとめて付けるを足す。保存したら `queryKeys.postDrafts(accountId)` を取り直す。
- [ ] T022 [US1] `apps/web/src/components/stock/MentionPanel.tsx` を作り、`apps/web/src/components/stock/DraftCard.tsx` の本文と承認のボタンの間に置く。`apps/web/src/components/stock/SelectionBar.tsx` に「メンションを付ける」を足す（T017を通す）。

**Checkpoint**: US2・US1で、設定した人を1回押して付け、承認すると時間差で返信が出る。

## Phase 5: User Story 3 - 出せなかったときに分かる（P2）

**Goal**: 返信を出せなかったときに、投稿済みの一覧で理由が分かる。返信の権限がないことが、つなぐときに分かる。

**Independent Test**: 返信の権限のないトークンのアカウントで、時間差のメンションを付けた投稿の返信の時刻を過ぎても返信が出ず、投稿済みの一覧に「出せませんでした（返信の権限がありません）」と出る。

### Tests（先に書いて失敗を確かめる）

- [ ] T023 [P] [US3] `apps/api/test/integration/mention-runner.test.ts` に足す（contracts/mention-job.md 7-2・7-3 の表）：
  - 投稿に失敗・削除 → `post_failed`
  - 24時間を過ぎた → `expired`
  - `replies_denied_at` がある → `no_permission`
  - 権限のエラー → `no_permission` で `replies_denied_at` が入る
  - 返信先が見つからない → `not_found`
  - 一時的な失敗 → やり直し、3回で `error`
  - 認証のエラー → 要再接続にして待つ
  - 要再接続・読むだけ・まとまりOFF → 24時間までは待つ
- [ ] T024 [P] [US3] `apps/api/test/integration/token-connect.test.ts` と `token-recheck.test.ts` に足す：
  - `debug_token` の権限に `threads_manage_replies` がない → `replies_denied_at` が入り、`warnings` に `no_replies_permission`
  - ある・読めない → NULL
  - つなぎ直すと NULL
- [ ] T025 [P] [US3] `apps/web/test/mention.test.tsx` に足す：
  - 投稿済みのカードの `pending`（「21:30 に返信予定」・「メンションをやめる」）
  - `sent`（「返信済み」・「返信を開く」）
  - `canceled`
  - `failed`（失敗の色の枠と `MENTION_FAILURE_LABELS` の理由）

### Implementation

- [ ] T026 [US3] `apps/api/src/services/mention-runner.ts` に 7-2・7-3 の理由ごとの扱いを足す（T023を通す）。
- [ ] T027 [US3] `apps/api/src/services/token-connect.ts`・`token-recheck.ts`・`account-service.ts` で、`replies_denied_at` を入れる・消す。`TokenWarning` に `no_replies_permission` を足し、Webのトークンの結果の案内（`apps/web/src/components/` のトークンの警告）に文を足す。`apps/api/src/lib/threads-client.ts` の `THREADS_SCOPES` に `threads_manage_replies` を足し、`docs/next-features.md` §I（審査）の「申し込む権限」に `threads_manage_replies`（時間差のメンションの返信）を書き足す（T024を通す）。
- [ ] T028 [US3] `apps/web/src/components/stock/PublishedCard.tsx` に状態の枠と「メンションをやめる」を足す（`DELETE …/mention`）（T025を通す）。
- [ ] T029 [P] [US3] `apps/web/src/pages/guide-threads-token.tsx` の権限の一覧に「threads_manage_replies：時間差のメンションの返信を出す」を足す。

**Checkpoint**: 出せなかった理由と、返信の権限がないことが分かる。

## Phase 6: User Story 4 - 投稿済みの投稿にあとからメンションする（P2）

**Goal**: 投稿済みのカードで「メンションを付ける」→「返信する」を押すと、数分以内に返信が出る。

**Independent Test**: メンションのない投稿済みの投稿で「メンションを付ける」→「返信する」を押し、次の回に返信が出て「返信済み」になる。

### Tests（先に書いて失敗を確かめる）

- [ ] T030 [P] [US4] `apps/api/test/integration/mention-attach.test.ts` に足す（contracts/api.md「投稿済み」）：
  - 7日以内・アプリから投稿・メンションなし → `send_after` が入り `notifyWake`
  - 8日前・手で投稿（`threads_media_id` なし）・もう付いている・返信の権限がない・NGワード → `VALIDATION_FAILED`
  - 投稿済みの `pending` の `DELETE` → `canceled`
- [ ] T031 [P] [US4] `apps/api/test/integration/mention-runner.test.ts` に足す：
  - `send_after` を過ぎた最初の回に出る
  - 押してから24時間を過ぎた → `expired`
- [ ] T032 [P] [US4] `apps/web/test/mention.test.tsx` に足す：
  - 投稿済みのメンションのない投稿に「メンションを付ける」が出る（7日を過ぎた投稿には出ない）
  - 押すと「今からメンションする」の枠（まだ保存しない）
  - 「返信する」で `PUT`
  - NGワードがあると「返信する」が押せない

### Implementation

- [ ] T033 [US4] `apps/api/src/services/mention-service.ts` の `attachMention` に投稿済みの扱いを足す（T030を通す）。`mention-runner.ts` の `send_after` の扱いを確かめる（T031を通す）。
- [ ] T034 [US4] `apps/web/src/components/stock/PublishedCard.tsx` に「メンションを付ける」と、`MentionPanel` の投稿済みの形（「今からメンションする」・「返信する」・ひとこと）を足す（T032を通す）。

**Checkpoint**: 全部のUser Storyがそろう。

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T035 [P] 解析（022）の返信率から自分の返信を除く（research.md R7）：`apps/api/src/services/analysis-service.ts` の `loadAnalysisPosts` で、`post_mentions.sent_at <= post_metrics.last_fetched_at` なら返信の数から1を引く（0未満にしない）。`apps/api/test/integration/analysis.test.ts` にテストを足す。
- [ ] T036 [P] `apps/api/test/migration/` と `apps/api/test/integration/permissions-matrix.test.ts` が新しいルートで通ることを確かめる。
- [ ] T037 [P] `docs/ui-design.md` に、カードの中のメンションの枠・設定の区分を足す。
- [ ] T038 [P] `docs/user-guide.md` に「時間差のメンション」の使い方を足す（アカウントのID・テスト版のURL・秘密の値を入れない）。
- [ ] T039 [P] `docs/architecture.md` に、定期処理の段階・新しい表・二重に出さない仕組みを足す。`docs/external-services-setup.md` のトークンの権限に `threads_manage_replies` を足す。`docs/next-features.md` §K に、023で作ったものを書く。
- [ ] T040 `pnpm --filter ./packages/shared test && pnpm --filter ./apps/api test && pnpm --filter ./apps/web test && pnpm lint && pnpm -r exec tsc --noEmit` を通す。
- [ ] T041 PRを出し、`/code-review low` でセルフレビューして、結果をPRにコメントする。
- [ ] T042 **本番（main）に出す前に、ユーザーとテスト版で確かめる**（quickstart.md「2. テスト版で確かめる」）。作業用のブランチはテスト版に出せない（デプロイの関所が develop と main だけを通す）ので、CIが通りユーザーのOKが出たら `develop` に入れてテスト版で確かめる。main は develop より遅れて出すので、本番の利用者には影響しない。問題があれば、直しのPRを出す。確かめること：
  - トークンに返信の権限（`threads_manage_replies`）が入っているか。ユーザーは入っていた記憶がある。設定に注意の帯が出ないことで確かめる
  - 時間差のメンションを付けて承認し、時間差のあとに、その投稿への返信が出て、相手に通知が届くか
  - 投稿済みの投稿で「返信する」を押し、数分以内に返信が出るか
  - スマートフォンの幅で、カードの中の操作ができるか
  - 権限が足りずに出せなかったときは、research.md R1 を直し、トークンの案内を直してから、もう一度確かめる

## Dependencies & Execution Order

- **Phase 1 → Phase 2**：定数・関数・スキーマが先。
- **Phase 2 → US2 → US1**：US1はメンションする人と「いつも付ける」を使う。
- **US1 → US3**：出す処理に理由ごとの扱いを足す。
- **US1 → US4**：付ける・出す処理に、投稿済みの扱いを足す。US3とは独立。
- **Polish**：全部の後。T042はPRのあと、マージの前。

### 同じファイルを触るタスク（順に行う）

- `apps/api/src/services/mention-service.ts`：T007 → T011 → T018 → T033
- `apps/api/src/services/mention-runner.ts`：T020 → T026 → T033
- `apps/api/test/integration/mention-attach.test.ts`：T014 → T015 → T030
- `apps/api/test/integration/mention-runner.test.ts`：T016 → T023 → T031
- `apps/web/test/mention.test.tsx`：T017 → T025 → T032
- `apps/web/src/components/stock/PublishedCard.tsx`：T028 → T034

## Parallel Example

```text
# Phase 1
T002 mention.ts（shared）／ T003 schemas.ts

# Phase 2 のテスト
T004 migration-0021.test.ts ／ T005 mention-settings.test.ts（守り）

# US1 のテスト
T014・T015 mention-attach.test.ts ／ T016 mention-runner.test.ts ／ T017 mention.test.tsx
```

## Implementation Strategy

1. **MVP**：Phase 1・2 → US2 → US1。設定した人を1回押して付け、承認すると時間差で返信が出る。
2. **次**：US3（出せなかった理由・返信の権限）。
3. **その次**：US4（投稿済みの投稿にあとから）。
4. 各Checkpointで、そのStoryのテストと今までのテストが通ることを確かめる。
5. T042 のテスト版の確認が通るまでマージしない。
