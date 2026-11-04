---

description: "Task list for feature 022 algorithm analysis"
---

# Tasks：Threadsのアルゴリズムの解析

**Input**: [spec.md](./spec.md)、[plan.md](./plan.md)、[research.md](./research.md)、[data-model.md](./data-model.md)、[contracts/api.md](./contracts/api.md)、[contracts/analysis.md](./contracts/analysis.md)、[contracts/ui-routes.md](./contracts/ui-routes.md)、[quickstart.md](./quickstart.md)

**Tests**: 001〜021と同じく、テストを先に書いて失敗を確かめてから実装する（TDD）。特に次を自動テストで確かめる。
- SC-002：件数が10件未満の区切りから、傾向が1つも出ない
- SC-003：CORE RULES・NGワードと食い違う傾向が、プロンプトに1つも入らない
- SC-004：傾向がないAccountで、プロンプトの文が本featureの前と1文字も変わらない
- SC-005：自動投稿が使えない人・関わりのない人・見せてもらっている人に、解析の結果が1つも返らない

**Organization**: spec.md の User Story ごと。MVPはUS1・US2（P1）。

## Format: `[ID] [P?] [Story] Description`

- **[P]**：別ファイルで、未完了のタスクに依存せず並行できる。
- **[Story]**：[US1]〜[US4]はspec.mdのUser Storyに対応する。
- 計算のテストは `packages/shared/test/analysis/*.test.ts`。材料は `packages/shared/test/analysis/fixtures.ts` の `makePosts(n, override)`：2026-08〜10月の確定した投稿を日本時間で作る（夜の投稿の閲覧を高めにした60件・フォロワー100人・24時間の値ありの基本形と、件数の少ない形・フォロワー数のない形・宣伝の投稿を含む形）。
- APIのテストは `apps/api/test/integration/analysis.test.ts`。投稿と反応数は `apps/api/test/helpers/` の今の作り方（006のテスト）を使い、チームの関わりは `helpers/team.ts`、機能のOFFは `helpers/features.ts` を使う。
- Webのテストは `apps/web/test/analysis.test.tsx`。
- 画面はモック（https://claude.ai/artifact/5GK8yF32kwsAqPVU1SaT8A ）と contracts/ui-routes.md のとおり。色は今の色（`foreground`・`muted`・`muted-foreground`・`border`）だけを使い、新しい強調の色は足さない。

## Phase 1: Setup

- [X] T001 `packages/shared/src/limits.ts` に定数を足す（data-model.md「共有の定数」）：`ANALYSIS_PERIOD_DAYS = 90`・`ANALYSIS_MIN_TOTAL = 20`・`ANALYSIS_MIN_BUCKET = 10`・`ANALYSIS_TREND_RATIO = 1.5`・`ANALYSIS_RECOMMENDED_TOP = 0.2`・`ANALYSIS_MAX_TRENDS = 5`・`ANALYSIS_CLASSIFY_BATCH = 50`・`ANALYSIS_THEMES_MAX = 10`・`ANALYSIS_THEME_NAME_MAX = 20`。
- [X] T002 `packages/shared/src/analysis/types.ts` を作る（data-model.md「共有の型」）：`OPENING_TYPES = ["aruaru", "question", "assertion", "story", "number", "announce", "other"] as const` と `OPENING_TYPE_LABELS`（あるある・問いかけ・言い切り・体験談・数字・告知・その他）、`TIME_BUCKETS`（`morning` 朝5〜10時・`noon` 昼11〜15時・`evening` 夕方16〜19時・`night` 夜20〜23時・`latenight` 深夜0〜4時）、`TEXT_FEATURES`（`question`・`number`・`shortFirstLine`・`manyLines`・`emoji`・`callout` と名前）、`AnalysisPost`・`PostValues`・`BucketRow`・`FeatureRow`・`Trend`・`RecommendedPost`・`CompareValues`・`AnalysisResult`。`packages/shared/src/analysis/index.ts` と `packages/shared/src/index.ts` から出す。
- [X] T003 [P] `packages/shared/src/schemas.ts` に解析のAPIの入出力を足す（contracts/api.md）：`analysisQuerySchema`（`scope`：`all`・`regular`、既定 `all`）、`analysisThemesSchema`（`[{ id?: /^t[0-9a-z]{1,8}$/, name }]`、10個まで、名前は前後の空白を除いて1〜20文字、重ならない）、`analysisSettingsRequestSchema`（`expectedVersion` は1以上の整数かnull、`trendsInPrompt?`・`themes?`、どちらもないのは不可）、`classificationsQuerySchema`（`mode`：`unclassified`・`classified`）、`classificationsRequestSchema`（`source`：`ai`・`manual`、`items` 1〜50件、`draftId` はuuid、`openingType` は7つのどれか、`themeId` は `/^t[0-9a-z]{1,8}$/` かnull）。`packages/shared/test/analysis/schemas.test.ts` で形を確かめる。

