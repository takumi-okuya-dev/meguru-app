# 実装計画（Implementation Plan）：課題の入力を手助けする

**ブランチ**：`feature/014-strategy-guidance` | **日付**：2026-10-16 | **仕様**：[spec.md](./spec.md) | **UI全体設計**：[docs/ui-design.md](../../docs/ui-design.md) | **モック**：https://claude.ai/artifact/KMzLe9YtcNcToBvf9ikd6g

**入力**：`specs/014-strategy-guidance/spec.md`の機能仕様（Clarifications 2026-10-16を含む）、Constitution 4.0.1、参考プロダクト（Threads Growth OS）の課題・リサーチ・投稿ストックの画面（2026-10-16に読むだけで確かめた）

## 概要（Summary）

最初に何を書けばよいかわからない人のために、課題・リサーチ・投稿づくりを手助けする。あわせて、書いた材料が投稿のプロンプトに確実に効くようにし、「投稿をつくる」と「投稿ストック」の画面を分ける。

- **課題**
  - 項目ごとの考えるヒント（共通の定数`STRATEGY_HINTS`。R1）と、自動チェック・進み具合・次におすすめ（純粋な関数`checkStrategy`。R2）。
  - 新しい区分「活動の目的・在り方」（`strategy_designs`に6列。R3）を足し、区分の名前から「課題①〜③」を外す。
  - チップの並びはPCでも上に固定する（R5）。
  - 「AIと深掘りする」「全体をAIと整理する」「5問からAIと整理する」のプロンプトは、画面の今の入力から作る。完成版は`【完成版ここから】`〜`【完成版ここまで】`で取り出す（R4）。
- **リサーチ**
  - 読み物「伸びる投稿を見つけるリサーチ」。
  - 参考投稿に媒体・投稿日・数字・投稿者・メモを足し、鮮度はそのつど求める（R6）。
  - 「ためて」まとめて登録する（全部か無しか。R7）。
  - 解説がまだの参考投稿を最大10件まとめてAIに解説してもらう。答えは【ID】で結び付け、空の行だけに保存する（R8）。
  - キーワードの案をAIに出してもらい、まとめて登録する。「Threadsで検索」も置く（R16）。
- **投稿のプロンプト**（`buildPrompt`。R10〜R12）
  - 冒頭の確認と優先順位、戦略設計を忠実に反映する指示、話題の配分。
  - 活動の目的・在り方の節、プロフィールと固定投稿の下書きの節（002の「材料に使わない」を変える）。
  - 宣伝内容：管理用タイトル・期限・ちょうどN件・書き方。リサーチ：鮮度の順・改行の引用・数字・型の件数。
  - 短文・中文・長文の件数と幅（アカウントごとの文字数と割合の設定）、コードブロックでの出力、最終チェック。
  - 長いときに2つに分けて送る`parts`。
  - 件数の数字は1か所で求める（FR-118）。
- **画面の分け方**（R14）
  - 新しい「投稿をつくる」（`/create`）：手順の案内、プロンプトに入っている情報（`GET /prompt`の`materials`。R9）、プロンプトのカード、貼り付け欄。
  - 「投稿ストック」（`/stock`）：一覧だけ。
  - サイドバーの見た目・並び・名前は変えない。
- **ホーム**：「はじめに読んでほしいこと」（端末に覚える。R15）。
- **Constitution**：原則Vの「決済をMVPの最後のfeatureとする」の文言を、PATCH（4.0.2）で明確にする（R18）。

## 技術コンテキスト（Technical Context）

**言語・バージョン**：TypeScript 6.0（フロントエンド・バックエンドとも）。Node.js 22 LTS。001〜013と同じ。

**主な依存**：001〜013と同じ。新しい依存は足さない（固定のチップの今の区分は`IntersectionObserver`、表示の好みは`localStorage`）。

