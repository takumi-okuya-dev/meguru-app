---

description: "作業の一覧：公開のためのブランチと環境"
---

# 作業の一覧（Tasks）：公開のためのブランチと環境

**入力**：`specs/015-deploy-environments/`の設計の文書

**前提**：[plan.md](./plan.md)・[spec.md](./spec.md)（必須）、[research.md](./research.md)・[data-model.md](./data-model.md)・[contracts/](./contracts/)

**テスト**：この機能は設定とワークフローが中心で、自動で確かめられるのは4つだけ（research.md R13）。その4つは、今までどおり**テストを先に書いて落ちることを確かめてから**作る。残りは[quickstart.md](./quickstart.md)の手で確かめる手順で確かめる。

**並べ方**：利用者の筋書き（US1〜US6）ごとに分け、それぞれ単体で確かめられるようにする。

## 形式：`[ID] [P?] [Story] 内容`

- **[P]**：並べて進められる（別のファイル・依存なし）
- **[Story]**：どの筋書きの作業か（US1〜US6）
- **【人】**：ユーザーが外部サービスの画面で行う作業（Claudeはできない）。手順は[quickstart.md](./quickstart.md) 1と、T041で書き直す手順書にある
- ファイルの場所を必ず書く

---

## Phase 1: Setup（共通の下ごしらえ）

**目的**：環境の名前を決め、例のファイルと費用の見込みをそろえる

- [ ] T001 [P] `apps/api/.dev.vars.example`に`APP_ENV=development`を足し、値は`production`・`staging`・`development`の3つだけだと注記する
- [ ] T002 [P] `apps/web/.env.example`に`VITE_APP_ENV=development`を足し、同じ3つの値だと注記する
- [ ] T003 [P] `docs/cost-estimate.md`に、2環境ぶんの見込みとドメイン代（年に数千円）を足す（research.md R12の表）

---

## Phase 2: Foundational（すべての筋書きの前提）

**目的**：環境を分ける土台（wranglerの環境・設定の確認・ブランチの保護・CIの行き先）

**⚠️ ここが終わるまで、US1以降のデプロイは試せない**

- [ ] T004 [P] `apps/api/test/unit/wrangler-config.test.ts`（新規）：`wrangler.toml`を読み、`[env.staging]`と`[env.production]`のそれぞれに`vars`・`kv_namespaces`（binding`AUTOPOST_KV`）・`triggers`（`0 18 * * *`と`*/5 * * * *`）があり、`name`が重複しないことを確かめる。**先に書いて落ちることを確かめる**（research.md R3）
- [ ] T005 `apps/api/wrangler.toml`に`[env.staging]`・`[env.production]`を足す（[contracts/environments.md](./contracts/environments.md) 1の形。名前付きの環境は一番上の設定を受け継がないので、`vars`・`kv_namespaces`・`triggers`を両方に書き切る。KVの`id`は仮の値を置き、T015・T024で本物に差し替える）。T004を通す
- [ ] T006 [P] `apps/api/test/integration/config.test.ts`（既存）に、`APP_ENV`が無い・`production`/`staging`/`development`以外のときに`CONFIG_ERROR`で止まることのテストを足す。**先に書いて落ちることを確かめる**
- [ ] T007 `apps/api/src`の設定の確認に`APP_ENV`を足す（既定は`development`。[contracts/environments.md](./contracts/environments.md) 2）。T006を通す
- [ ] T008 `apps/api/src`の記録（ログ）を出すところに`APP_ENV`を入れる（どの環境の記録か分かるようにする。FR-026）
- [ ] T009 `.github/workflows/ci.yml`の`on: push: branches`に`develop`を足す（PRは今までどおり全部）
- [ ] T010 【人】GitHubのEnvironmentを2つ作る（`staging`・`production`）。[data-model.md](./data-model.md) 3-3の値（`CLOUDFLARE_API_TOKEN`・`CLOUDFLARE_ACCOUNT_ID`・`DATABASE_URL`・`VITE_…`）を入れる
- [ ] T011 【人】GitHubのrulesetで`main`と`develop`を守る（直接のpushを禁止・PR必須・`ci.yml`の成功を必須）。既定のブランチを`develop`にする（[contracts/deploy.md](./contracts/deploy.md) 3）
- [ ] T012 【人】`develop`ブランチを`main`から作って push する

**区切り**：ここまでで、環境ごとの設定の置き場所と、ブランチの守りができる

---

