# 実装計画（Implementation Plan）：チームの運用状況を見る

**ブランチ**：`feature/020-team-monitoring` | **日付**：2026-11-04 | **仕様**：[spec.md](./spec.md) | **UI全体設計**：[docs/ui-design.md](../../docs/ui-design.md) | **モック**：https://claude.ai/artifact/ESSqiqhGna9qZ56YFBUKg1

**入力**：`specs/020-team-monitoring/spec.md`の機能仕様（Clarifications 2026-11-04を含む）、Constitution 4.3.0

## 概要（Summary）

チームの管理者と担当の編集者が、チームの「運用状況」で、手が止まっている人・Accountと、伸びていないAccountをまとめて見られるようにする。出すのは数と日付だけ。

- **数え方**：新しい表は作らず、開いたときに今ある表から数える。人の動き＝操作の記録（案を作る・直す・承認・却下）、投稿＝`post_drafts`、伸び＝`post_metrics`の確定した閲覧数（research.md R1）。
- **止まっている**：最後に動いた・投稿した日時（チームに入った日時より前なら入った日時）から7日より長い（R3）。操作の記録は90日で消えるので、記録がなく入って90日を過ぎた人は「90日以内にありません」（R2）。
- **伸び**：投稿した日で直近30日とその前の30日に分け、確定した閲覧数の中央値の比。5件に満たなければ判定しない。0.8以下で「伸びていない」（R4）。
- **判定**：`access.ts` に `authorizeTeamStatus` を足し、管理者は「すべて」、編集者は「担当のAccount（オーナーのチームが使えるもの）とそのオーナー」に範囲を決める。数える問い合わせは範囲の中だけを読む（R5・R6）。
- **API**：`GET /api/teams/:teamId/status` の1本。チームの詳細に `statusVisible` を足す（R8）。
- **画面**：`/teams/:teamId/status`。チームの画面に「運用状況」のボタンと件数の印、閉じたトグル「チームで見えること」。招待の確認の画面に1文（R9・R10）。

## 技術コンテキスト（Technical Context）

**言語・バージョン**：TypeScript 6.0（フロントエンド・バックエンドとも）。Node.js 22 LTS。019と同じ。

**主な依存**：019と同じ。新しい依存は足さない。

**ストレージ**：Neon（Postgres 17）。マイグレーションは足さない（[data-model.md](./data-model.md)）。

**テスト**：019と同じ構成。
- API：Vitest＋`@cloudflare/vitest-pool-workers`＋ローカルのPostgres。`apps/api/test/integration/team-status.test.ts`（quickstart.md 1の項目）。時刻は行の日時を過去にずらして作る。
- shared：`teamStatusSchema` の形、定数。
- Web：Vitest＋Testing Library。
  - 運用状況の画面：管理者・編集者の一行の説明・並び・印・伸びの4つの状態・接続が切れた・スマートフォンの縦の並び
  - チームの画面：ボタンと件数の印は `statusVisible` のときだけ。トグル「チームで見えること」
  - 招待の確認の画面の1文
- E2E：足さない。

**対象プラットフォーム**：Web＝Cloudflare Pages、API＝Cloudflare Workers（無料プラン）。Cronは足さない。

**プロジェクトの種類**：Webアプリ（`apps/web`・`apps/api`・`packages/shared`のpnpmモノレポ）

**性能の目標**：20件のAccount・50人のチームで3秒以内（SC-002）。問い合わせは、判定1回＋人の動き1回＋Accountの数（投稿・残り・要確認）1回＋伸び1回の、Accountの数によらない固定の回数。今ある索引で足りる。

**制約**：
- 判定は1か所（Constitution原則V）。範囲の外の行は問い合わせで除く。画面で隠すだけにしない
- 数と日付だけを返す。投稿の本文・戦略・設定・操作の記録の中身を返さない（FR-003）
- 個人運用の画面・操作は変えない（FR-033）
- 読むだけ。書き込みも操作の記録もしない
- 定数：7日・30日・5件・0.8・数える操作の4つ（data-model.md「定数」）

