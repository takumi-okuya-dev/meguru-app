# 実装計画（Implementation Plan）：めぐるの外枠とWebの分割

**ブランチ**：`feature/028-meguru-shell` | **日付**：2026-11-12 | **仕様**：[spec.md](./spec.md)

**入力**：`specs/028-meguru-shell/spec.md`（Clarifications 2026-11-12を含む）、Constitution 4.5.0、[docs/product-structure.md](../../docs/product-structure.md) §5〜§7、[docs/module-map.md](../../docs/module-map.md)、specs/027

## 概要（Summary）

Webのコード（`apps/web/src`）を、外枠（`shell/`）・Threadsアプリ（`apps/threads/`）・共通の部品（今の`components/`・`lib/`）・組み立て（`main.tsx`・`router.tsx`・`app-registry.ts`）に分け、ESLintの規則で境界を守る。Threadsの画面を`/threads`の下に移し、前のURLは転送する。すべてのアプリの画面（`/apps`）・アプリの切り替え・最後に使ったアプリから始まる入口を作る。アプリが1本の人（今の利用者全員）には、URLのほかは今と同じ画面を出す。

- **分け方**：外枠はアプリを読まない。各アプリは`AppModule`（ルート・設定の項目・前のURLの対応）を1つ出し、組み立てが一覧にして外枠に渡す。サイドバーの中身は、アプリの画面の枠が外枠の骨格に渡す（[research.md](./research.md) R1・R3、[data-model.md](./data-model.md) 4・6）。
- **境界のチェック**：`eslint-rules/web-module-boundaries.js`。`@/`の別名も見て、7つの型の違反を止める（[contracts/web-module-boundaries.md](./contracts/web-module-boundaries.md)）。
- **URL**：`/accounts/*`・`/teams/*` → `/threads/…`。転送は画面の側で、ログインの関所の外で行う。公開ページ・`/threads/complete`・`/settings`のURLは変えない（R4・R5、[contracts/ui-routes.md](./contracts/ui-routes.md)）。
- **判断はAPIに**：使っているアプリ・最後に使ったアプリ・入口の行き先を`/api/me`の`apps`で返し、`PUT /api/me/last-app`で覚える（`users.last_app_id`）。アプリの一覧は`@meguru/shared`の`APP_CATALOG`（R6・R7・R14、[contracts/api.md](./contracts/api.md)）。
- **PRは3つ**：PR1 フォルダーの分割と規則（URLは変えない）→ PR2 URLの移動と転送 → PR3 すべてのアプリ・切り替え・最後に使ったアプリ・文書（R15）。

## 技術コンテキスト（Technical Context）

**言語・バージョン**：TypeScript 6.0。Node.js 22 LTS。027と同じ。

**主な依存**：027と同じ（React 19・React Router 8・TanStack Query 5・Clerk・shadcn/ui・Hono・Drizzle）。新しい依存は足さない。

**ストレージ**：Neon（Postgres 17）。`users`に`last_app_id`（text・null可）を足すマイグレーション`0025`を1つだけ作る（PR3）。

**テスト**：
- 今あるテスト（共有・Web・API・E2E）を、URLと読みこみ先のほかは中身を変えずに通す。
- 足すテスト：
  - ESLintの規則のテスト（`node --test`）：7つの違反の型・通る例・仮のアプリのフォルダー・`@/`と相対パス
  - Web：前のURLの転送（クエリと`#`を保つ・履歴の置き換え・ログインなし）、入口の振り分け（`landing`あり・なし）、`/threads`のホーム、すべてのアプリの画面、ユーザーメニューの「すべてのアプリ」、アプリが1本の人に切り替えが出ないこと、仮のアプリでの切り替えと`PUT /api/me/last-app`、Threadsから入る道（紹介・招待）
  - API：`/api/me`の`apps`、`PUT /api/me/last-app`、作るURLの3か所、APIの入口の一覧
- **E2E**：今のテストのURLを直す（11ファイル）。前のURLの転送を1つ足す。

**対象プラットフォーム**：Web＝Cloudflare Pages、API＝Cloudflare Workers（デプロイの単位は変えない）。

**プロジェクトの種類**：Webアプリ（`apps/web`・`apps/api`・`packages/shared`・`e2e`のpnpmモノレポ）。主に触るのは`apps/web`。APIは`/api/me`・`last-app`・作るURL・マイグレーションだけ。