## Phase 3: User Story 1 -テストユーザーが使える場所に、自動で出る（Priority: P1）🎯 MVP

**目的**：`develop`へのマージで、ステージングに自動で出る。テスト環境だと分かる

**単体での確かめ**：`develop`に小さな変更をマージし、10分以内にステージングのURLで見え、帯が出て、テストユーザーがログインから自動投稿まで通せる（[quickstart.md](./quickstart.md) 3-2）

### テスト（先に書く）

- [ ] T013 [P] [US1] `apps/web/test/env-banner.test.tsx`（新規）：`VITE_APP_ENV`が`staging`・`development`なら帯が出て`production`なら出ないこと、帯がほかの帯（無料体験・読むだけ・要再接続）より**上**に出ることを確かめる。**先に書いて落ちることを確かめる**（[contracts/ui-routes.md](./contracts/ui-routes.md) 1）

### 実装

- [ ] T014 [US1] `apps/web/src/components/layout/EnvBanner.tsx`（新規）：`VITE_APP_ENV`を見て帯を出す（文言は[contracts/ui-routes.md](./contracts/ui-routes.md) 1の表のとおり。注意の色・閉じられない・375pxで折り返す）
- [ ] T015 [US1] `apps/web/src/components/layout/AppShell.tsx`の`banner`の**先頭**に`EnvBanner`を置く。あわせて`AppShell`の外の画面（ログイン・招待の確認・利用規約・特定商取引法の表記・トークンの作り方）の一番上にも置く。T013を通す
- [ ] T016 [P] [US1] `apps/web/vite.config.ts`と`apps/web/index.html`：`VITE_APP_ENV`が`staging`のときだけ`<meta name="robots" content="noindex, nofollow">`を差し込む（FR-042）
- [ ] T017 [US1] `.github/workflows/deploy.yml`（新規）を書く（[contracts/deploy.md](./contracts/deploy.md) 2の手順。`on: push: branches: [develop, main]`、`environment`の出し分け、`concurrency`、マイグレーション → API（`wrangler deploy --env`）→ Web（`wrangler pages deploy --branch`）、`workflow_dispatch`も付ける）
- [ ] T018 [US1] 【人】Neonでステージングのプロジェクトを作り、接続文字列をGitHubの`staging`のSecretsとCloudflareのシークレットに入れる。マイグレーションをすべて当てる
- [ ] T019 [US1] 【人】ステージングのKVを作る（`wrangler kv namespace create AUTOPOST_KV --env staging`）。出た`id`を`wrangler.toml`の`[env.staging]`に入れる（T005の仮の値を差し替える）
- [ ] T020 [US1] 【人】ステージングのCloudflareのシークレットを入れる（[data-model.md](./data-model.md) 3-1の「秘」。`wrangler secret put … --env staging`）
- [ ] T021 [US1] 【人】Cloudflare PagesのGit連携を切り、`staging.<ドメイン>`を`develop`のブランチの別名に向ける（DNSはproxy。ドメインが未定の間は`develop.<プロジェクト>.pages.dev`で進める）
- [ ] T022 [US1] 【人】Clerkの開発用インスタンスで、許可したメールアドレスだけ登録できる設定にし、テストユーザーを登録する（FR-021b）
- [ ] T023 [US1] 【人】Metaのアプリに、ステージングのコールバックのURLを足す
- [ ] T024 [US1] `develop`に小さな変更をマージして、[quickstart.md](./quickstart.md) 3-2の1〜6を通す（帯・許可していない人が入れない・ログインから自動投稿まで・本番のDBに入らない）

**区切り**：ステージングが動く。ここまでで、この機能の価値の中心は出ている

---

## Phase 4: User Story 2 -本番に、決めた手順で出る（Priority: P1）

**目的**：`develop`→`main`のPRで本番に出る。マイグレーションが先に当たり、失敗したら止まる

**単体での確かめ**：`develop`→`main`のPRをマージし、本番のWebとAPIが新しくなり、マイグレーションが当たっている（[quickstart.md](./quickstart.md) 3-3）

