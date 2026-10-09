# 実装計画（Implementation Plan）：チーム運用

**ブランチ**：`feature/008-team-operations` | **日付**：2026-10-10 | **仕様**：[spec.md](./spec.md) | **UI全体設計**：[docs/ui-design.md](../../docs/ui-design.md) | **画面案**：[008チーム運用の画面案](https://claude.ai/artifact/RvoXXDYsJHwUt3iLE5EraA)（非公開）

**入力**：`specs/008-team-operations/spec.md`の機能仕様（Clarifications 2026-10-09 を含む）

## 概要（Summary）

Accountのオーナーが、運用代行・コンサルのパートナーを招き、パートナーが自社の編集者を担当に割り当てて、一緒にAccountを運用できるようにする（PRD FR-13）。役割（オーナー・パートナー・編集者）ごとの権限を1か所で判定し、すべてのAPIに通す（Constitution原則V 3.0.0）。

- **役割の持ち方**：`memberships.role`に`partner`・`editor`を足し、どのチーム経由かを`team_id`で持つ（原則IV）。チーム・編集者・手伝いの関係は別の表（`teams`・`team_editors`・`account_partners`）で持ち、`memberships`の行はチームの操作と同じトランザクションで作る・消す（research.md R1）。
- **判定**：`findOwnedAccount`（59か所）を`authorizeAccount(db, user, accountId, permission)`に置き換える。権限は`view`・`content`・`review`・`settings`・`activity`・`owner`の6つで、表は`packages/shared`に置いてAPIと画面で共有する（R2、[contracts/permissions.md](./contracts/permissions.md)）。grower機能の判定はオーナーの登録日時で行う（R3）。
- **招待**：LINEグループに近い常設リンク。パートナーはAccountごと（最初の1人が参加すると閉じる）、編集者はチームに1本（10人まで）。文字列はハッシュで照合し、表示用に暗号化した写しを持つ（R4）。QRコードはブラウザで作る（R5）。確認画面はログイン不要（R7）。
- **任せる範囲**：`account_partners.delegate_review`・`delegate_settings`。
- **保存の衝突**：既存の409 `STALE_UPDATE`に、先に保存した人の名前を足す（R8）。
- **操作の記録**：チームがあるAccountだけ、操作と同じトランザクションで`activity_logs`に書く。まとめての操作は1行。90日で日次の処理が消す（R9）。
- **画面**：招待の確認、パートナーの2列の画面（手伝っているアカウント・編集者と担当）、操作の記録、設定の「運用を手伝ってもらう」、サイドバーの役割の表示、切り替えメニューの2つのまとまり、投稿ストックの出し分け（[contracts/ui-routes.md](./contracts/ui-routes.md)）。
- **スマートフォンの通知**：767px以下で通知をヘッダーの下に出す（R13、UI全体設計 §11）。

## 技術コンテキスト（Technical Context）

**言語・バージョン**：TypeScript 6.0（フロントエンド・バックエンドとも）。開発ツールはNode.js 22 LTS。001〜007と同じ。

**主な依存**：001〜007と同じ。Webに`uqr`（QRコードのSVG。MIT、依存なし）を足す（R5）。それ以外は足さない。

**ストレージ**：Neon（Postgres 17）。[data-model.md](./data-model.md)のとおり。
- 列挙型：`membership_role`に2つの値を足す、`activity_kind`を新しく作る
- テーブル5つ（`teams`・`team_editors`・`account_partners`・`account_partner_invites`・`activity_logs`）
- 列を足す：`memberships.team_id`、`post_drafts`（2列）、`post_metrics`（2列）、保存した人の列（6つの表）
- マイグレーション`0009_team_operations.sql`の1本。Workers KVは使わない。

**テスト**：007と同じ構成。
- 共通：Vitest（権限の表、招待の文字列の形）
- API：Vitest＋`@cloudflare/vitest-pool-workers`＋ローカルのPostgres（OrbStack＋`docker compose up -d`）。テスト用の認証で複数のユーザーを切り替える。役割×APIの表のテストと、ルートの一覧で置き換えの漏れを見つけるテスト（SC-002）
- Web：Vitest＋Testing Library。個人運用のオーナーの画面が変わらないことのテスト（SC-005）
- E2E（任意）：Playwrightで2つのブラウザのコンテキストを使った招待と参加（既存のE2Eの準備ができていれば）

**対象プラットフォーム**：
- Web：Cloudflare Pages
- API：Cloudflare Workers（無料プラン）。Cronは足さない（90日の削除は既存の日次の処理）
- ブラウザ：PC・タブレット・スマートフォンのモダンブラウザ。Web Share APIは使えるときだけ

**プロジェクトの種類**：Webアプリ（SPA＋API）

**性能目標**：
- 本featureのAPIはp95で500ms以内（001〜007と同じ）。
- `authorizeAccount`は1回の問い合わせで、今の`findOwnedAccount`から往復の回数を増やさない（R14）。
- 「手伝っているアカウント」は、手伝う先10件で2秒以内に表示（SC-007）。Accountの数ぶんの問い合わせにしない（R12）。

**制約**：
- 月額固定費$0（Constitution）。Clerk Organizationsは使わない。
- NGワードのチェック（原則I）と人の承認（原則II）を、どの役割でも省かない（FR-005）。
- 個人運用のオーナーの画面は「運用を手伝ってもらう」の区分以外変えない（FR-006、SC-005）。
- 上限・暫定値：編集者10人（`TEAM_EDITOR_LIMIT`）、記録90日（`ACTIVITY_LOG_RETENTION_DAYS`）、まとめての記録の書き出し50件、チーム名50文字、まとめの表示100件、記録の1ページ50件。`packages/shared/src/limits.ts`に置く。

**規模**：
- 画面：新規4つ（招待の確認、手伝っているアカウント、編集者と担当、操作の記録）、待機の案内、変更5つ（このアカウントの設定、サイドバー、切り替えメニュー、投稿ストック、ホーム）。
- API：新規約20本（[contracts/api.md](./contracts/api.md)）。変更：既存のAccountのAPIすべて（判定の置き換え）、`/api/me`、要確認の件数、記録を書く操作、409の応答。

「要確認」の項目はなし（[research.md](./research.md)で解消済み）。

## Constitutionとの整合（Constitution Check）

*ゲート：Phase 0の前に確認し、Phase 1の設計後に再確認する。Constitution 3.0.0。*

| 原則・制約 | 判定 | 根拠 |
|---|---|---|
| I. 人格・トーン・NGワードの一貫性 | 合格 | 配信の直前のNGワードのチェック（005）と承認のときのチェック（004）は変えず、役割にかかわらず通る（FR-005）。NGワードの変更は`settings`の権限で、オーナーか任されたパートナーだけ |
| II. 人間承認ゲート | 合格 | 承認は`review`の権限（オーナー、または任されたパートナー）で、人の明示的な操作だけ。編集者は承認できない。承認済みを直すと要確認に戻る（004 FR-007）のは全員に同じ。却下の理由は今のとおり記録する |
| III. 外部LLM前提・API依存ゼロ | 合格 | アプリの中でAIを呼ばない |
| IV. 契約／ロール分離 | 合格 | 役割は`memberships.role`（owner・partner・editor）でAccountごとに持つ（R1）。パートナーの役割はオーナーの招待だけ、編集者の役割（担当）はパートナーの操作だけで付く（FR-025）。契約（`accounts.plan`・無料体験）には触れず、grower機能はオーナーの状態で判定する（R3）。役割と契約を1つの値にしない |
| V. 個人運用起点のシンプルさ | 合格（例外を記録） | 判定を`authorizeAccount`の1か所に集め、すべてのAPIが通る（R2）。個人運用の画面に足すのは「運用を手伝ってもらう」の1区分だけで、spec FR-006に原則Vの例外として記録した（2026-10-09ユーザー決定）。匿名ベンチマーク・PINは作らない |
| VI. 改善フィードバックループの忠実性 | 合格 | 改善メモ・プロンプトの流れは変えない。編集者・パートナーも改善メモを書ける（`content`） |
| 技術スタック制約 | 合格 | 既存のスタック。Clerkはログインだけ、チームはアプリのDB。依存は`uqr`だけ足す |
| 運用コスト制約（固定費$0） | 合格 | Cron・KVを足さない。判定の往復は増えない。記録は90日で数MB未満（R14） |
| 開発ワークフロー | 合格 | PRDを先に更新（a6c822b）、`feature/008-team-operations`で作業 |

**Phase 1の設計後の再確認**：data-model.md・contracts/で、新たな違反は生じていない。
- マイグレーションは後方互換（既存の行は`owner`・`team_id` NULLのまま、新しい列はNULLか既定値）。列挙型の値の追加は、同じマイグレーションの中で新しい値を書かない形にした（data-model.md）。
- 原則IIの確認：まとめて承認の確認（004 FR-004b）は、任されたパートナーにも同じく出る。
- 原則V：権限の表とAPIの対応を[contracts/permissions.md](./contracts/permissions.md)に1つにまとめ、表にないAPIがあればテストが失敗する仕組みにした。

## プロジェクト構成（Project Structure）

### ドキュメント（このfeature）

```text
specs/008-team-operations/
├── spec.md                  # 機能仕様（/speckit-specify・/speckit-clarify）
├── plan.md                  # このファイル（/speckit-plan）
├── research.md              # Phase 0の出力
├── data-model.md            # Phase 1の出力
├── quickstart.md            # Phase 1の出力
├── contracts/               # Phase 1の出力
│   ├── permissions.md       #   権限の表、APIごとの必要な権限、削除の扱い
│   ├── api.md               #   新しいAPI・エラー・操作の記録のコード・/api/me の変更
│   └── ui-routes.md         #   画面・表示文言
├── checklists/
│   └── requirements.md      # 仕様品質チェックリスト
└── tasks.md                 # Phase 2の出力（/speckit-tasks。本コマンドでは作らない）
```

### ソースコード（リポジトリのルート）

007までの構成に、次のファイルを足す・変える（★は新規、✎は変更）。

```text
packages/shared/src/
├── ★ permissions.ts            # 権限・役割の型、役割×任せる範囲→権限の集合、削除に要る権限
├── ✎ limits.ts                 # TEAM_EDITOR_LIMIT・ACTIVITY_LOG_RETENTION_DAYS ほか
├── ✎ schemas.ts                # Access・Team・Invite・Activity の型、AccountSummary に role・ownerName、409 に updatedBy
└── ✎ errors.ts                 # 新しいエラーコードと文言
packages/shared/test/★ permissions.test.ts

apps/api/
├── drizzle/★ 0009_team_operations.sql
├── src/
│   ├── ✎ app.ts                        # 新しいルートの登録（招待の確認はログイン不要）
│   ├── db/✎ schema.ts                  # 列挙型・5つのテーブル・足す列
│   ├── routes/
│   │   ├── ★ team.ts                   # /api/team/*（パートナー本人）
│   │   ├── ★ invites.ts                # /api/invites/:token、/accept
│   │   ├── ★ account-team.ts           # /accounts/:id/access・team・partner・partner-invite
│   │   ├── ★ activity.ts               # /accounts/:id/activity
│   │   ├── ✎ me.ts                     # 役割つきの一覧・landing・partnerTeam・editorWaiting
│   │   └── ✎ その他のAccountのルート    # findOwnedAccount → authorizeAccount（permissions.md の表のとおり）
│   └── services/
│       ├── ✎ access.ts                 # authorizeAccount・AccountAccess（findOwnedAccount を置き換え）
│       ├── ★ team-service.ts           # チーム・編集者・担当・手伝いの関係（memberships と同じトランザクション）
│       ├── ★ invite-service.ts         # 文字列の生成・照合・暗号化した写し・参加
│       ├── ★ activity-log.ts           # recordActivity（hasTeam のときだけ）・一覧・90日の削除
│       ├── ★ partner-summary.ts        # 手伝っているアカウントのまとめ
│       ├── ✎ grower-access.ts          # オーナーの登録日時で判定
│       ├── ✎ account-review-counts.ts  # 関わるすべてのAccount
│       ├── ✎ draft-service.ts・review-service.ts・strategy-service.ts・item-service.ts・
│       │     posting-rules-service.ts・posting-schedule-service.ts・performance-service.ts
│       │                               # 記録を書く、保存した人の列、409 に updatedBy、削除の権限の分け方
│       └── ✎ daily-jobs.ts             # activity logs cleanup
└── test/
    ├── ✎ helpers（認証のテスト用）       # 複数のユーザーで呼べるようにする
    └── integration/
        ├── ★ permissions-matrix.test.ts # 役割×API の表、ルートの一覧で漏れを見つける
        ├── ★ invites.test.ts            # 作成・作り直し・取り消し・確認・参加・同時参加・上限・自分
        ├── ★ team.test.ts               # 担当・外す・自社アカウント・まとめ
        ├── ★ activity.test.ts           # 書く・書かない・まとめ・再試行・90日・外した後
        └── ✎ 既存のテスト               # 409 の updatedBy、grower機能の判定

apps/web/src/
├── ✎ router.tsx                        # /invite/:token、/partner/*、/accounts/:id/activity、ガードの拡張
├── ✎ main.tsx・components/ui/sonner.tsx # 通知の位置（767px以下）
├── lib/★ use-account-access.ts         # access の読み込み・403 での読み直し・404 での移動
├── components/
│   ├── ★ team/InviteLinkDialog.tsx     # リンク・コピー・送る・QRコード・作り直す（パートナー・編集者で共用）
│   ├── ★ team/QrCode.tsx               # uqr で SVG
│   ├── ★ team/TeamSection.tsx          # このアカウントの設定の「運用を手伝ってもらう」
│   ├── ★ team/RemovePartnerDialog.tsx
│   ├── ★ team/PartnerJoinedNotice.tsx  # オーナーのホーム
│   ├── ★ team/EditorWaiting.tsx        # 待機の案内
│   ├── ✎ layout/Sidebar.tsx            # 役割の枠、「チーム > 操作の記録」
│   ├── ✎ layout/AccountSwitcher.tsx    # 2つのまとまり、まとめて見る、担当未定
│   ├── ✎ ConflictDialog.tsx            # 「（名前）さんが先に保存しました」
│   ├── ✎ stock/*                       # review がないときの出し分け、作成・編集の名前、案内
│   └── ✎ settings/*                    # settings がないときの読むだけ
├── pages/
│   ├── ★ invite.tsx
│   ├── ★ partner/partner-layout.tsx・partner-accounts.tsx・partner-editors.tsx
│   ├── ★ activity.tsx
│   ├── ✎ account-settings.tsx・account-home.tsx・landing.tsx・account-layout.tsx
└── test/★ team・invite・partner・activity・stock（出し分け）のテスト
```

**構成の判断**：001〜007と同じモノレポ。権限の表は、APIの判定と画面の出し分けで同じものを使うため`packages/shared`に置く。チームの操作（`memberships`の行の作成・削除を含む）は`team-service.ts`に集め、ほかの場所から`memberships`のpartner・editorの行を書かない。

## 実装の順番（tasksへの申し送り）

1. マイグレーション・スキーマ・権限の表（shared）。
2. `authorizeAccount`と、既存の59か所の置き換え＋役割×APIの表のテスト（この時点ではpartner・editorの行がないので、オーナーの動作は変わらない）。
3. US1（招待・参加・外す・確認画面・設定の区分）→ US2（チーム・編集者・担当・待機）→ ここでMVP。
4. US3（任せる範囲）→ US4（記録・作成者の名前・409の名前）→ US5（まとめ・切り替えメニュー）→ US6（通知の位置）。

## 複雑さの記録（Complexity Tracking）

| 違反・例外 | なぜ必要か | より単純な案を退けた理由 |
|---|---|---|
| 原則Vの例外：個人運用の「このアカウントの設定」に「運用を手伝ってもらう」の区分を1つ足す | オーナーがパートナーを招く入口が、どこかに必要 | 入口を出さない（招待はパートナーからの申請だけにする）と、オーナー主導で招く流れ（addendumの例の手順1）が成り立たない。設定の中の1区分に留め、ほかの画面には出さない（spec FR-006、2026-10-09ユーザー決定） |
| UI全体設計の「専用のダッシュボード画面は作らない」の例外：パートナーの2列の画面 | 手伝い先が増えたパートナーが、全体を1画面で見る（US5） | 切り替えメニューだけでは、伸び・任された範囲・担当まで出せない。設定と同じ型Dで作り、新しい型を増やさない（spec FR-060、2026-10-09ユーザー決定） |
