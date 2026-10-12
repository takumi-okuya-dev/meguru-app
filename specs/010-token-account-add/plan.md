# 実装計画（Implementation Plan）：自分のMetaアプリのトークンでアカウントを追加

**ブランチ**：`feature/010-token-account-add` | **日付**：2026-10-10 | **仕様**：[spec.md](./spec.md) | **UI全体設計**：[docs/ui-design.md](../../docs/ui-design.md)

**入力**：`specs/010-token-account-add/spec.md`の機能仕様（Clarifications 2026-10-10を含む）

## 概要（Summary）

利用者が自分のMetaアプリで作った長期トークンを貼り付けて、Threadsアカウントを追加・接続し直せるようにする。001の「このアプリの接続」（OAuth）と同じAccount・接続情報・日次の延長・自動投稿の仕組みに乗せ、違いは「トークンの受け取り方」と「確かめ方」だけにする。

- **受け取りと確かめ**：`POST /api/threads/token-connect`。形の確認 → 失敗の待ちの判定 → プロフィール → `debug_token`（トークン自身で調べて、期限・権限・有効かを読む。読めなければ60日とみなし、2時間後に確かめ直す）→ 投稿の権限（005と同じ）→ 反応数の権限（006と同じ）（research.md R1〜R4）。
- **確定**：001の`completeConnection`を「接続の入力」（OAuthのstateか、トークンの要求か）を受け取る形に広げ、同じトランザクションで作成・更新・接続し直しを行う（R5）。
- **二重登録の防止**：ユーザーIDに加え、正規化したユーザー名で照合する。ユーザー名ごとのアドバイザリーロックを足し、ユーザー名だけが一致したら、先にその相手のプロフィールを取り直す（R6）。OAuthの追加・接続し直しにも同じ照合を使う。
- **接続の方法**：`accounts.connection_method`（`app`／`token`）。接続し直しで変わる。ユーザーIDが変わったら更新する（R7）。
- **2時間後の確かめ直し**：`threads_connections.recheck_at`。5分ごとの定期処理の関所（005 R3）の「次に見る時刻」の候補に足し、用のない回はDBに触れないまま（R8）。
- **失敗の待ち**：`token_check_failures`に失敗の時刻を残し、10分に5回で10分止める（R9）。
- **画面**：追加の画面の折りたたみ、接続し直しのダイアログ（2つの方法）、設定の「今の接続」、公開の利用規約`/terms`と詳しい手順`/guide/threads-token`（R10・R11、[contracts/ui-routes.md](./contracts/ui-routes.md)）。
- **文書の番号**：Constitution 3.0.1（PATCH）、008の文書、PRD §6.1の「009（決済）」→「011（決済）」（R12）。

## 技術コンテキスト（Technical Context）

**言語・バージョン**：TypeScript 6.0（フロントエンド・バックエンドとも）。開発ツールはNode.js 22 LTS。001〜009と同じ。

**主な依存**：001〜009と同じ。新しい依存は足さない。

**ストレージ**：Neon（Postgres 17）。[data-model.md](./data-model.md)のとおり。
- 列挙型`connection_method`（`app`・`token`）を新しく作る
- 列を足す：`accounts.connection_method`、`threads_connections.recheck_at`
- 表を足す：`token_check_failures`
- 索引を足す：`accounts`の正規化したユーザー名（一意にはしない。R6）
- マイグレーション`0011_token_connect.sql`の1本。Workers KVは既存の`AUTOPOST_KV`の関所だけを使う

**テスト**：009と同じ構成。
- 共通：Vitest（トークンの形の判定、ユーザー名の正規化）
- API：Vitest＋`@cloudflare/vitest-pool-workers`＋ローカルのPostgres。偽のThreadsに`debug_token`と、任意のトークンでの`/me`を足す（R13）。二重登録の3通り（SC-003）、平文を出さないこと（SC-004）、方法の切り替えでデータが残ること（SC-005）、延長（SC-006）、待ち（FR-015）、確かめ直し（FR-012）、役割の表（008 `permissions-matrix.test.ts`に新しいルートを足す）
- Web：Vitest＋Testing Library。個人運用の追加の画面が、開かなければ変わらないこと（SC-007）
- E2E：Playwrightで、偽のThreadsのトークンを貼って追加し、接続し直しで方法を切り替える（`pnpm e2e -- token`）

**対象プラットフォーム**：
- Web：Cloudflare Pages
- API：Cloudflare Workers（無料プラン）。Cronは足さない（既存の5分ごとと日次）

**プロジェクトの種類**：Webアプリ（`apps/web`・`apps/api`・`packages/shared`のpnpmモノレポ）

**性能の目標**：トークンの確認は、Threadsへの問い合わせがふつう4回（プロフィール・debug_token・投稿の上限・フォロワー数）、ユーザー名だけが一致したときは相手のプロフィールの取り直しを足して5回で、ふつう3秒以内に結果を返す（SC-001の2分に十分な余裕）。