- [ ] T025 [US2] 【人】ドメインを買い、CloudflareのDNSに載せる（ネームサーバーを向ける）。`app.<ドメイン>`・`staging.<ドメイン>`・APIのURLを決める
- [ ] T026 [US2] 【人】Neonで本番のプロジェクトを作り、接続文字列をGitHubの`production`のSecretsとCloudflareのシークレットに入れる
- [ ] T027 [US2] 【人】本番のKVを作り、`wrangler.toml`の`[env.production]`に`id`を入れる
- [ ] T028 [US2] 【人】本番のCloudflareのシークレットを入れる（[data-model.md](./data-model.md) 3-1の「秘」。`--env production`）
- [ ] T029 [US2] 【人】Clerkの本番インスタンスを作り、`clerk.`・`accounts.`のCNAMEをDNSに足す。GoogleのOAuthを自分の認証情報に差し替える（research.md R6）
- [ ] T030 [US2] 【人】Metaのアプリに本番のコールバックのURLを足す。Cloudflare Pagesに`app.<ドメイン>`を当てる
- [ ] T031 [US2] `develop`→`main`のPRをマージして、[quickstart.md](./quickstart.md) 3-3の1〜4を通す（本番が新しくなる・帯が出ない・マイグレーションが当たる）
- [ ] T032 [US2] わざと失敗するマイグレーションで、APIとWebが入れ替わらないことを確かめる（[quickstart.md](./quickstart.md) 3-4。確かめたら戻す。SC-005）

**区切り**：本番に出せる。公開の判断ができる状態になる

---

## Phase 5: User Story 3 -環境ごとに、設定と秘密情報が分かれている（Priority: P1）

**目的**：混ざっていないこと・秘密がリポジトリにないことを、確かめられる形にする

**単体での確かめ**：両方の環境の設定の出どころを確かめ、リポジトリに秘密がなく、片方を変えても他方が変わらない

- [ ] T033 [P] [US3] リポジトリに秘密が入っていないことを確かめる（`git log -p`と今のファイルを、鍵の形（`sk_live_`・`sk_test_`・`postgres://`・`whsec_`）で検索する）。見つかれば、その値を無効にして入れ直す（SC-004）
- [ ] T034 [P] [US3] `.gitignore`に`.dev.vars`・`.env.local`が入っていることを確かめ、抜けていれば足す
- [ ] T035 [US3] ステージングで作ったデータが本番のDBに入っていないことを確かめる（両方のDBの件数を見る。SC-003）
- [ ] T036 [US3] `pnpm --filter api exec wrangler deploy --env staging --dry-run`と`--env production --dry-run`が通ることを確かめる（[quickstart.md](./quickstart.md) 3-1）

**区切り**：環境が混ざらないことを、実際に確かめた

---

## Phase 6: User Story 4 -ステージングでも決済を試せて、テストユーザーには料金を求めない（Priority: P2）

**目的**：ステージングはStripeのテスト用環境でON。テストユーザーは料金なしの印

**単体での確かめ**：テスト用のカードで契約でき、本番のStripeに何も起きず、料金なしの印を付けた人は契約なしで使える

- [ ] T037 [US4] 【人】Stripeのテスト用環境のWebhookを、ステージングのAPIのURLに向ける。本番のWebhookは本番のAPIのURLに向ける
- [ ] T038 [US4] 【人】`[env.staging].vars`と`[env.production].vars`の`STRIPE_PRICE_ID`などを、それぞれの環境のIDにする（[data-model.md](./data-model.md) 3-1）
- [ ] T039 [US4] ステージングで[quickstart.md](./quickstart.md) 3-5の1〜3を通す（テスト用のカードで契約・本番に影響なし・料金なしの印）

**区切り**：決済の変更を、本番より先にステージングで試せる

---

## Phase 7: User Story 5 -急ぎの修正を本番に出し、ステージングにも戻せる（Priority: P2）

**目的**：`main`から分けた修正を本番に出し、`develop`にも戻す流れを、実際に通す

**単体での確かめ**：`main`から修正を出して本番に反映し、`develop`との差が残らない

- [ ] T040 [US5] 小さな修正（文言など）で[quickstart.md](./quickstart.md) 3-6の1〜2を通し、`git log --oneline main ^develop`が空になることを確かめる

**区切り**：公開後に必ず要る流れを、一度通してある

---

## Phase 8: User Story 6 -ブランチの運用と公開前の手順が、文書で分かる（Priority: P3）

**目的**：次に触るときに迷わない

**単体での確かめ**：Constitutionと手順書を読み、PRの行き先・リリース・公開前の作業が分かる（[quickstart.md](./quickstart.md) 3-7）

