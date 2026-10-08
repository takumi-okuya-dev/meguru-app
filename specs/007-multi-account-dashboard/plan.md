# 実装計画（Implementation Plan）：マルチアカウント・ダッシュボード

**ブランチ**：`feature/007-multi-account-dashboard` | **日付**：2026-10-08 | **仕様**：[spec.md](./spec.md) | **画面イメージ**：[PC](../../docs/mockups/007-account-switcher-desktop.png)・[スマートフォン](../../docs/mockups/007-account-switcher-mobile.png)

**入力**：`specs/007-multi-account-dashboard/spec.md` の機能仕様

## 概要（Summary）

既存のアカウント切り替えメニューに、所有する全Accountの「要確認 N件」を表示する。専用画面や新しい保存項目は作らない。件数は認証済みユーザーの所有Accountについて1回の集計で読む独立したAPIから取得する。`GET /api/me` とは分離し、件数が取れない場合も切り替えを使えるようにする（[research.md](./research.md) R1・R2）。メニューを開くたびに一覧と件数を更新し、読込中・取得失敗・0件を区別する（R3）。PC・スマートフォンの既存のメニュー操作と、要再接続・表示中の印を保つ（R4）。

## 技術コンテキスト（Technical Context）

**言語・バージョン**：TypeScript 6.0。開発環境はNode.js 22以上。既存のモノレポに合わせる。

**主な依存**：APIはHono・Drizzle、WebはReact 19・TanStack Query・Radix UI・Tailwind CSS・Zod。新しいパッケージは足さない。

**ストレージ**：既存のNeon（Postgres）にある `memberships`・`accounts`・`post_drafts` を読む。新しい列・テーブル・マイグレーション・KVキーなし（[data-model.md](./data-model.md)）。

**テスト**：APIは既存のVitest結合テストとローカルPostgresを使い、所有者の境界、5・2・0件、要再接続、失敗を確認する。WebはVitest・Testing Libraryでメニューの状態と操作を確認する。実機幅・速度は[quickstart.md](./quickstart.md)で確認する。

**対象プラットフォーム**：Cloudflare WorkersのAPI、Cloudflare PagesのSPA。PC・タブレット・スマートフォンのモダンブラウザ。

**プロジェクトの種類**：既存のWebアプリ（SPA＋API）。定期処理は変更しない。

**性能目標**：3件のAccountで、メニューを開いて全件と件数が見えるまで95%以上が2秒以内（spec SC-005）。20件でも件数のHTTP呼び出しは1回とし、メニューで最後の項目まで操作できる。APIの読み取りは既存の目安のp95 500ms以内を確認する。

**制約**：固定費$0の前提を維持し、定期的なポーリングを足さない。Threads・Clerk・Stripeへの新たな呼び出しなし。アカウント一覧と件数の読み取りを分離し、件数の失敗は切り替えを止めない。チーム管理・契約変更・横断分析は含めない。

**規模・範囲**：新規API 1本、既存メニュー1箇所の拡張、共通の応答スキーマ1つ。新しい画面・URL・DB変更なし。

**技術上の未解決事項**：なし。件数の取得方法、認可、更新時点、メニューの収まりは[research.md](./research.md)で決定済み。

## Constitutionとの整合（Constitution Check）

*ゲート：Phase 0の前に確認し、Phase 1の設計後に再確認する。Constitution 2.0.0。*

| 原則・制約 | 判定 | 根拠 |
|---|---|---|
| I. 人格・トーン・NGワードの一貫性 | 合格 | 投稿の作成・公開・NGワードのチェックには触れず、既存の下書きの件数を読むだけ |
| II. 人間承認ゲート | 合格 | 承認状態の変更や公開はしない。「要確認」の件数は承認前の下書きだけを数える |
| III. 外部LLM前提・API依存ゼロ | 合格 | LLMの呼び出しやプロンプトの生成は足さない |
| IV. 契約／ロール分離 | 合格 | 所有者の範囲は既存の `Membership.role = owner` で決め、現行プランの値や契約の有無を件数・権限と結び付けない。現行の旧プランをFR-12で置き換える方針は変更しない |
| V. 個人運用起点のシンプルさ | 合格 | ユーザーが選んだ既存メニューの拡張のみ。パートナー・編集者・担当割り当て・専用ダッシュボードを作らない |
| VI. 改善フィードバックループの忠実性 | 合格 | 分析やプロンプトへの反映を変えない。006の経路を維持する |
| 技術スタック制約 | 合格 | 既存のReact・Hono・Drizzle・Postgres・Clerkの範囲。Clerk Organizationsを使わない |
| 運用コスト制約 | 合格 | メニューを開いたときだけ集計を1回読む。Accountの数だけAPIを呼ぶ方式とポーリングを避ける |
| 開発ワークフロー・ブランチ | 合格 | spec-kitの計画段階として `feature/007-multi-account-dashboard` で作業する |

**Phase 1の設計後の再確認**：`data-model.md`・`contracts/`・`quickstart.md`に新たな違反はない。集計の応答には契約状態やロールを混ぜず、他人のAccountを除く。件数の取得失敗を既存のアカウント一覧から分離するため、切り替えと原則Vの簡潔さを維持する。

## プロジェクト構成（Project Structure）

### ドキュメント（このfeature）

```text
specs/007-multi-account-dashboard/
├── spec.md                       # 機能仕様（既存）
├── plan.md                       # このファイル
├── research.md                   # Phase 0：設計判断
├── data-model.md                 # Phase 1：既存データと派生値
├── quickstart.md                 # Phase 1：確認手順
├── contracts/
│   ├── api.md                    # 全Accountの要確認件数
│   └── ui-menu.md                # 切り替えメニューの表示と操作
├── checklists/requirements.md   # 仕様品質の確認（既存）
└── tasks.md                     # Phase 2（/speckit-tasksで作る）
```

### ソースコード（リポジトリのルート）

予定する変更箇所。新規ファイルは★、既存の変更は✎。

```text
packages/shared/src/
└── ✎ schemas.ts                      # 集計の応答スキーマ・型

apps/api/src/
├── ✎ routes/me.ts                     # GET /api/me/needs-review-counts
└── services/★ account-review-counts.ts # 所有Account全件を1回で集計
apps/api/test/integration/
└── ★ needs-review-counts.test.ts     # 5・2・0件、他人の除外、削除、認証

apps/web/src/
├── ✎ lib/api-client.ts                # 集計の読み取り
├── ✎ lib/query.ts                     # 集計のクエリキー
└── components/layout/✎ AccountSwitcher.tsx # メニュー開閉時の更新、件数・失敗・再試行・スクロール
apps/web/test/
└── ★ account-switcher.test.tsx        # 件数・切り替え・取得失敗・20件・幅と操作
```

**構成の判断**：既存のAccount一覧（`/api/me`）と切り替えを再利用する。件数の集計だけを独立させ、API側で所有者の絞り込みと0件を含む集計を1回行う。Webは受け取った `accountId` で一覧に件数を対応づける。メニューを開くまで横断件数を読まず、開くたびに最新を取得する。既存の表示中のAccountの件数APIと投稿ストックは変更しない。

## 複雑さの記録（Complexity Tracking）

Constitution Checkに違反はないため、記録なし。