**ストレージ**：Neon（Postgres 17）。[data-model.md](./data-model.md)のとおり、マイグレーション`0015_strategy_guidance`の1本。
- `strategy_designs`：目的の6列
- `reference_posts`：媒体・投稿日の選び方・投稿日・数字6つ・投稿者・メモの11列（既定値とCHECK）
- `accounts`：文字数と割合の7列（既定値とCHECK）
- 新しい表は作らない

**テスト**：013と同じ構成。
- **共通**（Vitest）
  - 課題：`checkStrategy`の境、`STRATEGY_HINTS`が21項目そろっていること、`extractFinal`
  - プロンプト：3つのプロンプト、`buildPrompt`（節・件数・空のとき・`parts`・長さの調整で新しい節が残る）、`splitLengthMix`（いろいろな件数と割合で合計がそろう）
  - リサーチ：`freshnessOf`と`sortForPrompt`の境、`shortIdsOf`、`parseExplanations`、`parseKeywordIdeas`
  - 貼り付け：`splitDrafts`のコードブロック
  - スキーマ：参考投稿の新しい項目と`prompt-settings`の`length`
- **API**（Vitest＋`@cloudflare/vitest-pool-workers`＋ローカルのPostgres）
  - 課題のPUTで目的のキーを省く
  - 参考投稿：新しい項目の保存と検証、まとめての登録（上限・全部か無しか・同時）、解説のプロンプト（空の行の選び方・順）とまとめての保存（空の行だけ・飛ばした分）
  - キーワード：案のプロンプトと、まとめての登録（上限・重なり）
  - プロンプト：`GET /prompt`の`parts`・`materials`・`settings`、`PUT /prompt-settings`の`length`（検証・版・オーナーだけ）
  - 新しいAPIの権限の表（関わり×読むだけ）
  - マイグレーションのテスト（`migration-0015.test.ts`）
- **Web**（Vitest＋Testing Library）
  - 課題：ヒントの開閉、入力で印と数が変わる、次におすすめ、深掘りの反映（目印あり・なし・上限超え）、活動の軸のボタンの押せる条件、固定のチップ、見せてもらっている人・読むだけでAIのボタンが出ない
  - リサーチ：ためる・外す・まとめて登録・離れるときの確認、まとめての解説の一覧と保存、キーワードの案
  - 投稿をつくる：手順の開閉、情報の一覧、文字数と割合の検証、送り方の切り替えと覚える、登録の後の案内
  - 投稿ストック：一覧だけ、空のときの案内
  - サイドバー：「投稿をつくる」の行き先と選ばれた見た目
  - ホーム：はじめに読んでほしいこと、「投稿をつくりましょう」の行き先
- **E2E**（Playwright）
  - 今の流れ（`onboarding`・`team`・`token`）で、投稿ストックからプロンプト・貼り付けを使っている所を「投稿をつくる」に直す
  - `strategy.spec.ts`に目的とヒントを足す
  - 新規`research.spec.ts`：ためて登録 → まとめての解説（偽の答え）
  - 新規`create.spec.ts`：投稿をつくる → 登録 → 投稿ストックで確かめる

**対象プラットフォーム**：Web＝Cloudflare Pages、API＝Cloudflare Workers（無料プラン）。Cronは足さない。

**プロジェクトの種類**：Webアプリ（`apps/web`・`apps/api`・`packages/shared`のpnpmモノレポ）

**性能の目標**：
- 課題の画面の入力のたびの自動チェックは、21項目の文字数を数えるだけで、入力を待たせない（SC-002）
- `GET /prompt`は今の問い合わせに参考投稿の全件（200件まで）を読む分が増えるだけで、ふつう1秒以内
- まとめての登録・解説の保存は、1つのトランザクションで1回の往復

