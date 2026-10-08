---
description: "パフォーマンス分析と改善フィードバックの実装タスク"
---

# タスク（Tasks）：パフォーマンス分析と改善フィードバック

**入力**：`specs/006-performance-feedback/`の設計文書

**前提**：
- [plan.md](./plan.md)、[spec.md](./spec.md)、[research.md](./research.md)、[data-model.md](./data-model.md)
- [contracts/api.md](./contracts/api.md)、[contracts/metrics-job.md](./contracts/metrics-job.md)、[contracts/prompt-template.md](./contracts/prompt-template.md)、[contracts/csv.md](./contracts/csv.md)、[contracts/ui-routes.md](./contracts/ui-routes.md)
- [quickstart.md](./quickstart.md)、[docs/ui-design.md](../../docs/ui-design.md)、[docs/threads-algorithm-research.md](../../docs/threads-algorithm-research.md)、005の[contracts](../005-auto-post/contracts/)

**テスト**：quickstart.mdの「自動テスト」の表にあるテストを、該当するフェーズで先に書く（失敗することを確認してから実装する）。001〜005と同じ進め方。

**構成**：ユーザーストーリーごとにフェーズを分け、各ストーリーを単独で実装・テストできるようにする。

## 書式：`[ID] [P?] [Story] 説明`

- **[P]**：並行して進められる（別ファイルで、未完了のタスクに依存しない）
- **[Story]**：対応するユーザーストーリー（US1〜US3）
- 説明には、変更するファイルのパスを含める

## パスの規約（plan.mdの構成）

- API：`apps/api/src/`、テストは`apps/api/test/`
- Web：`apps/web/src/`、テストは`apps/web/test/`
- 共通：`packages/shared/src/`、テストは`packages/shared/test/`

## 001〜005から使い回す部品

- **API**：
  - `findOwnedAccount`（`apps/api/src/services/access.ts`）、`requireGrowerAccess`・`canEditProfile`（`apps/api/src/services/grower-access.ts`）
  - `parseBody`（`apps/api/src/lib/validate.ts`）、`AppError`・`itemNotFound`・`notFound`（`apps/api/src/lib/errors.ts`）
  - `createDb`・`withTransaction`（`apps/api/src/db/client.ts`）
  - `loadThreadsCredentials`（`apps/api/src/services/threads-credentials.ts`）、要再接続にするときの世代番号の条件（`apps/api/src/services/token-refresh.ts`の`markNeedsReconnect`と同じ書き方）
  - 005の`runAutoPost`・`computeNextCheckAt`・`readGate`・`writeGate`（`apps/api/src/services/auto-post-runner.ts`・`auto-post-gate.ts`）、投稿済みの一覧のカーソル（`draft-service.ts`の`encodeCursor`・`decodeCursor`）
  - テストの`createUserWithAccount`・`setAccount`・`AFTER_TRIAL`・`resetDb`・`db`・`fake`・`makeApp`・`call`（`apps/api/test/helpers/app.ts`）
- **Web**：
  - `PageHeader`、`GrowerRequiredBanner`の文言（`GROWER_REQUIRED_MESSAGE`は使わず、`PLAN_CHANGE_CONTACT`を使う）、`ReconnectButton`
  - 005の`PublishedCard`・`use-published.ts`（カーソルで続きを読む書き方）、`formatDateTime`（`apps/web/src/lib/format.ts`）
  - `queryKeys`（`apps/web/src/lib/query.ts`）、`api-client.ts`
- **共通**：`hasGrowerAccess`（`packages/shared/src/access.ts`）、`buildPrompt`（`packages/shared/src/prompt.ts`）、`jstDateOf`・`addDays`（`packages/shared/src/schedule.ts`）、文字数の数え方（`countChars`。`packages/shared/src/text.ts`）

---

## Phase 1：セットアップ

**目的**：画面とテストで使う、ほかに依存しない準備。

- [ ] T001 [P] 判定の色のトークンを足す。`apps/web/src/index.css`に`--perf-good-bg`・`--perf-good-fg`・`--perf-poor-bg`・`--perf-poor-fg`（ライト：好調 #FFF0DC／#8F4700、低調 #E3EEFB／#0B4F9E。ダーク：好調 #3B2A12／#FFB866、低調 #16304F／#8EC2FF）を足し、Tailwindのテーマから使えるようにする（contracts/ui-routes.md「判定のアイコン」）。
- [ ] T002 [P] 手動確認のシードを作る。`apps/api/scripts/seed-performance.ts`と`apps/api/package.json`の`seed:performance`（件数を引数で指定でき、500件も作れる）：投稿した日時を「1時間前・24時間前・72時間前・168時間前・10日前」にずらした投稿済みの下書き、確定済みの反応数（閲覧数 167・23・99・260・30・64）、低調の投稿6件を、ローカルのDBに作る（quickstart.md 手順1〜3）。本番の接続先では動かない（接続先のホストを確かめる）。

