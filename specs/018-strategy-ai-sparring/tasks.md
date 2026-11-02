---

description: "Task list for feature 018 strategy AI sparring"
---

# Tasks:AIと壁打ちして課題を埋める

**Input**: [spec.md](./spec.md)、[plan.md](./plan.md)、[research.md](./research.md)、[data-model.md](./data-model.md)、[contracts/prompt-template.md](./contracts/prompt-template.md)、[contracts/ui-routes.md](./contracts/ui-routes.md)、[quickstart.md](./quickstart.md)

**Tests**: 001〜017と同じく、テストを先に書いて失敗を確かめてから実装する（TDD）。特に次を自動テストで確かめる。SC-001（空の課題で、1回のコピーと1回の貼り付けで21項目を反映できる）、SC-002（決まった形の答えは、含まれる項目がすべて候補になる）、SC-003（反映しても、保存を押すまでサーバーは変わらない）、SC-004（選ばなかった項目は変わらない）、SC-005（形が崩れていても、読み取れなかった名前か出し直しの案内が必ず出る）。

**Organization**: 共通パッケージの純粋な関数（範囲の絞り込み・プロンプト・答えの読み取り・候補）をPhase 1・2で先に作り、画面はUser Storyごとに分ける。MVPはUS1（P1）。

## Format: `[ID] [P?] [Story] Description`

- **[P]**:別ファイルで、未完了のタスクに依存せず並行できる。
- **[Story]**: [US1]〜[US4]はspec.mdのUser Storyに対応する。
- Webのテストは、014の`apps/web/test/strategy-deepen.test.tsx`と同じ形（`renderStrategyPage`・`strategyOf`は`apps/web/test/helpers/strategy-page.tsx`、`api.getStrategy`・`api.putStrategy`をモック、貼り付けは`userEvent.paste`）で書く。
- ボタンは今の画面にそろえる（contracts/ui-routes.md）：「AIと壁打ちして埋める」は「全体をAIと整理する」と同じ`CopyPromptTrigger`の`outline`の見た目、欄の中は`DeepenPanel`と同じ（コピー・反映は塗り、閉じるは`ghost`）。押しても文言を変えない（docs/ui-design.md §6）。

## Phase 1: Setup

**Purpose**: 壁打ちの定数。

- [ ] T001 `packages/shared/src/strategy-sparring.ts`を作り、次を置いて`packages/shared/src/index.ts`から書き出す（research.md R2・R4、data-model.md）：
  - `SPARRING_KEYS`：対象の21のキーを表示の順で（`purposeOrigin`・`purposeSelf`・`purposeOthers`・`purposeFuture`・`purposeStance`・`activityAxis`・`finalAction`・`targetPersona`・`realWorries`・`desiredSelfImage`・`perceivedImage`・`contentThemeMix`・`antiPersona`・`benchmarkAccounts`・`funnelDesign`・`postGenres`・`dmReplyTemplate`・`inquiryQualityTips`・`toneNotes`・`differentiation`・`successMetrics`）。型`SparringKey`。`tonePreset`と下書きの4項目は入れない。
  - `SPARRING_SECTION_IDS`：`["purpose", "sales", "account", "funnel", "tone", "other"]`（下書きは入れない）。
  - `SPARRING_ITEM_BEGIN_PREFIX = "【項目："`・`SPARRING_ITEM_END = "【項目ここまで】"`と、始まりの目印の行を作る`sparringBeginLine(label)`（`【項目：${label}】`）。
  - テスト：`packages/shared/test/strategy-sparring.test.ts`に、`SPARRING_KEYS`が21で`STRATEGY_FIELDS`の順に並ぶこと、`tonePreset`・`profileBioDraft`・`pinnedPostDraft1〜3`を含まないこと。

## Phase 2: Foundational

**Purpose**: 範囲の絞り込み・プロンプト・答えの読み取り・候補の純粋な関数。US1〜US4のすべての画面がこれを使う。

### Tests（先に書いて失敗を確かめる）

- [ ] T002 [P] `packages/shared/test/strategy-sparring.test.ts`に、`selectSparringTargets(values, { sections, onlyIncomplete })`のテストを足す（research.md R4、FR-004）：
  - 空の課題・6区分すべて・`onlyIncomplete: true` → 21のキーが表示の順
  - 「十分」の項目は`onlyIncomplete: true`で外れ、`false`で入る。「短め」は`true`でも入る（判定は`checkStrategy`）
  - 活動の軸は、空なら入り、入力があれば`onlyIncomplete: true`で外れる
  - `sections`に`tone`だけ → `toneNotes`だけ。`sections`が空 → 空の配列