## Phase 2: Foundational

### Tests（先に書いて失敗を確かめる）

- [X] T004 [P] `apps/api/test/migration/migration-0020.test.ts`：`analysis_settings`（主キー `account_id`、`trends_in_prompt` 既定 true、`themes` 既定 `[]`、`version` 既定 1、Accountの削除で消える）、`post_classifications`（主キー `draft_id`、`opening_type` の CHECK（7つ）、`theme_id` の CHECK（`^t[0-9a-z]{1,8}$` かNULL）、`source` の CHECK（`ai`・`manual`）、下書きの削除とAccountの削除で消える）。
- [X] T005 [P] `packages/shared/test/analysis/holidays.test.ts`：2026年の祝日（元日・成人の日 1/12・建国記念の日・天皇誕生日 2/23・春分の日 3/20・昭和の日・憲法記念日・みどりの日・こどもの日・振替休日 5/6・海の日 7/20・山の日・敬老の日 9/21・国民の休日 9/22・秋分の日 9/23・スポーツの日 10/12・文化の日・勤労感謝の日）が true、2026-05-07・2026-09-24 などの平日が false。2025年・2027年の春分と秋分の日。扱うのは決まりで求められる2000〜2099年だけ（解析は直近90日なので、一度だけの特別な休日は扱わない）。
- [X] T006 [P] `packages/shared/test/analysis/values.test.ts`：`postValues` で反応率（(いいね＋返信＋リポスト＋引用)÷閲覧）・返信率・広がり（フォロワー数がない・0ならnull）・初速（24時間の閲覧。なければnull）・後からの伸び（24時間の閲覧が0・なければnull）、時間帯（日本時間。UTCの11:30は夜20時台）、平日・休日（土日・祝日）、本文の特徴（contracts/analysis.md と research.md R4 の表。最後の空でない行が「？」で終わる・全角数字・1行目20字・空でない行が5行以上・絵文字・「みなさん」）、文字数はコードポイント。`lengthBuckets` で初めの値（55・100・135）から 〜77字・78〜117字・118字〜 になる。
- [X] T007 [P] `apps/api/test/integration/analysis.test.ts` に守りを書く（contracts/api.md）：オーナーと担当の人は `GET /analysis` を読める、見せてもらっている人は `403 ROLE_FORBIDDEN`、関わりのない人は `404 ACCOUNT_NOT_FOUND`、自動投稿がOFFは `403 FEATURE_DISABLED`（SC-005）、`view` だけの人は `PATCH /analysis/settings`・`GET`／`PUT /analysis/classifications` が `ROLE_FORBIDDEN`、決済で読むだけは書き込みが `BILLING_REQUIRED`、`scope` が違うと `VALIDATION_FAILED`。

### Implementation