---

## Phase 2：基盤（すべてのユーザーストーリーの前提）

**目的**：定数・共通の計算・DB・Threadsの呼び出し。これが終わるまで、ユーザーストーリーに入らない。

### 共通パッケージ

- [ ] T003 [P] 共通の計算のテストを書く（失敗を確認する）。`packages/shared/test/performance.test.ts`：
  - `milestoneForElapsed(minutes)`：23:00〜25:00→`h24`、71:00〜73:00→`d3`、167:00〜169:00→`d7`、それ以外→`null`（境界の22:59・25:01を含む）
  - `catchUpKind(minutes, taken)`：取った時点（`h24`・`d3`・`d7`の集合）から、過ぎた時点のうち最も新しい1つ。経過が192時間（11,520分）を超えて`d7`がなければ`late`。過ぎた時点より後の時点を取っていれば`null`（例：`d3`を取っていれば`h24`は補わない）
  - `judge(views, baseline)`：`ratio >= 2.0`→`good`、`ratio <= 0.5`→`poor`、それ以外→`normal`。2.0ちょうど・0.5ちょうど・丸める前の値で比べる
  - `median([...])`：偶数個は真ん中2つの平均
  - `formatRatio(ratio)`：小数第1位（`×3.4`）
- [ ] T004 [P] `packages/shared/src/limits.ts`に定数を足す（plan.md「制約」）：`METRICS_MILESTONE_HOURS = { h24: 24, d3: 72, d7: 168 }`、`METRICS_WINDOW_MINUTES = 60`、`METRICS_LATE_AFTER_HOURS = 192`、`METRICS_MAX_CALLS_PER_TICK = 24`、`METRICS_CALLS_PER_PUBLISH = 8`、`METRICS_CATCHUP_HOUR_JST = 3`、`PERFORMANCE_BASELINE_SAMPLE = 30`、`PERFORMANCE_MIN_JUDGEABLE = 5`、`PERFORMANCE_GOOD_RATIO = 2`、`PERFORMANCE_POOR_RATIO = 0.5`、`PERFORMANCE_PAGE_SIZE = 50`、`PERFORMANCE_EXPORT_PAGE_SIZE = 200`、`FEEDBACK_MEMO_MAX = 200`、`PROMPT_POOR_POSTS = 5`、`FOLLOWER_ACTIVE_DAYS = 30`。
- [ ] T005 `packages/shared/src/performance.ts`を作り、`packages/shared/src/index.ts`から公開する（research.md R4・R5）。`milestoneForElapsed`・`catchUpKind`・`judge`・`median`・`formatRatio`・`confirmAtOf(publishedAt)`（＋7日）・`nextFetchAtOf(publishedAt)`（＋24時間）。T003を通す。
- [ ] T006 `packages/shared/src/schemas.ts`に型とzodのスキーマを足す（contracts/api.md「型」）：`Judgment`・`MetricsState`（`pending`を含む）・`MetricsKind`・`PerformanceTab`・`Metrics`・`PerformanceItem`・`PerformanceSummary`・`performanceQuerySchema`（`tab`既定`all`、`before`、`limit`は1〜50）・`feedbackRequestSchema`（`memo`は前後の空白を除いて200文字まで、空なら`null`。`memo`か`includeInPrompt`のどちらか1つ以上）・`exportQuerySchema`（`kind`は`posts`・`snapshots`）・`PostExportRow`・`SnapshotExportRow`（contracts/csv.md の列に対応）。
- [ ] T007 [P] `packages/shared/src/errors.ts`に文言を足す（contracts/ui-routes.md）：権限がない（「反応数を読む許可がありません。再接続して、インサイトの許可をオンにしてください」）、計測できません、grower機能を使えない（「パフォーマンス分析は有料の契約で使えます」）、メモの保存の失敗、書き出しの失敗。

### DB

