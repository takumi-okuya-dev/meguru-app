# 実装計画（Implementation Plan）：テスター招待での接続、アカウント数・投稿数の上限、無料体験の廃止

**ブランチ**：`feature/024-tester-invite-connect` | **日付**：2026-11-08 | **仕様**：[spec.md](./spec.md) | **モック**：[024 テスター招待と上限 モック](https://claude.ai/artifact/R6Pc9o8YomNZNDEB161eSf)

**入力**：`specs/024-tester-invite-connect/spec.md`の機能仕様（Clarifications 2026-11-08を含む）、Constitution 4.4.0

## 概要（Summary）

本番をMeta App Reviewの前に公開するため、次の4つを入れる。

1. **テスター招待**：利用者がThreadsのユーザー名で申し込み、運営者がMetaでテスターに招待して一覧で「招待した」にし、利用者が承認して「Threadsで許可する」（001）でつなぐ。つながると申し込みは自動で「接続済み」になる。運営者はトークンを扱わない。
2. **上限**：利用者が持てるアカウントの数と、アカウントごとの1日の投稿数に、全員共通の既定値と利用者ごとの値を置く。運営者には上限をかけない。
3. **無料体験の廃止と料金**：新しく登録した人は契約するまで使えない。料金はアカウント1件につき月1,000円。024が出る前に始めた無料体験は、終わる日まで使える。
4. **運営者の料金なし**：運営者は、招待制のON/OFFにかかわらず、どの環境でも料金なし。

設計の要点は次のとおり。

- **申し込み**：表`tester_applications`に、アカウント1件につき「生きている」申し込みを1つまで持つ（research.md R1）。テスター枠は、運営者が「招待した」から「外した」までの行で数える（`holds_slot`。R2）。
- **接続済みにする**：OAuthとトークンで共通の`completeConnection`の中で、同じトランザクションで申し込みを進める（R5）。
- **上限**：既定値は1行だけの表`operator_settings`に、利用者ごとの値は`users`の2列に持つ。アカウントの上限は`accountLimitFor`の1か所で、投稿の上限は投稿のスケジュールの保存と自動投稿の時刻の処理で効かせる（R6・R7）。
- **契約前**：新しい状態`unsubscribed`を足す。024の前からいた人は`users.legacy_trial`の印で見分ける（R8）。契約前の人には、認証のミドルウェアで、許す経路のほかを`403 SUBSCRIPTION_REQUIRED`で止める（016の招待制と同じ作り。R9）。
- **料金**：Stripeに1件1,000円の料金を作り直し、すでにある契約は、数の合わせ直しのときに新しい料金へ切り替える（R10）。
- **招待の管理のON/OFF**：新しいスイッチは作らない。今ある`THREADS_ACCESS_MODE`が`testers`で、`app`を出しているときにON（R4）。

## 技術コンテキスト（Technical Context）

**言語・バージョン**：TypeScript 6.0（フロントエンド・バックエンドとも）。Node.js 22 LTS。023と同じ。

**主な依存**：023と同じ。新しい依存は足さない。

**ストレージ**：Neon（Postgres 17）。[data-model.md](./data-model.md)のとおり、マイグレーション`0022_tester_invites`の1本。
- 表を3つ足す（`tester_applications`・`operator_settings`・`operator_events`）。
- `users`に3列を足す（`account_limit`・`daily_post_limit`・`legacy_trial`）。

**外部サービス**：
- **Stripe**：料金（`STRIPE_PRICE_ID`）を、1件1,000円のものに作り直す。テスト用環境と本番の両方（R10）。
- **Meta**：
  - テスト版：ThreadsAutomationのアプリIDと、3つのコールバックのURLを設定する。
  - 本番：本番用のMetaアプリを作る（R12）。
  - アプリからMetaのテスターを操作するAPIは使わない（ないため）。

**テスト**：023と同じ構成。
- **API**：Vitest＋`@cloudflare/vitest-pool-workers`＋ローカルのPostgres。確かめるのは次のとおり。
  - **申し込み**：
    - 申し込む・取り消す（「申し込み中」のときだけ）・二重の申し込み（`409`）
    - ユーザー名の形（`@`を取る・小文字にそろえる・使えない形）
    - 10分に5回の制限
    - 招待の管理がOFFなら`404`
    - 他人のアカウントには申し込めない
  - **運営者**：
    - 一覧（状態ごと・同じユーザー名・すでにつながっている）
    - 招待した・見送る（理由）・戻す・外した
    - 枠の数を変える、枠がいっぱいの警告（`force`）
    - 運営者でなければ`OPERATOR_ONLY`
    - 記録が残る
  - **接続**：
    - OAuthでつながると「接続済み」になる
    - ユーザー名が違うときと、トークンでつないだときは「外してよい」になる
    - アカウントを消した・退会したときも「外してよい」になる
    - 退会したら名前とメールアドレスを残さない
  - **アカウントの上限**：
    - 既定値・利用者ごとの値・運営者は上限なし
    - 前からの無料体験の1件とは、小さい方が効く
    - 料金なしの人・グループの人にもかかる
    - 同時に作っても上限を超えない
    - 上限を下げても今あるアカウントは残る
  - **投稿の上限**：
    - 保存のときに上限を超えると`POSTING_SLOT_LIMIT`
    - 自動投稿の時刻の処理は、早い時刻から上限の数までだけ
    - チームの人が手伝うアカウントでは、オーナーの値が効く
  - **契約前**：
    - 新しく登録した人は`unsubscribed`になり、許す経路のほかは`SUBSCRIPTION_REQUIRED`
    - 契約すると使える。その場で請求し、試用を付けない
    - 前からいた人は無料体験のまま
    - 料金なしの人・運営者・決済がOFFの環境では止めない
    - `fullAccessSql`と`entitlementOf`の結果が同じ（billing-sql-parity）
  - **運営者の料金なし**：招待制がOFFでも料金なしになる（016・019の振る舞いを変える分）
  - **料金**：
    - 次の請求の見込みが「件数×1,000円」になる
    - 料金が古い契約は、数の合わせ直しのときに新しい料金になる（次の請求から。日割りはしない）
  - **マイグレーション**：
    - 足すだけで、今いる人に`legacy_trial`が付く
    - 退会とアカウントの削除で、申し込みが「外してよい」になる
- **Web**：Vitest＋Testing Library。
  - つなぐ画面（申し込み前・申し込み中・招待済み・見送り・招待済みでつなげなかったとき・OFFの環境）
  - 契約前の画面
  - 運営者の「テスター招待」「上限」の画面
  - 上限に達したときのアカウントを作る画面
  - 投稿のスケジュールの上限の表示（上限を超えた時刻に「投稿しません」）
  - 設定の「運営」の区分
  - 無料体験の文言が新しく登録する人の画面に出ないこと
- **E2E**：今のE2E（決済OFFの手元）がそのまま通ることを確かめる。新しくは足さない。

**対象プラットフォーム**：Web＝Cloudflare Pages、API＝Cloudflare Workers（無料プラン）。Cronは足さない（自動投稿の時刻の処理の中で上限を効かせる）。

**プロジェクトの種類**：Webアプリ（`apps/web`・`apps/api`・`packages/shared`のpnpmモノレポ）

**性能の目標**：
- 認証のミドルウェアの問い合わせは1回のまま（契約の状態と`legacy_trial`を、同じSELECTに`subscriptions`の結合で足す）。
- 自動投稿の時刻の処理は、オーナーの1日の投稿数の上限を、今の設定の読み込みに結合で足す（問い合わせを増やさない）。

**制約**：
- **判定は1か所**（Constitution原則V）：
  - アカウントの上限は`accountLimitFor`だけ
  - 使える状態は`entitlementOf`と`fullAccessSql`だけ（両者を同じ結果に保つ）
  - 運営者の判定は`OPERATOR_CLERK_USER_IDS`だけ
- **守りはAPIで**：画面の出し分けは見た目だけ（FR-013・FR-022・FR-029）。
- **トークン**：運営者がトークンを作る・付けるAPIは作らない（FR-002）。パスワードを受け取る口も作らない（FR-001）。
- **消さないもの**：上限を下げても、アカウントと登録した時刻は消さない（FR-020・FR-021）。
- **変えないもの**：
  - 設定のない人・決済がOFFの環境で、001〜023の振る舞いを変えない（上限の既定値は、今の「1日10件」と同じ）
  - 前からの無料体験の人の振る舞いを変えない（FR-031）
- **定数**：
  - 上限の既定値の初めの値：アカウント3件・投稿10件
  - 投稿の上限の最大：250件
  - テスター枠の初めの値：25
  - 料金：1件1,000円
  - 申し込み・取り消し：10分に5回まで
  - 見送りの理由：200文字まで
  - 記録の表示：50件

**規模**：運営者は1人。申し込みは数十〜数百件。上限を個別に変える人は数人〜数十人。

## Constitution Check

*GATE：Phase 0の前に確かめ、Phase 1の後にもう一度確かめた。Constitution 4.4.0。*

| 原則 | 確かめたこと | 結果 |
|---|---|---|
| I. NGワードの一貫性 | 投稿の上限は投稿の数だけを減らす。NGワードのチェックの経路は変えない。grower機能の条件は「契約中（料金なしを含む）」になり、024の前からの無料体験の人は終わる日まで同じに扱う（4.4.0） | 合格 |
| II. 人間承認ゲート | 承認していない案を投稿する経路は作らない。上限を超えた時刻には投稿しないだけ | 合格 |
| III. 外部LLM前提 | 変更なし | 合格 |
| IV. 契約／ロール分離 | <ul><li>**上限**：`users`の列と`operator_settings`に持ち、契約（`subscriptions`）とロール（`memberships`）のどちらにも混ぜない</li><li>**契約前**：「契約するまでは使えない」（4.4.0）を`unsubscribed`で表す</li><li>**チーム**：チームの人の投稿の上限は、そのAccountのオーナーの値に従う（オーナーが設定を持つ）</li></ul> | 合格 |
| V. 個人運用起点のシンプルさ | 個人運用の画面に足すのは、つなぐ画面の申し込みの欄だけ（つなぐ前のアカウントだけに出る）。上限の判定は1か所。運営者の区分は運営者にだけ出る | 合格 |
| VI. 改善フィードバック | 変更なし | 合格 |
| 技術スタック・運用コスト | 新しい依存・サービス・Cronを足さない。Stripeの料金のIDを替えるだけ | 合格 |
| 開発ワークフロー | <ul><li>spec-kitの順。`feature/024-tester-invite-connect`→`develop`</li><li>マイグレーションは足すだけ</li><li>環境の違いは設定に置く（`THREADS_CONNECT_METHODS`・`THREADS_APP_ID`・`STRIPE_PRICE_ID`の値を変え、docs/environment-switches.mdを同じPRで直す）</li><li>PRDのFR-12は先に直してある（2026-11-08）</li></ul> | 合格 |

**Phase 1の後の確認**：data-model・contractsに、原則に反するものはない。
- Constitutionの改定（4.4.0）とPRDの直しは、このfeatureのPRに入れる。
- Constitutionの先頭のSync Impact Reportは、コミットの前に消す。

## プロジェクトの構成（Project Structure）

### 文書（このfeature）

```text
specs/024-tester-invite-connect/
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
├── billing.ts         # unsubscribed の状態、BILLING_UNIT_PRICE_JPY（1,000円）、nextInvoiceAmount、legacyTrial を入力に足す。BASE・EXTRA をなくす
├── limits.ts          # 上限の既定値・最大、テスター枠の初めの値、申し込みの回数の制限
├── schedule.ts        # 時刻の数の上限を引数で受け取る（AUTOPOST_SLOT_LIMIT の固定をやめる）
├── tester.ts          # 新規：申し込みの状態、ユーザー名の正規化と形の確かめ、外してよい理由
├── schemas.ts         # me の billing（unsubscribed）・limits・testerInvites、申し込み・運営者のAPIの入出力、BillingSummary の prices
└── errors.ts          # SUBSCRIPTION_REQUIRED・TESTER_APPLICATION_EXISTS・POSTING_SLOT_LIMIT、ACCOUNT_LIMIT_REACHED の文

apps/api/
├── drizzle/0022_tester_invites.sql
├── src/db/schema.ts                           # tester_applications・operator_settings・operator_events、users の3列
├── src/lib/config.ts                          # billingModeOf が招待制にかかわらず operators を持つ、testerInvitesEnabledOf
├── src/middleware/auth.ts                     # 契約前の人の経路の制限（SUBSCRIPTION_REQUIRED）、同じ問い合わせで契約の状態を読む
├── src/services/billing-service.ts            # legacyTrial、fullAccessSql、料金の切り替え（syncQuantity）
├── src/services/test-group-service.ts         # billingExemptSql が招待制にかかわらず運営者を含む
├── src/services/limit-service.ts              # 新規：既定値・利用者ごとの上限の読み書き、実際の上限（運営者は null）
├── src/services/account-service.ts            # accountLimitFor が limit-service を使う、completeConnection で申し込みを進める、deleteAccount
├── src/services/tester-application-service.ts # 新規：申し込み・取り消し・運営者の操作・一覧・枠・記録
├── src/services/posting-schedule-service.ts   # 保存のときに上限を確かめる
├── src/services/auto-post-runner.ts           # オーナーの上限の数までの時刻だけ使う
├── src/services/token-connect.ts              # トークンでつないだら申し込みを取り下げにする（completeConnection の中）
├── src/services/withdrawal-service.ts         # 退会で申し込みを外してよいにし、名前・メールアドレスを残さない
├── src/routes/tester-applications.ts          # 新規：利用者の申し込みのAPI
├── src/routes/operator-tester-invites.ts      # 新規：運営者の招待の管理のAPI
├── src/routes/operator-limits.ts              # 新規：運営者の上限のAPI
├── src/routes/me.ts・billing.ts・posting-schedule.ts・accounts.ts  # limits・unsubscribed・上限の数
└── test/                                      # 024のテスト、013・016・019の運営者の料金なし・無料体験のテストの書き換え

apps/web/src/
├── components/connect/ConnectMethods.tsx      # 招待の管理がONなら TesterApplicationPanel
├── components/connect/TesterApplicationPanel.tsx  # 新規：申し込み前・申し込み中・招待済み・見送り
├── components/billing/SubscribeRequired.tsx   # 新規：契約前の画面
├── components/guards.tsx・lib/api-client.ts   # SUBSCRIPTION_REQUIRED と me.billing.state で契約前の画面
├── components/settings/PostingScheduleDialog.tsx  # 上限の数、上限を超えた時刻に「投稿しません」
├── pages/settings/tester-invites.tsx          # 新規：運営 › テスター招待
├── pages/settings/limits.tsx                  # 新規：運営 › 上限
├── pages/settings/sections.ts                 # 「運営」に2つ足す
├── pages/settings/billing.tsx・account-new.tsx・account-home.tsx・landing.tsx・legal-commerce.tsx・terms.tsx  # 料金と無料体験の文言
├── pages/threads-complete.tsx                 # 招待済みでつなげなかったときの案内
└── router.tsx                                 # /settings/tester-invites・/settings/limits

apps/api/wrangler.toml                          # staging：THREADS_CONNECT_METHODS を消す（両方）、THREADS_APP_ID、STRIPE_PRICE_ID
docs/environment-switches.md・external-services-setup.md（Stripe 10-2、Meta 3-3・9-8、本番用のMetaアプリ）
docs/user-guide.md・architecture.md・ui-design.md・threads-token-guide.md・release-runbook.md
.specify/memory/constitution.md（4.4.0）・_bmad-output/.../prd-threads-grower-app.md（FR-12）
```

**構成の判断**：
- 申し込みの読み書きは`tester-application-service.ts`だけに置く。
- 上限の読み書きは`limit-service.ts`だけに置く。
- 接続との結び付きは`completeConnection`の中の1か所にする（OAuthとトークンの両方がここを通る。010 research.md R5）。
- 画面は`/api/me`と各APIの値を出すだけで、自分では判定しない。

## 複雑さの記録（Complexity Tracking）

Constitutionの違反はないので、記録はない（4.4.0の改定で、無料体験をなくしたことを原則I・IVに反映した）。
