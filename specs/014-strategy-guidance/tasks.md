---

description: "Task list for feature 014 strategy guidance"
---

# Tasks:課題の入力を手助けする

**Input**: [spec.md](./spec.md)、[plan.md](./plan.md)、[research.md](./research.md)、[data-model.md](./data-model.md)、[contracts/api.md](./contracts/api.md)、[contracts/ui-routes.md](./contracts/ui-routes.md)、[contracts/prompt-template.md](./contracts/prompt-template.md)、[contracts/hints.md](./contracts/hints.md)、[quickstart.md](./quickstart.md)、モック https://claude.ai/artifact/KMzLe9YtcNcToBvf9ikd6g

**Tests**: 001〜013と同じく、テストを先に書いて失敗を確かめてから実装する（TDD）。特に次を自動テストで確かめる。
- SC-007：n/16の数え方が変わらない
- SC-014：解説の【ID】の取り違えがない
- SC-015・SC-016：プロンプトの件数がそろい、空の材料の節が入らない
- SC-019：短文・中文・長文の件数の合計
- SC-020：2つに分けた節
- SC-021：コードブロックの貼り付け
- SC-023：投稿ストックの操作が変わらない

**Organization**: User Storyごとに分ける。MVPはUS1＋US2（どちらもP1）。P2はUS3・US4・US5・US7・US8・US10・US15・US11・US12の順（US11・US12はUS15の「投稿をつくる」の画面に載せる）、P3はUS6・US9・US13・US14。

## Format: `[ID] [P?] [Story] Description`

- **[P]**:別ファイルで、未完了のタスクに依存せず並行できる。
- **[Story]**: [US1]〜[US15]はspec.mdのUser Storyに対応する。
- すべてのタスクに、変更または確認する正確なパスを書く。
- 文言はcontracts/ui-routes.md・prompt-template.md・hints.mdのとおりにする。全角と半角のあいだに空白を入れない。
- **サイドバーの見た目・並び・名前は変えない**（ユーザーの指示）。

## Phase 1: Setup

**Purpose**: Constitutionの文言の明確化と、決定を変える文書の注記。

- [X] T001 `/speckit-constitution`で`.specify/memory/constitution.md`をPATCH（4.0.1 → 4.0.2）にする（research.md R18）。
  - 原則Vの「決済をMVPの最後のfeatureとする」を、「決済を、MVPのうちチーム運用と課金まわりの最後のfeatureとする。公開の前の入力の手助けなど、決済の判定に関わらない機能は、決済の後に足してよい」に直す。
  - Rationaleに2026-10-16の理由を1文足す。
  - Sync Impact Reportを残し、`Last Amended`を2026-10-16にする。
- [X] T002 [P] `specs/002-strategy-profile/spec.md`に注記を足す：プロフィール・固定投稿の下書きは、014（FR-113）から投稿のプロンプトに方向性の軸として入る。区分の名前の「課題①〜③」は014（FR-019）で外した。
- [X] T003 [P] `specs/003-prompt-bulk-register/contracts/prompt-template.md`の冒頭に、014のcontracts/prompt-template.mdで直したことへのリンクを1行足す。

---

## Phase 2: Foundational（すべてのStoryの前提）

**Purpose**: マイグレーション・共通の定義（課題の6キーと区分、参考投稿の項目、文字数と割合、新しい定数）。どのStoryもここに依存する。

- [X] T004 `apps/api/test/migration/migration-0015.test.ts`を先に書く（data-model.md「マイグレーションの確かめ」）：前後で課題・参考投稿・アカウントの件数と今の列の値が変わらない。今ある参考投稿が`platform = 'threads'`・`posted_date_mode = 'unknown'`、今あるアカウントが150・55・100・135・35・45・20になる。次のCHECKがそれぞれ拒まれる：割合の合計が100でない、長さが目標を超える、`exact`で投稿日がない、`exact`以外で投稿日がある、数字が負、投稿者が101文字、メモが501文字。
- [X] T005 `apps/api/drizzle/0015_strategy_guidance.sql`と`apps/api/src/db/schema.ts`を直す（data-model.md）。T004を通す。
  - `strategy_designs`：`purpose_origin`・`purpose_self`・`purpose_others`・`purpose_future`・`purpose_stance`・`activity_axis`（`text NULL`）
  - `reference_posts`
    - `platform text NOT NULL DEFAULT 'threads'`（CHECKで`threads`・`instagram`・`tiktok`・`x`・`other`）
    - `posted_date_mode text NOT NULL DEFAULT 'unknown'`（CHECKで`exact`・`week`・`month`・`3months`・`unknown`）
    - `posted_date date NULL`（CHECK：`exact`のときだけ値がある）
    - `metric_likes`・`metric_replies`・`metric_views`・`metric_saves`・`metric_reposts`・`metric_followers`（`integer NULL`、CHECKで0以上）
    - `author text NULL`（100文字まで）、`memo text NULL`（500文字まで）
  - `accounts`（smallint NOT NULL）
    - `post_length_target` DEFAULT 150（50〜500）
    - `short_length` 55・`medium_length` 100・`long_length` 135（各10〜500かつ`≤ post_length_target`）
    - `short_ratio` 35・`medium_ratio` 45・`long_ratio` 20（各0〜100、合計100）
  - `apps/api/drizzle/meta`の記録も合わせる。
- [X] T006 [P] `packages/shared/src/limits.ts`に定数を足す：`PROMPT_SPLIT_THRESHOLD = 12000`、`REFERENCE_BATCH_MAX = 20`、`EXPLAIN_BATCH_MAX = 10`、`KEYWORD_BATCH_MAX = 20`、`REFERENCE_AUTHOR_MAX = 100`、`REFERENCE_MEMO_MAX = 500`、`FRESHNESS_LATEST_DAYS = 30`、`FRESHNESS_ACTIVE_DAYS = 90`、`POST_LENGTH_DEFAULTS = { target: 150, shortLength: 55, mediumLength: 100, longLength: 135, shortRatio: 35, mediumRatio: 45, longRatio: 20 }`。
- [X] T007 `packages/shared/test/strategy.test.ts`を先に直し、`packages/shared/src/strategy.ts`を直す（data-model.md、research.md R3）。
  - `STRATEGY_TEXT_KEYS`の先頭に`purposeOrigin`・`purposeSelf`・`purposeOthers`・`purposeFuture`・`purposeStance`・`activityAxis`を足す。
  - `STRATEGY_SECTIONS`：先頭に`{ id: "purpose", title: "活動の目的・在り方", chip: "目的" }`を足す。`sales`は「営業導線設計」／「営業導線」、`account`は「アカウント設計」／「アカウント」、`funnel`は「集客導線設計」／「集客導線」にする（「課題①〜③」を外す。FR-019）。`chipShort`をやめ、`drafts`のチップを「下書き」にする。
  - `STRATEGY_FIELDS`に6項目を`section: "purpose"`・`counted: false`で足す。項目名はQ1：〜Q5：の問いと「活動の軸」、記入例はcontracts/hints.mdの例に合わせる。
  - テスト：`countFilled`と`STRATEGY_TOTAL = 16`が変わらない（SC-007）、区分の順・名前。