- [ ] T008 `apps/api/src/db/schema.ts`を変える（data-model.md）。
  - 列挙型`metrics_state`（`updating`・`confirmed`・`late_confirmed`・`unmeasurable`）・`metrics_kind`（`h24`・`d3`・`d7`・`late`）・`judgment`（`good`・`normal`・`poor`）
  - `post_metrics`：`draft_id` PK・FK→`post_drafts.id`（削除で連鎖）、`account_id` NOT NULL・FK→`accounts.id`（削除で連鎖）、`state` NOT NULL、6つの数は integer NULL、`last_fetched_at`・`last_elapsed_minutes`・`last_kind`・`confirmed_at`・`unmeasurable_reason`（`no_media_id`・`not_found`）・`judgment`・`judgment_ratio`（double precision）・`judgment_baseline`（double precision）・`judged_at`・`feedback_memo`・`include_in_prompt` boolean NOT NULL DEFAULT true・`feedback_updated_at`・`created_at`・`updated_at`。CHECK：「`state = 'unmeasurable'` ⇔ `unmeasurable_reason IS NOT NULL`」「`state IN ('confirmed','late_confirmed')` ⇔ `confirmed_at IS NOT NULL`」「`judgment IS NOT NULL` ⇒ `state IN ('confirmed','late_confirmed') AND judgment_ratio IS NOT NULL AND judgment_baseline > 0`」「`char_length(feedback_memo) <= 200`」「6つの数は0以上」。インデックス`(account_id, state)`と`(account_id, judgment) WHERE judgment = 'poor'`
  - `post_metric_snapshots`：`id` PK、`draft_id`・`account_id`（削除で連鎖）、`kind` NOT NULL、`method` text NOT NULL（CHECKで`slot`・`daily`）、`fetched_at` NOT NULL、`elapsed_minutes` integer NOT NULL、6つの数は integer NULL。一意`(draft_id, kind)`、インデックス`(account_id, fetched_at)`
  - `follower_snapshots`：`account_id`（削除で連鎖）・`snapshot_date` date・`followers_count` integer NOT NULL・`captured_at` NOT NULL、主キー`(account_id, snapshot_date)`
  - `post_drafts`：`body_edit_tracked` boolean NOT NULL（既定は`true`）、`body_edited_at`、`published_slot_minute` smallint（CHECK 0〜1439）、`published_carryover` boolean、`published_prioritized` boolean
  - `draft_batches`：`strategy_updated_at`・`promotions_changed_at`・`research_changed_at`・`core_rules_changed_at`
  - `accounts`：`promotions_changed_at`・`research_changed_at`・`core_rules_changed_at`・`insights_denied_at`
- [ ] T009 マイグレーション`apps/api/drizzle/0008_performance.sql`を作る（data-model.md「マイグレーション」）。`body_edit_tracked`は`DEFAULT false`で足して既存の行を`false`にしてから`SET DEFAULT true`。`accounts`の`promotions_changed_at`を`promotions`の`max(updated_at)`で、`research_changed_at`を`reference_posts`と`research_keywords`の`max(updated_at)`で埋める（行がなければNULL）。`core_rules_changed_at`は保存日時の記録がないのでNULLのままにする。新しい列挙型の値を同じトランザクションで使わない。`pnpm --filter api db:migrate`で当て、005までのテストが通ることを確かめる。

### Threads APIと偽のThreadsサーバー

- [ ] T010 [P] 偽のThreadsサーバーに反応数とフォロワー数を足す（contracts/api.md「偽のThreadsサーバー」）。`apps/api/test/fake-threads/server.ts`：`GET /v1.0/:mediaId/insights`（`data[]`に`name`・`period: lifetime`・`values[0].value`）と`GET /v1.0/:userId/threads_insights?metric=followers_count`（`total_value.value`）。テストから、投稿ごとの値、返さない指標、削除（400・コード100・サブコード33）、権限（コード10）、上限（コード4）、5xxを設定できる。呼び出しの回数を数えられる。
- [ ] T011 [P] Threadsの呼び出しのテストを書く（失敗を確認する）。`apps/api/test/integration/threads-insights-client.test.ts`：6つの指標の読み取り（`values`と`total_value`の両方の形）、返らない指標は`null`、`ThreadsNotFoundError`（404・コード100/サブコード33）、`ThreadsPermissionError`（コード10・200番台）、上限・認証・一時的は005と同じ分け方、トークンが`Authorization`ヘッダーにあること。
- [ ] T012 `apps/api/src/lib/threads-client.ts`に`getMediaInsights`・`getFollowersCount`と、`ThreadsNotFoundError`・`ThreadsPermissionError`（どちらも`ThreadsApiError`の一種。`parseOrThrow`で`error_subcode`も読む）を足す（research.md R1）。T011を通す。

**チェックポイント**：基盤ができ、ユーザーストーリーを始められる。

---

## Phase 3：ユーザーストーリー1 - 投稿ごとの反応数と、伸びたかどうかを見る（優先度：P1）🎯 MVP

**目標**：反応数を24時間・3日・7日の時点で取り込み、確定したら判定し、パフォーマンスの画面で見られる。

**単独のテスト**：投稿から7日を過ぎた投稿済みの投稿が6件以上あるAccountで定期処理を動かし、画面に6つの数・アイコン・倍率が出て、タブで絞り込めることを確かめる（spec US1）。