- [X] T008 `apps/api/src/db/schema.ts` に `analysisSettings`・`postClassifications` を足し（data-model.md）、`apps/api/drizzle/0020_algorithm_analysis.sql` と `drizzle/meta` を作る（T004を通す）。
- [X] T009 [P] `packages/shared/src/analysis/holidays.ts` に `isJapaneseHoliday(date: "YYYY-MM-DD")` を作る：固定の日、ハッピーマンデー（成人の日・海の日・敬老の日・スポーツの日）、春分と秋分の式（1980〜2099年の式）、振替休日、国民の休日（前後が祝日の平日）。2000〜2099年の外は false（T005を通す）。
- [X] T010 [P] `packages/shared/src/analysis/values.ts` に `postValues(post, lengthSettings)` と `lengthBuckets(lengthSettings)` を作る（research.md R3・R4。T006を通す）。
- [X] T011 `apps/api/src/services/analysis-service.ts` に `loadAnalysisPosts(db, accountId, now)` を作る：直近90日（日本時間の今日から89日前の0時以降）の `published` で `post_metrics.state = 'confirmed'` の投稿を、`post_metric_snapshots`（`kind = 'h24'`）・投稿時点のフォロワー数（`follower_snapshots` の `captured_at <= published_at` で最も新しい行。`performance-service.ts` の `followersAtPost` と同じ）・`post_classifications` と結合して1回で読む。宣伝の投稿の印（research.md R9：本文にそのAccountの宣伝内容のタイトルか `linked_url` がある）を付ける。`apps/api/src/routes/analysis.ts` の枠を作り、読むのは `authorizeAccount(..., "view", { feature: "autopost" })`、書くのは `"content"` を通す。`apps/api/src/app.ts` に足し、`apps/api/test/integration/permissions-matrix.test.ts` の表に新しいルートを足す（T007を通す）。

**Checkpoint**: 表ができ、祝日と投稿ごとの値が求められ、解析のAPIの守りが通る。

## Phase 3: User Story 1 - 伸びやすい時間帯・曜日・長さが分かる（P1）🎯 MVP

**Goal**: 「解析」で、時間帯・曜日・文字数・本文の特徴ごとの件数と中央値が並び、件数と差の決まりを満たした傾向が出る。

**Independent Test**: 夜の投稿の閲覧を高めにした60件のAccountで「解析」を開き、時間帯の表で夜の中央値が高く、「夜（20〜23時）に出した投稿が伸びやすい」が出る。件数の少ない区切りに「件数が少ない」が出る。

### Tests（先に書いて失敗を確かめる）

- [X] T012 [P] [US1] `packages/shared/test/analysis/analyze.test.ts`：`analyzePosts` の区切り（時間帯の5つ・平日と休日・文字数の3つ・本文の特徴のあり／なし）ごとの件数と、閲覧・反応率・返信率の中央値。10件未満は `mark: "few"`、0件は `mark: "untried"` で値はnull。傾向（research.md R5）：夜の60件で夜の傾向が出る・両側10件以上・1.5倍以上・ほかの投稿の中央値が0なら出ない・区切りの種類ごとに1つ・倍率の大きい順で5つまで・「なし」の側が伸びた本文の特徴（「絵文字のない投稿が伸びやすい」）・傾向の文と件数（contracts/analysis.md の表）。件数が10件未満の区切りから傾向が出ない（SC-002）。確定した投稿が20件未満なら `needMore`（20−件数）が出て表と傾向が空。
- [X] T013 [P] [US1] `apps/api/test/integration/analysis.test.ts` に足す：`GET /analysis` が期間の確定した投稿だけを使う（遅れて確定・計測できない・確定待ち・91日前の投稿は入らない）、`totals`（`confirmed`・`promo`・`withFollowers`・`classified`）、`scope=regular` で宣伝の投稿が外れる、ほかのAccountの投稿が入らない（原則V）、確定した投稿が0件なら `needMore: 20`、`period` の日付、`schedule.slotTimes`（投稿の設定の時刻）、`settings` の初めの値（`trendsInPrompt: true`・`themes: []`・`version: null`）、`canEdit`。
- [X] T014 [P] [US1] `apps/web/test/analysis.test.tsx`：サイドバーの「自動投稿」で「パフォーマンス」の次に「解析」がある、見出しと「直近90日・確定した投稿 {n}件」、「この画面の見方」が閉じていて開くと箇条書き（contracts/ui-routes.md の5つ）、件数不足で「あと{n}件たまると見られます」、傾向の行（文と件数・中央値）、傾向がないと「まだはっきりした傾向はありません」、時間帯の表と「件数が少ない」「試していない」の印、曜日・文字数・本文の特徴の表、「すべて」「ふだんの投稿」の切り替えで `scope=regular` を読む。

