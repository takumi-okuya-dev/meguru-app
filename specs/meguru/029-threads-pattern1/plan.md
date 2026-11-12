# 実装計画（Implementation Plan）：Threadsをパターン①にそろえる（2作目より前に）

**ブランチ**：`feature/meguru-029-threads-pattern1` | **日付**：2026-11-12 | **仕様**：[spec.md](./spec.md)

**入力**：`specs/meguru/029-threads-pattern1/spec.md`（Clarifications 2026-11-12を含む）、Constitution 4.9.0（この計画の確認で改めた。T000）、[docs/app-separation.md](../../../docs/app-separation.md)、[docs/module-map.md](../../../docs/module-map.md)

## 概要（Summary）

Threadsアプリ（今はパターン②）を、2作目より前にパターン①にそろえる。Threadsの表をすべてスキーマ`threads`に移し、共通との外部キーを外す。共通とのやりとりを、共通の入口の関数（利用権をまとめて読む・利用の数を伝えるなど）と出来事（送り出しの表と5分ごとの定期処理）だけにする。ThreadsのAPIを`/api/threads/…`に、Webの呼び出しを`apps/threads/`にそろえる。利用者から見える動き・画面・料金は変えず、テスト環境のデータは移し替えて残す。

- **持ち主の移動**：`accounts`・`memberships`・チームの3表・`activity_logs`と、権限の判定・アカウント・チーム・活動の記録の処理を、共通からThreadsへ移す（[research.md](./research.md) R1）。
- **置き場所**：`ALTER TABLE … SET SCHEMA threads`で31表を移す。データの写しは要らない（R2）。
- **共通の土台**：入口の関数（`currentUser`・`loadEntitlement(s)`・`peopleNames`・`reportUsage`）、出来事（`platform_events`・届け先ごとの状態・すぐに届ける＋5分ごとのやり直し・2回届いても同じ）、利用の数（`app_usage`）、機能と上限の「アプリ・名前」化（R4〜R7、[contracts/platform-entry.md](./contracts/platform-entry.md)）。
- **知らせの置き換え**：5種類を、Threadsの中の処理と出来事`user.withdrawn`・`limits.changed`に置き換え、`platform/hooks.ts`を消す（R8）。
- **APIとWeb**：`/api/me`を共通の分だけにし、`/api/threads/me`を足す。約110本の道筋を`/api/threads/…`へ。古い道筋は画面が移るまで残す（R9・R10、[contracts/api-routes.md](./contracts/api-routes.md)）。
- **進め方**：5つのPR（共通の土台 → 持ち主の移動（コード）→ 置き場所の移動（DB）→ 道筋とWeb → 片づけ）。テスト環境での確かめはPR3とPR5のあと（R12、[quickstart.md](./quickstart.md)）。

## 技術コンテキスト（Technical Context）

**言語・バージョン**：TypeScript 6.0。Node.js 22 LTS。028と同じ。

**主な依存**：028と同じ（Hono・Drizzle ORM・drizzle-kit・`@neondatabase/serverless`・React・TanStack Query・Zod・Clerk・Stripe）。新しい依存は足さない。Cloudflare Queuesは使わない（Clarifications）。

**ストレージ**：Neon（Postgres 17）。同じDBの中に、スキーマ`threads`を足す。新しい表：共通5（`platform_events`・`platform_event_deliveries`・`app_usage`・`user_app_limits`・`app_limit_defaults`）、Threads2（`settings`・`received_events`）。マイグレーションは4本（PR1・PR2・PR3・PR5。[data-model.md](./data-model.md) 5）。

**テスト**：
- 今あるテスト（共通517件・Web 803件・API 1,285件・E2E 19件）を、期待する結果を変えずに通す。道筋・読みこみ先・モックの場所だけを直す。
- 足すテスト：
  - 利用権：今の判定と同じ結果になる（8つの状態）。まとめて読んでも1人ずつと同じ
  - 出来事：同じトランザクションで書く・すぐ届く・やり直し・10回で`failed`・2回届いても同じ
  - 利用の数：数が変わったら`quantity_sync_needed`が付く・料金が今と同じ・毎日の数え直し
  - 退会：すぐ終わり、出来事でThreadsのデータが今と同じ範囲で消える
  - マイグレーション：PR1（写し）・PR3（31表の件数と中身・外部キー0本）・PR5（列の削除）
  - ESLintの規則：アプリ → 共通の表、共通 → アプリの表を止める
  - `/api/threads/me`：今の`/api/me`のThreadsの部分と同じ値
- **E2E**：足さない（今の19件を、道筋が変わったあとも通す）。

**対象プラットフォーム**：Web＝Cloudflare Pages、API＝Cloudflare Workers（1つのまま）。定期処理は今の2つ（毎日18:00 UTC・5分ごと）のまま。5分ごとの最初に、出来事の届け直しを足す。