- [ ] T003 [P] `packages/shared/test/strategy-prompts.test.ts`に、`buildSparringPrompt(values, targets)`のテストを足す（contracts/prompt-template.md 1、FR-006・FR-007）：
  - 質問の対象ごとに`【n】{label}`・考えること（`description`）・ヒント（コツ・悪い例・良い例・足してみたい観点・こんな場合は・もっと良くするなら）・「今の私の答え」（空なら「未入力」、未保存の値を使う）が入る。活動の軸はヒントの行がない
  - 質問の対象ではない対象の項目のうち入力のあるものだけが「■ほかの項目に書いたこと」に入る。なければ節ごと入らない
  - 近い人間性・下書きの4項目の名前と値が、どこにも入らない
  - 進め方の5点（1〜2問ずつ・作らない・今の文を活かす・重なりと食い違い・完成版の出し方と「完成版を出して」）が入る
  - 「完成版の形」に、質問の対象ごとの`【項目：{label}】`と`【項目ここまで】`が、対象の順で入る
  - `contentThemeMix`が対象のときだけ、進め方に6（候補を3つ以上・相談して1つに）が入る
  - 長い入力でも削らない（2000字の値が21項目あっても全部入る）
- [ ] T004 [P] `packages/shared/test/strategy-sparring-parse.test.ts`を作り、`parseSparringAnswer(text)`のテストを書く（contracts/prompt-template.md 2の表を1行ずつ、research.md R3）：ふつう・太字（`**…**`）・コード（`` `…` ``）・見出し（`## …`）で囲んだ目印・半角の`:`と空白・括弧つきの名前・「Q1」だけ・終わりの目印がない（次の始まりまで／最後は答えの終わりまで）・同じ項目が2回（後のもの）・近い人間性と知らない名前（`unknown`、重ねない、出てきた順）・空の中身（入れない）・目印なし（`markerFound: false`）・目印の外の文を使わない・`】`のあとの同じ行の文を中身の1行目にする・`items`が表示の順。
- [ ] T005 [P] `packages/shared/test/strategy-sparring.test.ts`に、`buildSparringCandidates(items, values)`のテストを足す（data-model.md「反映の候補」、FR-015〜FR-018）：表示の順、`current`は渡した`values`、`selected`のはじめは「`current`が空（`isBlank`）で`proposed`と違う」とき真、`same`は前後の空白を除いて同じとき真（`selected`は偽）、`over`は`countChars(proposed) > STRATEGY_TEXT_MAX`（2000）。

### Implementation

- [ ] T006 `packages/shared/src/strategy-sparring.ts`に`selectSparringTargets`を実装する（T002を通す）。
- [ ] T007 `packages/shared/src/strategy-prompts.ts`に`buildSparringPrompt(values, targets)`を実装する（T003を通す。`fieldOf`・`valueText`・`hintOf`を使い、文はcontracts/prompt-template.md 1のとおり。ファイル先頭のコメントに specs/018 を足す）。
- [ ] T008 `packages/shared/src/strategy-sparring.ts`に`parseSparringAnswer`を実装する（T004を通す。行ごとに見て、NFKCにそろえて目印を判定し、名前は`label`と同じ正規化で引き当てる。目的の5問は「Q1」〜「Q5」で始まる名前も引き当てる）。
- [ ] T009 `packages/shared/src/strategy-sparring.ts`に`buildSparringCandidates`を実装する（T005を通す）。

**Checkpoint**: 共通パッケージのテストが通り、画面がなくても「範囲 → プロンプト → 答え → 候補」が関数だけで確かめられる。

## Phase 3: User Story 1 -まとめて壁打ちし、答えを一括で反映する（P1）🎯 MVP

**Goal**: 課題の画面で、壁打ちの欄を開き、プロンプトをコピーし、答えを貼って、選んだ項目をまとめて入力欄に反映できる（保存はしない）。

**Independent Test**: 空の課題で欄を開き、範囲をはじめのままコピーする。21項目の完成版を含む答えを貼り、すべて選ばれた状態で反映すると、21の入力欄が置き換わり、未保存になる。「保存」までは`putStrategy`が呼ばれない。