- [X] T008 `packages/shared/test/schemas.test.ts`（新規）を先に書き、`packages/shared/src/schemas.ts`を直す（contracts/api.md）。
  - `putStrategyRequestSchema`：目的の6キーは`.optional()`、今の19キーと`tonePreset`は必須のまま。
  - `strategySchema`：6キーを足す。
  - `referencePostInputSchema`
    - `platform`（既定`threads`）・`postedDateMode`（既定`unknown`）・`postedDate`（`YYYY-MM-DD`か`null`）を足す。`exact`なら必須で、今日（日本時間）より後でない。それ以外は`null`。
    - `metrics`：`likes`・`replies`・`views`・`saves`・`reposts`・`followers`の0以上の整数か`null`、2147483647まで。
    - `author`（100文字）・`memo`（500文字）を足す。
    - どれも省略でき、省略は既定値。
  - 応答の`referencePostSchema`：`freshness`（`latest`・`active`・`archive`・`unknown`）と`shortId`を足す。
  - まとめての要求：`referencePostBatchRequestSchema`（1〜20件）、`explanationsRequestSchema`（1〜10件、`whyGood`は1〜2,000文字、同じ`id`の重なりを拒む）、`keywordBatchRequestSchema`（1〜20件）。
  - `putPromptSettingsRequestSchema`に`length`（任意）を足す：`target`は50〜500で10刻み、各長さは10〜500で5刻みかつ`target`以下、各割合は0〜100で5刻み、合計100。
  - `promptResponseSchema`に`parts`・`length`・`splitRecommended`・`settings`・`materials`を足す。
- [X] T009 `apps/api/src/services/strategy-service.ts`と`apps/api/src/routes/strategy.ts`：目的の6キーを読み書きし、PUTで省略されたキーは`set`に入れない（今の値を残す）。先に`apps/api/test/integration/strategy-purpose.test.ts`を書く（FR-050・FR-054・FR-055、SC-006）。
  - 保存・読み直し・版の衝突・操作の記録（`strategy_saved`）
  - 6キーを省いたPUTで値が残る
  - 見せてもらっている人のGETに6キーが出る
  - 読むだけ（013）のオーナーのPUTが`403 BILLING_REQUIRED`（FR-071）
  - `filledCount`が変わらない
- [X] T010 `apps/web/src/lib/api-client.ts`の型と`apps/web/src/pages/strategy.tsx`の`pickValues`・`sameValues`を、6キーに合わせる（画面の区分は`STRATEGY_SECTIONS`から並ぶので、目的の区分が先頭に出る）。区分の名前の変更で落ちる今のテスト（`apps/web/test/strategy.test.tsx`）の期待を直す。

**Checkpoint**：マイグレーションが当たり、課題の画面に目的の区分が出て保存でき、今のテストが通る。

---

## Phase 3: User Story 1 -項目ごとの考えるヒントを見て書ける(Priority: P1) 🎯 MVP

**Goal**：数える16項目と目的の5問に、考えるヒント（コツ・悪い例・良い例・3つの問い）が出る。

**Independent Test**：課題の画面で21項目にヒントがあり、開閉でき、初めは閉じていて、見せてもらっている人にも出ることを確かめる。

### Tests for User Story 1

- [X] T011 [P] [US1] `packages/shared/test/strategy-guidance.test.ts`：`STRATEGY_HINTS`が21項目（目的の5問・テキストの15項目・近い人間性）をそろえ、各項目にコツ・悪い例・良い例・足してみたら2〜3個・こんな場合は・もっと良くするなら・目安の文字数（近い人間性はなし）がある。発信テーマの掛け合わせに★と考え方がある（SC-001、FR-001・FR-003）。
- [X] T012 [P] [US1] `apps/web/test/strategy-hints.test.tsx`：考えるヒントが初めは閉じている、押すと開いて内容が出る、もう一度で閉じる、★特に大事と考え方の文が出る、見せてもらっている人（`canEdit: false`）でもヒントが出る（FR-002〜FR-004）。

### Implementation for User Story 1

- [X] T013 [US1] `packages/shared/src/strategy-guidance.ts`を作り、`STRATEGY_HINTS`をcontracts/hints.mdの文言のとおりに書く（キー・コツ・悪い例・良い例・`more`・`whatIf`・`better`・`shortTip`（任意）・`minChars`・`star`と`starNote`）。`packages/shared/src/index.ts`から出す。T011を通す。
- [X] T014 [P] [US1] `apps/web/src/components/strategy/HintPanel.tsx`を作る：「考えるヒント」のボタン（`aria-expanded`）と、開いたときのコツ・悪い例と良い例（`grid`で横2つ、狭い幅では縦）・足してみたら・こんな場合は・もっと良くするなら（contracts/ui-routes.md「課題」）。
- [X] T015 [US1] `apps/web/src/pages/strategy.tsx`と`apps/web/src/components/FieldWithCounter.tsx`：各項目の下に`HintPanel`を置き、★特に大事の印と考え方の文を出す（近い人間性の`ToneSelect`にも置く）。T012を通す。

**Checkpoint**：US1だけで、21項目のヒントを読める。

---

## Phase 4: User Story 2 -自動チェックと進み具合で、次に書く項目がわかる(Priority: P1) 🎯 MVP

**Goal**：項目ごとの未入力・短め・十分、完了・要確認・目的の数、次におすすめ、PCでも固定の区分のチップ。

**Independent Test**：入力で印と数が保存の前に変わり、次におすすめで項目へ移り、チップが固定されて今の区分が変わることを確かめる。

### Tests for User Story 2

