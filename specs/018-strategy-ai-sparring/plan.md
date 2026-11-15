# 実装計画（Implementation Plan）：AIと壁打ちして課題を埋める

**ブランチ**：`feature/018-strategy-ai-sparring` | **日付**：2026-11-02 | **仕様**：[spec.md](./spec.md) | **UI全体設計**：[docs/ui-design.md](../../docs/ui-design.md)

**入力**：`specs/018-strategy-ai-sparring/spec.md`の機能仕様（Clarifications 2026-11-02の4点）、Constitution 4.0.1

## 概要（Summary）

課題の画面に「AIと壁打ちして埋める」を足す。範囲（区分・未入力と短めだけ）を選んでプロンプトをコピーし、外のAIと相談した答えを貼ると、項目ごとの「今の入力 → 新しい案」が並び、選んだ項目をまとめて入力欄に反映する（保存はしない）。

- **土台**：014の「AIと深掘り」の仕組みをそのまま使う。プロンプトは`strategy-prompts.ts`に足し、コピーは`useCopyPrompt`・`CopyPromptTrigger`・`CopyPromptStatus`、貼り付け欄と未反映の確かめは`DeepenPanel`と同じ形にする（research.md R1）。
- **答えの形**：項目ごとに`【項目：〈項目の名前〉】`の行で始め、`【項目ここまで】`の行で終える。014の`【完成版ここから】`と同じく、Markdownの見出し・区切り線にならない文字にする（R2）。
- **読み取り**：`parseSparringAnswer`（純粋な関数）が、名前のゆれ（全角・半角、空白、括弧、「Q1」だけの書き方）を吸収して項目のキーに引き当てる（R3）。
- **画面**：進み具合のカードの「全体をAIと整理する」の隣に、開閉のボタンを置き、カードの下に壁打ちの欄を開く。押してもボタンを動かさない（docs/ui-design.md §6。R5）。
- **保存しない**：新しいAPI・DBの変更はない。反映は、今の未保存の変更（`values`）を置き換えるだけ（FR-032）。

## 技術コンテキスト（Technical Context）

**言語・バージョン**：TypeScript 6.0（フロントエンド・共通パッケージ）。Node.js 22 LTS。017と同じ。

**主な依存**：017と同じ。新しい依存は足さない。

**ストレージ**：なし。DB・API・ブラウザの保存に何も足さない。範囲・貼った答え・候補は画面の状態だけで持つ。

**テスト**：017と同じ構成。
- 共通（`packages/shared`）：Vitest。プロンプト（対象・文脈・下書きと近い人間性を入れない・頼み方・目印）と、答えの読み取り（ふつう・太字やコードで囲んだ目印・終わりの目印がない・同じ項目が2回・空の中身・知らない名前・対象の外の名前・名前のゆれ・「Q1」だけ）、範囲の絞り込み。
- Web：Vitest＋Testing Library。ボタンの出し分け（直せる人だけ）、範囲のはじめの状態と項目の数、0のとき押せない、コピーした文、貼ったあとの候補とはじめの選択、「すべて選ぶ／外す」、反映（入力欄・未保存・自動チェック）、上限を超えた印、目印がないときの案内、閉じるときの確かめ、ボタンの位置が変わらないこと。
- E2E：足さない。実際のChatGPT・Claudeが形を守るかは、テスト版で手で確かめる（quickstart.md 2）。

**対象プラットフォーム**：Web＝Cloudflare Pages。APIは変えない。

**プロジェクトの種類**：Webアプリ（`apps/web`・`apps/api`・`packages/shared`のpnpmモノレポ）

**性能の目標**：
- 貼った答えの読み取りは、入力のたびにその場で行う（数万文字でも1回の走査）。
- プロンプトは削らない（Edge Cases）。21項目すべてを選び、ヒントを入れても1万〜2万字程度。