### Implementation

- [X] T015 [US1] `packages/shared/src/analysis/analyze.ts` に `analyzePosts(posts, { lengthSettings, themes, now })` の区切り・本文の特徴・傾向・`needMore`・`totals` の部分を作る（中央値は `performance.ts` の `median`。T012を通す）。
- [X] T016 [US1] `apps/api/src/services/analysis-service.ts` に `getAnalysis(db, access, scope, now)` を作り、`GET /api/accounts/:accountId/analysis` を返す（contracts/api.md。設定は `analysis_settings`、行がなければ初めの値。投稿の時刻は `readPostingSchedule`。文字数の設定は `lengthSettingsOf(account)`）（T013を通す）。
- [X] T017 [P] [US1] `apps/web/src/lib/api-client.ts` と `apps/web/src/lib/query.ts` に解析の読み出し（`queryKeys.analysis(accountId, scope)`）を足す。
- [X] T018 [US1] `apps/web/src/components/analysis/BucketTable.tsx`（件数・閲覧の中央値の棒・反応率・返信率、印。`md` より狭いと縦の並び。FR-063）・`FeatureTable.tsx`（あり／なし・差）・`TrendCard.tsx`（傾向の行と空の状態。切り替えはUS3で足す）を作る。
- [X] T019 [US1] `apps/web/src/pages/analysis.tsx` を作る（見出し・範囲の切り替え・`HelpToggle`（`components/team/HelpToggle.tsx` を使う）・件数不足・伸びた傾向・時間帯・曜日と文字数（パソコンで2列）・本文の特徴）。`apps/web/src/router.tsx` に `/accounts/:accountId/analysis`、`apps/web/src/components/layout/Sidebar.tsx` の「自動投稿」に「解析」（`ChartLineIcon`、`path: "analysis"`）を足す。サイドバーの並びを見ている今のテストを直す（T014を通す）。

**Checkpoint**: US1だけで、時間帯・曜日・長さ・本文の特徴の傾向が見られる。

## Phase 4: User Story 2 - おすすめに乗りやすい投稿の特徴が分かる（P1）

**Goal**: おすすめに乗った目安の投稿が広がりの大きい順に並び、初速・後からの伸び・返信率などが、ほかの投稿と並べて分かる。

**Independent Test**: フォロワー100人のAccountで閲覧300を超える投稿を数件作り、「おすすめに乗った目安」に広がり（×3.0など）と初速・返信率が並び、ほかの投稿の中央値と比べられる。

### Tests（先に書いて失敗を確かめる）

- [X] T020 [P] [US2] `packages/shared/test/analysis/recommended.test.ts`：広がりを求められる投稿が10件未満なら `available: false`、上位20%（小さいほうから80%の位置の値以上）かつ広がりが1を超える投稿だけ（全部が1以下なら0件）、広がりの大きい順、フォロワー数のない投稿は外れる（FR-023）、`head` は本文の初めの40文字、`compare` の初速・後からの伸び・返信率・文字数の中央値と、最後に問いかけがある件数（FR-021）。
- [X] T021 [P] [US2] `apps/api/test/integration/analysis.test.ts` に足す：`recommended` の `posts`（`head`・`publishedAt`・`views`・`spread`・`firstSpeed`・`laterGrowth`・`replyRate`）と `compare`、本文の全文は返さない。
- [X] T022 [P] [US2] `apps/web/test/analysis.test.tsx` に足す：「おすすめに乗った目安の投稿」の件数、初めは3件で「残りの{n}件を見る」で全部、広がりの「×4.3」の形、「ほかの投稿とのちがい（中央値）」の2行、`available: false` なら「フォロワー数の記録がある投稿が10件たまると見られます」、フォロワー数のない投稿を外した件数の説明。