**性能の目標**：変えない。入口の振り分けは今と同じく`/api/me`を1回読むだけ。`PUT /api/me/last-app`はアプリが変わったときだけ（今の利用者は最初の1回だけ）。

**制約**：
- **動きを変えない**（spec FR-005・FR-006）：アプリが1本の人のサイドバー・画面・操作、機能のON/OFF・契約・チーム・テスト版の関所。
- **Metaに登録・配ったURLを変えない**（FR-003）：`/threads/complete`・`/data-deletion/:code`・`/guide/threads-token`・`/invite/:token`・`/test-invite/:token`・`/r/:code`・`/terms`・`/legal/commerce`。
- **小さく安全に動かす**：PR1のファイルの移動は`git mv`で、読みこみ先の直しは機械的に行う。中身を変えるのは、サイドバーの枠と中身の切り分け・`guards`と`FeatureUnavailable`の切り分け・設定の項目の混ぜ方だけ（`api-client`は分けない。data-model.md 6-6）。
- **各PRで全部通り、Threadsをリリースできる**（§6の決まり）。
- **モバイル化を見込む**（2026-11-12）：判断はAPIと`@meguru/shared`に置く（R14）。

**規模**：Webの移動するファイル約170（ソース199のうち）、Webのテストの読みこみ先の直し約84ファイル、画面の中のURLの直し約29ファイル、新しいファイル（外枠の画面・登録・規則・アプリの一覧）約15、APIの変更約6ファイル。

## Constitution Check

*GATE：Phase 0の前に確かめ、Phase 1の後にもう一度確かめた。Constitution 4.5.0。*

| 原則 | 確かめたこと | 結果 |
|---|---|---|
| I. NGワードの一貫性 | 投稿の処理は変えない（Webの画面の置き場所とURLが変わるだけ） | 合格 |
| II. 人間承認ゲート | 確かめる・承認の画面と処理は変えない | 合格 |
| III. 外部LLM前提 | 変更なし | 合格 |
| IV. 契約／ロール分離 | 契約前の画面・読むだけの制限・チームのロールの判定は、今と同じ場所・同じ条件。すべてのアプリの画面は料金の文言を出すだけで、契約の判定を持たない。最後に使ったアプリは契約ともロールとも別の値 | 合格 |
| V. 個人運用起点のシンプルさ | アプリが1本の人（個人運用を含む全員）には、アプリの切り替えを出さず、画面の項目と操作を増やさない（ユーザーメニューに「すべてのアプリ」が1行増えるだけ）。利用権・workspaces・作りかけのアプリの一部公開は作らない（R6・R7） | 合格 |
| VI. 改善フィードバック | 変更なし | 合格 |
| 技術スタック・運用コスト | 新しい依存・サービスを足さない。React＋Vite（Pages）・Workers＋Hono・Neon＋Drizzle・Clerk（ログインだけ）・shadcn/uiのまま。見た目はChatGPT風のまま | 合格 |
| 技術スタック：APIのモジュール構成 | `/api/me`と`last-app`は共通（platform/identity）に置く。共通からThreadsを読まない（使っているかの判定は共通の表だけで決める。R6） | 合格 |
| 開発ワークフロー | spec-kitの順。`feature/028-meguru-shell`→`develop`。Webのモジュールの決まりと、2作目以降のアプリはモバイル化を見込んで技術を選ぶ決まりを、技術スタック制約に書き足す（spec FR-021）。Constitutionを**4.6.0（MINOR）**に改める（PR3、`/speckit-constitution`の手順で） | 合格（改定を伴う） |

**Phase 1の後の確認**：data-model・contractsに、原則に反するものはない。Constitutionへの書き足しは、Webの構成と技術の選び方の決まりを記録するもので、原則I〜VIを変えない。

## プロジェクトの構成（Project Structure）

### 文書（このfeature）

```text
specs/028-meguru-shell/
├── spec.md
├── plan.md              # この文書
├── research.md          # Phase 0
├── data-model.md        # Phase 1（DBの列・アプリの一覧・AppModule・Webのモジュール地図の下書き）
├── quickstart.md        # Phase 1
├── contracts/
│   ├── ui-routes.md               # ルート・転送・入口・すべてのアプリ・サイドバー
│   ├── api.md                     # /api/me の apps・PUT /api/me/last-app・作るURL
│   └── web-module-boundaries.md   # Webの境界の規則とアプリを足す手順
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks で作る
```