- [X] T016 [P] [US2] `packages/shared/test/strategy-guidance.test.ts`に`checkStrategy`のテストを足す（FR-010〜FR-016、research.md R2）。
  - 空白・改行だけは`empty`、目安ちょうどは`ok`、目安未満は`short`。近い人間性は選んでいれば`ok`。
  - 下書きと活動の軸は判定しない。
  - 完了（16項目の`ok`）・要確認（16項目と5問の`short`）・目的（5問の`ok`）の数。
  - 次におすすめ：表示の順で最初の`empty`、なければ最初の`short`、なければ`null`。
- [X] T017 [P] [US2] `apps/web/test/strategy-progress.test.tsx`（FR-012〜FR-018）。
  - 入力のたびに印・数・短めの一言が変わる（保存しない）。
  - 次におすすめを押すと項目へ移り、直せる人なら入力欄にフォーカスする。
  - すべて十分のとき「すべての項目が十分に書けています」。
  - チップに区分ごとの`ok`の数/項目数と✓が出て、今の区分の`aria-current`が付く（`IntersectionObserver`を差し替えて確かめる）。
  - スマートフォンの幅で完了・要確認の数が先頭に出る。

### Implementation for User Story 2

- [X] T018 [US2] `packages/shared/src/strategy-guidance.ts`に`checkStrategy(values)`を足す（`countChars`と`isBlank`を使う）。T016を通す。
- [X] T019 [P] [US2] `apps/web/src/components/strategy/FieldCheckBadge.tsx`（十分・短め・未入力の印）と`ProgressCard.tsx`（完了n/16項目・要確認n件・活動の目的n/5問・バー・次におすすめのリンク・「全体をAIと整理する」の置き場所）を作る。
- [X] T020 [P] [US2] `apps/web/src/components/strategy/SectionChips.tsx`を作る（research.md R5）。
  - 区分ごとの`ok`の数/項目数（すべて十分なら✓、下書きは数なし）を出す。
  - 今の区分を`IntersectionObserver`で決め、`aria-current`と塗りつぶしで目立たせる。
  - 押すと見出しへ移る。
- [X] T021 [US2] `apps/web/src/pages/strategy.tsx`を直す。T017を通す。
  - `PageHeader`の`toolbar`を、PCでもスマートフォンでも固定の`SectionChips`にする（今のPCの区分のボタンの並びは消す）。
  - 上部バーに完了・要確認・目的の数を出す。
  - `ProgressCard`を案内の文の下に置く。
  - 各項目に`FieldCheckBadge`と短めの一言を出す。
  - 区分の見出しに`scroll-margin-top`、項目に`id="field-<key>"`を付ける。

**Checkpoint**：US1＋US2（MVP）で、何をどこまで書けばよいかがわかる。

---

## Phase 5: User Story 3 -項目ごとにAIと深掘りして完成させる(Priority: P2)

**Goal**：項目ごとのプロンプトのコピー、貼り付け、反映（保存しない）。

**Independent Test**：コピーした文に問い・ヒント・今の入力・文脈が入り、目印つきの答えを貼ると内側だけが反映されることを確かめる。

### Tests for User Story 3

- [X] T022 [P] [US3] `packages/shared/test/strategy-prompts.test.ts`（FR-032・FR-033・FR-037、contracts/prompt-template.md 2）。
  - `buildDeepenPrompt`：項目名・説明・ヒント・今の入力（空なら「未入力」）・ほかの入力のある項目（下書きを除く）・頼み方・目印の2行が入る。掛け合わせでは候補を3つ以上出す頼み方。
  - `extractFinal`：組の内側、組なしは全体、2組は最初、始まりだけは全体、前後の空白を除く。
- [X] T023 [P] [US3] `apps/web/test/strategy-deepen.test.tsx`（FR-030〜FR-035、FR-070）。
  - 同時に1項目だけ開く。
  - コピー（クリップボードに書けないときは選べる形で出す）。
  - 反映する内容の出し分け（目印あり・なし）。
  - 「この内容を反映する」で入力欄が置き換わり、未保存の変更になり、「変更を破棄」で戻る。
  - 空なら押せない。上限超えの注意が出て、保存できない。
  - 見せてもらっている人・読むだけではボタンが出ない。

### Implementation for User Story 3

- [X] T024 [US3] `packages/shared/src/strategy-prompts.ts`を作り、`buildDeepenPrompt(key, values)`と`extractFinal(text)`を書く（目印は`【完成版ここから】`・`【完成版ここまで】`、research.md R4）。`packages/shared/src/index.ts`から出す。T022を通す。
- [X] T025 [P] [US3] `apps/web/src/components/strategy/DeepenPanel.tsx`を作る：3つの手順・「プロンプトをコピーする」（今の`PromptCard`と同じコピーの扱い）・貼り付け欄・反映する内容・「この内容を反映する」・「閉じる」・「反映しても、まだ保存されません」・上限超えの文。
- [X] T026 [US3] `apps/web/src/pages/strategy.tsx`：直せる人だけ、テキストの15項目と目的の5問に「この項目をAIと深掘りする」を置き、開いている項目を1つだけ持つ。反映は`set(key, value)`で行う。T023を通す。

---

## Phase 6: User Story 4 -全体をAIと整理する(Priority: P2)

**Goal**：課題の全体のプロンプトをコピーし、重複・矛盾・抜けの質問をもらう（取り込まない）。

**Independent Test**：コピーした文に区分ごとの全項目（下書きを除く。未保存を含む）と頼み方が入ることを確かめる。

- [X] T027 [P] [US4] `packages/shared/test/strategy-prompts.test.ts`に`buildOverallPrompt`のテストを足す：区分の順、空は「未入力」、下書きなし、頼み方（質問だけ・書き直さない・10問まで）（FR-041）。
- [X] T028 [US4] `packages/shared/src/strategy-prompts.ts`に`buildOverallPrompt(values)`を足す。T027を通す。
- [X] T029 [US4] `apps/web/src/components/strategy/ProgressCard.tsx`の「全体をAIと整理する」（直せる人だけ）で、画面の今の値からコピーし、「コピーしました。ChatGPTやClaudeに貼り付けて送ると…」を出す。テストは`apps/web/test/strategy-progress.test.tsx`に足す（FR-040・FR-042）。

---

## Phase 7: User Story 5 -活動の目的・在り方を書き、活動の軸をまとめる(Priority: P2)

**Goal**：目的の5問と活動の軸の画面の仕上げ、活動の軸のプロンプト、投稿のプロンプトへの反映。