### Implementation

- [X] T023 [US2] `packages/shared/src/analysis/analyze.ts` に `recommended` の部分を足す（research.md R6。T020を通す）。
- [X] T024 [US2] `apps/api/src/services/analysis-service.ts` の応答に `recommended` を入れる（T021を通す）。
- [X] T025 [US2] `apps/web/src/components/analysis/RecommendedCard.tsx` を作り、`apps/web/src/pages/analysis.tsx` の伸びた傾向の次に置く（スマートフォンでは1件ずつ縦の並び。モック「解析（スマートフォン）」）（T022を通す）。

**Checkpoint**: US1・US2で、伸びやすい区切りと、おすすめに乗った目安の投稿が1画面で見られる（SC-001）。

## Phase 5: User Story 3 - 傾向を次の投稿づくりに活かす（P2）

**Goal**: 本文で変えられる傾向が、投稿のプロンプトの「■伸びた傾向」に入る。時間帯・曜日の傾向は、自動投稿の時刻の見直しの参考として出る。

**Independent Test**: 傾向が2つ出ているAccountでプロンプトを作り直すと、節に2つが件数つきで入る。「プロンプトに入れる」を外すと節がなくなる。

### Tests（先に書いて失敗を確かめる）

- [X] T026 [P] [US3] `packages/shared/test/analysis/prompt-trends.test.ts`：`trendsForPrompt` で時間帯・曜日の傾向が入らない、CORE RULESに「絵文字」「問いかけ」「質問」「数字」「呼びかけ」「改行」「1行目」「書き出し」があると、その特徴の傾向が向きに関係なく入らない、NGワードを含む傾向（テーマの名前）が入らない（SC-003）、5つまで。
- [X] T027 [P] [US3] `packages/shared/test/prompt.test.ts` に足す：`PromptInput.trends` があると「■伸びた傾向(取りためた反応数から見た傾向。合わせすぎず、人柄とCORE RULESを優先すること)」の節が「■反応が低かった投稿」の後・「■リサーチで見つけた…」の前に入り、行は「・{text}({count}件。閲覧の中央値が、ほかの投稿の{ratio}倍)」、長さの調整で減らない、`summary.trendCount`。`trends` が空・省略のとき、全文が本featureの前と1文字も同じ（SC-004。今のスナップショット・期待値を変えない）。
- [X] T028 [P] [US3] `apps/api/test/integration/analysis.test.ts` と `apps/api/test/integration/prompt.test.ts` に足す：`PATCH /analysis/settings` の保存・応答・行がないときの `expectedVersion: null`・衝突で `STALE_UPDATE`・操作の記録（`analysis_settings_updated`）。`GET /prompt` で、傾向があるAccountは節が入り `summary.trendCount` が数と同じ、`trendsInPrompt: false` なら節がない、傾向は「ふだんの投稿」で求める（宣伝の投稿の閲覧を高くしても傾向にならない）、傾向がないAccountは今と同じ文。
- [X] T029 [P] [US3] `apps/web/test/analysis.test.tsx` に足す：「プロンプトに入れる」の切り替えで `PATCH` が送られる、`canEdit` がなければ切り替えが出ない、時間帯・曜日の傾向に「時刻の参考」の印、「自動投稿の時刻の見直しの参考に」に今の時刻と時間帯の傾向が出て「投稿の時刻を開く」が投稿の設定へ移る。

### Implementation