**制約**：
- トークンの平文は、受け取ったリクエストの処理の中だけで持ち、暗号化して保存した後は画面・ログ・エラー・記録・書き出しに出さない（001 FR-010、FR-043）。ログの出し方は001と同じく、トークンを含む値を書かない
- Neonの無料枠：5分ごとの定期処理は、確かめ直しが近いときだけDBに触れる（R8）
- 定数：`TOKEN_CHECK_FAILURE_LIMIT = 5`、`TOKEN_CHECK_WINDOW_MINUTES = 10`、`TOKEN_CHECK_LOCK_MINUTES = 10`、`TOKEN_RECHECK_DELAY_MINUTES = 120`、`TOKEN_MIN_LIFETIME_HOURS = 48`（これより短い期限は短期トークンとみなす）、`TOKEN_ASSUMED_LIFETIME_DAYS = 60`、トークンの長さ`32〜2048`文字

**規模**：Accountの数・問い合わせの回数は001と同じ桁。追加の操作は1人につき数回。

## Constitution Check

*GATE：Phase 0の前に確かめ、Phase 1の後にもう一度確かめた。*

| 原則 | 確かめたこと | 結果 |
|---|---|---|
| I. NGワードの一貫性 | トークンでの接続のAccountも、自動投稿は005の同じ処理（NGワードの確認を含む）を通る。接続の方法で分ける分岐を投稿の処理に入れない（FR-042） | 合格 |
| II.人間承認ゲート | 承認済みの案だけを投稿するのは変わらない。接続の方法は承認に関わらない | 合格 |
| III.外部LLM前提 | LLMは使わない | 合格 |
| IV.契約／ロール分離 | 接続の方法はAccountの属性で、契約にもロールにも混ぜない。トークンの追加・接続し直しはオーナーだけ（008の`owner`権限） | 合格 |
| V.個人運用起点のシンプルさ | 追加の画面は、2つ目の方法を開かなければ今までと同じ（SC-007）。接続し直しのダイアログは2つの選択だけ。判定は`authorizeAccount`を通す。決済の番号の記述だけを直す（3.0.1） | 合格 |
| VI.改善フィードバック | 変更なし | 合格 |
| 技術スタック・運用コスト | 新しい依存・有料のサービスを足さない。KVの関所を保つ | 合格 |
| 開発ワークフロー | spec-kitの順。`main`＋`feature/*`のまま（公開時の3段構成は011の後） | 合格 |

Phase 1の後の確認：data-model・contractsに、原則に反するものはない。001 FR-008の「貼り付けは提供しない」を改めるのは、specのFR-004で明示した変更で、Constitutionに関わらない。

## プロジェクトの構成（Project Structure）

### 文書（このfeature）

```text
specs/010-token-account-add/
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
├── limits.ts                     # 定数を足す
├── token.ts                      # 新規：トークンの形の判定・前後の取り除き
├── schemas.ts                    # token-connect の要求・応答、Accountの connectionMethod
└── errors.ts                     # TOKEN_INVALID・TOKEN_SHORT_LIVED・TOKEN_CHECK_LOCKED・ACCOUNT_ALREADY_REGISTERED と文言

apps/api/
├── drizzle/0011_token_connect.sql
├── src/db/schema.ts              # connection_method・recheck_at・token_check_failures・索引
├── src/db/locks.ts               # lockThreadsUsername を足す
├── src/lib/threads-client.ts     # debugToken を足す
├── src/routes/threads-connect.ts # POST /api/threads/token-connect、callback の照合を広げる
├── src/services/
│   ├── token-connect.ts          # 新規：確かめる手順（R1〜R4・R9）
│   ├── account-service.ts        # completeConnection を接続の入力で広げる（R5〜R7）
│   ├── token-recheck.ts          # 新規：2時間後の確かめ直し（R8）
│   ├── auto-post-runner.ts       # 関所の候補に recheck_at を足し、確かめ直しを呼ぶ
│   ├── daily-jobs.ts             # 古い失敗の記録を消す
│   └── activity-log.ts           # threads_reconnected を足す（どちらの方法でも）
└── test/fake-threads/            # debug_token・貼り付け用のトークンを足す

apps/web/src/
├── components/connect/
│   ├── TokenConnectForm.tsx      # 新規：手順・入力欄・説明・送信（追加と接続し直しで共用）
│   └── ReconnectDialog.tsx       # 新規：2つの方法を選ぶ
├── components/ReconnectButton.tsx # ダイアログを開く形に変える
├── pages/account-new.tsx         # 2つ目の方法の折りたたみ
├── pages/account-settings.tsx    # 「今の接続」と、ダイアログ
├── pages/terms.tsx               # 新規：利用規約
├── pages/guide-threads-token.tsx # 新規：トークンの作り方の詳しい手順
├── pages/activity.tsx            # threads_reconnected の文言
└── router.tsx                    # /terms・/guide/threads-token（ログイン不要）

e2e/tests/token.spec.ts           # 新規
docs/threads-token-guide.md       # 新規：運営者向けの説明（画面の手順の元・Metaの画面が変わったときの直し方）
```

**構成の判断**：001〜009と同じモノレポ。OAuthと共通の部分（Account・接続の書き込み・延長・投稿）は今の場所に置いたまま、トークンに固有の確かめ方だけを`token-connect.ts`に分ける。

## 複雑さの記録（Complexity Tracking）

Constitutionの違反はないので、記録はない。
