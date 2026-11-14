# 実装計画（Implementation Plan）：紹介リンク

**ブランチ**：`feature/017-referral-links` | **日付**：2026-11-01 | **仕様**：[spec.md](./spec.md) | **UI全体設計**：[docs/ui-design.md](../../docs/ui-design.md)

**入力**：`specs/017-referral-links/spec.md`の機能仕様（Clarifications 2026-11-01と、仕様のあとに了承を得た6つの決定）、Constitution 4.0.1

## 概要（Summary）

利用者1人に1本の紹介リンクを持たせ、そのリンクを開いてから新しく登録した人に「誰の紹介か」を記録する。紹介した人には、紹介で登録した人数だけを見せる。特典はなく、料金・権限・テスト環境に入れるかの判定には使わない。

- **記録**：`users`に`referral_code`・`referred_by_user_id`・`referred_at`を足す（research.md R1）。
- **受け渡し**：紹介リンクの画面（`/r/:code`）で、文字列をブラウザに30日覚える。画面はAPIを呼ぶたびに見出し`X-Referral-Code`を付け、認証のミドルウェアが**利用者の行を新しく作るときだけ**読んで記録する（R3・R4）。
- **見せるもの**：設定の「紹介」に、紹介リンクと「コピー」と人数（R6・R7）。
- **テスト環境**：記録は同じ。016の判定に手を入れないので、紹介リンクだけでは入れない。紹介リンクの画面にだけ注意を出す（R5）。

## 技術コンテキスト（Technical Context）

**言語・バージョン**：TypeScript 6.0（フロントエンド・バックエンドとも）。Node.js 22 LTS。016と同じ。

**主な依存**：016と同じ。新しい依存は足さない（紹介の文字列は`crypto.getRandomValues`）。

**ストレージ**：Neon（Postgres 17）。[data-model.md](./data-model.md)のとおり、マイグレーション`0017_referral_links`の1本（`users`に列3つと索引・CHECKを足すだけ）。ブラウザの`localStorage`に紹介の文字列を30日。

**テスト**：016と同じ構成。
- API：Vitest＋`@cloudflare/vitest-pool-workers`＋ローカルのPostgres。確かめるのは次のとおり。
  - JIT作成での記録（持ち主がいる・いない・形が違う・すでに行がある・見出しなし）
  - `GET /api/me/referral`（作る・2回目は同じ・人数・名前を返さない）、`GET /api/referral-page`（ON/OFF）
  - 退会（紹介した人・された人）、テスト用のグループON（記録は残り、入れないまま）
  - CORSの見出しの許可、マイグレーション（列・UNIQUE・CHECK）
- Web：Vitest＋Testing Library。紹介リンクの画面（未ログインで覚える・ログイン中は移る・ONの注意・名前を出さない）、設定の「紹介」（コピー・人数）、APIクライアント（見出しを付ける・30日で捨てる・`me`の成功で消す）
- E2E：足さない

**対象プラットフォーム**：Web＝Cloudflare Pages、API＝Cloudflare Workers（無料プラン）。Cronは足さない。

**プロジェクトの種類**：Webアプリ（`apps/web`・`apps/api`・`packages/shared`のpnpmモノレポ）

**性能の目標**：
- 認証のミドルウェアの問い合わせは、すでに行がある人では増やさない（見出しは行を作るときだけ読む）
- 行を作るときは、紹介の文字列の持ち主を1回引くだけ（UNIQUEの索引）

**制約**：
- 紹介の記録を、料金・使える状態・権限・テスト環境に入れるかの判定に使わない（FR-008）
- 紹介された人が誰かわかる情報を、紹介した人に返さない（FR-007）
- OFF/ONどちらの環境でも、001〜016の振る舞い・E2Eが変わらない
- 定数：紹介の文字列の形`r_`＋22文字、覚えておく期間30日

**規模**：利用者は数十〜数百人。紹介は1人あたり数人。

## Constitution Check

*GATE：Phase 0の前に確かめ、Phase 1の後にもう一度確かめた。Constitution 4.0.1。*

| 原則 | 確かめたこと | 結果 |
|---|---|---|
| I. NGワードの一貫性 | 変更なし | 合格 |
| II.人間承認ゲート | 変更なし | 合格 |
| III.外部LLM前提 | 変更なし | 合格 |
| IV.契約／ロール分離 | 紹介は契約にもロールにも関わらない。特典なし（FR-008） | 合格 |
| V.個人運用起点のシンプルさ | 列を3つ足すだけで、記録は行を作る1か所。普段の画面には何も足さない（設定の項目を1つ足すだけ） | 合格 |
| VI.改善フィードバック | 変更なし | 合格 |
| 技術スタック・運用コスト | 新しい依存・サービス・Cronを足さない | 合格 |
| 開発ワークフロー | spec-kitの順。`feature/017-referral-links`→`develop`。マイグレーションは足すだけ。環境ごとの設定は足さない（テスト環境での扱いは016の設定を読むだけ） | 合格 |

Phase 1の後の確認：data-model・contractsに、原則に反するものはない。Constitutionの改定は要らない。

## プロジェクトの構成（Project Structure）

### 文書（このfeature）

```text
specs/017-referral-links/
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
├── schemas.ts         # referralResponse・referralPage
└── limits.ts          # REFERRAL_REMEMBER_DAYS（30）

apps/api/
├── drizzle/0017_referral_links.sql
├── src/db/schema.ts                      # users.referral_code・referred_by_user_id・referred_at
├── src/app.ts                            # CORSの allowHeaders に X-Referral-Code、ルートの登録
├── src/middleware/auth.ts                # JIT作成のときだけ X-Referral-Code を読む
├── src/routes/referrals.ts               # 新規：GET /api/me/referral・GET /api/referral-page
├── src/services/referral-service.ts      # 新規：文字列を作る・持ち主を引く・人数
└── test/                                 # 017のテスト、マイグレーション0017

apps/web/src/
├── pages/referral-landing.tsx            # 新規：/r/:code
├── pages/settings/referral.tsx           # 新規：設定 › 紹介
├── pages/settings/sections.ts            # 「個人設定」に「紹介」
├── lib/referral-store.ts                 # 新規：localStorage の読み書き（30日）
├── lib/api-client.ts                     # 見出しを付ける、me の成功で消す、新しいAPI
└── router.tsx                            # /r/:code、/settings/referral
```

**構成の判断**：紹介の読み書きは`referral-service.ts`に置き、認証のミドルウェアからは「文字列から持ち主のIDを引く」関数だけを呼ぶ。ブラウザに覚える処理は`referral-store.ts`の1か所にし、紹介リンクの画面とAPIクライアントの両方がそれを使う。

## 複雑さの記録（Complexity Tracking）

Constitutionの違反はないので、記録はない。