### テスト（先に書いて失敗を確認する）

- [ ] T013 [P] [US1] 反応数の段階のテストを書く。`apps/api/test/integration/metrics-runner.test.ts`（contracts/metrics-job.md）：
  - 時点：経過23〜25時間・71〜73時間・167〜169時間の投稿を、時刻の処理で`method: slot`として取る。幅の外は取らない。同じ時点を二重に取らない
  - 補い：3:00を過ぎ、`metrics:catchup`がその日でないときだけ動く。過ぎた時点のうち最も新しい1つだけを`method: daily`で取る。192時間を過ぎていれば`late`→`late_confirmed`。投稿IDがなければ問い合わせずに`unmeasurable`（`no_media_id`）。終わったら`metrics:catchup`に日付、残りがあれば関所が immediate
  - 状態：`h24`・`d3`→`updating`、`d7`→`confirmed`（`confirmed_at`あり）。確定・計測できないの行は変わらない
  - 判定：確定した投稿が5件以上で、確定（遅れて確定を除く）の直近30件の中央値で判定し、保存する。4件では判定しない。5件目の確定で、それまでの確定の投稿もまとめて判定する。基準値0では判定しない。倍率2.0ちょうど→好調、0.5ちょうど→低調。遅れて確定は判定するが基準値に入らない。確定した判定は後の確定で変わらない
  - 失敗：投稿が見つからない→`unmeasurable`（`not_found`。それまでの値と履歴は残る）、権限→`accounts.insights_denied_at`が入り、その日はそのAccountを飛ばす、認証→要再接続、上限→その回の残りを止める、一時的→記録しない
  - 対象外：要再接続のAccount、grower機能を使えないAccount（`AFTER_TRIAL`）
  - フォロワー数：補いのとき、直近30日に投稿済みのあるAccountで1日1回
  - 回数：公開を4件進める回は反応数の段階を行わない。公開0件の回で、Threadsへの呼び出しが24回以下、1回の処理の外部への呼び出し（Neon・Threads）の合計が50回以下（偽の`fetch`で数える。quickstart.md の表）
- [ ] T014 [P] [US1] 005の定期処理のテストに足す。`apps/api/test/integration/auto-post-runner.test.ts`・`auto-post-gate.test.ts`：反応数の段階の例外が公開の結果に影響しない、関所の候補に「次の日本時間3:00」が入る（その日の補いが済んでいれば翌日）、反応数に残りがあれば immediate。
- [ ] T015 [P] [US1] パフォーマンスのAPIのテストを書く。`apps/api/test/integration/performance.test.ts`（contracts/api.md `GET /performance`）：
  - `summary`：基準値・基準値に使える件数・確定の件数・基準値0・最終取り込み日時・`insightsDenied`・`needsReconnect`・タブの件数
  - `items`：投稿した日時の新しい順、50件ずつ、カーソルで続き。`pending`（`nextFetchAt`）・`updating`（`metrics`と`confirmAt`）・確定（`judgment`・`ratio`）・`late_confirmed`・`unmeasurable`（`metrics`なし、`threadsPermalink`が`null`のときは`null`）
  - タブ：`pending`は行なしと`updating`、`unmeasurable`は`all`だけ
  - grower機能を使えないAccountで`403 GROWER_FEATURE_REQUIRED`、他人のAccountで`404`、不正な`tab`・`before`で`400`
  - 性能（SC-007）：投稿済み500件（確定・確定待ち・低調を混ぜる）のAccountで、`GET /performance`（`tab=all`と`tab=poor`）の応答が500ms以内（ローカルのPostgres。APIの目標p95 500ms以内に合わせ、画面の2秒の内訳とする）。クエリが投稿の件数に比例して増えない（N+1がない）
- [ ] T016 [P] [US1] Webのテストを書く。`apps/web/test/performance.test.tsx`（contracts/ui-routes.md）：
  - サイドバーの「分析 > パフォーマンス」から開ける
  - 基準値の欄（値・説明・3つのアイコンの意味）。確定5件未満で「確定した投稿が5件たまると判定を始めます（いま{n}件）」、基準値0で「基準値が0のため判定できません」
  - タブはアイコンと件数で、`aria-label`に「伸びた 7件」など。押すと絞り込み
  - バッジ：`title`と読み上げの文字が「伸びた（基準値の3.4倍）」など、「×3.4」が見える
  - 確定待ち（値なし・値あり）、遅れて確定、計測できませんのカードの文言。「Threadsで開く」はURLがあるときだけ
  - 「さらに表示する」で続きを読む
  - `403`で「パフォーマンス分析は有料の契約で使えます」と「プランの変更は運営者にお問い合わせください。」、CSVのボタンなし
  - `insightsDenied`で権限の案内と「再接続」