### Tests（先に書いて失敗を確かめる）

- [ ] T010 [P] [US1] `apps/web/test/strategy-sparring.test.tsx`を作り、次を書く：
  - 直せる人には進み具合のカードに「AIと壁打ちして埋める」（`aria-expanded="false"`）と「全体をAIと整理する」が並ぶ。見せてもらっている人・読むだけ（`canEdit: false`）には出ない
  - 押すと`aria-expanded="true"`になり、ボタンの名前は「AIと壁打ちして埋める」のまま変わらない。4つの手順・「プロンプトをコピーする」・「AIの答えを貼り付ける」が出る。もう一度押すと閉じる
  - 「プロンプトをコピーする」で、クリップボードに`buildSparringPrompt`の文（21項目の名前を含む）が入り、ボタンの下に「コピーしました。ChatGPTやClaudeに貼り付けて送ってください」が出る
  - 21項目の完成版を含む答えを貼ると、候補が21並び、すべて選ばれている。「選んだ項目を反映する」で、21の入力欄が置き換わり、欄が閉じ、上の「保存」が押せる（未保存）。`putStrategy`は呼ばれていない（SC-003）。「保存」で`putStrategy`に反映した値が渡る
  - 反映したあと、完了の数・区分のチップの数が変わる（FR-020）
  - 貼った答えがあるまま「閉じる」を押すと、「貼り付けたAIの答えがあります。破棄しますか？」が出て、「破棄して閉じる」で閉じる

### Implementation

- [ ] T011 [P] [US1] `apps/web/src/components/strategy/SparringCandidates.tsx`を作る：候補の一覧（各行に、ラベルが項目の名前のチェックボックス・「今」（空なら「未入力」）・「新しい案」。今と新しい案は縦に並べ、長い文は高さを決めてその中でスクロール）。props は候補の配列と`onToggle(key)`（contracts/ui-routes.md 5）。
- [ ] T012 [US1] `apps/web/src/components/strategy/SparringPanel.tsx`を作る（contracts/ui-routes.md「壁打ちの欄」、research.md R1・R7）：
  - 4つの手順、`useCopyPrompt`＋`CopyPromptTrigger`（「プロンプトをコピーする」）＋`CopyPromptStatus`（「コピーしました。ChatGPTやClaudeに貼り付けて送ってください」。ボタンの行の下）
  - 貼り付け欄（`DeepenPanel`と同じ見た目・ラベル・プレースホルダー）。貼った文が変わるたびに`parseSparringAnswer`→`buildSparringCandidates`で候補を作り、選択をはじめの状態に戻す。候補の`current`は親から受け取る今の`values`で、その都度出す（research.md R6）
  - 「選んだ項目を反映する」（塗り。選んだ数が0なら押せない）・「閉じる」（`ghost`）・「反映しても、まだ保存されません。上の『保存』で保存します。」
  - 貼った文があれば`useUnsavedChanges`で画面の移動を確かめ、`onDirtyChange`で親に知らせる（`DeepenPanel`と同じ）
  - props：`values`・`onApply(patch)`・`onClose`・`onDirtyChange`
  - この段階の範囲は、はじめの範囲（6区分すべて・未入力と短めだけ）で固定し、選ぶ欄はUS2で足す
- [ ] T013 [US1] `apps/web/src/components/strategy/ProgressCard.tsx`の`actions`の入れ物を、2つのボタンが折り返して並ぶ`flex flex-wrap gap-2`にする（右寄せのまま。ファイル先頭のコメントに specs/018 を足す）。
- [ ] T014 [US1] `apps/web/src/pages/strategy.tsx`をつなぐ：
  - 直せる人だけ、`actions`に「AIと壁打ちして埋める」（`Button variant="outline"`、`CopyPromptTrigger`と同じ高さ・角丸、先頭の`ChevronRightIcon`を開いたとき`rotate-90`、`aria-expanded`、文言は変えない）を「全体をAIと整理する」の前に置く
  - 開いているとき、`below`の`CopyPromptStatus`のあとに`SparringPanel`を出す
  - `onApply(patch)`で`setValues((v) => ({ ...v, ...patch }))`し、欄を閉じる
  - 貼った答えがあるまま閉じる（ボタン・「閉じる」）ときは、今の深掘りの確かめのダイアログ（`confirmDeepen`と同じ文言）を使う。深掘りの欄とは別の状態（`sparringOpen`・`sparringDirty`・確かめの対象）で持ち、どちらの欄も同時に開ける（contracts/ui-routes.md「項目ごとの『AIと深掘り』との関係」）

