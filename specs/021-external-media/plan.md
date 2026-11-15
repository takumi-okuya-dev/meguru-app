# 実装計画（Implementation Plan）：外部媒体展開

**ブランチ**：`feature/021-external-media` | **日付**：2026-11-04 | **仕様**：[spec.md](./spec.md) | **UI全体設計**：[docs/ui-design.md](../../docs/ui-design.md) | **モック**：https://claude.ai/artifact/78VBSVeE19t3EqqvjckMRZ

**入力**：`specs/021-external-media/spec.md`の機能仕様（Clarifications 2026-11-04を含む）、Constitution 4.3.0

## 概要（Summary）

宣伝内容（イベント）を、こくちーずプロ・Peatix・つなげーと・ジモティー・YOUTRUSTの登録画面の順に合わせた掲載内容にし、欄ごとにコピーして貼れるようにする。媒体ごとのルールのチェックと自動の直し、画像のプロンプト、作業の画面（STEP）、状況と掲載URLを持つ。

- **媒体の決まり**：`packages/shared/src/media/` に媒体ごとの1ファイル。欄・選択肢・ルール・自動の直し・STEP・画像の大きさを定数と関数で持ち、APIとWebで同じものを使う（research.md R1、contracts/media.md）。
- **組み立て**：決まりだけで組み立てる（原則III）。言い回しは「AIと整える」で外のAIに頼み、答えを貼って反映（018と同じ形。R2・R3）。
- **自動の直し**：行ごとに外し、外した行と理由を残す（R4）。ルールのチェックはその場で計算し、保存しない（R5）。
- **データ**：宣伝内容に `event`（jsonb）、新しい表 `promotion_listings`（宣伝内容×媒体）と `media_defaults`（Account×媒体）。マイグレーション `0019_external_media`（R6、data-model.md）。
- **判定**：`authorizeAccount` の `view`（読む）・`content`（書く）と `feature: "strategy"`。見せてもらっている人には出さない（R7）。
- **プロンプト**：宣伝投稿のプロンプトに、イベントの情報があるときだけ1行を足す（R9）。
- **画面**：サイドバーの「戦略」に「外部媒体展開」。一覧 → 入力の画面 → 作業の画面（`?view=work`）。宣伝内容の編集に「イベントの情報（任意）」（R10、contracts/ui-routes.md）。

## 技術コンテキスト（Technical Context）

**言語・バージョン**：TypeScript 6.0（フロントエンド・バックエンドとも）。Node.js 22 LTS。020と同じ。

**主な依存**：020と同じ。新しい依存は足さない。

**ストレージ**：Neon（Postgres 17）。マイグレーション `0019_external_media` の1本（列1つと表2つを足すだけ）。

**テスト**：020と同じ構成。
- shared：媒体ごとの決まり（欄・選択肢の決め方・自動の直し・ルールのチェック・STEP・画像とAIのプロンプト・答えの読み取り）を、港のIT交流会と同じ材料で確かめる。イベントの情報のスキーマ。
- API：宣伝内容の `event`、プロンプトの1行、外部媒体展開のAPI（作る・保存・状況・衝突・作り直し・`sourceChanged`）、守り（view・content・strategy・決済）、マイグレーション。
- Web：サイドバー・一覧・入力の画面・作業の画面・AIと整える・宣伝内容のイベントの情報。
- E2E：足さない。

**対象プラットフォーム**：Web＝Cloudflare Pages、API＝Cloudflare Workers（無料プラン）。Cronは足さない。

**プロジェクトの種類**：Webアプリ（`apps/web`・`apps/api`・`packages/shared`のpnpmモノレポ）

**性能の目標**：組み立ては決まりだけで、1つの媒体で数ミリ秒。入力の画面の問い合わせは1回（宣伝内容・掲載内容・既定値を結合して読む）。

**制約**：
- アプリの中でAIを呼ばない・画像を作らない（原則III）
- 判定は1か所（原則V）。画面の出し分けは見た目だけで、守りはAPI
- 掲載内容を直しても、宣伝内容は変えない（SC-004）
- イベントの情報がない宣伝内容で、宣伝投稿のプロンプトの文が変わらない
- 媒体へ自動で投稿しない（spec Assumptions）
- 口座・PayPayの情報を、掲載内容に入れない

**規模**：Accountごとの宣伝内容は今の上限まで（`PROMOTION_LIMIT`）。媒体は5つ。