### 実装

- [ ] T017 [US1] `apps/api/src/services/metrics-runner.ts`を作る（contracts/metrics-job.md 6-0〜6-6、research.md R2〜R5・R10・R11）。`runMetricsStage(env, db, threads, { now, publishedThisTick, catchupDone })`：対象の読み込み（1クエリ、grower機能と接続の条件を含む）、取る種類の決定（T005の関数）、Accountごとのトークンの復号は1回、呼び出しの回数の管理、失敗の分け方、`db.batch`での書き込み（履歴は`ON CONFLICT (draft_id, kind) DO NOTHING`、`post_metrics`は確定・計測できないの行を変えない条件のupsert、フォロワー数、`insights_denied_at`、判定のSQL）。戻り値に「残りがあるか」「補いを終えたか」とログ用の数。ログは`metrics: run`・`metrics: deferred`・`metrics: insights denied`・`metrics: catch-up done`（トークン・本文・投稿のIDを出さない）。
- [ ] T018 [US1] `apps/api/src/services/auto-post-gate.ts`に`metrics:catchup`の読み書きを足す（`readGate`で一緒に読む。値は日本時間の日付`YYYY-MM-DD`）。
- [ ] T019 [US1] `apps/api/src/services/auto-post-runner.ts`の手順5の後に反応数の段階を足す（contracts/metrics-job.md「005の手順への差し込み」）。その回の公開の試みの数を渡し、例外は受け止めてログに出す。補いを終えたら`metrics:catchup`を書く。関所の候補に「次の日本時間3:00」（その日の補いが済んでいなければ今日）を足し、反応数に残りがあれば immediate。T013・T014を通す。
- [ ] T020 [P] [US1] `apps/api/src/services/account-service.ts`の`writeConnection`で`accounts.insights_denied_at`を`null`にする（research.md R11）。
- [ ] T021 [US1] `apps/api/src/services/performance-service.ts`を作る（research.md R5・R6）。`getPerformanceSummary(db, accountId, now)`（基準値は確定の直近30件の`percentile_cont(0.5)`、タブの件数は1つの集計クエリ）と`listPerformancePage(db, accountId, { tab, before, limit })`（`post_drafts`と`post_metrics`を結合、005と同じカーソル、本文以外の大きな列は返さない）。`lastElapsedHours`は切り捨て。
- [ ] T022 [US1] `apps/api/src/routes/performance.ts`を作り、`apps/api/src/app.ts`に登録する。`GET /api/accounts/:accountId/performance`（`findOwnedAccount`・`requireGrowerAccess`・`performanceQuerySchema`）。T015を通す。
- [ ] T023 [US1] Webのデータの取得を作る。`apps/web/src/lib/query.ts`に`queryKeys.performance(id, tab)`、`apps/web/src/components/performance/use-performance.ts`（最初のページ・タブの切り替え・「さらに表示する」・`403`の見分け）。
- [ ] T024 [P] [US1] 部品を作る（contracts/ui-routes.md）。`apps/web/src/components/performance/JudgmentBadge.tsx`（`TrendingUpIcon`・`ArrowRightIcon`・`TrendingDownIcon`・`ClockIcon`・`BanIcon`、T001の色、`title`と読み上げ用の文字）、`BaselineCard.tsx`、`PerformanceTabs.tsx`、`PerformanceCard.tsx`（反応数はPC 6列・スマートフォン 3列×2行、返らない数は「−」）、`InsightsDeniedBanner.tsx`。
- [ ] T025 [US1] 画面を組み立てる。`apps/web/src/pages/performance.tsx`（上部バーに「反応数の最終更新」、説明の1文、基準値の欄、タブ、カード、「さらに表示する」、`403`の案内）、`apps/web/src/router.tsx`に`performance`、`apps/web/src/components/layout/Sidebar.tsx`に見出し「分析」と「パフォーマンス」（`ChartColumnIcon`）。T016を通す。

**チェックポイント**：US1が単独で動く（反応数が取り込まれ、判定が画面に出る）。

---

## Phase 4：ユーザーストーリー2 - 伸びなかった投稿を、次のプロンプトに反映する（優先度：P1）

**目標**：低調の投稿に傾向メモと「プロンプトに入れる」を付け、外していない新しい5件がメモ付きで次のプロンプトに入る（Constitution原則VI）。

**単独のテスト**：低調の投稿が6件あるAccountで、1件にメモを書き、別の1件を外し、プロンプトを作り直して、外していない新しい5件がメモ付きで入り、外した投稿が入らないことを確かめる（spec US2）。

### テスト（先に書いて失敗を確認する）