**Checkpoint**: 1回のコピーと1回の貼り付けで、21項目をまとめて反映できる（SC-001）。

## Phase 4: User Story 2 -範囲を絞って壁打ちする（P2）

**Goal**: 区分と「未入力と短めの項目だけにする」で、質問の対象を絞れる。

**Independent Test**: 10項目が「十分」の課題で、はじめの範囲のままコピーすると、残りの項目だけが質問の対象になり、十分な項目は「ほかの項目に書いたこと」に入る。

- [ ] T015 [P] [US2] `apps/web/test/strategy-sparring.test.tsx`に足す：
  - 欄を開くと、区分のチップ（目的・営業導線・アカウント・集客導線・人柄・その他）がすべて`aria-pressed="true"`、「未入力と短めの項目だけにする」がオン、「〇項目を相談します」が出る
  - 一部が「十分」の課題で、数がその分だけ減る。コピーした文の質問の対象に十分な項目が入らず、「ほかの項目に書いたこと」に入る
  - スイッチをオフにすると21に戻る。区分を1つだけにすると、その区分の数になる
  - 区分をすべて外すと「この範囲には、相談する項目がありません」が出て、「プロンプトをコピーする」が押せない
  - 範囲を変えても「AIと壁打ちして埋める」「全体をAIと整理する」「プロンプトをコピーする」の名前が変わらない
  - 欄を閉じて開き直すと、範囲がはじめに戻る
- [ ] T016 [US2] `apps/web/src/components/strategy/SparringPanel.tsx`に範囲の欄を足す（contracts/ui-routes.md 2）：「相談する区分」（`fieldset`と`legend`。区分のトグルのチップは`aria-pressed`、名前は`STRATEGY_SECTIONS`の`chip`）、「未入力と短めの項目だけにする」（`Switch`かチェックボックス。今の画面にあるものを使う）、決まった1行の「〇項目を相談します」／「この範囲には、相談する項目がありません」。質問の対象は`selectSparringTargets(values, 範囲)`で求め、プロンプトにもそれを渡す。範囲は欄の中の状態だけで持つ（閉じると消える）。

**Checkpoint**: 書き終えた項目を聞き直されずに、残りの項目だけを相談できる。

## Phase 5: User Story 3 -反映する前に、案を見比べて選ぶ（P2）

**Goal**: すでに書いてある項目の案は、本人が選ぶまで反映されない。

**Independent Test**: 入力のある項目と空の項目を含む答えを貼り、はじめの選択と、選ばなかった項目が変わらないことを確かめる。

- [ ] T017 [P] [US3] `apps/web/test/strategy-sparring.test.tsx`に足す：
  - 入力のある項目の候補ははじめ選ばれていない、空の項目は選ばれている。今と同じ案には「今と同じ」が出て、選ばれていない
  - 「すべて選ぶ」「すべて外す」で全部の選択が変わり、「〇件中〇件を選んでいます」が変わる。0件で「選んだ項目を反映する」が押せない
  - 2000字を超える案に「2000文字を超えています。反映した後に短くしてください」が出る。反映はでき、上限を超えている間は「保存」できない（今の扱い）
  - 選ばなかった項目の入力欄は、反映の前後で変わらない（SC-004）
  - 貼ったあとに入力欄を直すと、候補の「今」も変わる（research.md R6）
- [ ] T018 [US3] `apps/web/src/components/strategy/SparringCandidates.tsx`と`SparringPanel.tsx`に、「今と同じ」・上限を超えた印、「すべて選ぶ」「すべて外す」（`outline`の小さいボタン。文言は変えない）、「〇件中〇件を選んでいます」（ボタンの外の文）を足す（contracts/ui-routes.md 5、FR-016〜FR-018）。

**Checkpoint**: 自分で書いた文が、気づかないうちに置き換わらない。

## Phase 6: User Story 4 -答えの形が崩れていても、読めた分だけ使う（P3）

**Goal**: 読み取れなかった部分を、利用者が必ず知ることができる。

