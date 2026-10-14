# 実装計画（Implementation Plan）：アカウントを先に作る

**ブランチ**：`feature/012-accounts-before-connect` | **日付**：2026-10-14 | **仕様**：[spec.md](./spec.md) | **UI全体設計**：[docs/ui-design.md](../../docs/ui-design.md)

**入力**：`specs/012-accounts-before-connect/spec.md`の機能仕様（Clarifications 2026-10-14を含む）、Constitution 4.0.1

## 概要（Summary）

今は「Threadsにつなぐこと＝アカウントを作ること」になっている。これを、名前だけでアカウントを作り、Threadsには「このアカウントの設定」からあとでつなぐ形に分ける。つなぐ前でも、戦略・プロンプト・投稿ストック・承認は使える。

- **データ**：列挙型`connection_status`に`not_connected`、`oauth_mode`に`connect`を足す。`accounts`に`name`（1〜50文字）を足し、`threads_user_id`・`username`・`connection_method`を`NULL`可にして、CHECK制約で「未接続 ⇔ 3つが`NULL`」を守る。今のアカウントの名前はThreadsの表示名で埋める。マイグレーション`0013_accounts_before_connect`の1本（research.md R1・R2、[data-model.md](./data-model.md)）。
- **作る**：`POST /api/accounts { name }`。行ロックの中で上限を判定し、未接続のアカウントを作る。`PATCH /api/accounts/:id { name }`で名前を直す（オーナーだけ）（R3）。
- **つなぐ**：接続のモードを`connect`（はじめてつなぐ）と`reconnect`にし、`new`（つないで作る）をなくす。`completeConnection`の`connect`の手順で、対象が未接続か・オーナーか・同じThreadsアカウントが自分の別のアカウントや他の利用者にないかを、今のロックの順の中で確かめる。成功も失敗も「このアカウントの設定」に戻す（R4、[contracts/api.md](./contracts/api.md)）。
- **未接続の間**：投稿・毎日の処理は`connected`で絞っているので変えない。投稿の権限の確認・自動投稿をオンにする保存・パフォーマンスに`not_connected`の扱いを足す（R5）。
- **表示**：主の名前はいつもアカウントの名前。@ユーザー名は添える。`accountLabel`（`packages/shared`）で1か所にまとめ、`AccountAvatar`・切り替えメニュー・設定・チームの画面などで使う（R2、[contracts/ui-routes.md](./contracts/ui-routes.md)）。
- **画面**：`/accounts/new`を「アカウントを作る」に置き換える。設定に「アカウントの名前」の区分と、未接続の「Threadsとの接続」（010の2つの方法）を足す。ホームの未接続の帯と「次にやること」、パフォーマンス・自動投稿の案内（R6）。
- **チーム**：`assertOwnFreeAccounts`で未接続のアカウントを拒み、招待の確認に`needs_connection`を足す（R7）。
- **文書**：001・010・011のspec、PRD FR-1・FR-2・UJ-1、docs/next-features.mdを直す（R9）。

## 技術コンテキスト（Technical Context）

**言語・バージョン**：TypeScript 6.0（フロントエンド・バックエンドとも）。Node.js 22 LTS。001〜011と同じ。

**主な依存**：001〜011と同じ。新しい依存は足さない。

**ストレージ**：Neon（Postgres 17）。[data-model.md](./data-model.md)のとおり。
- 列挙型：`connection_status`に`not_connected`、`oauth_mode`に`connect`（別の文で足す。同じマイグレーションの中では使わず、CHECKは`::text`で比べる）
- 列：`accounts.name`を足す、`threads_user_id`・`username`・`connection_method`の`NOT NULL`を外す。CHECK制約2つ（名前の長さ、接続の状態と列のそろい）
- 表は足さない。Workers KVは使わない

**テスト**：011と同じ構成。
- 共通：Vitest（`accountNameSchema`、`accountLabel`、接続の要求のスキーマ）
- API：Vitest＋`@cloudflare/vitest-pool-workers`＋ローカルのPostgres。作る・上限・同時の作成、`connect`の照合の表（自分の別のアカウント・他の利用者・ユーザー名だけ・同時のつなぐ操作）、未接続のアカウントでのThreadsへの問い合わせが0回（毎日の処理・自動投稿・確認。SC-005）、未接続のアカウントでの002〜004のAPI（SC-002）、チームの入口、マイグレーションのテスト（`migration-0013.test.ts`）。テストの準備（`test/helpers/app.ts`）に`name`を足し、未接続のアカウントを作る関数を足す
- Web：Vitest＋Testing Library。アカウントを作る画面、設定の「Threadsとの接続」（未接続・つないだ直後）、未接続の表示（`@null`が出ない。SC-006）、ホームの「次にやること」、個人運用の画面（SC-007、`solo-owner-unchanged.test.tsx`）
- E2E：Playwright。`onboarding.spec.ts`を書き直し、`token.spec.ts`・`reconnect-delete.spec.ts`・`team-flow.ts`を「作ってからつなぐ」に直す

**対象プラットフォーム**：Web＝Cloudflare Pages、API＝Cloudflare Workers（無料プラン）。Cronは足さない。

**プロジェクトの種類**：Webアプリ（`apps/web`・`apps/api`・`packages/shared`のpnpmモノレポ）

**性能の目標**：アカウントを作る要求は、Threadsへの問い合わせなしで1回のトランザクション（ふつう1秒以内。SC-001の1分を十分に下回る）。つなぐ流れの問い合わせの数は010と同じ。

**制約**：
- 判定は1か所（Constitution原則V）。新しいAPIも`authorizeAccount`を通す。チームの入口は`assertOwnFreeAccounts`の1か所
- 接続中のアカウントの問い合わせ・画面の数を変えない（SC-007）
- 定数：`ACCOUNT_NAME_MAX = 50`。上限（001 FR-015〜FR-017）は今のまま