- [ ] T026 [P] [US2] プロンプトの節のテストを書く。`packages/shared/test/prompt.test.ts`（contracts/prompt-template.md）：「■過去に却下された投稿」の直後に「■反応が低かった投稿(…)」、却下が0件でも同じ並びの位置、メモがある投稿だけ`(傾向メモ: …)`、0件なら節ごと省く、`PROMPT_LENGTH_TARGET`を超えて直近の下書き・却下・参考投稿を減らしても、この節は減らない、`summary.poorPosts`。
- [ ] T027 [P] [US2] プロンプトの材料のテストを書く。`apps/api/test/integration/prompt.test.ts`：`judgment = poor`・`include_in_prompt = true`・確定（遅れて確定を含む）の投稿を、投稿した日時の新しい順に5件。外した投稿・好調・普通・確定待ち・計測できないは入らない。外すと次が繰り上がる（SC-003）。
- [ ] T028 [P] [US2] 傾向メモのAPIのテストを書く。`apps/api/test/integration/performance.test.ts`（contracts/api.md `PATCH …/feedback`）：メモの保存（前後の空白を除く、空なら`null`、201文字で`400`）、切り替え、両方なし`400`、低調でない投稿・他のAccountの投稿で`404`、応答の`promptIds`、後から保存した内容で上書き、grower機能を使えないAccountで`403`。`GET /performance`の`feedback.inNextPrompt`。
- [ ] T029 [P] [US2] Webのテストを書く。`apps/web/test/performance.test.tsx`：低調のタブの説明、メモは入力欄から離れたときに保存（変わっていなければ呼ばない）、「{n}/200」、切り替えは押したときに保存、入るかどうかの3つの説明、`promptIds`でほかのカードの表示が変わる、失敗で「保存できませんでした…」と入力が残る、すべてのタブの低調の投稿にメモの要約と「改善メモを開く」（押すと低調のタブ）・「✓ 次のプロンプトに入ります」。

### 実装

- [ ] T030 [US2] `packages/shared/src/prompt.ts`に`poorPosts: { body: string; memo: string | null }[]`と「■反応が低かった投稿(このアカウントで閲覧数が基準の半分以下だった投稿。同じ書き方・切り口は避けること)」の節を足す。長さの調整（`buildPrompt`の減らすループ）の対象にしない。`summary.poorPosts`を足す。T026を通す。
- [ ] T031 [US2] `apps/api/src/services/prompt-service.ts`で低調の投稿を読み、`buildPrompt`に渡す（research.md R8）。T027を通す。
- [ ] T032 [US2] `apps/api/src/services/performance-service.ts`に`updateFeedback(db, accountId, draftId, req, now)`（`judgment = 'poor'`の行だけ更新、`feedback_updated_at`）と`nextPromptIds(db, accountId)`（T031と同じ条件の5件）を足し、`listPerformancePage`の`feedback.inNextPrompt`に使う。
- [ ] T033 [US2] `apps/api/src/routes/performance.ts`に`PATCH /api/accounts/:accountId/performance/:draftId/feedback`を足す（`feedbackRequestSchema`）。T028を通す。
- [ ] T034 [US2] `apps/web/src/components/performance/FeedbackEditor.tsx`を作り、低調のタブのカードと説明、すべてのタブのメモの要約・「改善メモを開く」・「✓ 次のプロンプトに入ります」を`PerformanceCard.tsx`・`pages/performance.tsx`に組み込む。保存したら`queryKeys.promptAll(id)`を無効にする（次のプロンプトに反映）。T029を通す。
- [ ] T035 [P] [US2] `apps/web/src/components/stock/PromptCard.tsx`の材料の表示に「反応が低かった投稿 {n}件」を足す（`summary.poorPosts`。0件なら出さない）。`apps/web/test/stock.test.tsx`に確かめを足す。

**チェックポイント**：US1＋US2で、PRD FR-9・FR-10とConstitution原則VIを満たす。

---

## Phase 5：ユーザーストーリー3 - 反応数をCSVで書き出す（優先度：P2）

**目標**：投稿ごと・取り込みごとのCSVを保存でき、分析のための記録（FR-002e〜FR-002g）が入っている。

**単独のテスト**：投稿済みの投稿が10件（確定待ち1件・計測できない1件を含む）あるAccountで書き出し、10行のCSVが表計算ソフトで崩れずに開け、列が決めたとおりであることを確かめる（spec US3）。

### テスト（先に書いて失敗を確認する）

