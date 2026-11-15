# 実装計画（Implementation Plan）：テスト用のグループ

**ブランチ**：`feature/016-test-groups` | **日付**：2026-10-31 | **仕様**：[spec.md](./spec.md) | **UI全体設計**：[docs/ui-design.md](../../docs/ui-design.md)

**入力**：`specs/016-test-groups/spec.md`の機能仕様（Clarifications 2026-10-31を含む）、Constitution 4.0.1

## 概要（Summary）

テスト環境を組織やコミュニティの単位で渡せるようにする。運営者がグループ（名前・人数の上限・招待リンク）を作り、招待リンクから「参加する」を押した人だけがテスト環境を使える。入った人には料金なしの印が付く。仕組みは環境の設定でON/OFFし、テスト環境はON、本番はOFF。

- **判定**：入れる人＝`users.signed_up_open`（OFFの間に登録した人・前からいた人）か、閉じていないグループの人か、運営者。SQLの条件`testAccessSql`の1つにまとめる（research.md R2）。
- **止める場所**：認証のミドルウェアで、入れない人のAPIを`403 TEST_ACCESS_REQUIRED`にする（許す経路は`/api/me`・退会・招待だけ。R5）。
- **定期処理**：決済のモードに`testGroups`を載せ、`entitlementFromFacts`・`fullAccessSql`で「入れない人は読むだけ（`test_access`）」にする。013の仕組みで、自動投稿・反応の取り込みが止まる（R4）。
- **参加**：グループの行に鍵をかけて数え、上限を超えない。1人1グループ（R3）。
- **管理**：設定の「運営」の区分に、運営者だけの画面（一覧・作る・名前と上限・外す・リンクの作り直し・閉じる・記録。R9）。
- **設定**：`TEST_GROUPS_ENABLED`（必須）と`OPERATOR_CLERK_USER_IDS`（R1）。

## 技術コンテキスト（Technical Context）

**言語・バージョン**：TypeScript 6.0（フロントエンド・バックエンドとも）。Node.js 22 LTS。015と同じ。

**主な依存**：015と同じ。新しい依存は足さない（招待の文字列はチームの招待と同じ`crypto`・`createTokenCipher`）。

**ストレージ**：Neon（Postgres 17）。[data-model.md](./data-model.md)のとおり、マイグレーション`0016_test_groups`の1本（表3つ・列1つを足すだけ）。

**テスト**：015と同じ構成。
- API：Vitest＋`@cloudflare/vitest-pool-workers`＋ローカルのPostgres。既定は`TEST_GROUPS_ENABLED=false`で、016のテストだけ`true`にする。確かめるのは次のとおり。
  - 参加（空き・定員・同時に押す・すでに入っている・閉じた・作り直した・OFF）
  - 入れない人の止め方（許す経路と止める経路）、前からいた人・OFFの間に登録した人
  - 運営者のAPI（運営者でない・OFF・作る・変える・外す・閉じる・記録）、料金なしの印の付け外し
  - 自動投稿・反応の取り込みが入れない人で止まること、`billing-sql-parity`に入れる・入れないの行
  - マイグレーション（今の行が`signed_up_open = true`になる）
- Web：Vitest＋Testing Library。招待の画面（未ログイン・参加できる・定員・すでに入っている・使えない）、入れない人の画面、運営者の画面（一覧・作る・外す・閉じる）、設定の「運営」の区分の出し分け
- E2E：足さない（テスト環境のONは`wrangler.toml`の値で、E2Eは手元の`false`のまま通す）

**対象プラットフォーム**：Web＝Cloudflare Pages、API＝Cloudflare Workers（無料プラン）。Cronは足さない。

**プロジェクトの種類**：Webアプリ（`apps/web`・`apps/api`・`packages/shared`のpnpmモノレポ）

**性能の目標**：
- 認証のミドルウェアの問い合わせは1回のまま（利用者の行と入れる人の条件を同じSELECTで読む。ONのときだけ）
- 参加は1つのトランザクション（行の鍵＋数える＋入れる）

**制約**：
- 判定は1か所（Constitution原則V）。`testAccessSql`と`entitlementFromFacts`の外に、入れる人の条件を書かない
- OFFの環境（本番・手元・既存のテスト）で、001〜015の振る舞い・E2Eが変わらない
- 招待の文字列の平文をDBに置かない
- 定数：グループ名の長さ1〜50、上限1〜1000、記録の表示50件

**規模**：テスト環境の利用者は数十人。グループは数個。

## Constitution Check

*GATE：Phase 0の前に確かめ、Phase 1の後にもう一度確かめた。Constitution 4.0.1。*