**プロジェクトの種類**：Webアプリ（`apps/web`・`apps/api`・`packages/shared`のpnpmモノレポ）。

**性能の目標**：利用者から見て変えない。定期処理は、持ち主の利用権を読む問い合わせが1回増える（R4）。出来事は、ふだんは書いた直後（数秒）、遅くても10分以内に届く。

**制約**：
- **動きを変えない**：画面・応答・料金・データ（spec FR-021・FR-022）。
- **データを残す**：テスト環境のデータは移し替えて残す。置き場所の移動は`SET SCHEMA`で行い、表を消して作らない（R2）。
- **前の版との組み合わせ**：PR1・PR2・PR4は、前の版のAPIでも壊れないマイグレーションだけにする。壊れるのはPR3（置き場所）とPR5（列の削除）だけで、テスト環境だけで受け入れる例外にする（spec FR-019）。本番を立てたあとに、同じ進め方をしない。
- **並行するセッション**：このfeatureの間、人物管理・集金管理は仕様と計画だけ、Threadsの改善は止める（Clarifications）。共通の変更とぶつからない。
- **各コミットで全部通る**：型の確認・ESLint・テストを、PRの中のコミットごとに通す。

**規模**：共通からThreadsへ移すファイル約20（`accounts/`・`teams/`・`access/`・`activity/`）、Threadsの中で共通の部品の読み方を直すファイル約50、新しいファイル（出来事・利用権・利用の数・登録・`/api/threads/me`）約15、Webで`useThreadsMe`に替えるファイル11と、呼び出しの移動（`api-client.ts`・`query.ts`の大半）、テストのモックの直し約60、マイグレーション4本。

## Constitution Check

*GATE：Phase 0の前に確かめ、Phase 1の後にもう一度確かめた。Constitution 4.8.1 → /speckit-analyze のあと 4.9.0。*

| 原則 | 確かめたこと | 結果 |
|---|---|---|
| I. NGワードの一貫性 | 投稿の処理は場所と読み方が変わるだけで、NGワードのチェックの経路は変えない。自動投稿の候補の絞り方（利用権）を替えるが、NGワードは公開の直前に今のまま確かめる | 合格 |
| II. 人間承認ゲート | 承認の処理は場所が変わるだけ | 合格 |
| III. 外部LLM前提 | 変更なし | 合格 |
| IV. 契約／ロール分離 | 契約（共通の`subscriptions`・`app_usage`）とロール（Threadsの`memberships`・チーム・権限の判定）が、モジュールの境目で分かれ、より明確になる。料金の数え方（アカウント1件につき同じ額）は変えない。利用権の判定（契約中・料金なし・024の前の無料体験）は、今と同じ結果になることをテストで確かめる | 合格 |
| V. 個人運用起点のシンプルさ | 利用者から見える変化はない。出来事・利用の数・機能と上限の登録は新しい仕組みだが、2作目・3作目で同じものを使うための最小限（Queuesを使わない・写しの表を持たない・画面を作らない）。複雑さの記録に書く | 合格（複雑さの記録あり） |
| VI. 改善フィードバック | 数字の取得の処理は場所と読み方が変わるだけ | 合格 |
| 技術スタック・運用コスト | 新しい依存・サービスなし。同じWorker・同じNeon。定期処理の回数も変えない | 合格 |
| 技術スタック制約「アプリのデータの分け方」 | 「Threadsはパターン②のまま」と書いてあったので、作り始める前（PR1の最初。T000）に「Threadsは029でパターン①にそろえる。そろえ終えるまでは途中の形を認める。チームはThreadsの機能」と改めた（MINOR：4.9.0、2026-11-12）。PR5で「そろえた」に直す（PATCH：4.9.1。T065） | 合格（改定済み） |
| 開発ワークフロー | spec-kitの順。`specs/meguru/029-…`、ブランチ`feature/meguru-029-…`→`develop`。PRは下書き → セルフレビュー → コードを変えたPRはCI → Codex | 合格 |

**Phase 1の後の確認**：data-model・contractsに、原則に反するものはない。マイグレーションの決まり（[release-runbook.md](../../../docs/release-runbook.md) 3）からの例外（PR3・PR5）は、本番がない今だけのものとして、spec・data-model・quickstartに書いた。

## プロジェクトの構成（Project Structure）

### 文書（このfeature）

```text
specs/meguru/029-threads-pattern1/
├── spec.md
├── plan.md              # この文書
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   ├── platform-entry.md      # 共通の入口の関数・出来事・利用の数
│   ├── api-routes.md          # APIの道筋と /api/me の分け方
│   └── module-boundaries.md   # 境界の規則の変更
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks で作る
```