**Independent Test**：5問を書いて保存し、「5問からAIと整理する」の文に答えが入り、投稿のプロンプトに目的の節が入ることを確かめる。

- [X] T030 [P] [US5] `packages/shared/test/strategy-prompts.test.ts`に`buildAxisPrompt`のテストを足す（5問の問いと答え・未入力・3案・目印。FR-036）。
- [X] T031 [P] [US5] `packages/shared/test/prompt.test.ts`に目的の節のテストを足す：戦略設計の節のすぐ後、入力のある見出しだけ、すべて空なら節ごとなし、長さの調整で削られない（FR-053、FR-117）。
- [X] T032 [US5] `packages/shared/src/strategy-prompts.ts`に`buildAxisPrompt(values)`を、`packages/shared/src/prompt.ts`に`purposeSection(strategy)`（contracts/prompt-template.md 1-5）を足し、`assemble`で戦略設計の後に置く。T030・T031を通す。
- [X] T033 [US5] `apps/web/src/pages/strategy.tsx`：目的の区分に案内の文（「何のために発信するかを先に決めると、ほかの項目が書きやすくなります。ここに書いた内容も、投稿づくりの材料になります」）を出す。活動の軸に「任意」の印と「5問からAIと整理する」（`DeepenPanel`を`buildAxisPrompt`で使う。5問がすべて空なら押せず「先にQ1〜Q5のどれかに答えてください」）を置く。テストは`apps/web/test/strategy-deepen.test.tsx`に足す（US5-1・US5-3・US5-4）。

---

## Phase 8: User Story 7 -参考投稿を、ためてまとめて・1件ずつ登録する(Priority: P2)

**Goal**：参考投稿の新しい項目・鮮度、ためてまとめて登録、一覧の表示、プロンプトの並び。

**Independent Test**：数字や投稿日の違う3件をためて登録すると、それぞれの値で登録され、一覧に鮮度が出ることを確かめる。

### Tests for User Story 7

- [X] T034 [P] [US7] `packages/shared/test/research.test.ts`（FR-096・FR-098・FR-099）。
  - `freshnessOf`：0・30・31・90・91日の境（日本時間の日付）。`week`・`month`・`3months`は登録日から7・30・90日前。`unknown`。
  - `sortForPrompt`：最新 → 現役 → 投稿日不明 → アーカイブ、同じ区分は登録の新しい順。
- [X] T035 [P] [US7] `apps/api/test/integration/reference-posts-fields.test.ts`（FR-095〜FR-097、SC-013）。
  - 新しい項目の追加・編集・読み直し。省略は既定値。
  - 検証：`exact`で日付なし・未来の日付、`exact`以外で日付あり、負の数字、101文字の投稿者。
  - GETの`freshness`・`shortId`。今ある行が`threads`・`unknown`。
- [X] T036 [P] [US7] `apps/api/test/integration/reference-posts-batch.test.ts`（FR-083・FR-084・FR-094、contracts/api.md）。
  - 20件まで、21件は400。1件でも検証に通らなければ0件（`fields`に位置）。
  - 上限200を超えるなら0件で`409 ITEM_LIMIT_REACHED`と`error.remaining`。同時の2つの要求でも上限を超えない。
  - 操作の記録が1件。権限：見せてもらっている人403、読むだけ`BILLING_REQUIRED`。
- [X] T037 [P] [US7] `apps/web/test/research-add.test.tsx`（FR-080〜FR-085、FR-097）。
  - ためる：欄が空になり、キーワードと媒体は残り、投稿日は不明に戻る。本文が空なら押せない。検証に通らなければためない。
  - ためた投稿の一覧と「外す」。登録のボタンの文（登録する／〇件を登録する）。
  - まとめての登録の成功と、上限の文。数字の欄の開閉。
  - ためた数が、残りの件数（上限200−今の件数）または20件に達したら「ためる」を押せなくなり、「参考投稿はあと〇件まで登録できます」「1回に登録できるのは20件までです」と出る（US7-5、FR-084）。
  - 閉じる・離れるときの確認。
  - 一覧のカードに媒体・鮮度・解説あり／なし・数字が出る。
- [X] T038 [P] [US7] `packages/shared/test/prompt.test.ts`：参考投稿が鮮度の順で入る（`buildPrompt`に渡す前の並べ替えは`apps/api/test/integration/prompt-research-order.test.ts`で確かめる）。

### Implementation for User Story 7

- [X] T039 [US7] `packages/shared/src/research.ts`を作り、`freshnessOf(post, today)`・`sortForPrompt(posts, today)`を書く（日本時間の日付は今の`packages/shared`の日付の関数を使う）。`index.ts`から出す。T034を通す。
- [X] T040 [US7] `apps/api/src/routes/research.ts`：`referenceColumns`・`toReferencePost`に新しい項目を足し、GETに`freshness`・`shortId`を足す。T035を通す。
- [X] T041 [US7] `apps/api/src/services/item-service.ts`に`insertManyWithLimit(env, accountId, kind, limit, count, n, insert)`を足す（`insertWithLimit`と同じアドバイザリーロック、`count + n > limit`なら`error.remaining`つきの409）。`apps/api/src/routes/research.ts`に`POST /accounts/:accountId/reference-posts/batch`（`content`、`reference_posts_added`を1件、`touchMaterials`）を足す。T036を通す。
- [X] T042 [US7] `apps/api/src/services/prompt-service.ts`：参考投稿を全件（上限200件）読み、`sortForPrompt`で並べてから`PROMPT_REFERENCE_POSTS`件にする。`PromptReferencePost`に媒体・数字・鮮度を渡す（節の書き方はUS10のT055）。T038を通す。
- [X] T043 [P] [US7] `apps/web/src/lib/api-client.ts`に`createReferencePostsBatch`と新しい項目の型を足す。
- [X] T044 [US7] `apps/web/src/components/research/ReferencePostFormDialog.tsx`を「参考投稿を追加」（ためる・まとめて登録）と「編集」（ためるなし）の2つの使い方にし、新しい項目（媒体・投稿日の選び方と日付・鮮度の表示・開閉の数字の欄・投稿者・メモ・なぜ良いかの案内）を足す。未登録の入力の確認は今の`useUnsavedChanges`を使う。
- [X] T045 [US7] `apps/web/src/pages/research.tsx`：参考投稿のカードに媒体・鮮度・解説あり／なし・キーワード・閲覧といいねを出す。T037を通す。