| 原則 | 確かめたこと | 結果 |
|---|---|---|
| I. NGワードの一貫性 | 変更なし。入れない人の自動投稿は止まるだけで、確認を飛ばす経路は作らない | 合格 |
| II.人間承認ゲート | 変更なし。戻った後も承認済みの案だけが投稿される（013 R8の仕組みのまま） | 合格 |
| III.外部LLM前提 | 変更なし | 合格 |
| IV.契約／ロール分離 | グループはロールでも契約でもない「環境に入れるか」。料金なしの印（契約側）は、グループで付けた分だけを付け外しし、チームのロールには触らない | 合格 |
| V.個人運用起点のシンプルさ | 入れる人の判定は`testAccessSql`の1か所、止めるのは認証のミドルウェアの1か所、定期処理は013の判定に足す。個人運用の画面には何も足さない（運営者の区分は運営者にだけ出る） | 合格 |
| VI.改善フィードバック | 変更なし | 合格 |
| 技術スタック・運用コスト | 新しい依存・サービス・Cronを足さない | 合格 |
| 開発ワークフロー | spec-kitの順。`feature/016-test-groups`→`develop`。環境の違いは設定（`TEST_GROUPS_ENABLED`）に置く。マイグレーションは足すだけ | 合格 |

Phase 1の後の確認：data-model・contractsに、原則に反するものはない。Constitutionの改定は要らない。

## プロジェクトの構成（Project Structure）

### 文書（このfeature）

```text
specs/016-test-groups/
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
├── billing.ts         # ReadOnlyReason に test_access
├── schemas.ts         # me の testGroups、招待の確認・参加、運営者のAPIの入出力
└── errors.ts          # TEST_ACCESS_REQUIRED・TEST_INVITE_INVALID・TEST_GROUP_FULL・TEST_GROUP_ALREADY_MEMBER・TEST_GROUP_CLOSED・TEST_GROUP_CAPACITY_INVALID・OPERATOR_ONLY

apps/api/
├── drizzle/0016_test_groups.sql
├── src/env.ts・src/lib/config.ts         # TEST_GROUPS_ENABLED・OPERATOR_CLERK_USER_IDS、BillingMode.testGroups
├── src/db/schema.ts                      # test_groups・test_group_members・test_group_events、users.signed_up_open
├── src/middleware/auth.ts                # JIT の signed_up_open、入れる人の判定と許す経路
├── src/routes/test-invites.ts            # 新規：招待の確認と参加
├── src/routes/operator-test-groups.ts    # 新規：運営者のAPI
├── src/routes/me.ts                      # testGroups
├── src/services/test-group-service.ts    # 新規：testAccessSql・参加・作る・変える・外す・閉じる・記録
├── src/services/billing-service.ts       # entitlementFromFacts・fullAccessSql・loadEntitlement・loadOwnerEntitlement に testAccess
├── src/services/access.ts・auto-post-runner.ts・metrics-runner.ts  # 行と一緒に testAccess を読む
├── scripts/set-billing-exempt.ts（billing-service の setBillingExemptByEmail）  # 手で付けたら granted_billing_exempt を外す
├── wrangler.toml・.dev.vars.example      # TEST_GROUPS_ENABLED
└── test/                                 # env に TEST_GROUPS_ENABLED=false、016のテスト

apps/web/src/
├── pages/test-invite.tsx                 # 新規：招待の確認と参加
├── pages/settings/test-groups.tsx        # 新規：運営者の一覧と詳しい画面
├── pages/settings/sections.ts・settings-layout.tsx  # 「運営」の区分（運営者にだけ）
├── components/TestAccessRequired.tsx     # 新規：入れない人の画面
├── components/guards.tsx                 # 入れない人の画面に替える
├── lib/api-client.ts                     # 新しいAPI、TEST_ACCESS_REQUIRED の受け口
├── 読むだけの理由の文言（billing・NextPostCard など）  # test_access
└── router.tsx                            # /test-invite/:token、/settings/test-groups

docs/staging-setup-record.md・docs/external-services-setup.md  # TEST_GROUPS_ENABLED・OPERATOR_CLERK_USER_IDS の入れ方
```

**構成の判断**：グループのデータの読み書きは`test-group-service.ts`だけに置く（チームの`team-service.ts`・`invite-service.ts`と同じ分け方）。入れる人の判定はSQLの条件1つにし、認証のミドルウェア・使える状態（013）の両方がそれを使う。

## 複雑さの記録（Complexity Tracking）

Constitutionの違反はないので、記録はない。