### ソースコード（あと）

```text
apps/api/src/
├── app.ts                        # 組み立て：registerAppFeatures・registerAppLimits・registerConsumer（registerThreads を置き換え）
├── index.ts                      # 5分ごとの最初に deliverPendingEvents
├── db/schema.ts                  # 共通とThreadsの表を読み直して出す（今のまま）
├── kernel/
│   └── invite-token.ts           # 新：招待のトークンの部品（teams/invite-service から移す）
├── platform/
│   ├── index.ts                  # 入口の関数と型だけを出す（表の定義・SQLの部品を出さない）
│   ├── schema.ts                 # 共通の11表＋新しい5表
│   ├── events/                   # 新：emitEvent・registerConsumer・deliverPendingEvents
│   ├── usage/                    # 新：reportUsage・app_usage を読む
│   ├── entitlement/              # 新：loadEntitlement(s)（billing・features・operator・test-groups の判定をまとめる）
│   ├── registry/                 # 新：registerAppFeatures・registerAppLimits
│   ├── identity/・billing/・features/・operator/・test-groups/・referrals/・withdrawal/
│   └── （accounts/・teams/・access/・activity/・hooks.ts は消える）
└── apps/threads/
    ├── index.ts                  # 組み立てが使うもの（APIの入口・受け取り・機能と上限の名前）
    ├── schema.ts                 # pgSchema("threads")：31表＋settings・received_events
    ├── accounts/                 # 新（共通から）：アカウント・メンバー・数・上限・最後に開いたアカウント
    ├── access/                   # 新（共通から）：authorizeAccount
    ├── teams/                    # 新（共通から）：チーム・招待・運用状況
    ├── activity/                 # 新（共通から）：活動の記録
    ├── me/                       # 新：/api/threads/me・withdrawal-preview
    ├── events/                   # 新：onUserWithdrawn・onLimitsChanged・markReceived
    └── connection/・strategy/・drafts/・publish/・metrics/・mention/・external-media/・tester-invites/・operator/

apps/web/src/
├── lib/api-client.ts・query.ts   # 共通のAPIだけ
├── shell/app-module.ts           # withdrawalPreview を足す
└── apps/threads/lib/
    ├── api.ts                    # 新：ThreadsのAPIの呼び出し（/api/threads/…）
    ├── query-keys.ts             # 新：Threadsのキャッシュのキー
    └── use-threads-me.ts         # 新：/api/threads/me

packages/shared/src/
├── schemas.ts                    # meResponseSchema を共通の分だけに（PR5）
└── apps/threads/                 # 新：threadsMeResponseSchema・FEATURES（Threadsの名前）

eslint-rules/module-boundaries.js # アプリ → 共通の表、共通 → アプリの表を止める
```

**構成の判断**：
- 共通の表は`public`のまま、Threadsだけをスキーマ`threads`に移す（R2）。
- 定期処理は、SQLのJOINをやめ、利用権をまとめて読む（R4）。利用権の写しの表は持たない。
- 出来事はQueuesを使わず、送り出しの表と5分ごとの定期処理（R5）。
- 退会の前の確かめは、外枠がアプリを読まないよう、`AppModule`の項目で渡す（R10）。

## 複雑さの記録（Complexity Tracking）

| 違反・複雑さ | 必要な理由 | もっと簡単な案を取らない理由 |
|---|---|---|
| 出来事の仕組み（送り出しの表・届け先ごとの状態・やり直し） | 共通とアプリがトランザクションをまたがずに、退会などを確実にアプリへ伝えるため（spec FR-009・FR-010） | 今の同じトランザクションの知らせはパターン②そのもの。Queuesは新しい仕組みと設定が要る（Clarificationsで否決） |
| 利用の数（`app_usage`）と`reportUsage` | 共通が料金の数をアプリの表を読まずに知るため（spec FR-011） | 共通がThreadsを呼ぶと、向きの違反になる |
| 機能と上限の「アプリ・名前」化（列と表の追加・登録） | 共通のコードからThreadsの名前を消し、2作目も同じ仕組みを使うため（spec FR-012） | 今の列のまま共通にThreadsの名前を書き続けると、2作目ごとに共通を直すことになる |
| 古い道筋と`/api/me`の今の形を、PR4〜PR5の間だけ残す | APIが画面より先にデプロイされるため、前の画面を壊さない | 一度に消すと、デプロイの間に画面が壊れる |
| テスト環境だけのマイグレーションの例外（PR3・PR5） | 置き場所の移動は、前の版と両立させるには表の写し（ビュー）が要り、手間が大きい | 本番がない今なら、数分の失敗をテスト環境で受け入れるほうが簡単で安全。本番のあとには使わない |