**制約**：
- アプリの中でAIを呼ばない（Constitution原則III）。
- 課題の保存のしかた・APIを変えない（FR-032）。014の「AIと深掘り」「全体をAIと整理する」を変えない（FR-030・FR-031）。
- 項目の名前・説明・考えるヒントは、014の定数（`STRATEGY_FIELDS`・`STRATEGY_HINTS`）を使う（FR-007）。
- 押してもボタンを動かさない（docs/ui-design.md §6）。

**規模**：対象の項目は21。1回の答えに入る項目は多くても21。

## Constitution Check

*GATE：Phase 0の前に確かめ、Phase 1の後にもう一度確かめた。Constitution 4.0.1。*

| 原則 | 確かめたこと | 結果 |
|---|---|---|
| I. NGワードの一貫性 | 投稿の本文は作らない。課題の入力欄に入れるだけ | 合格 |
| II.人間承認ゲート | 反映の前に利用者が候補を見て選び、保存も利用者が押す | 合格 |
| III.外部LLM前提 | プロンプトのコピーと答えの貼り付けだけ。アプリはAIを呼ばない | 合格 |
| IV.契約／ロール分離 | 直せる人だけに出す（014の「AIと深掘り」と同じ判定）。読むだけ（013）の扱いも同じ | 合格 |
| V.個人運用起点のシンプルさ | 保存するものを足さない。欄を1つ足し、範囲の選び方は区分と切り替えの2つだけ | 合格 |
| VI.改善フィードバック | 変更なし | 合格 |
| 技術スタック・運用コスト | 新しい依存・サービス・費用なし | 合格 |
| 開発ワークフロー | spec-kitの順。`feature/018-strategy-ai-sparring`→`develop`。マイグレーション・環境ごとの設定はない | 合格 |

Phase 1の後の確認：data-model・contractsに、原則に反するものはない。Constitutionの改定は要らない。

## プロジェクトの構成（Project Structure）

### 文書（このfeature）

```text
specs/018-strategy-ai-sparring/
├── spec.md
├── plan.md              # この文書
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   ├── prompt-template.md   # Phase 1：壁打ちのプロンプトと答えの形
│   └── ui-routes.md         # Phase 1：課題の画面の変更
├── checklists/
│   └── requirements.md
└── tasks.md             # /speckit-tasks で作る
```

### ソースコード（変更する主なところ）

```text
packages/shared/src/
├── strategy-sparring.ts          # 新規：対象の項目・範囲の絞り込み・答えの読み取り（目印の定数も）
├── strategy-prompts.ts           # buildSparringPrompt を足す
└── index.ts                      # 書き出し
packages/shared/test/
├── strategy-sparring.test.ts     # 新規
└── strategy-prompts.test.ts      # 壁打ちのプロンプトを足す

apps/web/src/
├── components/strategy/SparringPanel.tsx   # 新規：範囲・コピー・貼り付け欄・候補・反映
├── components/strategy/SparringCandidates.tsx  # 新規：候補の一覧（今の入力 → 新しい案・選ぶ印）
└── pages/strategy.tsx                      # ボタン・欄の開閉・反映・閉じるときの確かめ
apps/web/test/
└── strategy-sparring.test.tsx              # 新規

docs/ui-design.md      # 課題の画面に壁打ちの欄
docs/user-guide.md     # 課題の書き方に「AIと壁打ちして埋める」
docs/next-features.md  # §F の1を「018に移した」にする
```

**構成の判断**：範囲の絞り込みと答えの読み取りは、画面から切り離した純粋な関数として`strategy-sparring.ts`に置き、共通パッケージのテストで細かく確かめる（R3・R4）。プロンプトの文は、ほかの課題のプロンプトと並べて`strategy-prompts.ts`に置く。画面は、欄（`SparringPanel`）と候補の一覧（`SparringCandidates`）に分け、`strategy.tsx`が大きくなりすぎないようにする。

## 複雑さの記録（Complexity Tracking）

Constitutionの違反はないので、記録はない。