- [X] T030 [US3] `packages/shared/src/analysis/prompt.ts` に `trendsForPrompt(trends, coreRules, ngWords)` を作る（research.md R7。NGワードは `findNgWords`。T026を通す）。
- [X] T031 [US3] `packages/shared/src/prompt.ts` に `PromptTrend`・`PromptInput.trends?`・`trendSection`・`PromptSummary.trendCount` を足す（contracts/analysis.md「プロンプトの節」。T027を通す）。
- [X] T032 [US3] `apps/api/src/services/analysis-service.ts` に `updateAnalysisSettings(tx, access, input)`（`trendsInPrompt` の保存。テーマはUS4）と `trendsForAccountPrompt(db, account)`（設定がONのとき、「ふだんの投稿」で `analyzePosts` → `trendsForPrompt`）を作る。`PATCH /api/accounts/:accountId/analysis/settings` を `withActivityTx` で返す。`apps/api/src/services/prompt-service.ts` の `getPrompt` で傾向を読んで `buildPrompt` に渡す（T028を通す）。
- [X] T033 [US3] `apps/web/src/components/analysis/TrendCard.tsx` に「プロンプトに入れる」（今の `Switch`）と説明・「時刻の参考」の印を足し、`apps/web/src/components/analysis/ScheduleHint.tsx` を作って時間帯の表の下に置く。保存したら `queryKeys.promptAll(accountId)` も読み直す（T029を通す）。

**Checkpoint**: 傾向がプロンプトに入り、切り替えられる。時刻の参考が見られる。

## Phase 6: User Story 4 - 内容（テーマ・書き出しの型）でも比べられる（P3）

**Goal**: 外のAIの答えを貼って投稿に書き出しの型とテーマを付け、分類ごとの表が出る。手でも直せる。

**Independent Test**: 確定した投稿30件に分類が付いた状態で、内容の表に分類ごとの件数と中央値が並ぶ。

### Tests（先に書いて失敗を確かめる）

- [X] T034 [P] [US4] `packages/shared/test/analysis/classify.test.ts`：`classifyPrompt` の形（型の7つ・テーマの一覧・テーマがないときの形・【1】〜の番号と本文・答えの形。contracts/analysis.md）、`parseClassifyAnswer` で目印の行だけを読む・前後の文を無視・区切り（「／」「/」「、」）とコロン（全角・半角）・「」『』と全角半角のちがいを無視・テーマ「なし」・同じ番号は後のほう・知らない型・知らないテーマ・範囲外の番号・答えのない投稿を `problems` に理由つきで返す。`analyzePosts` の `opening`・`theme` の表が分類の付いた投稿だけで求まり、型とテーマの傾向（「『あるある』の書き出しが伸びやすい」「テーマ『転職』の投稿が伸びやすい」）が出る、一覧にない `themeId` はテーマなし。
- [X] T035 [P] [US4] `apps/api/test/integration/analysis.test.ts` に足す：`GET /analysis/classifications?mode=unclassified` が分類のない確定した投稿の新しい順に50件と `remaining`、`mode=classified` が分類のある投稿、`PUT /analysis/classifications` の保存・入れ替え（`source` も変わる）・ほかのAccountの投稿と期間外・確定していない投稿と知らない `themeId` は `skipped`・操作の記録（`posts_classified`）。`PATCH /analysis/settings` のテーマ：新しいidが付く・名前の重なりと11個目は `VALIDATION_FAILED`・消したテーマの分類は `theme_id` がNULLになる（同じトランザクション）。投稿の削除で分類が消える。
- [X] T036 [P] [US4] `apps/web/test/analysis.test.tsx` に足す：内容の表（「書き出しの型」「テーマ」の切り替え・「分類が付いた投稿 {n}件 / {m}件」）、「内容を分類する」で開く画面（contracts/ui-routes.md）：テーマを直して保存、①プロンプトをコピー、②答えを貼って「読み取る」、③候補（選び直せる）と読み取れなかった理由、「{n}件を反映する」で `PUT`（`source: "ai"`）、「分類済み」で選び直すとその場で `PUT`（`source: "manual"`）、投稿が0件の表示、`canEdit` がなければボタンが出ない。

### Implementation