**規模**：1チーム50人・Account 20件程度。

## Constitution Check

*GATE：Phase 0の前に確かめ、Phase 1の後にもう一度確かめた。Constitution 4.3.0。*

| 原則 | 確かめたこと | 結果 |
|---|---|---|
| I. NGワードの一貫性 | 変更なし（投稿もプロンプトも作らない） | 合格 |
| II.人間承認ゲート | 変更なし（承認の経路に触れない） | 合格 |
| III.外部LLM前提 | 変更なし（アプリの中でAIを呼ばない） | 合格 |
| IV.契約／ロール分離 | 4.3.0のとおり、管理者はチームのすべてのAccount、編集者は担当のAccountとそのオーナーの運用状況（数と日付だけ）を見る。承認・設定・中身には触れない。契約の判定は変えない | 合格 |
| V.個人運用起点のシンプルさ | 判定は `access.ts` の1か所（`authorizeTeamStatus`）。「見せてもらっているAccountでパフォーマンスを見せない」は保ち、運用状況は数と日付だけ。メンバー・別のチームの人に見せず、編集者に担当の外を見せない。招待の確認の画面で見える範囲を示す。個人運用には何も足さない | 合格 |
| VI.改善フィードバック | 変更なし（006の確定した値を読むだけ） | 合格 |
| 技術スタック・運用コスト | 新しい依存・サービス・Cron・表を足さない | 合格 |
| 開発ワークフロー | spec-kitの順。`feature/020-team-monitoring`→`develop`。マイグレーションなし。環境の違いはない（docs/environment-switches.md は変えない） | 合格 |

Phase 1の後の確認：data-model・contractsに、原則に反するものはない。Constitutionの改定（4.3.0）は、このfeatureのPRに入れる。

## プロジェクトの構成（Project Structure）

### 文書（このfeature）

```text
specs/020-team-monitoring/
├── spec.md
├── plan.md              # この文書
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   ├── api.md           # Phase 1
│   └── ui-routes.md     # Phase 1
├── checklists/
│   └── requirements.md
└── tasks.md             # /speckit-tasks で作る
```

### ソースコード（変更する主なところ）

```text
packages/shared/src/
├── limits.ts          # TEAM_STATUS_* の定数
└── schemas.ts         # teamStatusSchema、teamDetailSchema の statusVisible

apps/api/
├── src/services/access.ts           # authorizeTeamStatus（範囲：all / assigned）
├── src/services/team-status.ts      # 新規：人・Accountの運用状況を数える（範囲の中だけ）、並べる
├── src/services/team-service.ts     # getTeamDetail に statusVisible
├── src/routes/teams.ts              # GET /teams/:teamId/status
└── test/integration/team-status.test.ts  # 新規

apps/web/src/
├── pages/team-status.tsx            # 新規：運用状況（スマートフォンは縦、パソコンは表）
├── pages/team.tsx                   # 「運用状況」のボタンと件数の印、トグル「チームで見えること」
├── pages/invite.tsx                 # 見える範囲の1文
├── lib/api-client.ts・query.ts       # teamStatus
└── router.tsx                       # /teams/:teamId/status

apps/web/test/                       # team-status（新規）・team-page・invite-page

docs/ui-design.md・user-guide.md・architecture.md・team-roles.md  # 運用状況と見える範囲
.specify/memory/constitution.md      # 4.3.0
```

**構成の判断**：数える処理は `team-status.ts` に置き、範囲は引数で受け取る（範囲を決めるのは `authorizeTeamStatus` だけ）。`getTeamDetail` の `statusVisible` も、同じ条件を `access.ts` の小さな関数から使う。画面は `status` の結果を出すだけで、自分では数えない・判定しない。

## 複雑さの記録（Complexity Tracking）

Constitutionの違反はないので、記録はない（4.3.0の改定で、運用状況の見える範囲を明文化した）。