## Constitution Check

*GATE：Phase 0の前に確かめ、Phase 1の後にもう一度確かめた。Constitution 4.3.0。*

| 原則 | 確かめたこと | 結果 |
|---|---|---|
| I. NGワードの一貫性 | Threadsへの投稿ではない（外部の媒体へ利用者が貼る）。宣伝投稿のプロンプトに足すのは、宣伝内容の事実（日時・場所・参加費）だけで、CORE RULES・NGワードの扱いは変えない | 合格 |
| II.人間承認ゲート | Threadsへの投稿の経路に触れない。外部の媒体へは、利用者が自分で貼って公開する | 合格 |
| III.外部LLM前提 | 掲載内容は決まりで組み立てる。言い回しは外のAIにプロンプトをコピーして頼み、答えを貼る。画像もプロンプトだけ | 合格 |
| IV.契約／ロール分離 | 判定は今の `view`・`content` と機能のまとまり「戦略」。新しいロールや契約の区分を作らない | 合格 |
| V.個人運用起点のシンプルさ | 判定は `authorizeAccount` の1か所。サイドバーの「戦略」に1行足すだけで、チームの画面は変えない。見せてもらっている人には出さない | 合格 |
| VI.改善フィードバック | 変更なし（低調な投稿と却下ログの扱いを変えない） | 合格 |
| 技術スタック・運用コスト | 新しい依存・サービス・Cronを足さない | 合格 |
| 開発ワークフロー | spec-kitの順。`feature/021-external-media`→`develop`。マイグレーションは足すだけ。環境の違いはない | 合格 |

Phase 1の後の確認：data-model・contractsに、原則に反するものはない。Constitutionの改定は要らない。

## プロジェクトの構成（Project Structure）

### 文書（このfeature）

```text
specs/021-external-media/
├── spec.md
├── plan.md              # この文書
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   ├── api.md           # Phase 1
│   ├── media.md         # Phase 1（媒体ごとの欄・選択肢・ルール・STEP）
│   └── ui-routes.md     # Phase 1
├── checklists/
│   └── requirements.md
└── tasks.md             # /speckit-tasks で作る
```

### ソースコード（変更する主なところ）

```text
packages/shared/src/
├── media/
│   ├── types.ts         # MediaDefinition・MediaField・ListingCheck・ListingFix
│   ├── common.ts        # 日時の分け方・行の直し・共通のルール・画像のプロンプトの共通部分
│   ├── kokuchpro.ts・peatix.ts・tsunagate.ts・jmty.ts・youtrust.ts
│   └── index.ts         # MEDIA・buildListing・checkListing・workSteps・imagePrompt・polishPrompt・parsePolishAnswer
├── schemas.ts           # promotionEventSchema、宣伝内容の event、外部媒体展開のAPIの入出力
└── prompt.ts            # PromptPromotion.event と promotionLine の1行

apps/api/
├── drizzle/0019_external_media.sql
├── src/db/schema.ts                     # promotions.event・promotion_listings・media_defaults
├── src/services/external-media.ts       # 新規：一覧・入力の画面の読み出し・作る・保存・既定値
├── src/routes/external-media.ts         # 新規
├── src/routes/promotions.ts             # event の保存と応答
├── src/services/prompt-service.ts       # toPromptPromotion に event
└── test/integration/external-media.test.ts・migration/migration-0019.test.ts

apps/web/src/
├── pages/external-media.tsx             # 新規：一覧
├── pages/external-media-listing.tsx     # 新規：入力の画面と作業の画面
├── components/external-media/           # 新規：FieldCard・RuleCheck・WorkSteps・PolishDialog・CopyValueButton
├── components/promotions/PromotionFormDialog.tsx  # イベントの情報（任意）
├── components/layout/Sidebar.tsx        # 戦略に「外部媒体展開」
├── lib/api-client.ts・query.ts
└── router.tsx

docs/ui-design.md・user-guide.md・architecture.md・next-features.md
```

**構成の判断**：媒体の決まりは`packages/shared`にだけ置き、APIもWebもそこを呼ぶ（決まりを2か所に書かない）。APIは作る・保存するときだけ決まりを通し、ルールのチェックはWebがその場で計算する。

## 複雑さの記録（Complexity Tracking）

Constitutionの違反はないので、記録はない。