- [X] T037 [US4] `packages/shared/src/analysis/prompt.ts` に `classifyPrompt`・`parseClassifyAnswer` を、`packages/shared/src/analysis/analyze.ts` に `opening`・`theme` の表と傾向を足す（T034を通す）。
- [X] T038 [US4] `apps/api/src/services/analysis-service.ts` に `listClassificationTargets`・`saveClassifications` を作り、`updateAnalysisSettings` にテーマ（新しいid・消したテーマの分類を外す）を足す。`GET`・`PUT /api/accounts/:accountId/analysis/classifications` を返す（T035を通す）。
- [X] T039 [US4] `apps/web/src/components/analysis/ContentCard.tsx` と `apps/web/src/components/analysis/ClassifyDialog.tsx` を作り（018の `ExplainBatchPanel`・021の `PolishDialog` と同じ部品と並び）、`apps/web/src/pages/analysis.tsx` の最後に置く。`apps/web/src/lib/api-client.ts`・`query.ts` に分類と設定の読み書きを足す（T036を通す）。

**Checkpoint**: 全部のUser Storyがそろう。

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T040 [P] `docs/ui-design.md` に「解析」の画面（サイドバーの位置・並び・印・内容を分類する）を足す。
- [X] T041 [P] `docs/user-guide.md` に「解析」の使い方（見方・傾向とプロンプト・内容を分類する）を足す（アカウントのID・テスト版のURL・秘密の値を入れない）。
- [X] T042 [P] `docs/architecture.md` に、解析の計算の場所（shared）・新しい表2つ・プロンプトの節を足す。`docs/next-features.md` §F-3 に、022で作ったものを書く。
- [X] T043 `pnpm --filter ./packages/shared test && pnpm --filter ./apps/api test && pnpm --filter ./apps/web test && pnpm lint && pnpm -r exec tsc --noEmit` を通す。quickstart.md「1. 自動のテスト」の確かめることを見直す。
- [ ] T044 quickstart.md「3. テスト版で確かめる」をマージのあとにユーザーと行い、しきい値を直すかを決める。

## Dependencies & Execution Order

- **Phase 1 → Phase 2**：定数・型・スキーマが先。
- **Phase 2 → US1〜US4**：表・祝日・投稿ごとの値・APIの枠が先。
- **US1 → US2**：同じ `analyzePosts` と画面に足す。
- **US1 → US3**：傾向が要る。US2とは独立。
- **US1 → US4**：区切りと傾向の仕組みを使う。US3のテーマの設定（`updateAnalysisSettings`）に足すので、US3の後。
- **Polish**：全部の後。T044はマージの後。

### 同じファイルを触るタスク（順に行う）

- `packages/shared/src/analysis/analyze.ts`：T015 → T023 → T037
- `apps/api/src/services/analysis-service.ts`：T011 → T016 → T024 → T032 → T038
- `apps/web/src/pages/analysis.tsx`：T019 → T025 → T033 → T039
- `apps/api/test/integration/analysis.test.ts`：T007 → T013 → T021 → T028 → T035
- `apps/web/test/analysis.test.tsx`：T014 → T022 → T029 → T036

## Parallel Example

```text
# Phase 2 のテスト
T004 migration-0020.test.ts ／ T005 holidays.test.ts ／ T006 values.test.ts ／ T007 analysis.test.ts（守り）

# Phase 2 の実装
T009 holidays.ts ／ T010 values.ts（T008 の後に T011）

# US1 のテスト
T012 analyze.test.ts ／ T013 analysis.test.ts ／ T014 analysis.test.tsx
```

## Implementation Strategy

1. **MVP**：Phase 1・2 → US1 → US2。時間帯・曜日・長さ・本文の特徴の傾向と、おすすめに乗った目安が見られる。
2. **次**：US3（プロンプトに入れる・時刻の参考）。原則VIの「改善が次に活きる」に届く。
3. **最後**：US4（内容の分類）。外のAIとのやり取りがあるので最後にする。
4. 各Checkpointで、そのStoryのテストと今までのテストが通ることを確かめる。