- [ ] T036 [P] [US3] CSVの整形のテストを書く。`packages/shared/test/csv.test.ts`（contracts/csv.md）：先頭にBOM、CRLF、すべての値を`"`で囲み`"`は`""`、本文の改行・カンマが1つのセル、空欄、日時は`2026-09-25T19:01:00+09:00`、曜日・時は日本時間、文字数は書記素の数、投稿ごと37列・取り込みごと13列の列名と順番、ファイル名`threads-{username}-posts-{YYYYMMDD}.csv`。
- [ ] T037 [P] [US3] 書き出しのAPIのテストを書く。`apps/api/test/integration/performance.test.ts`（contracts/api.md `GET …/export`）：`posts`の行数＝投稿済みの件数、`snapshots`の行数＝履歴の件数、200件ずつとカーソル、投稿時点のフォロワー数（投稿した日時より前で最も新しい記録）、取り込んだ日のフォロワー数、24時間時点の6つの数、判定の列（確定待ち・計測できません・判定なし）、バッチ・承認・次に投稿する・持ち越し・本文を直したか（はい・いいえ・不明）・時刻の枠・材料の版、grower機能・owner。
- [ ] T038 [P] [US3] 分析のための記録のテストを書く（FR-002e〜FR-002g）。
  - `apps/api/test/integration/post-drafts.test.ts`：本文が変わる編集で`body_edited_at`が入り、空白だけの違い（前後の空白）では入らない。マイグレーション前の行は`body_edit_tracked = false`。バッチの登録で`draft_batches`に4つの日時が写る
  - `apps/api/test/integration/auto-post-runner.test.ts`：公開の成功で`published_slot_minute`・`published_carryover`・`published_prioritized`が入る
  - `apps/api/test/integration/promotions.test.ts`・`research.test.ts`・`posting-rules.test.ts`：追加・変更・削除・状態の変更で`accounts`の`promotions_changed_at`・`research_changed_at`・`core_rules_changed_at`が今になる
- [ ] T039 [P] [US3] Webのテストを書く。`apps/web/test/performance.test.tsx`：「CSVで書き出す」のメニュー（2つの説明）、選ぶと続きがなくなるまで読む、書き出し中は押せない、ファイル名、失敗で「書き出せませんでした…」、`403`のときはボタンを出さない。

### 実装

- [ ] T040 [US3] `packages/shared/src/csv.ts`を作り、`index.ts`から公開する（`toCsv(header, rows)`、`postExportColumns`・`snapshotExportColumns`、`formatJstIso`、`weekdayJst`・`hourJst`、`csvFileName`）。T036を通す。
- [ ] T041 [US3] `apps/api/src/services/draft-service.ts`を変える。`updateDraft`で、前後の空白を除いた本文が前と違えば`body_edited_at`に今を入れる。`createDraftBatch`で、その時点の`strategy_designs.updated_at`と`accounts`の3つの`*_changed_at`を`draft_batches`に写す（同じトランザクション）。
- [ ] T042 [P] [US3] プロンプトの材料の変更の日時を入れる（research.md R9）。`apps/api/src/routes/promotions.ts`（追加・変更・削除・状態、宣伝の割合の保存は含めない）→`promotions_changed_at`、`apps/api/src/routes/research.ts`（参考の投稿・キーワードの追加・変更・削除）→`research_changed_at`、`apps/api/src/services/posting-rules-service.ts`の`saveCoreRules`→`core_rules_changed_at`。それぞれ同じ書き込みの中（トランザクションか`db.batch`）で行う。
- [ ] T043 [US3] `apps/api/src/services/publish-executor.ts`の公開の成功の記録で、`published_slot_minute`（試みの`slot_minute`）・`published_carryover`（試みの`is_carryover`）・`published_prioritized`（取り出した時点の下書きの`prioritized_at`があったか）を一緒に入れる。T038を通す。
- [ ] T044 [US3] `apps/api/src/services/performance-service.ts`に`listExportRows(db, accountId, kind, before)`を足す（200件ずつ。フォロワー数の結合、`h24`の履歴、バッチ・材料の版の結合）。
- [ ] T045 [US3] `apps/api/src/routes/performance.ts`に`GET /api/accounts/:accountId/performance/export`を足す（`exportQuerySchema`）。T037を通す。
- [ ] T046 [US3] `apps/web/src/components/performance/CsvExportMenu.tsx`を作り、上部バーに置く（スマートフォンはアイコンだけ）。続きを読みながら`toCsv`で組み立て、`Blob`で保存させる。T039を通す。

**チェックポイント**：すべてのユーザーストーリーが動く。

---

## Phase 6：仕上げと横断的な対応