---

## Phase 9: User Story 8 -解説がまだの参考投稿を、まとめてAIに解説してもらう(Priority: P2)

**Goal**：まとめての解説のプロンプト（【ID】つき）、貼り戻しの取り出し、空の行だけの保存、編集の画面の1件の解説。

**Independent Test**：空の参考投稿3件のプロンプトに本文とIDが入り、3件分の答えがそれぞれに入って保存されることを確かめる。

### Tests for User Story 8

- [X] T046 [P] [US8] `packages/shared/test/research.test.ts`に足す（FR-101〜FR-103、SC-014、contracts/prompt-template.md 5）。
  - `shortIdsOf`：先頭8文字、重なるときに延びる。
  - `buildExplainPrompt`：まとめては【ID】と`@@@`、1件はなし。数字の不明、課題の材料。
  - `parseExplanations`：`@@@`での分け方、`【ID:〜】`と`【ID：〜】`。理由（見つからない・すでに解説あり・2回目・空・2,000文字超）。前後の説明のブロック。
- [X] T047 [P] [US8] `apps/api/test/integration/reference-posts-explain.test.ts`（FR-100〜FR-105、SC-014）。
  - `explain-prompt`：空の行を`sortForPrompt`の順で10件まで、`pendingCount`、`?id=`の1件、0件のとき。
  - `explanations`：空の行だけ更新し版を上げる。解説ありの行は`skipped`（`already_explained`）、ほかのアカウントのIDは`not_found`。同じIDの重なりは400。操作の記録が1件。
  - 権限の表。
- [X] T048 [P] [US8] `apps/web/test/research-explain.test.tsx`（US8-1〜US8-8）。
  - 解説がまだの件数と、押すとコピーして貼り付け欄が出る。
  - 一覧の対応と理由の印。保存の文（飛ばした分を含む）。
  - 0件なら出さない。見せてもらっている人には出さない。
  - 編集の画面の1件の解説（「なぜ良いかに入れる」）。

### Implementation for User Story 8

- [X] T049 [US8] `packages/shared/src/research.ts`に`shortIdsOf`・`buildExplainPrompt`・`parseExplanations`を足す（区切りの判定は`drafts.ts`の`splitDrafts`と同じ行の判定を使う）。T046を通す。
- [X] T050 [US8] `apps/api/src/routes/research.ts`に`GET /accounts/:accountId/reference-posts/explain-prompt`と`POST /accounts/:accountId/reference-posts/explanations`を足す（`content`。保存は1つのトランザクションで`UPDATE … WHERE account_id = ? AND id = ? AND (why_good IS NULL OR btrim(why_good) = '')`、版＋1・最終更新者、`reference_posts_explained`を1件、`touchMaterials`）。T047を通す。
- [X] T051 [P] [US8] `apps/web/src/components/research/ExplainBatchPanel.tsx`を作り、`apps/web/src/pages/research.tsx`の一覧の上に置く。`apps/web/src/components/research/ReferencePostFormDialog.tsx`の編集に「AIに解説してもらう」（`?id=`のプロンプト・貼り付け欄・「なぜ良いかに入れる」）を足す。`apps/web/src/lib/api-client.ts`に2つのAPIを足す。T048を通す。

---

## Phase 10: User Story 10 -書いた課題・宣伝内容・リサーチが、投稿のプロンプトに確実に効く(Priority: P2)

**Goal**：投稿のプロンプトの直し（contracts/prompt-template.md 1）。文字数と割合は、US13の前は初めの値で作る。

**Independent Test**：材料をそろえたアカウントのプロンプトに各節・指示・件数が入り、件数がそろい、空の材料の節が入らないことを確かめる。

### Tests for User Story 10

- [ ] T052 [P] [US10] `packages/shared/test/prompt.test.ts`を直し、足す（FR-110〜FR-118・FR-170〜FR-172、SC-015・SC-016・SC-018）。
  - 件数：`promoCount`・`patternCount`・`profileInviteCount`・`splitLengthMix`。
  - 節：最初に確認すること・優先順位、忠実に反映の指示、話題の配分（4項目のどれかがあるとき）、プロフィールと固定投稿（下書きがあるとき）、宣伝のタイトル・期限と残り日数・ちょうどN件・書き方、リサーチの引用・鮮度・媒体・数字・「分析メモなし」・型の件数、長さの件数と幅、文字数の目標、コードブロックの指示、最終チェック（材料のある行だけ）。
  - 冒頭・各節・最終チェックで件数が同じ。材料が空なら節と行が入らない。
  - 初めの値で今の範囲（150字・40〜70・80〜120・120〜150）。長さの調整で新しい節が残る。今のテストの期待（150字の文など）を新しい文に直す。
- [ ] T053 [P] [US10] `packages/shared/test/drafts.test.ts`：`splitDrafts`が行の初めの```` ``` ````（言語名つき、前の空白つき）を除いてから分け、行の途中の```` ``` ````は残す（FR-170、SC-021）。
- [ ] T054 [P] [US10] `apps/api/test/integration/prompt-materials.test.ts`：宣伝内容のタイトル・期限が入る、下書き・目的が入る、`length`が全文の文字数（FR-113〜FR-115）。

### Implementation for User Story 10

- [ ] T055 [US10] `packages/shared/src/prompt.ts`を直す（research.md R10、contracts/prompt-template.md 1）。T052を通す。
  - `PromptInput`に`today`・`lengthSettings`（既定は`POST_LENGTH_DEFAULTS`）を足す。`PromptPromotion`に`title`・`validUntil`、`PromptReferencePost`に`platform`・`metrics`・`freshness`を足す。
  - 件数を求める関数（`promptCounts`）と`splitLengthMix`を足し、各節に渡す。
  - 節を足す：`firstCheckSection`・`profileSection`・`finalCheckSection`。
  - 節を直す：`strategySection`（忠実に反映・話題の配分）・`promotionSection`・`researchSection`・`lengthMixSection`・`charCountSection`・`outputSection`。
  - `assemble`の順をR10にする。
  - 長さの調整は今の減らす順のまま、新しい節を減らさない。戻り値に`length`を足す。