**Independent Test**: 目印のない答え、知らない名前を含む答え、近い人間性を含む答えを貼り、それぞれの表示を確かめる。

- [ ] T019 [P] [US4] `apps/web/test/strategy-sparring.test.tsx`に足す：目印のない答えで「項目ごとの完成版が見つかりませんでした。AIに『決まった形で完成版を出してください』と送り、出た答えを貼ってください」が出て、候補と「選んだ項目を反映する」が押せない。知らない名前・近い人間性の目印があれば「読み取れなかった項目：〇〇、〇〇」が出て、ほかの項目は候補に並ぶ。範囲の外の対象の項目も候補に並ぶ（FR-012）。
- [ ] T020 [US4] `apps/web/src/components/strategy/SparringPanel.tsx`に、目印がないときの案内（`role="alert"`、014のエラーの文と同じ見た目）と、「読み取れなかった項目：…」の文を足す（FR-013・FR-014）。

**Checkpoint**: 形が崩れても、何も表示されないまま終わることがない（SC-005）。

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T021 [P] `docs/ui-design.md`の課題の画面の説明に、進み具合のカードの「AIと壁打ちして埋める」（「全体をAIと整理する」と同じ見た目・▶／▼で開閉）と壁打ちの欄を足す。`specs/014-strategy-guidance/contracts/ui-routes.md`の「課題」に「2026-11-02：018で『AIと壁打ちして埋める』を足した（specs/018-strategy-ai-sparring/contracts/ui-routes.md）」の1行を足す。
- [ ] T022 [P] `docs/user-guide.md`の「ふだんの使い方」の課題の書き方に、「AIと壁打ちして埋める」の使い方（範囲を選んでコピー → ChatGPTやClaudeと相談 → 答えを貼って選んで反映 → 保存）を足し、更新日を直す。項目ごとの「AIと深掘り」との使い分け（まとめて埋めるなら壁打ち、1項目を深めるなら深掘り）を1行で書く。
- [ ] T023 [P] `docs/next-features.md`の§Fの1「AIと壁打ちして戦略を考える機能」に、「2026-11-02に018として仕様にした（specs/018-strategy-ai-sparring）」を書き、最終更新を直す。
- [ ] T024 全体のテスト・lint・型チェック・Webのビルドを通す（`pnpm --filter ./packages/shared test`、`pnpm --filter ./apps/web test`、`pnpm lint`、`pnpm -r exec tsc --noEmit`、`pnpm --filter ./apps/web build`）。014の`strategy-deepen.test.tsx`・`strategy-progress.test.tsx`が変わらず通ることも確かめる。
- [ ] T025 quickstart.mdの「2. テスト版で手で確かめる」を、マージのあとにユーザーとテスト版で通す（ChatGPTとClaudeの両方で、実際の答えが読み取れるか。スマートフォンで候補が読めて、ボタンが動かないか）。

## Dependencies & Execution Order

- Phase 1（T001）が最初。
- Phase 2：T002〜T005（テスト）は並行できる → T006〜T009（実装）。US1〜US4の前。
- US1：T010（テスト）・T011（候補の一覧）は並行できる → T012（欄）→T013（カード）→T014（画面）。
- US2：US1の後。T015→T016。
- US3：US1の後（US2と並行できるが、`SparringPanel.tsx`を両方が直すので、順に行うのが安全）。T017→T018。
- US4：US1の後。T019→T020。
- Polish は最後。T021〜T023は並行できる。T025はマージのあと。

## Parallel Example: Phase 2

```text
T002（範囲の絞り込みのテスト）・T003（プロンプトのテスト）・T004（答えの読み取りのテスト）・T005（候補のテスト）は別の関数で並行できる（T002とT005は同じファイルなので、続けて書く）。
```

## Parallel Example: User Story 1

```text
T010（画面のテスト）と T011（候補の一覧）は別ファイルで並行できる。
```

## Implementation Strategy

1. Phase 1・2で、共通パッケージの関数をテストから作る（画面は変わらないので、既存のテストは変わらない）。
2. US1で、欄を開いてコピー・貼り付け・一括の反映までを作る（ここで出してもよい）。
3. US2で、範囲の選び方を足す。
4. US3で、見比べて選ぶための印と操作を足す。
5. US4で、形が崩れたときの案内を足す。
6. Polishで文書と全体のテスト。マージのあと、テスト版で実際のAIの答えを確かめる。