**制約**：
- 外部のAIへはコピー＆ペーストだけ（Constitution原則III）。新しいAPIもプロンプトを返すだけで、AIを呼ばない
- 権限の判定は`authorizeAccount`だけ（原則V）。新しいAPIは`content`、文字数と割合の保存は今の作る件数と同じ`settings`
- NGワードの確認・承認の関所（原則I・II）は変えない。下書きと目的がプロンプトに入っても、配信の前の確認は今のまま
- 今の投稿ストックのURL・承認・却下・修正の結果を変えない（SC-023）。サイドバーの見た目・並び・名前を変えない
- 002の「入力済み項目数（n/16）」を変えない（FR-020）
- 定数：`PROMPT_SPLIT_THRESHOLD = 12000`、`REFERENCE_BATCH_MAX = 20`、`EXPLAIN_BATCH_MAX = 10`、`KEYWORD_BATCH_MAX = 20`、`REFERENCE_AUTHOR_MAX = 100`、`REFERENCE_MEMO_MAX = 500`、`FRESHNESS_LATEST_DAYS = 30`、`FRESHNESS_ACTIVE_DAYS = 90`、文字数と割合の初めの値（150・55・100・135・35・45・20）

**規模**：001〜013と同じ（利用者は数十人まで）。参考投稿はアカウントに200件まで、キーワードは100件まで（002のまま）。

## Constitution Check

*GATE：Phase 0の前に確かめ、Phase 1の後にもう一度確かめた。Constitution 4.0.1。*

| 原則 | 確かめたこと | 結果 |
|---|---|---|
| I. NGワードの一貫性・戦略の反映 | 戦略プロファイル（課題）を、忠実に反映の指示・話題の配分・目的の節・下書きの節で、これまでより強くプロンプトに反映する。配信の前のNGワードの確認は変えない。ヒントの例文は投稿されないので確認の対象外（Edge Cases） | 合格 |
| II.人間承認ゲート | 「投稿をつくる」で登録した案は、今のとおり投稿ストックの要確認に入り、承認するまで投稿されない。画面を分けても承認の操作は投稿ストックに残る | 合格 |
| III.外部LLM前提 | 深掘り・全体の整理・活動の軸・解説・キーワードの案は、どれもプロンプトのコピーと答えの貼り付けだけ。アプリはAIを呼ばない | 合格 |
| IV.契約／ロール分離 | 契約・ロールの形は変えない。新しいAPIの権限は今のロールの権限（`content`・`settings`）を使う | 合格 |
| V.個人運用起点のシンプルさ | 判定は`authorizeAccount`の1か所のまま。個人運用の画面にチームのものを足さない。見せてもらっている人には読むだけで見せ、AIの操作を出さない。**「決済をMVPの最後のfeatureとする」の文言**は、本featureを決済の後に足すことと字面でずれるため、意図（チーム運用と課金まわりの順）を明確にするPATCH（4.0.2）を行う（R18。tasksの最初） | 合格（PATCHで文言を明確にする） |
| VI.改善フィードバック | 却下・反応が低かった投稿の節は今のまま入り、長さの調整でも減らす順を変えない（参考投稿は鮮度の順で入るが、却下・低調の節には触れない） | 合格 |
| 技術スタック・運用コスト | 新しい依存・サービス・月額の固定費を足さない | 合格 |
| 開発ワークフロー | spec-kitの順。`main`＋`feature/*`。002の決定（下書きを材料に使わない）を変えるので、002のspecに注記する | 合格 |

Phase 1の後の確認：data-model・contractsに、原則に反するものはない。Constitutionの改定は、原則の意味を変えない文言の明確化（PATCH）だけ。

## プロジェクトの構成（Project Structure）

### 文書（このfeature）

```text
specs/014-strategy-guidance/
├── spec.md
├── plan.md              # この文書
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   ├── api.md           # Phase 1
│   ├── ui-routes.md     # Phase 1
│   ├── prompt-template.md  # Phase 1（投稿のプロンプトの直しと、新しい5つのプロンプト）
│   └── hints.md         # Phase 1（考えるヒントの文言と目安の文字数）
├── checklists/
│   └── requirements.md
└── tasks.md             # /speckit-tasks で作る
```

### ソースコード（変更する主なところ）