- [ ] T056 [US10] `packages/shared/src/drafts.ts`の`splitDrafts`で、行の初めが```` ``` ````の行を除く。T053を通す。
- [ ] T057 [US10] `apps/api/src/services/prompt-service.ts`：宣伝内容の`title`・`validUntil`、今日の日付（日本時間）、アカウントの文字数と割合（US13の前は既定値の列）を`buildPrompt`に渡す。応答に`length`を足す。T054を通す。
- [ ] T058 [US10] `apps/web/src/pages/strategy.tsx`の下書きの区分の説明を「Threadsには自動で反映されない下書きです。投稿づくりでは、投稿の方向性の軸として使います」に変え、`apps/web/test/strategy.test.tsx`の期待を直す（FR-021）。

---

## Phase 11: User Story 15 -「投稿をつくる」と「投稿ストック」の役割を分ける(Priority: P2)

**Goal**：`/create`の画面、`/stock`は一覧だけ、サイドバーとホームの行き先。US11・US12・US13・US14はこの画面に載せる。

**Independent Test**：サイドバーの「投稿をつくる」で開き、コピー・貼り付け・登録・「投稿ストックで確かめる」で要確認が開き、投稿ストックは一覧だけで空なら案内されることを確かめる。

### Tests for User Story 15

- [ ] T059 [P] [US15] `apps/web/test/create.test.tsx`（新規。今の`apps/web/test/stock.test.tsx`のプロンプトのカードと貼り付け欄の部分をここへ移す）（FR-160〜FR-162・FR-165）。
  - 画面の並び。
  - 登録の後の「〇件を投稿ストックに登録しました」「投稿ストックで確かめる」（`/stock`）と、貼り付け欄が空になる。
  - プロンプトを作れない状態の案内が今と同じ。未登録の入力の確認。
- [ ] T060 [P] [US15] `apps/web/test/stock.test.tsx`を直す（FR-163、SC-023）：プロンプトのカードと固定の貼り付け欄がない、上に「投稿をつくる」、空の要確認で「まだ投稿がありません」と「投稿をつくる」、今の承認・却下・修正・まとめての承認・投稿済みのテストは今のまま通る。
- [ ] T061 [P] [US15] `apps/web/test/sidebar-create.test.tsx`（サイドバーの「投稿をつくる」が`/accounts/:id/create`へ移り、その画面で選ばれた見た目になる。並び・名前は変わらない）と、`apps/web/test/account-home.test.tsx`（「投稿をつくりましょう」のボタンが`/create`へ）（FR-160・FR-164）。

### Implementation for User Story 15

- [ ] T062 [US15] `apps/web/src/router.tsx`に`/accounts/:accountId/create`を足し、`apps/web/src/pages/create.tsx`を作る：上部バー「投稿をつくる」、`PromptCard`、`PasteComposer`の順（US12・US11・US13・US14の部品は後のPhaseで足す）。T059を通す。
- [ ] T063 [US15] `apps/web/src/components/stock/PasteComposer.tsx`を、画面の下に固定しない置き方（`placement: "inline"`）でも使えるようにし、見出し「AIの答えを貼り付けて、投稿ストックに登録する」と、登録の後の案内（件数・「投稿ストックで確かめる」）を足す。`PromptCard.tsx`の`startKey`（サイドバーから来たときの移動とフォーカス）は、`/create`を開いたときの初めのフォーカスに置き換える。
- [ ] T064 [US15] `apps/web/src/pages/stock.tsx`から`PromptCard`・`PasteComposer`・`startCreate`の扱いを外し、`PageHeader`の`actions`に「投稿をつくる」（`/create`）、空の要確認の案内を足す。T060を通す。
- [ ] T065 [US15] `apps/web/src/components/layout/Sidebar.tsx`の「投稿をつくる」を`NavLink`で`${base}/create`へ（`state.startCreate`をやめる。見た目・並び・名前は変えない）。`apps/web/src/pages/account-home.tsx`の「投稿をつくりましょう」のボタンを`/create`へ。T061を通す。
- [ ] T066 [US15] E2Eを直す：`e2e/tests/onboarding.spec.ts`・`e2e/tests/team.spec.ts`・`e2e/tests/token.spec.ts`・`e2e/tests/helpers.ts`・`e2e/tests/team-flow.ts`で、投稿ストックのプロンプト・貼り付けを使っている所を「投稿をつくる」へ。

---

## Phase 12: User Story 11 -プロンプトに何が入っているかを、「投稿をつくる」で確かめる(Priority: P2)

**Goal**：`GET /prompt`の`materials`と、「プロンプトに入っている情報」。

**Independent Test**：区分ごとの件数・判定が課題・宣伝内容・リサーチの画面とプロンプトに入る内容と一致し、「編集」でその項目へ移ることを確かめる。

- [ ] T067 [P] [US11] `apps/api/test/integration/prompt-materials.test.ts`に`materials`のテストを足す（FR-121・FR-123、SC-017）。
  - 課題：`checkStrategy`の結果と文字数。下書き：入力のあり・なし。
  - 宣伝：公開中で期限内の件数と行動喚起が空の件数。
  - リサーチ：全件・入る件数（10件まで）・解説あり・解説がまだ。
- [ ] T068 [P] [US11] `apps/web/test/create-materials.test.tsx`（FR-120〜FR-122）：閉じた状態の1行のまとめ、開くと一覧、課題の「編集」が`/strategy#field-<key>`、「解説がまだ」がリサーチのまとめての解説へ、プロンプトを作れない人には出ない。
- [ ] T069 [US11] `apps/api/src/services/prompt-service.ts`で`materials`を作り、`apps/api/src/routes/prompt.ts`の応答に足す。T067を通す。
- [ ] T070 [US11] `apps/web/src/components/create/PromptMaterials.tsx`を作り、`apps/web/src/components/stock/PromptCard.tsx`に置く。`apps/web/src/pages/strategy.tsx`で`#field-<key>`を開いたときにその項目へ移る。T068を通す。

---

## Phase 13: User Story 12 -「投稿をつくる」で、進め方がわかり、自分で1件書ける(Priority: P2)

**Goal**：5つの手順の案内、貼り付け欄の注意と自分で1件書く入口。

**Independent Test**：手順の案内と開閉（端末に覚える）、注意と入口が出ることを確かめる。