- [ ] T041 [US6] `docs/external-services-setup.md`の「9. 本番公開時の追加作業」を、上から進めれば済む形に書き直す（[quickstart.md](./quickstart.md) 1の1〜8を、画面の操作の手順まで入れて移す。値の置き場所は[data-model.md](./data-model.md) 3の表を引く）
- [ ] T042 [P] [US6] `.specify/memory/constitution.md`の「開発ワークフロー」のブランチ運用を、3段構成の今の形に直す（PRの行き先・リリース・急ぎの修正）。MINOR改定として版を上げ、Sync Impact Reportを残す
- [ ] T043 [P] [US6] `README.md`に、ブランチの運用（`develop`が既定・リリースのPR・急ぎの修正）とデプロイ（`deploy.yml`）の説明を足す
- [ ] T044 [P] [US6] `docs/next-features.md`の「C. 公開後のブランチと環境」を、このfeatureに移したと書き換える（メモからは消す）

---

## Phase 9: 仕上げ（Polish）

- [ ] T045 [P] `docs/ui-design.md`に、環境の帯（いちばん上・閉じられない・ステージングと開発で出す）を足す
- [ ] T046 スマートフォンの幅（375px）で、帯が横にはみ出さず、上部バーの操作に重ならないことを確かめる
- [ ] T047 `pnpm lint && pnpm typecheck && pnpm test && pnpm e2e`を通す（E2Eは手元で今までどおり）
- [ ] T048 `specs/015-deploy-environments/verification.md`に、自動の確認の結果・手で確かめたこと（quickstart 3）・計画からの変更を書く

---

## 依存と進める順番

### フェーズの依存

- **Phase 1（Setup）**：依存なし。すぐ始められる
- **Phase 2（Foundational）**：Phase 1の後。**US1以降のデプロイを塞ぐ**
- **Phase 3（US1）**：Phase 2の後。この機能のMVP
- **Phase 4（US2）**：Phase 3の後（同じ`deploy.yml`を使い、ステージングで通ったものを本番に出す）
- **Phase 5（US3）**：Phase 4の後（両方の環境がある状態で確かめる）
- **Phase 6（US4）**・**Phase 7（US5）**：Phase 4の後。互いに依存しない
- **Phase 8（US6）**：いつでも書けるが、実際の手順が固まるPhase 4の後が書きやすい
- **Phase 9（仕上げ）**：US1〜US6の必要な分が終わってから

### 筋書きの依存

- **US1（P1）**：Phase 2の後。ほかの筋書きに依存しない
- **US2（P1）**：US1の`deploy.yml`を使う（US1の後）
- **US3（P1）**：US1・US2の環境がそろってから確かめる
- **US4（P2）**・**US5（P2）**：US2の後。互いに独立
- **US6（P3）**：独立（文書だけ）

### 並べて進められるところ

- T001・T002・T003（Setup）
- T004とT006（別のテストのファイル）
- T013とT016（別のファイル）
- T033とT034（別の確認）
- T042・T043・T044（別の文書）
- 【人】の作業のうち、T018〜T023（ステージングの準備）は、T017（`deploy.yml`）と並べて進められる

---

## 進め方（Implementation Strategy）

### まずMVP（US1まで）

1. Phase 1（Setup）
2. Phase 2（Foundational）
3. Phase 3（US1）
4. **止めて確かめる**：ステージングが動く
5. ここで一度、テストユーザーに触ってもらえる

### 少しずつ出す

1. Setup＋Foundational → 土台
2. US1 → ステージング（MVP）
3. US2 → 本番に出せる状態
4. US3 → 混ざっていないことの確認
5. US4・US5 → 決済と急ぎの修正
6. US6・仕上げ → 文書

### 【人】の作業について

外部サービスの画面での作業（T010・T011・T012・T018〜T023・T025〜T030・T037・T038）は、ユーザーが行う。Claudeは、

- その前に、必要な値と手順を`docs/external-services-setup.md`（T041）と[quickstart.md](./quickstart.md) 1にそろえる
- 作業の後に、`--dry-run`やデプロイの実行で、入った値が正しいかを確かめる

を担当する。ドメイン（T025）が決まるまでは、Cloudflareの既定のURL（`*.pages.dev`・`*.workers.dev`）でステージングまで進められる（Clerkの本番インスタンスだけがドメインを待つ）。

---

## メモ

- `[P]`＝別のファイルで依存なし
- `[Story]`＝どの筋書きの作業か（追えるようにするため）
- テスト（T004・T006・T013）は、**先に書いて落ちることを確かめてから**実装する
- 作業のたび、またはまとまりごとにコミットする
- 区切りで止めて、その筋書きだけで確かめられる
