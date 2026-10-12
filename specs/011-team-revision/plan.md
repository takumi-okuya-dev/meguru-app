# 実装計画（Implementation Plan）：チームの見直し

**ブランチ**：`feature/011-team-revision` | **日付**：2026-10-13 | **仕様**：[spec.md](./spec.md) | **画面案**：[011チームの見直し 画面案](https://claude.ai/artifact/G2gCHhu6i1VDxUCQ8pFGp7)（非公開） | **UI全体設計**：[docs/ui-design.md](../../docs/ui-design.md)

**入力**：`specs/011-team-revision/spec.md`の機能仕様（Clarifications 2026-10-12・2026-10-13を含む）、Constitution 4.0.0

## 概要（Summary）

008のチーム運用（オーナーがアカウントごとにパートナーを招く、パートナー1人に1チーム）を、管理者が作るLINEグループに近いチームに作り直す。全員が自分のアカウントを持ってチームに入り、オーナーがアカウントごとに「チームに見せる」を決め、管理者がメンバー⇔編集者と担当を決める。承認・設定はいつもオーナーだけにする。

- **データ**：`teams`を作り直し（管理者・招待リンク1本・名前）、`team_members`（ロール：admin・member・editor）と`team_accounts`（見せる設定）を足す。担当は今と同じく`memberships`の`editor`の行（`team_id`つき）で持つ。008の`account_partners`・`account_partner_invites`・`team_editors`と、`memberships`の`partner`・`editor`の行は消す（Clarifications：移さずに消す）。マイグレーション`0012_team_revision`の1本（research.md R1・R2）。
- **判定**：`authorizeAccount`は1か所のまま、関わりを「オーナー」「担当の人」「見せてもらっている人」「関わりなし」の4つにする。権限に`read`（投稿ストック・戦略を読むだけ）を足し、投稿ストック・戦略のGETだけを`view`から`read`に下げる。任せる範囲（`review`・`settings`の委任）はなくし、`review`・`settings`はオーナーだけにする（R3、[contracts/permissions.md](./contracts/permissions.md)）。
- **チームのAPI**：`/api/teams/*`（作る・一覧・詳細・名前・削除・招待・ロール・担当・見せる・入れる／外す・抜ける・引き継ぐ）と`/api/invites/:token`（確認と参加）。判定は`authorizeTeamMember`／`authorizeTeamAdmin`の1か所（R4、[contracts/api.md](./contracts/api.md)）。
- **招待**：チームに1本のリンク（`t_`で始まる）。照合はハッシュ、表示は暗号化した写し（008 R4の仕組みをそのまま使う）。
- **画面**：サイドバーの「チーム」の見出しの下のチーム名（`/api/me`の`teams`）、チームの画面（`/teams/:teamId`）、担当の表（`/teams/:teamId/assign`）、見せてもらっているアカウント（`/teams/:teamId/accounts/:accountId`、読むだけ）、招待の確認（`/invite/:token`）、「このアカウントの設定」のチームの区分（R5、[contracts/ui-routes.md](./contracts/ui-routes.md)）。
- **片付け**：008のパートナーの画面（`/partner/*`）、「運用を手伝ってもらう」の区分、任せる範囲、編集者の待機の案内、パートナーの参加の知らせ、`/api/team/*`・`/api/accounts/:id/partner*`を消す（R6）。
- **E2E**：`e2e/tests/team.spec.ts`と`team-flow.ts`・`pnpm team:demo`を新しい流れに書き直す（SC-007）。

## 技術コンテキスト（Technical Context）

**言語・バージョン**：TypeScript 6.0（フロントエンド・バックエンドとも）。Node.js 22 LTS。001〜010と同じ。

**主な依存**：001〜010と同じ。新しい依存は足さない（QRコードは008の`uqr`）。

**ストレージ**：Neon（Postgres 17）。[data-model.md](./data-model.md)のとおり。
- 列挙型：`team_role`（admin・member・editor）を新しく作る。`membership_role`に`admin`を足す（操作の記録の`actor_role`に使う）
- 表：`teams`を作り直す、`team_members`・`team_accounts`を足す、`account_partners`・`account_partner_invites`・`team_editors`を消す
- 列を足す：`memberships.assigned_notice_dismissed_at`（担当の知らせ）、`team_members.joined_notice_dismissed_at`（参加の知らせ）
- 008のチームのデータ（`memberships`の`partner`・`editor`の行、`activity_logs`以外の関係）は消し、アカウントのデータと操作の記録は残す
- マイグレーション`0012_team_revision.sql`の1本。Workers KVは使わない

**テスト**：010と同じ構成。
- 共通：Vitest（権限の表`permissionsFor`、招待の文字列）
- API：Vitest＋`@cloudflare/vitest-pool-workers`＋ローカルのPostgres。役割×APIの表（`permissions-matrix.test.ts`を4つの関わり＋チームのAPIの表に作り直す。SC-002）、見せる設定と別のチーム（SC-003）、管理者がいないチームが生まれないこと（SC-004）、008のデータを消した後の件数（SC-006）
- Web：Vitest＋Testing Library。個人運用の画面が変わらないこと（SC-005、`solo-owner-unchanged.test.tsx`）
- E2E：Playwrightで3人のブラウザ（`pnpm e2e -- team`。SC-007）

**対象プラットフォーム**：Web＝Cloudflare Pages、API＝Cloudflare Workers（無料プラン）。Cronは足さない（操作の記録の90日の削除は既存の日次の処理）。

**プロジェクトの種類**：Webアプリ（`apps/web`・`apps/api`・`packages/shared`のpnpmモノレポ）

**性能の目標**：チームの画面・担当の表は、チーム1つ（50人・アカウント50件まで）を1回の要求で返す（ふつう1秒以内）。`authorizeAccount`の問い合わせは1回のまま（見せてもらっている人の判定を同じ問い合わせに足す）。

**制約**：
- 判定は1か所（Constitution原則V）。チームのAPIも`authorizeTeam*`の1か所を通す
- 個人運用（チームに入っていないアカウント）の画面と問い合わせの数を変えない（原則V、SC-005）
- 定数：`TEAM_EDITOR_LIMIT = 10`（008のまま）、`TEAM_MEMBER_LIMIT = 50`、`TEAMS_PER_ADMIN = 20`、`TEAM_NAME_MAX = 50`（008のまま）

**規模**：1チーム50人・アカウント50件まで、1人が管理者のチーム20まで。

## Constitution Check

*GATE：Phase 0の前に確かめ、Phase 1の後にもう一度確かめた。Constitution 4.0.0。*

| 原則 | 確かめたこと | 結果 |
|---|---|---|
| I. NGワードの一貫性 | 担当の人の操作も、008と同じくNGワードのチェックを通る。見せてもらっている人は書き込めない | 合格 |
| II.人間承認ゲート | 承認はいつもオーナーだけ（任せる範囲をなくす）。見せてもらっている人・担当の人には承認の操作がない | 合格 |
| III.外部LLM前提 | 変更なし | 合格 |
| IV.契約／ロール分離 | オーナー（アカウントの持ち主）と、チームのロール（`team_members.role`）を別に持つ。チームの人になるには自分のアカウントを1つ以上入れる。ロールは招待リンク（初めはmember）と管理者の切り替えでだけ付く。管理者は1チームに1人（部分一意索引）で、抜ける前に引き継ぐ | 合格 |
| V.個人運用起点のシンプルさ | チームに入っていなければ、サイドバーのチーム名・チームの区分を出さない（`/api/me`の`teams`が空）。判定は`authorizeAccount`と`authorizeTeam*`に集める。見せてもらっているアカウントは`read`（投稿ストック・戦略のGET）だけ | 合格 |
| VI.改善フィードバック | 変更なし | 合格 |
| 技術スタック・運用コスト | 新しい依存・有料のサービスを足さない | 合格 |
| 開発ワークフロー | spec-kitの順。`main`＋`feature/*` | 合格 |

Phase 1の後の確認：data-model・contractsに、原則に反するものはない。

## プロジェクトの構成（Project Structure）

### 文書（このfeature）

```text
specs/011-team-revision/
├── spec.md
├── plan.md              # この文書
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   ├── permissions.md   # Phase 1：関わりと権限、ルートの表
│   ├── api.md           # Phase 1
│   └── ui-routes.md     # Phase 1
├── checklists/
│   └── requirements.md
└── tasks.md             # /speckit-tasks で作る
```

### ソースコード（変更する主なところ）

```text
packages/shared/src/
├── permissions.ts          # 関わり（Relation）と read 権限、委任をなくす
├── limits.ts               # TEAM_MEMBER_LIMIT・TEAMS_PER_ADMIN
├── schemas.ts              # チームの要求・応答、/api/me の teams、008の型を消す
└── errors.ts               # 新しいcodeと文言

apps/api/
├── drizzle/0012_team_revision.sql
├── src/db/schema.ts        # teams・team_members・team_accounts、008の表を消す
├── src/services/
│   ├── access.ts           # authorizeAccount（4つの関わり）、authorizeTeamMember・authorizeTeamAdmin
│   ├── team-service.ts     # 作り直し：作る・詳細・名前・削除・ロール・担当・見せる・入れる／外す・抜ける・引き継ぐ
│   ├── invite-service.ts   # チームの招待（t_）だけにする
│   └── activity-log.ts     # チームの操作の action
├── src/routes/
│   ├── teams.ts            # 新規：/api/teams/*
│   ├── invites.ts          # チームの招待の確認・参加
│   ├── account-team.ts     # /access と /team だけ残す（パートナーの招待・任せる範囲を消す）
│   └── team.ts             # 消す（/api/team/*）
└── test/                   # permissions-matrix・team・invites・activity を作り直す

apps/web/src/
├── components/layout/Sidebar.tsx        # 「チーム」の見出しの下にチーム名
├── components/layout/AccountSwitcher.tsx # 「担当しているアカウント」
├── pages/team.tsx                        # 新規：チームの画面
├── pages/team-assign.tsx                 # 新規：担当の表
├── pages/team-shared-account.tsx         # 新規：見せてもらっているアカウント（読むだけ）
├── pages/invite.tsx                      # チームの招待の確認・参加
├── components/team/*                     # TeamSection を「チーム」の区分に、RoleDiagram・TeamRoster を改める、008の部品を消す
└── pages/partner/*                       # 消す

e2e/tests/team.spec.ts・team-flow.ts、e2e/scripts/team-open.ts   # 新しい流れ
docs/team-roles.md・docs/ui-design.md                            # 新しいロール
```

**構成の判断**：001〜010と同じモノレポ。判定の中心（`access.ts`）と、チームの書き込み（`team-service.ts`）を1か所ずつに保つ。008のパートナー・編集者の部品は、似た名前で残すと混乱するので消して作り直す。

## 複雑さの記録（Complexity Tracking）

Constitutionの違反はないので、記録はない。