- [ ] T071 [P] [US12] `apps/web/test/create-steps.test.tsx`（FR-130〜FR-132）：手順の5行とリンク、閉じたことを`localStorage`に覚える（読めないときは開いた状態）、貼り付け欄のコピーの注意、「自分で1件書く」と「リサーチを見る」、見せてもらっている人には出ない。
- [ ] T072 [P] [US12] `apps/web/src/lib/preferences.ts`を作る：`readPreference(key, fallback)`・`writePreference(key, value)`（`threads-grower:`で始まるキー。`localStorage`が使えなければ例外を出さずに既定値。research.md R15）。
- [ ] T073 [US12] `apps/web/src/components/create/CreateSteps.tsx`を作り`apps/web/src/pages/create.tsx`の一番上に置く。`PasteComposer.tsx`の`inline`の置き方に注意と入口を足す。T071を通す。

---

## Phase 14: User Story 6 -リサーチのやり方と、はじめに読んでほしいことがわかる(Priority: P3)

**Goal**：リサーチの読み物とホームの読み物。

**Independent Test**：リサーチの画面で解説を開いて読め、ホームで読めて閉じられる（端末に覚える）ことを確かめる。

- [ ] T074 [P] [US6] `apps/web/test/research-guide.test.tsx`（FR-060・FR-062）と`apps/web/test/intro-guide.test.tsx`（FR-061：初めは開く、閉じると見出し1行、利用者ごとに覚える、見せてもらっている人のホームでは出ない）。
- [ ] T075 [P] [US6] `apps/web/src/components/guides/ResearchGuide.tsx`を作る（①3つの指標 ②真似してよい投稿 ③真似しない方がよい投稿と例外 ④5つの手順 ⑤登録する前の5つの確認といちばん大事な考え方。このアプリの言葉で、成果を約束しない）。`apps/web/src/pages/research.tsx`のタブの下に、閉じた状態で置く。
- [ ] T076 [P] [US6] `apps/web/src/components/guides/IntroGuide.tsx`を作り（文はcontracts/ui-routes.md「ホーム」）、`apps/web/src/pages/account-home.tsx`の一番上に置く（`preferences.ts`の`threads-grower:intro-dismissed:<userId>`）。T074を通す。

---

## Phase 15: User Story 9 -検索するキーワードの案をAIに出してもらう(Priority: P3)

**Goal**：キーワードの案のプロンプト、取り出し、まとめての登録、「Threadsで検索」。

**Independent Test**：コピーした文に課題が入り、1行1つの答えを貼って選んだものだけ登録され、「Threadsで検索」が検索結果を開くことを確かめる。

- [ ] T077 [P] [US9] `packages/shared/test/research.test.ts`に`buildKeywordIdeaPrompt`・`parseKeywordIdeas`のテストを足す（行頭の`1.`・`1)`・`・`・`-`・`#`・`*`を除く、`｜`と`|`、`｜`なし、空の行、100文字超・登録済み・一覧の中の重なり。FR-090・FR-091）。
- [ ] T078 [P] [US9] `apps/api/test/integration/keywords-batch.test.ts`：`idea-prompt`の中身、まとめての登録（20件まで・上限100で0件と`remaining`・登録済みと重なれば`409 KEYWORD_DUPLICATE`と`details.keywords`・一覧の中の重なりは400・操作の記録が1件）、権限の表（FR-092・FR-094）。
- [ ] T079 [P] [US9] `apps/web/test/research-keywords.test.tsx`：案のカード・チェック付きの一覧・登録・「Threadsで検索」のURL（`https://www.threads.com/search?q=`＋エンコード）と`target="_blank"`、見せてもらっている人は「Threadsで検索」だけ（FR-090〜FR-093）。
- [ ] T080 [US9] `packages/shared/src/research.ts`に`buildKeywordIdeaPrompt`・`parseKeywordIdeas`を足し、`apps/api/src/routes/research.ts`に`GET /research-keywords/idea-prompt`と`POST /research-keywords/batch`（`insertManyWithLimit`、`research_keywords_added`）を足す。T077・T078を通す。
- [ ] T081 [US9] `apps/web/src/components/research/KeywordIdeasPanel.tsx`を作り、`apps/web/src/pages/research.tsx`のキーワードのタブに置く。キーワードの各行に「Threadsで検索」を足す。`apps/web/src/lib/api-client.ts`に2つのAPIを足す。T079を通す。

---

## Phase 16: User Story 13 -1投稿の文字数と、短文・中文・長文の割合を決める(Priority: P3)

**Goal**：文字数と割合の保存と、「投稿をつくる」の設定の欄。

**Independent Test**：値を変えて保存・読み直しでき、内訳とプロンプトの数字が変わり、「初期値に戻す」で今と同じになることを確かめる。

- [ ] T082 [P] [US13] `apps/api/test/integration/prompt-settings-length.test.ts`（FR-140〜FR-142）。
  - `length`の保存・省略。刻み・合計100・目標以下の検証（`details.reason`）。
  - 版の衝突（`latest`に`length`）。オーナーだけ（担当の人は403）。操作の記録`prompt_length_saved`。
  - `GET /prompt`の`settings`と、プロンプトの数字が変わる。
- [ ] T083 [P] [US13] `apps/web/test/create-length.test.tsx`：1行のまとめ、入力のたびの内訳（合計＝作る件数）、理由の文で保存できない、「初期値に戻す」、保存、オーナー以外は保存できない（SC-019）。
- [ ] T084 [US13] `apps/api/src/routes/prompt.ts`の`PUT /prompt-settings`で`length`を保存（同じ版、`prompt_length_saved`）、`GET /prompt`に`settings`を足す。`apps/api/src/services/prompt-service.ts`でアカウントの値を`buildPrompt`に渡す。T082を通す。
- [ ] T085 [US13] `apps/web/src/components/create/LengthSettings.tsx`を作り、`PromptCard.tsx`に置く（目標の文字数・短文中文長文の文字数とスライダー・件数・内訳・理由・「保存」・「初期値に戻す」。`splitLengthMix`を使う）。T083を通す。

---

## Phase 17: User Story 14 -長いプロンプトを2つに分けて送る(Priority: P3)

**Goal**：`parts`と送り方の切り替え。

**Independent Test**：長いプロンプトで文字数と注意が出て、1つ目・2つ目をそれぞれコピーでき、合わせると全文と同じ節になることを確かめる。