- [ ] T047 [P] `docs/ui-design.md`のサイドバーの説明に「分析 > パフォーマンス」を本featureで足したことを書く。`docs/cost-estimate.md`に、反応数の取り込み（1投稿最大3回、3:00の補い）と`metrics: deferred`の見方を足す。
- [ ] T048 [P] 001のデータ削除（Accountの削除・Metaからの削除の依頼）で、3つの新しい表の行が連鎖して消えることをテストで確かめる。`apps/api/test/integration/data-deletion.test.ts`。
- [ ] T049 `pnpm lint`・`pnpm typecheck`・`pnpm test`をすべて通す。
- [ ] T050 quickstart.mdの「手動の確認」1〜5・8・9をローカル（偽のThreads）で行う。8では投稿済み500件のAccountで、パフォーマンスの画面の最初の表示が2秒以内に終わることを測る（SC-007）。
- [ ] T051 quickstart.mdの手順6（本物のThreads）をテスター招待したアカウントで行い、投稿を削除したときのエラーの応答と`views`の応答の形を記録する。違っていれば`ThreadsNotFoundError`の判定・応答の読み方を直す（research.md R1 の要確認）。
- [ ] T052 [P] `specs/006-performance-feedback/verification.md`に、実施した確認と残っている手動の確認を書く（005と同じ形）。

---

## 依存関係と実行順

### フェーズの依存

- **Phase 1（セットアップ）**：すぐ始められる。
- **Phase 2（基盤）**：Phase 1の後（T001・T002とは独立に始めてもよい）。すべてのユーザーストーリーの前提。
- **Phase 3（US1）**：Phase 2の後。
- **Phase 4（US2）**：判定（US1のT017）と画面（T025）の後。プロンプトの部分（T026・T027・T030・T031）は、Phase 2の後なら US1と並行してできる（判定のデータはテストで直接作る）。
- **Phase 5（US3）**：Phase 2の後に始められる。分析の記録（T038・T041〜T043）はUS1と独立。書き出しのAPI（T044）は`post_metrics`の形（T017）を使うので、US1の後。
- **Phase 6（仕上げ）**：すべての後。

### ストーリーの中の順番

- テスト → 共通の関数 → APIのサービス・ルート → Webの部品 → 画面への組み込み
- 次の同じファイルを触るタスクは、ストーリーをまたいで並行にしない。
  - API：
    - `apps/api/src/services/performance-service.ts`（T021・T032・T044）
    - `apps/api/src/routes/performance.ts`（T022・T033・T045）
    - `apps/api/src/services/auto-post-runner.ts`（T019）と`publish-executor.ts`（T043）
    - `apps/api/src/services/draft-service.ts`（T041）
  - Web：
    - `apps/web/src/pages/performance.tsx`（T025・T034・T046）
    - `apps/web/src/components/performance/PerformanceCard.tsx`（T024・T034）
  - テスト：
    - `apps/api/test/integration/performance.test.ts`（T015・T028・T037）
    - `apps/api/test/integration/auto-post-runner.test.ts`（T014・T038）
    - `apps/web/test/performance.test.tsx`（T016・T029・T039）

## 並行して進められる例

### Phase 1・2

```text
T001 色のトークン ／ T002 シード
T003 共通のテスト ／ T004 limits ／ T007 errors ／ T010 偽のThreads ／ T011 threads-client のテスト
```

### US1

```text
T013 反応数の段階のテスト ／ T014 005のテスト ／ T015 API のテスト ／ T016 Web のテスト
T020 再接続（account-service）／ T024 部品（API の実装と並行）
```

### US1と並行してできるUS2・US3の一部

```text
T026 prompt のテスト → T030 prompt.ts ／ T027 → T031 prompt-service
T036 csv のテスト → T040 csv.ts
T038 記録のテスト → T041 draft-service ／ T042 材料の日時 ／ T043 publish-executor
```

## 実装の進め方

### MVP（US1＋US2。どちらもP1）

1. Phase 1・2を終える。
2. US1（取り込み・判定・画面）を作り、quickstart.mdの手順1・2で確かめる。
3. US2（傾向メモ・プロンプト）を作り、手順3で確かめる。Constitution原則VIのとおり、US1だけでは完了にしない。
4. ここでPRを出せる状態にする。

### 段階的に足す

1. MVPの後にUS3（CSV・分析の記録）を足す。分析の記録（T041〜T043）は、データを早くためるため、MVPと同じPRに入れてもよい。
2. 仕上げ（Phase 6）で、本物のThreadsでの確認と記録を行う。

## メモ

- 反応数の段階は、005の公開の後に動く。公開の枠（1回4件）を先に使い、反応数の失敗が公開に影響しないようにする（plan.md「Phase 1の設計後の再確認」）。
- 「grower機能を使える」は、今は`hasGrowerAccess`（プラン2以上か無料体験中）。2026-10-08の料金の見直し（PRD FR-12）で「有料の契約中か無料体験中」に変わるが、置き換えは課金のfeatureで行う。
- 画面の文言・色・アイコンは[contracts/ui-routes.md](./contracts/ui-routes.md)と画面案に合わせる。