```text
packages/shared/src/
├── strategy.ts              # 目的の6キー・区分 purpose・区分の名前（課題①〜③を外す）
├── strategy-guidance.ts     # 新規：STRATEGY_HINTS・checkStrategy
├── strategy-prompts.ts      # 新規：buildDeepenPrompt・buildOverallPrompt・buildAxisPrompt・extractFinal
├── research.ts              # 新規：freshnessOf・sortForPrompt・shortIdsOf・buildExplainPrompt・parseExplanations・buildKeywordIdeaPrompt・parseKeywordIdeas
├── prompt.ts                # buildPrompt の直し（件数・節・parts・最終チェック）、splitLengthMix
├── drafts.ts                # splitDrafts でコードブロックの行を除く
├── limits.ts                # 新しい定数
└── schemas.ts               # 課題の6キー（PUTは省略可）、参考投稿の項目、まとめての登録・解説・キーワード、prompt の parts・materials・settings、prompt-settings の length

apps/api/
├── drizzle/0015_strategy_guidance.sql
├── src/db/schema.ts                     # 3つの表の列
├── src/routes/
│   ├── strategy.ts                      # 目的のキー（省略で残す）
│   ├── research.ts                      # 参考投稿の項目・freshness・shortId、batch・explain-prompt・explanations、キーワードの idea-prompt・batch
│   └── prompt.ts                        # parts・materials・settings、prompt-settings の length
├── src/services/
│   ├── strategy-service.ts              # 省略されたキーを残す保存
│   ├── item-service.ts                  # 件数つきのまとめての追加（insertManyWithLimit）
│   └── prompt-service.ts                # 参考投稿の全件の読み込みと並べ替え、宣伝のタイトル・期限、文字数と割合、materials
└── test/                                # 上の「テスト」のとおり

apps/web/src/
├── pages/strategy.tsx                   # 目的の区分・固定のチップ・進み具合・ヒント・深掘り
├── components/strategy/                 # 新規：HintPanel・FieldCheckBadge・DeepenPanel・ProgressCard・SectionChips・AxisPrompt
├── pages/research.tsx                   # 読み物・まとめての解説・キーワードの案
├── components/research/                 # ReferencePostFormDialog を「参考投稿を追加」（ためる）と編集（1件の解説）に、新規：ResearchGuide・ExplainBatchPanel・KeywordIdeasPanel
├── pages/create.tsx                     # 新規：投稿をつくる
├── components/create/                   # 新規：CreateSteps・PromptMaterials・LengthSettings・PromptParts
├── components/stock/PromptCard.tsx・PasteComposer.tsx  # 投稿をつくるで使う形に（固定をやめる・登録の後の案内）
├── pages/stock.tsx                      # 一覧だけ・「投稿をつくる」・空のときの案内
├── pages/account-home.tsx               # はじめに読んでほしいこと・行き先
├── components/guides/                   # 新規：IntroGuide（はじめに読んでほしいこと）
├── components/layout/Sidebar.tsx        # 「投稿をつくる」を /create への NavLink に（見た目・並びは変えない）
├── lib/preferences.ts                   # 新規：localStorage の読み書き（読めなければ初めの状態）
├── lib/api-client.ts                    # 新しいAPI
└── router.tsx                           # /accounts/:accountId/create

e2e/tests/strategy.spec.ts・research.spec.ts（新規）・create.spec.ts（新規）・onboarding.spec.ts・team.spec.ts・token.spec.ts
.specify/memory/constitution.md（PATCH 4.0.2）、specs/002のspec（下書きの注記）、docs/ui-design.md（投稿をつくるの画面）
```

**構成の判断**：001〜013と同じモノレポ。判定（自動チェック・鮮度・件数）と文面（ヒント・プロンプト）を`packages/shared`の純粋な関数・定数にして、API（プロンプト・情報の一覧）とWeb（課題の画面・リサーチ・投稿をつくる）が同じものを使う。権限は`authorizeAccount`の今の呼び出しのまま。「投稿をつくる」は、今の`PromptCard`と`PasteComposer`を移して広げる形にし、登録の動き（003・004）を変えない。

## 複雑さの記録（Complexity Tracking）

Constitutionの違反はないので、記録はない（原則Vの文言はPATCHで明確にする。R18）。