- [ ] T086 [P] [US14] `packages/shared/test/prompt.test.ts`に`parts`のテストを足す：1つ目と2つ目の冒頭・末尾の文、どちらにも最初に確認すること、合わせた節が全文と同じ（SC-020）。`splitRecommended`の境（12,000字）。
- [ ] T087 [P] [US14] `apps/web/test/create-parts.test.tsx`：文字数の表示、12,000字超で注意と「2つに分けて送る」が初めの選択、切り替えを`localStorage`に覚える、それぞれのコピー・中身を見る、書き換えのコピーは1つにまとめたときだけ（FR-150〜FR-153）。
- [ ] T088 [US14] `packages/shared/src/prompt.ts`の`buildPrompt`に`parts`を足し（節2〜6と7〜14で分ける）、`apps/api/src/routes/prompt.ts`の応答に`parts`・`splitRecommended`を足す。T086を通す。
- [ ] T089 [US14] `apps/web/src/components/create/PromptParts.tsx`を作り、`PromptCard.tsx`のコピーの所を、文字数・送り方の切り替え（`preferences.ts`の`threads-grower:prompt-send-mode`）・1つにまとめて（今のコピーと書き換え）・2つに分けて（各行のコピーと中身を見る）にする。T087を通す。

---

## Phase 18: Polish & Cross-Cutting Concerns

- [ ] T090 [P] E2E：`e2e/tests/strategy.spec.ts`に目的の5問・考えるヒント・自動チェック・深掘りの反映（偽の答え）を足す。`e2e/tests/research.spec.ts`（新規：ためて登録 → まとめての解説（偽の答え））と`e2e/tests/create.spec.ts`（新規：投稿をつくる → コピー → 貼り付け（コードブロックつき）→ 登録 → 投稿ストックで確かめる）を書く。
- [ ] T091 [P] `docs/ui-design.md`に「投稿をつくる」の画面と、課題の固定のチップ・リサーチの追加の欄を足す。
- [ ] T092 [P] `apps/web/src/pages/activity.tsx`に新しい操作の記録の名前（`reference_posts_added`・`reference_posts_explained`・`research_keywords_added`・`prompt_length_saved`）の表示を足し、テストを足す。
- [ ] T093 スマートフォンの幅（375px）で、課題・リサーチ・投稿をつくる・投稿ストック・ホームが横にはみ出さないことを、Webのテスト（幅を狭めた描画）と手で確かめる（SC-009）。
- [ ] T094 `pnpm lint && pnpm typecheck && pnpm test && pnpm e2e`を通し、`specs/014-strategy-guidance/verification.md`に結果と手で確かめること（quickstart.md 2）の結果、計画からの変更を書く。
- [ ] T095 [P] contracts/hints.mdの文言を、ユーザーに確かめてもらい、直しがあれば`packages/shared/src/strategy-guidance.ts`に反映する。

---

## Dependencies & Execution Order

### Phaseの順

- **Phase 1（Setup）**：すぐに始められる。T001はほかのPhaseと並べてよいが、PRの前に終える。
- **Phase 2（Foundational）**：すべてのStoryの前提（マイグレーション・共通の定義・目的の6キー）。
- **Phase 3〜4（US1・US2。MVP）**：Phase 2の後。US2はUS1の`strategy-guidance.ts`（T013）に`checkStrategy`を足す。
- **Phase 5〜7（US3〜US5）**：US2の後（課題の画面の作りに乗る）。US3・US4・US5は`strategy-prompts.ts`を順に足すので、この順に行う。
- **Phase 8〜9（US7・US8）**：Phase 2の後なら課題のStoryと並べられる。US8はUS7の`research.ts`（T039）とAPIの項目（T040）に依存する。
- **Phase 10（US10）**：US5（目的の節）・US7（参考投稿の並び）の後。
- **Phase 11（US15）**：US10の後（プロンプトのカードを移す）。
- **Phase 12〜13（US11・US12）**：US15の後（「投稿をつくる」の画面に載せる）。US11はUS2の`checkStrategy`も使う。
- **Phase 14（US6）**：Phase 2の後ならいつでも。
- **Phase 15（US9）**：US7の`research.ts`の後。
- **Phase 16〜17（US13・US14）**：US15の後。US13はUS10の`splitLengthMix`、US14はUS10の`buildPrompt`の直しに依存する。
- **Phase 18（Polish）**：すべてのStoryの後。

### Story間の関わり

- US1・US2は課題の画面だけで、ほかに依存しない（MVP）。
- US10は、US5・US7の材料と、US13の設定の初めの値に依存する（US13の前は既定値の列で動く）。
- US11・US12・US13・US14は、US15の「投稿をつくる」の画面に載せる。

### Story内の順

- テストを先に書いて失敗を確かめる → 共通（`packages/shared`）→ API → Web。

## Parallel Example

```text
# Phase 2の後、課題とリサーチを並べる
Task: T011 [US1] strategy-guidance.test.ts（ヒント）
Task: T034 [US7] research.test.ts（鮮度・並び）
Task: T035 [US7] reference-posts-fields.test.ts

# US7の中で
Task: T036 reference-posts-batch.test.ts
Task: T037 research-add.test.tsx
Task: T043 api-client.ts

# US15の中で
Task: T059 create.test.tsx
Task: T060 stock.test.tsx
Task: T061 sidebar-create.test.tsx・account-home.test.tsx
```

## Implementation Strategy

### MVP First（US1＋US2）

1. Phase 1・2を終える（Constitutionの文言、マイグレーション、目的の区分）。
2. US1（考えるヒント）とUS2（自動チェック・進み具合・固定のチップ）を作る。
3. 課題の画面で、何をどこまで書けばよいかがわかることを確かめる。

### Incremental Delivery

1. MVP → US3〜US5（AIと深掘り・全体の整理・目的と活動の軸）で課題を仕上げる。
2. US7・US8（参考投稿のためて登録・まとめての解説）でリサーチを仕上げる。
3. US10（プロンプトの直し）→ US15（画面を分ける）→ US11・US12（情報の一覧・手順）。
4. P3：US6（読み物）・US9（キーワードの案）・US13（文字数と割合）・US14（2つに分ける）。
5. 各Storyの終わりに、そのStoryのテストと今のテストが通ることを確かめる。

## Notes

- `[P]`は別ファイルで依存のないタスク。同じファイル（`strategy.tsx`・`research.ts`・`prompt.ts`・`PromptCard.tsx`など）を触るタスクは順に行う。
- 文言はcontracts/のとおりにし、全角と半角のあいだに空白を入れない。
- 各タスク（または論理的なまとまり）の後にコミットする。
- サイドバーの見た目・並び・名前は変えない。投稿ストックのURLと操作の結果は変えない（SC-023）。