### ソースコード（分割のあと）

```text
eslint-rules/
├── web-module-boundaries.js       # 新規：Webの境界の規則（R2）
└── web-module-boundaries.test.js  # 新規
eslint.config.js                   # apps/web/src に規則をかける

packages/shared/src/
└── apps.ts                        # 新規：APP_CATALOG・AppId・lastAppRequestSchema（R7、PR3）

apps/api/
├── drizzle/0025_*.sql             # 新規：users.last_app_id（PR3）
└── src/
    ├── app.ts                     # 設定の不備の転送先（PR2）
    ├── platform/schema.ts         # users.last_app_id（PR3）
    ├── platform/identity/me-routes.ts   # apps と PUT /me/last-app（PR3）
    └── apps/threads/connection/threads-connect-routes.ts   # redirectTo（PR2）

apps/web/src/
├── main.tsx・router.tsx           # 組み立て（buildRoutes(apps)）
├── app-registry.ts                # 組み立て：出せるアプリの一覧（新規）
├── shell/                         # 外枠
│   ├── index.ts                   # 入口
│   ├── app-module.ts              # AppModule の型・AppRegistryProvider
│   ├── layout/                    # AppShell・Sidebar（枠）・AppSwitcher（新規）・UserMenu・EnvBanner・PageHeader
│   ├── pages/                     # landing（新規の振り分け）・apps（新規）・not-found・sign-in・terms・legal-commerce・test-invite・referral-landing
│   ├── settings/                  # settings-layout・sections・個人設定と運営の共通の項目
│   ├── guards/                    # RequireAuth・契約前・テスト版・退会の途中
│   └── lib/                       # seller-info・use-last-app（新規）
├── apps/
│   └── threads/                   # Threadsアプリ
│       ├── index.ts               # 入口：threadsApp（AppModule）
│       ├── routes.tsx
│       ├── sidebar/               # アカウントの切り替え・中身・下の項目・ThreadsShell
│       ├── pages/                 # 今の pages/ のThreadsの画面（チーム・招待・接続を含む）とホーム
│       ├── components/            # 今の components/ のThreadsのもの
│       └── lib/                   # paths.ts・use-account-access など
├── components/                    # 共通の部品（ui/ と、どのアプリでも使うもの）
└── lib/                           # 共通の部品（api-client・query・format・utils など）

apps/web/test/                     # 読みこみ先とURLを直す。新しいテストを足す
e2e/tests/                         # URLを直す。転送のテストを足す

docs/
├── module-map.md                  # Webの章を足す（境界・地図・例外・アプリを足す手順。FR-010・FR-011・FR-021）
├── architecture.md                # Webの構成を書き足す
├── product-structure.md           # §6の表のWebの行を「分けた」に（§6の決まりは2026-11-12に記録済み）
└── ui-design.md                   # アプリの切り替え・すべてのアプリの画面
```

**構成の判断**：
- 共通の部品は今の場所に残し、外枠とThreadsのものだけを移す（R1）。
- 外枠 → アプリの依存は持たない。組み立てが一覧を渡す（R1・R3）。
- `@meguru/shared`の中身は移さない。2作目は`packages/shared/src/apps/<名前>/`に置く（R12）。
- PRは3つ（R15）。

## 複雑さの記録（Complexity Tracking）

| 違反・複雑さ | 必要な理由 | もっと簡単な案を取らない理由 |
|---|---|---|
| Webの境界の規則を、APIとは別に足す | Webは`@/`の別名で読むので、APIの規則では判定できない。アプリを足しても設定を変えずに止めたい | APIの規則に形を選ぶ設定を足すと、2つの形が1つのファイルに混ざる。標準の`no-restricted-imports`では「自分以外のアプリ」を書き分けにくい |
| `AppModule`とアプリの登録の一覧（今はアプリが1本） | 2作目を外枠に直に書き足さず、登録の1か所で足せるようにする（spec FR-008・FR-010）。仮のアプリでテストする | Threadsを外枠に直に書くと、2作目のときに外枠を作り直すことになり、§6の「2作目より前に分ける」を満たさない |
| `users.last_app_id`の列（今はアプリが1本） | 別の端末でも最後に使ったアプリから始める（spec FR-019） | ブラウザに覚えると端末ごとに変わる。今はThreads固定にすると、2作目で入口を作り直す |