**規模**：001〜011と同じ（1人あたりのアカウントは上限まで）。

## Constitution Check

*GATE：Phase 0の前に確かめ、Phase 1の後にもう一度確かめた。Constitution 4.0.1。*

| 原則 | 確かめたこと | 結果 |
|---|---|---|
| I. NGワードの一貫性 | 未接続のアカウントでもNGワードの確認は今のまま（案の登録・承認・投稿の前）。投稿はつないでからだけ | 合格 |
| II.人間承認ゲート | 未接続でも承認の手順は同じ。つないでも自動投稿はオフのままで、オーナーがオンにするまで投稿しない（承認済みの案が一度に出ていかない） | 合格 |
| III.外部LLM前提 | 変更なし（プロンプトのアカウント名を`name`にするだけ） | 合格 |
| IV.契約／ロール分離 | つなぐのはオーナーだけ（接続はオーナーの持ち物）。未接続のアカウントはチームに入れず、「チームの人になれるのは、自分のThreadsアカウントを1つ以上チームに入れた人だけ」を守る（R7） | 合格 |
| V.個人運用起点のシンプルさ | 判定は`authorizeAccount`と`assertOwnFreeAccounts`の1か所のまま。個人運用の画面に足すのは「アカウントの名前」の区分だけで、チームのものは足さない。未接続のときだけ案内を足す | 合格 |
| VI.改善フィードバック | 未接続の間は低調の判定がないので、プロンプトの改善の部分は空（006の「データがまだない」と同じ）。つないだ後は今のまま | 合格 |
| 技術スタック・運用コスト | 新しい依存・有料のサービスを足さない。未接続のアカウントはThreadsに問い合わせず、Neonの負荷も増やさない | 合格 |
| 開発ワークフロー | spec-kitの順。`main`＋`feature/*`。PRD（FR-1・FR-2）を実装の前に直す（R9） | 合格 |

Phase 1の後の確認：data-model・contractsに、原則に反するものはない。Constitutionの改定は要らない。

## プロジェクトの構成（Project Structure）

### 文書（このfeature）

```text
specs/012-accounts-before-connect/
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
├── schemas.ts              # AccountSummary（name・nullable）、接続の要求（connect）、作る・名前・削除の要求、チームの型、threadsCheck・performance
├── account-label.ts        # 新規：accountLabel（主の名前・添える名前・頭文字）
├── limits.ts               # ACCOUNT_NAME_MAX
└── errors.ts               # ACCOUNT_NOT_CONNECTED・ACCOUNT_ALREADY_CONNECTED、ACCOUNT_ALREADY_REGISTERED の文言

apps/api/
├── drizzle/0013_accounts_before_connect.sql
├── src/db/schema.ts        # 列挙型の値、accounts の列とCHECK
├── src/routes/
│   ├── accounts.ts         # POST /api/accounts・PATCH /api/accounts/:id、削除の confirmName
│   ├── threads-connect.ts  # connect モード、callback の戻り先
│   └── performance.ts      # 未接続の扱い
├── src/services/
│   ├── account-service.ts  # createAccount・renameAccount、completeConnection の connect、deleteAccount
│   ├── threads-oauth.ts    # startConnect の connect
│   ├── token-connect.ts    # connect モード
│   ├── threads-check-service.ts・auto-post-status.ts・posting-schedule-service.ts・performance-service.ts  # not_connected
│   ├── access.ts           # toAccountSummary に name
│   ├── invite-service.ts   # assertOwnFreeAccounts、needs_connection、name・connected
│   ├── team-service.ts     # アカウントの行に name
│   └── prompt-service.ts   # アカウント名を name に
└── test/                   # 上の「テスト」

apps/web/src/
├── pages/account-new.tsx           # AccountCreate（名前だけ）に置き換え
├── pages/account-settings.tsx      # アカウントの名前の区分、Threadsとの接続（未接続）、削除の確認
├── pages/account-home.tsx          # 未接続の帯、次にやること
├── pages/performance.tsx           # 未接続の案内
├── pages/invite.tsx                # needs_connection、選べないアカウント
├── components/connect/ConnectMethods.tsx   # 新規：未接続の「Threadsとの接続」（2つの方法）
├── components/connect/*            # TokenConnectForm・ReconnectDialog の mode・表示名
├── components/NotConnectedNotice.tsx・NotConnectedBanner.tsx  # 新規
├── components/AccountAvatar.tsx・ConnectionBadge.tsx・AutoPostNotices.tsx・ReconnectButton.tsx
├── components/layout/AccountSwitcher.tsx   # accountLabel、「アカウントを作る」
├── components/settings/PostingScheduleSection.tsx  # 未接続ならオンにできない
├── components/team/*               # accountLabel、CreateTeamDialog の未接続
├── lib/callback-result.ts・lib/invite-return.ts   # connected=connect、招待へ戻す
└── pages/guide-threads-token.tsx   # 「追加の画面」の文言

e2e/tests/onboarding.spec.ts・token.spec.ts・reconnect-delete.spec.ts・team-flow.ts
docs/next-features.md・docs/ui-design.md、specs/001・010・011 の spec、PRD
```

**構成の判断**：001〜011と同じモノレポ。アカウントを作る書き込みと、つなぐ書き込みを`account-service.ts`の2つの関数（`createAccount`・`completeConnection`）に分け、上限の判定は作る側だけにする。表示の決まりは`accountLabel`の1か所にまとめ、画面ごとに`displayName ?? username`を書かない。

## 複雑さの記録（Complexity Tracking）

Constitutionの違反はないので、記録はない。
