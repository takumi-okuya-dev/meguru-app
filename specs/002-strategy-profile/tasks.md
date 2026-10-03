---
description: "戦略プロファイル（課題・宣伝内容・リサーチ）の実装タスク"
---

# タスク（Tasks）：戦略プロファイル（課題・宣伝内容・リサーチ）

**入力**：`specs/002-strategy-profile/`の設計文書

**前提**：[plan.md](./plan.md)、[spec.md](./spec.md)、[research.md](./research.md)、[data-model.md](./data-model.md)、[contracts/api.md](./contracts/api.md)、[contracts/ui-routes.md](./contracts/ui-routes.md)、[quickstart.md](./quickstart.md)、[docs/ui-design.md](../../docs/ui-design.md)

**テスト**：quickstart.mdの「自動テスト」の表にあるテストを、該当するフェーズで先に書く（失敗することを確認してから実装する）。

**構成**：ユーザーストーリーごとにフェーズを分け、各ストーリーを単独で実装・テストできるようにする。

## 書式：`[ID] [P?] [Story] 説明`

- **[P]**：並行して進められる（別ファイルで、未完了のタスクに依存しない）
- **[Story]**：対応するユーザーストーリー（US1〜US4）
- 説明には、変更するファイルのパスを含める

## パスの規約（plan.mdの構成）

- API：`apps/api/src/`、テストは`apps/api/test/`
- Web：`apps/web/src/`、テストは`apps/web/test/`
- 共通：`packages/shared/src/`、テストは`packages/shared/test/`
- E2E：`e2e/tests/`

---

## Phase 1：セットアップ

**目的**：本featureで足す依存と設定の雛形を用意する

- [X] T001 [P] `apps/web`に`@radix-ui/react-tabs`を追加し、shadcn/uiの`apps/web/src/components/ui/textarea.tsx`と`apps/web/src/components/ui/tabs.tsx`を追加する（research.md R9）
- [X] T002 [P] `apps/api/.dev.vars.example`に`THREADS_ACCESS_MODE=testers`を、「`testers`（既定）か`public`。Meta App Reviewに通り、Metaのアプリを公開したら`public`にする」という説明のコメント付きで足す（contracts/api.md「環境変数（追加）」）

**完了条件**：`pnpm install`と`pnpm -r typecheck`が通る

---

## Phase 2：基盤（すべてのユーザーストーリーの前提）

**目的**：共通の判定関数、DB、エラーの形、grower機能の判定、001の画面の手直し（docs/ui-design.md「8. 001からの変更点」）を済ませる

**⚠️ このフェーズが終わるまで、ユーザーストーリーの作業は始めない**

### 共通パッケージ

- [X] T003 [P] `packages/shared/test/text.test.ts`と`packages/shared/test/access.test.ts`を書く（失敗を確認する）：
  - 文字数：コードポイントで数え、絵文字1つは1文字
  - 空欄：空白・改行だけは空
  - キーワードの正規化：「ＡＩ」「 ai 」「Ai」がすべて`"ai"`になる
  - grower機能：プラン`auto-grower`・`multi-account`・`team`は常に使える。`auto-only`は無料体験中だけ使える
  - 無料体験の終了時刻：日本時間の暦で1か月後。1月31日の登録は2月の最終日の同じ時刻
- [X] T004 [P] `packages/shared/src/limits.ts`を作る（research.md R8、spec FR-021・FR-022）：
  - 文字数の上限：`STRATEGY_TEXT_MAX = 2000`、`PROMOTION_CONTENT_MAX = 2000`、`REFERENCE_BODY_MAX = 2000`、`REFERENCE_WHY_GOOD_MAX = 2000`、`SHORT_TEXT_MAX = 100`（管理用タイトル・届けたい属性・CTA・キーワード・狙いのメモ）、`URL_MAX = 2000`
  - 件数の上限：`PROMOTION_LIMIT = 50`、`REFERENCE_POST_LIMIT = 200`、`KEYWORD_LIMIT = 100`
  - その他：`PRIORITY_MIN = 0`、`PRIORITY_MAX = 100`、`PROMOTION_RATIO_DEFAULT = 20`
- [X] T005 [P] `packages/shared/src/text.ts`を作る（research.md R2・R5・R8）：
  - `countChars(s)`：`[...s].length`
  - `isBlank(s)`：`s.trim() === ""`
  - `normalizeKeyword(s)`：NFKC正規化 → 前後の空白を除く → 小文字
  - `isHttpUrl(s)`：`http:`・`https:`のURLだけ`true`
- [X] T006 [P] `packages/shared/src/access.ts`を作る（research.md R14）：
  - `trialEndsAt(userCreatedAt: Date): Date`：日本時間の暦で1か月後の同じ時刻。日がない月は月の最終日に丸める
  - `isInTrial(userCreatedAt, now)`
  - `hasGrowerAccess(plan, userCreatedAt, now)`：`plan`が`auto-grower`・`multi-account`・`team`のどれか、または`isInTrial`
- [X] T007 `packages/shared/src/errors.ts`の`ERROR_CODES`に`STALE_UPDATE`・`ITEM_NOT_FOUND`・`ITEM_LIMIT_REACHED`・`KEYWORD_DUPLICATE`・`GROWER_FEATURE_REQUIRED`を足し、`errorMessage`にcontracts/ui-routes.md「エラー文言」の文言を足す。`errorResponseSchema`（`packages/shared/src/schemas.ts`）に任意の`latest`（形は問わない`unknown`）を足す。`packages/shared/src/index.ts`から本フェーズの新しいモジュールをexportする

### DB

- [X] T008 `apps/api/src/db/schema.ts`に、data-model.mdのとおり次を足す。どのテーブルも`account_id`は`accounts.id`への`ON DELETE CASCADE`。
  - **列挙型**：`tone_preset`（`energetic_casual`, `polite_warm`, `formal`, `casual_frank`, `introspective_calm`, `passionate`, `humorous`）、`promotion_status`（`active`, `paused`, `ended`）
  - **`accounts`**：列`promotion_ratio_percent`（smallint、NOT NULL、既定値20、`0 <= 値 <= 100`）を足す
  - **`strategy_designs`**：
    - 主キーは`account_id`
    - テキスト列19個（`final_action`、`target_persona`、`real_worries`、`desired_self_image`、`perceived_image`、`content_theme_mix`、`anti_persona`、`benchmark_accounts`、`funnel_design`、`post_genres`、`dm_reply_template`、`inquiry_quality_tips`、`tone_notes`、`differentiation`、`success_metrics`、`profile_bio_draft`、`pinned_post_draft_1`〜`_3`）は、どれもNULL可で`char_length(列) <= 2000`
    - `tone_preset`（NULL可）、`version`（integer、NOT NULL、既定値1）、`created_at`・`updated_at`
  - **`promotions`**：
    - `title`（NOT NULL、`1 <= char_length <= 100`）、`content`（NOT NULL、`1 <= char_length <= 2000`）
    - `target_location`・`target_persona`・`target_age_range`・`cta`（NULL可、`char_length <= 100`）、`linked_url`（NULL可、`char_length <= 2000`）
    - `priority`（smallint、NOT NULL、既定値0、`0 <= 値 <= 100`）、`status`（NOT NULL、既定値`active`）、`valid_until`（date、NULL可）
    - `version`、`created_at`・`updated_at`、インデックス`(account_id)`
  - **`reference_posts`**：
    - `body`（NOT NULL、`1 <= char_length <= 2000`）、`keyword`（NULL可、`char_length <= 100`）、`post_url`（NULL可、`char_length <= 2000`）、`why_good`（NULL可、`char_length <= 2000`）
    - `version`、`created_at`・`updated_at`、インデックス`(account_id, created_at DESC)`
  - **`research_keywords`**：
    - `keyword`（NOT NULL、`1 <= char_length <= 100`）、`keyword_normalized`（NOT NULL）、`purpose`（NULL可、`char_length <= 100`）
    - `version`、`created_at`・`updated_at`、一意制約`(account_id, keyword_normalized)`
- [X] T009 `pnpm --filter api db:generate --name strategy_profile`でマイグレーション（`apps/api/drizzle/0001_strategy_profile.sql`）を作り、ローカルDBに当てて、既存のAccountに`promotion_ratio_percent = 20`が入ることを確かめる

### APIの共通部品

- [X] T010 `apps/api/src/lib/errors.ts`の`AppError`の`status`に`403`を足し、`409 STALE_UPDATE`のときにレスポンスへ`latest`を載せられるようにする（`AppError`に任意の`latest`を持たせ、`apps/api/src/app.ts`のエラー処理で`{ error, latest }`の形にする。contracts/api.md「共通事項」）
- [X] T011 [P] `apps/api/src/services/grower-access.ts`を作る：Accountの行とリクエストしたユーザー（`users.created_at`）から`hasGrowerAccess`（T006）を求める`canEditProfile`と、使えなければ`403 GROWER_FEATURE_REQUIRED`を投げる`requireGrowerAccess`（research.md R14）
- [X] T012 [P] `apps/api/src/services/item-service.ts`を作る（research.md R3・R4）。宣伝内容・参考投稿・キーワードで共通に使う。
  - `insertWithLimit(env, accountId, kind, limit, insertFn)`
    - `withTransaction`の中で、`pg_advisory_xact_lock(hashtextextended('account_items:<accountId>:<kind>', 0))` → 件数を数え、上限なら`409 ITEM_LIMIT_REACHED` → `insertFn`
    - 外部キー違反は`404 ACCOUNT_NOT_FOUND`にする
  - `updateWithVersion(db, table, accountId, id, expectedVersion, values)`
    - `WHERE id = $id AND account_id = $accountId AND version = $expected`で更新し、`version + 1`・`updated_at = now()`にする
    - 0行なら行の有無を確かめ、あれば`409 STALE_UPDATE`（`latest`付き）、なければ`404 ITEM_NOT_FOUND`
    - IDがUUIDの形でなければ`404 ITEM_NOT_FOUND`
  - `deleteItem(db, table, accountId, id)`：なくても成功（`204`）
- [X] T013 [P] `apps/api/test/helpers/app.ts`に、本featureのテスト用の部品を足す：ユーザーとAccountを直接作る`createUserWithAccount(user, { plan, userCreatedAt })`（`users.created_at`を指定して無料体験の内外を作れる）と、Accountの`plan`・`connection_status`を書き換える部品

### Webの共通部品と001の画面の手直し（docs/ui-design.md）

- [X] T014 [P] `apps/web/src/index.css`の色の変数を、docs/ui-design.md「4. 見た目の約束」の表の値にする。
  - `--background`（ライト`#FFFFFF`／ダーク`#212121`）、`--sidebar`（`#F9F9F9`／`#181818`）、`--card`（`#FFFFFF`／`#2A2A2A`）、`--accent`（`#ECECEC`／`#303030`）、`--muted`（`#F0F0F0`／`#303030`）、`--border`（`#E3E3E3`／`#3A3A3A`）、`--foreground`（`#0D0D0D`／`#ECECEC`）、`--muted-foreground`（`#5D5D5D`／`#B4B4B4`）、`--ring`（`#0B66D0`／`#61A8FF`）
  - 足すもの：`--success`（文字`#17733A`・背景`#E6F4EA`／`#6FD79A`・`#173A25`）と、注意の背景（`#FFF0DC`／`#3B2A12`。`--warning`の文字は`#8F4700`／`#FFB866`）
  - 書体：`font-family: 'Hiragino Sans', 'Noto Sans JP', system-ui, sans-serif`（Webフォントは読み込まない）
- [X] T015 [P] `apps/web/test/layout-responsive.test.tsx`を書く（失敗を確認する）：
  - サイドバーのAccountの切り替えがドロップダウンで、一覧と「＋ アカウントを追加」が出る。「要再接続」のAccountには「要再接続」と出る
  - サイドバーを畳んだ状態が`localStorage`に保存される
  - 767px以下では、設定画面が「一覧 → 中身」の2段になり、中身の画面に「← 設定」がある
- [X] T016 `apps/web/src/components/layout/AccountSwitcher.tsx`を、表示中のAccount（アイコン・表示名・@ユーザー名）のボタンからドロップダウンを開く形に変える（`@radix-ui/react-dropdown-menu`）。中身は全Accountの一覧（表示中にチェック、`needs_reconnect`には`TriangleAlert`と「要再接続」）と「＋ アカウントを追加」とする（docs/ui-design.md「2. 画面の骨格」）
- [X] T017 `apps/web/src/components/layout/Sidebar.tsx`を、docs/ui-design.md「2. 画面の骨格」の並びにする。
  - 上から順に、Accountの切り替え（T016）と畳むボタン（`PanelLeft`）、「ホーム」（`House`）、機能の移動の欄、区切り線の下に「このアカウントの設定」（`SlidersHorizontal`、`/accounts/:id/settings`）とユーザーメニュー
  - 表示中の画面は背景を`--accent`にする
  - 見出し「戦略」の項目は、各ストーリーのフェーズで足す
- [X] T018 `apps/web/src/components/layout/AppShell.tsx`を変える（research.md R9、docs/ui-design.md「5. 画面幅ごとの振る舞い」）：
  - `lg`（1024px）以上：サイドバーを常に表示し、畳めるようにする。畳んだ状態は`localStorage`に保存する（読み書きは`try/catch`で包む）
  - `md`〜`lg`未満：サイドバーを`Sheet`で画面の上に重ねて開く
  - `md`未満：左から出るドロワーにする
  - メインパネルの中身は、各画面の`PageHeader`（T019）とスクロール領域にする
- [X] T019 [P] `apps/web/src/components/layout/PageHeader.tsx`を作る：
  - 左に画面名、右に主な操作を置き、スクロール領域の上端に固定する（高さ56px、`md`未満は52px）
  - `md`未満では`[≡] 画面名 [主な操作]`の3列にし、画面名を中央に置く
  - サイドバーを畳んでいるときは、画面名の左に「サイドバーを開く」ボタンを出す
  - `needs_reconnect`のバナー（001）は、この下に出す
- [X] T020 `apps/web/src/pages/settings/settings-layout.tsx`を、`md`未満では「項目の一覧の画面 → 項目の中身の画面（左上に「← 設定」）」の2段にする。`md`以上は001の2列のまま（docs/ui-design.md 型D）
- [X] T021 [P] `apps/web/src/components/ui/dialog.tsx`に、`md`未満で全画面のシート（左上に✕、右上に主な操作）として出す表示を足す（docs/ui-design.md 型B、research.md R9）
- [X] T022 [P] `apps/web/src/lib/use-unsaved-changes.ts`を作る（research.md R10）：
  - `useUnsavedChanges(isDirty)`：React Routerの`useBlocker`でアプリ内の移動を止め、`beforeunload`でブラウザ標準の確認を出す
  - 止めた移動を「続ける」「やめる」ための値を返す
  - 「変更がある」は、入力値と最後に保存した値の比較で決める（元に戻したら変更なし）
- [X] T023 [P] `apps/web/src/components/UnsavedChangesDialog.tsx`（見出し「保存していない変更があります」、説明「このまま移動すると、変更は失われます。」、「編集に戻る」（既定）／「変更を破棄して移動」）と、`apps/web/src/components/ConflictDialog.tsx`（見出し「他の場所で更新されています」、説明「この内容は、別のタブや端末で先に保存されています（{最新の更新日時}）。」、「最新の内容を読み込み直す」（既定）／「自分の内容で上書きする」）を作る（contracts/ui-routes.md 規則3・5）
- [X] T024 [P] `apps/web/src/components/FieldWithCounter.tsx`を作る（contracts/ui-routes.md 規則9、docs/ui-design.md 型A）：
  - 表示：ラベル、未入力のときの「未入力」の小さなラベル、1行の説明、`Textarea`（または`Input`）、右下の「{いまの文字数}/{上限}」
  - 記入例は`placeholder`に出す
  - 上限を超えたら、注意の色にして「{上限}文字以内で入力してください」を出す
  - 文字数は`countChars`（T005）で数える。`md`未満の入力の文字は16px以上にする
- [X] T025 [P] `apps/web/src/components/GrowerRequiredNotice.tsx`を作る（contracts/ui-routes.md 規則10）：
  - 文言：「課題・宣伝内容・リサーチの編集は、プラン2以上で使えます。保存済みの内容はそのまま残っています。」と「プランの変更は運営者にお問い合わせください。」
  - 画面の上部の案内と、保存で`403`を受けたときのダイアログの両方の形で使える
- [X] T026 `apps/web/src/lib/api-client.ts`の`ApiError`に、`409`のレスポンスの`latest`を持たせる。`apps/web/src/lib/query.ts`の再試行しないステータスに`403`と`409`を足し、`queryKeys`に`profileStatus(id)`・`strategy(id)`・`promotions(id)`・`promotionSettings(id)`・`referencePosts(id)`・`researchKeywords(id)`を足す

**完了条件**：`pnpm --filter @threads-grower/shared test`とT015が通る。001の既存のテスト（API・Web・E2E）が引き続き通る。サイドバー・設定画面が4つの画面幅（375・768・1024・1440px）で崩れない

---

## Phase 3：ユーザーストーリー1 - 課題（戦略設計）の入力と保存（優先度：P1）🎯 MVP

**ゴール**：Accountごとに課題の20項目と近い人間性を入力・保存・復元でき、未保存の警告と別のタブとの競合の検知が働く

**単独でのテスト**：Accountを1件持つユーザーで課題を入力・保存し、ログアウト・再ログイン後に同じ内容が出る（quickstart.md「手動の確認 1」）

### テスト（先に書いて失敗を確認する）

- [X] T027 [P] [US1] `packages/shared/test/strategy.test.ts`を書く：`STRATEGY_FIELDS`が20項目（数える16項目＋下書き4項目）を持ち、入力済み項目数が下書きを数えず、`tonePreset`は`null`以外で入力済みになる
- [X] T028 [P] [US1] `apps/api/test/integration/strategy.test.ts`を書く（quickstart.mdの表の次の行）：
  - 「課題の復元」「空欄の扱い」「文字数の上限」「課題の競合」（行がないのに`expectedVersion: 1`で保存すると`409`になり、行は作られないことも含む）
  - 「他人のAccount」（strategy）、「要再接続のAccount」（strategy）
  - 「grower機能の判定」（strategy）：無料体験中・プラン2は保存できる。無料体験の後のプラン1は`PUT`が`403 GROWER_FEATURE_REQUIRED`で、`GET`は`canEdit: false`と保存済みの内容を返す
- [X] T029 [P] [US1] `apps/web/test/strategy.test.tsx`を書く：
  - 「未保存の警告（Web）」「競合のダイアログ（Web）」
  - `canEdit: false`のとき入力欄が読み取り専用で、保存がなく、案内が出る
  - 保存で`403`を受けると、入力内容を残したまま案内のダイアログが出る

### 実装

- [X] T030 [P] [US1] `packages/shared/src/strategy.ts`を作る（data-model.md「strategy_designs」、contracts/ui-routes.md「項目の文言」）：
  - `STRATEGY_FIELDS`：キー、DBの列名、区分（「課題① 営業導線設計」「課題② アカウント設計」「課題③ 集客導線設計」「人柄（トンマナ）」「その他」「プロフィール・固定投稿（下書き）」）、ラベル・説明・記入例（ui-routes.mdの表のとおり）、入力済み項目数に数えるか
  - `TONE_PRESETS`：値と表示名の組。`energetic_casual`=元気・カジュアル、`polite_warm`=丁寧・温かい、`formal`=敬語ベース、`casual_frank`=ため口・フランク、`introspective_calm`=内省的・静かめ、`passionate`=情熱的・熱量高め、`humorous`=ユーモア・自虐混じり
  - `countFilled(values)`：16項目のうち入力済みの数
- [X] T031 [US1] `packages/shared/src/schemas.ts`に、課題のスキーマを足す（contracts/api.mdの`StrategyValues`・`Strategy`）。
  - `strategyValuesSchema`：19個のテキストのキーすべて必須、各`countChars <= 2000`。`tonePreset`は`TONE_PRESETS`の値か`null`
  - `putStrategyRequestSchema`：`expectedVersion`は0以上の整数
  - `strategyResponseSchema`：`version`、`filledCount`、`totalCount: 16`、`updatedAt`、`canEdit`を含む
- [X] T032 [US1] `apps/api/src/services/strategy-service.ts`を作る（research.md R1・R2・R3）：
  - `getStrategy`：行がなければ全項目`""`・`tonePreset: null`・`version: 0`・`updatedAt: null`
  - `saveStrategy`：空白だけの値は`NULL`にする。`INSERT … ON CONFLICT (account_id) DO UPDATE SET …, version = strategy_designs.version + 1, updated_at = now() WHERE strategy_designs.version = $expectedVersion RETURNING *`の1文で保存し、0行なら最新の値を`latest`に入れて`409 STALE_UPDATE`。行がないのに`expectedVersion`が1以上なら、作らずに`409 STALE_UPDATE`を返し、`latest`には全項目が空・`version: 0`の課題を入れる
  - DBの`NULL`はレスポンスで`""`にする
- [X] T033 [US1] `apps/api/src/routes/strategy.ts`に`GET`・`PUT /api/accounts/:accountId/strategy`を作り、`apps/api/src/app.ts`に登録する。
  - どちらも`findOwnedAccount`で確かめる
  - `PUT`は`requireGrowerAccess`（T011）のあとに検証し、違反は`400 VALIDATION_FAILED`で`details`に項目名
  - `GET`には`canEdit`を入れる（contracts/api.md）
- [X] T034 [US1] `apps/web/src/lib/api-client.ts`に`getStrategy`・`putStrategy`を足す
- [X] T035 [US1] `apps/web/src/pages/strategy.tsx`を作る（contracts/ui-routes.md「課題の画面」、docs/ui-design.md 型A）。
  - 上部バー：`PageHeader`に「課題」、「{入力済み}/16 入力済み」、PCのみ「最終更新：{日時}」、「⋯」（変更を破棄）、「保存」
  - 本文：案内文、区分のチップ（`md`未満は上部バーの下に固定して横スクロール、先頭に「{入力済み}/16」）、区分ごとの見出しと`FieldWithCounter`
  - 近い人間性：ブラウザ標準の`<select>`（「（未選択）」と7つ）
  - プロフィール・固定投稿の区分：見出しの下に「Threadsには自動で反映されない下書きです。投稿づくりの材料には使いません。」
  - 保存：成功したらトースト「保存しました」。`409`は`ConflictDialog`、`403`は`GrowerRequiredNotice`のダイアログ、その他の失敗は入力を残してトースト（ui-routes.md 規則2）
  - `useUnsavedChanges`で警告する。`canEdit: false`なら読むだけの表示と`GrowerRequiredNotice`
- [X] T036 [US1] `apps/web/src/router.tsx`に`/accounts/:accountId/strategy`を足し、`apps/web/src/components/layout/Sidebar.tsx`に見出し「戦略」と「課題」（`Target`）を足す

**完了条件**：T027〜T029が通り、quickstart.md「手動の確認 1・2」ができる

---

## Phase 4：ユーザーストーリー2 - 宣伝内容の登録と管理（優先度：P2）

**ゴール**：宣伝内容を複数登録・編集・状態の変更・削除でき、宣伝投稿の割合を保存できる。期限切れと対象外が正しく並ぶ

**単独でのテスト**：宣伝内容を2件登録し、1件を一時停止にして「対象外」に移ることと、割合の保存を確かめる（quickstart.md「手動の確認 3」）

### テスト（先に書いて失敗を確認する）

- [X] T037 [P] [US2] `packages/shared/test/promotions.test.ts`を書く：
  - 日本時間の今日：UTCの15:00の前後で日付が変わる
  - 宣伝の対象・期限切れ：掲載期限の当日は対象、翌日の0時（日本時間）から期限切れ
  - 並び順（FR-009）
- [X] T038 [P] [US2] `apps/api/test/integration/promotions.test.ts`を書く（quickstart.mdの表の次の行）：
  - 「宣伝内容の並び順」「掲載期限の境目」「件数の上限の同時実行」「削除済みの行の更新」「URLの検証」（専用URL）
  - 「別のAccountの行」「他人のAccount」「要再接続のAccount」（promotions・promotion-settings）、「grower機能の判定」（promotions・promotion-settings）
  - 宣伝投稿の割合の`GET`・`PUT`（`101`と`1.5`は`400`）

### 実装

- [X] T039 [P] [US2] `packages/shared/src/promotions.ts`を作る（research.md R6）：
  - `jstToday(now)`：`YYYY-MM-DD`
  - `isExpired(validUntil, now)`：`validUntil < jstToday`
  - `isTargetable(status, validUntil, now)`：`status === "active"`かつ期限切れでない
  - `sortPromotions(items, now)`：宣伝の対象を先に。それぞれの中は`priority`の降順、同じなら`createdAt`の降順
- [X] T040 [US2] `packages/shared/src/schemas.ts`に、宣伝内容のスキーマを足す（contracts/api.mdの`PromotionInput`・`Promotion`）。
  - `promotionInputSchema`
    - `title`・`content`は空でない（`isBlank`でない）。`title`は100文字まで、`content`は2,000文字まで
    - `targetLocation`・`targetPersona`・`targetAgeRange`・`cta`は100文字まで
    - `linkedUrl`は`""`か`isHttpUrl`で2,000文字まで
    - `priority`は0〜100の整数（既定0）、`status`は既定`active`
    - `validUntil`は実在する`YYYY-MM-DD`か`null`
  - `promotionSchema`：`isExpired`・`isTargetable`・`version`・`createdAt`・`updatedAt`を含む
  - `promotionSettingsSchema`：`ratioPercent`は0〜100の整数
- [X] T041 [US2] `apps/api/src/routes/promotions.ts`を作り、`apps/api/src/app.ts`に登録する（contracts/api.md）：
  - `GET`・`PUT /api/accounts/:accountId/promotion-settings`（`accounts.promotion_ratio_percent`。競合は検知しない）
  - `GET /promotions`（`sortPromotions`の順。`items`・`limit: 50`・`canEdit`）
  - `POST /promotions`（`insertWithLimit`、上限50）
  - `PUT /promotions/:promotionId`（`updateWithVersion`）
  - `DELETE /promotions/:promotionId`（`deleteItem`）
  - 書き込みはすべて`requireGrowerAccess`のあとに行う。任意のテキストの`""`はDBで`NULL`にする
- [X] T042 [US2] `apps/web/src/lib/api-client.ts`に、宣伝内容と宣伝投稿の割合の呼び出しを足す
- [X] T043 [P] [US2] `apps/web/src/components/promotions/PromotionFormDialog.tsx`を作る（contracts/ui-routes.md「宣伝内容の画面」の追加・編集のダイアログ）：
  - 見出し：「宣伝内容を追加」／「宣伝内容を編集」
  - 項目：管理用タイトル（「必須・投稿には出ません」）、宣伝したい内容（必須）、届けたい属性（場所・どんな人・年齢。`md`以上は横に3つ並べる）、CTA、専用URL、優先度、状態、掲載期限
  - 掲載期限が過去なら「この日付はすでに過ぎているため、期限切れとして扱われます。」と出す（保存はできる）
  - `useUnsavedChanges`で、閉じる操作でも確認する。保存で`404 ITEM_NOT_FOUND`なら規則6、`409`なら`ConflictDialog`、`403 GROWER_FEATURE_REQUIRED`なら入力内容を残したまま`GrowerRequiredNotice`のダイアログを出し、画面を読むだけの表示に切り替える（ui-routes.md 規則10）
- [X] T044 [US2] `apps/web/src/pages/promotions.tsx`を作る（contracts/ui-routes.md「宣伝内容の画面」、docs/ui-design.md 型B）：
  - 上部バー：`PageHeader`に「宣伝内容」と「＋ 追加」（`md`未満は「＋」アイコン）
  - 案内文と、宣伝投稿の割合の行（値を変えたら「保存」を出す）
  - 一覧：「宣伝の対象（{件数}）」のカードと、「対象外（{件数}）」の1行のカード
  - 「⋯」メニュー：編集、一時停止／有効に戻す、終了、削除（確認のダイアログ）
  - その他：空の状態、件数の上限の案内（規則8）、`canEdit: false`のときの読むだけの表示
- [X] T045 [US2] `apps/web/src/router.tsx`に`/accounts/:accountId/promotions`を足し、`apps/web/src/components/layout/Sidebar.tsx`の「戦略」に「宣伝内容」（`Megaphone`）を足す

**完了条件**：T037・T038が通り、quickstart.md「手動の確認 3」ができる

---

## Phase 5：ユーザーストーリー3 - リサーチメモ（参考投稿とキーワード）（優先度：P3）

**ゴール**：参考投稿とキーワードを保存・編集・削除でき、キーワードの重複が防がれる

**単独でのテスト**：参考投稿を2件保存して新しい順に並ぶこと、キーワードの重複の案内を確かめる（quickstart.md「手動の確認 4」）

### テスト（先に書いて失敗を確認する）

- [X] T046 [P] [US3] `apps/api/test/integration/research.test.ts`を書く（quickstart.mdの表の次の行）：
  - 「キーワードの重複」「キーワードの削除」「URLの検証」（投稿のURL）
  - 「他人のAccount」「要再接続のAccount」「grower機能の判定」（reference-posts・research-keywords）
  - 参考投稿の新しい順、件数の上限（参考投稿200件・キーワード100件）
- [X] T047 [P] [US3] `apps/web/test/research.test.tsx`を書く：
  - タブの切り替えがクエリ`?tab=keywords`に残る
  - 「なぜ良いか：未入力」が出る
  - 重複したキーワードを入力すると、保存する前に「同じキーワードがすでに登録されています」が出る
  - 保存で`403`を受けると、入力内容を残したまま案内のダイアログが出る

### 実装

- [X] T048 [US3] `packages/shared/src/schemas.ts`に、リサーチのスキーマを足す（contracts/api.md）：
  - `referencePostInputSchema`
    - `body`は空でなく2,000文字まで
    - `keyword`は100文字まで
    - `postUrl`は`""`か`isHttpUrl`で2,000文字まで
    - `whyGood`は2,000文字まで
  - `researchKeywordInputSchema`：`keyword`は空でなく100文字まで、`purpose`は100文字まで
  - 一覧のレスポンス（`items`・`limit`・`canEdit`）
- [X] T049 [US3] `apps/api/src/routes/research.ts`を作り、`apps/api/src/app.ts`に登録する（contracts/api.md）：
  - `GET`・`POST /reference-posts`（新しい順、上限200）、`PUT`・`DELETE /reference-posts/:referencePostId`
  - `GET`・`POST /research-keywords`（新しい順、上限100）、`PUT`・`DELETE /research-keywords/:keywordId`
  - キーワードは`normalizeKeyword`の値を`keyword_normalized`に入れ、一意制約の違反（`23505`）を`409 KEYWORD_DUPLICATE`にする
  - 書き込みはすべて`requireGrowerAccess`のあとに行う
- [X] T050 [US3] `apps/web/src/lib/api-client.ts`に、参考投稿とキーワードの呼び出しを足す
- [X] T051 [P] [US3] `apps/web/src/components/research/ReferencePostFormDialog.tsx`と`apps/web/src/components/research/KeywordFormDialog.tsx`を作る（contracts/ui-routes.md「リサーチの画面」）：
  - 参考投稿：本文（必須、記入例「Threadsで見つけた投稿の本文をそのまま貼り付け」）、検索したキーワード、投稿のURL、なぜ良いか
  - キーワード：キーワード（必須）、狙いのメモ。重複は`normalizeKeyword`で事前に判定する
  - 未保存の警告・`404`・`409`・`403`の扱いはT043と同じ
- [X] T052 [US3] `apps/web/src/pages/research.tsx`を作る（contracts/ui-routes.md「リサーチの画面」、docs/ui-design.md 型B）：
  - 上部バー：`PageHeader`に「リサーチ」と、選択中のタブに応じた「＋ 参考投稿を追加」／「＋ キーワードを追加」
  - 案内文と、折りたたみの「リサーチの手順」
  - タブ（`Tabs`、クエリ`?tab=`に持つ）
  - 参考投稿のカード：本文6行まで＋「もっと見る」、キーワード・保存日時、URLのリンク（`target="_blank" rel="noopener noreferrer"`）、「なぜ良いか」
  - キーワードの行、空の状態、件数の上限の案内、`canEdit: false`のときの読むだけの表示
- [X] T053 [US3] `apps/web/src/router.tsx`に`/accounts/:accountId/research`を足し、`apps/web/src/components/layout/Sidebar.tsx`の「戦略」に「リサーチ」（`Search`）を足す

**完了条件**：T046・T047が通り、quickstart.md「手動の確認 4」ができる

---

## Phase 6：ユーザーストーリー4 - Accountの画面で入力状況を把握する（優先度：P4）

**ゴール**：ホームで課題・宣伝内容・リサーチの入力状況と「次にやること」、無料体験の終了日、grower機能を使えないときの案内がわかる

**単独でのテスト**：何も入力していないAccountと、課題だけ入力したAccountのホームで、案内が切り替わることを確かめる（quickstart.md「手動の確認 5・6」）

### テスト（先に書いて失敗を確認する）

- [X] T054 [P] [US4] `apps/api/test/integration/profile-status.test.ts`を書く：
  - 入力済み項目数・宣伝の対象の件数・全件数・参考投稿とキーワードの件数が正しい
  - `access`：無料体験中は`inTrial: true`・`trialEndsAt`あり。無料体験の後のプラン1は`canEdit: false`
  - 他人のAccountは`404`
  - `needs_reconnect`のAccountでも`200`で返る
- [X] T055 [P] [US4] `apps/web/test/account-home.test.tsx`を書く：
  - 「ホームの案内（Web）」：research.md R11の4つの「次にやること」の切り替え
  - 無料体験中に「無料体験中：{YYYY年M月D日}まで、すべての機能を使えます」が出る
  - `canEdit: false`ではgrower機能の案内に変わる

### 実装

- [X] T056 [US4] `apps/api/src/services/profile-status.ts`と`GET /api/accounts/:accountId/profile-status`を作る（`apps/api/src/routes/strategy.ts`に置く。contracts/api.md）。件数は1回のクエリでまとめて数える。`access`は`canEditProfile`と`trialEndsAt`（T006）から作る。レスポンスのスキーマを`packages/shared/src/schemas.ts`に足す
- [X] T057 [US4] `apps/web/src/pages/account-home.tsx`を、contracts/ui-routes.md「ホーム」のとおりにする：
  - 001の表示（アイコン・表示名・@ユーザー名・接続状態）の下に、無料体験中の表示、「次にやること」の大見出しと説明、3枚のカード（`md`以上は横並び、`md`未満は縦並びで右端に「›」）を出す
  - 案内している画面のカードは枠線を濃くする
  - `canEdit: false`では、grower機能の案内に変える
- [X] T058 [US4] 課題・宣伝内容・リサーチの保存・削除の`onSuccess`で`queryKeys.profileStatus(id)`を古いものとして扱う（`apps/web/src/pages/strategy.tsx`・`apps/web/src/pages/promotions.tsx`・`apps/web/src/pages/research.tsx`。contracts/ui-routes.md 規則11）

**完了条件**：T054・T055が通り、quickstart.md「手動の確認 5・6」ができる

---

## Phase 7：仕上げと横断的な対応

**目的**：Threads連携の公開範囲の切り替え（FR-028）、Account削除との関係、E2E、全体の確認

- [X] T059 [P] `apps/api/test/integration/access-mode.test.ts`を書く（quickstart.mdの表の「公開範囲の切り替え」）：
  - 未設定・`testers`なら`GET /api/me`が`threadsAccessMode: "testers"`
  - `public`なら`"public"`
  - `foo`なら`500 CONFIG_ERROR`で`details`に`THREADS_ACCESS_MODE`
- [X] T060 `apps/api/src/env.ts`に任意の`THREADS_ACCESS_MODE`を足し、`apps/api/src/lib/config.ts`で値が未設定・`testers`・`public`以外なら`THREADS_ACCESS_MODE`を設定の誤りにする。`apps/api/src/routes/me.ts`のレスポンスと`meResponseSchema`（`packages/shared/src/schemas.ts`）に`threadsAccessMode`を足す（research.md R15）
- [X] T061 `apps/web/src/pages/account-new.tsx`で、`TESTER_NOTICE`を`threadsAccessMode === "testers"`のときだけ出す（contracts/ui-routes.md「アカウント追加画面の案内」）。`apps/web/test/account-new-limit.test.tsx`に、`public`では出ないことを足す
- [X] T062 [P] `apps/api/test/integration/profile-cascade.test.ts`を書く（quickstart.mdの表の「Accountの削除」）：課題・宣伝内容・参考投稿・キーワードを持つAccountを`DELETE /api/accounts/:accountId`で削除すると、4つのテーブルの行がすべて消える。Metaのデータ削除要求の処理でも同じ
- [X] T063 [P] `e2e/tests/strategy.spec.ts`を書く：ログイン → Accountの接続（偽のThreadsサーバー）→ 課題に入力して保存 → 再読み込みで復元される。未保存のままサイドバーで移動すると確認のダイアログが出る
- [X] T064 `pnpm lint`・`pnpm typecheck`・`pnpm test`を通す。新しくexportした関数・コンポーネントすべてにJSDocを付ける（001で導入した`eslint-plugin-jsdoc`の規則）
- [ ] T065 quickstart.mdの「手動の確認」1〜7を、`pnpm dev:fake`で375・768・1024・1440pxの4つの幅で行い、docs/ui-design.mdとずれた点があれば直す。タブレット（768〜1023px）の見え方の結果をdocs/ui-design.md「10. まだ決めていないこと」に反映する
- [X] T066 [P] `specs/001-login-account-setup/contracts/ui-routes.md`の「レイアウトの骨格」に、「2026-10-03以降はdocs/ui-design.mdを正とする」と1行足す

---

## 依存関係と実行順

### フェーズの依存

- **Phase 1（セットアップ）**：すぐ始められる
- **Phase 2（基盤）**：Phase 1の後。**すべてのユーザーストーリーを止める**
- **Phase 3〜6（US1〜US4）**：Phase 2の後。互いに独立しているので、優先度順に1つずつ進めても、並行して進めてもよい
  - US4（ホーム）は、件数を数えるテーブルがPhase 2のマイグレーションで揃っているので、US1〜US3がなくても作れる。ただし手動の確認は、US1〜US3の画面があるほうがしやすい
- **Phase 7（仕上げ）**：T059〜T061（公開範囲の切り替え）はPhase 2の後ならいつでもよい。T062〜T066はすべてのストーリーの後

### ストーリーの中の順番

- テスト → 共通のスキーマ・判定 → APIのサービス・ルート → Webのクライアント → 画面 → ルーターとサイドバー
- 同じファイル（`apps/web/src/router.tsx`、`apps/web/src/components/layout/Sidebar.tsx`、`packages/shared/src/schemas.ts`、`apps/web/src/lib/api-client.ts`、`apps/api/src/app.ts`）を触るタスクは、ストーリーをまたいで並行にしない

## 並行して進められる例

### Phase 2

```text
T004 limits.ts ／ T005 text.ts ／ T006 access.ts（共通）
T011 grower-access.ts ／ T012 item-service.ts ／ T013 テストの部品（API）
T014 色の変数 ／ T019 PageHeader ／ T021 dialog ／ T022 use-unsaved-changes ／ T023 ダイアログ2つ ／ T024 FieldWithCounter ／ T025 GrowerRequiredNotice（Web）
```

### US1

```text
T027 shared のテスト ／ T028 API のテスト ／ T029 Web のテスト ／ T030 strategy.ts
```

### US2

```text
T037 shared のテスト ／ T038 API のテスト ／ T039 promotions.ts ／ T043 PromotionFormDialog
```

## 実装の進め方

### MVP（US1だけ）

1. Phase 1・2を終える（001の画面の手直しを含む）
2. Phase 3（US1 課題）を終える
3. **止めて確認**：quickstart.md「手動の確認 1・2」と、4つの画面幅で課題の画面を確かめる
4. ここで、プロダクトオーナーの「たくみ」「AI部」の課題をスプレッドシートから移せる（SC-001の一部）

### 少しずつ足す

1. US1 → US2（宣伝内容）→ US3（リサーチ）→ US4（ホーム）の順に足し、それぞれ単独で確かめる
2. Phase 7で、公開範囲の切り替え・Account削除との関係・E2E・全体の確認を行う

## メモ

- [P]のタスクは、別のファイルを触り、未完了のタスクに依存しない
- 各タスク、または論理的なまとまりごとにコミットする
- APIの書き込みは、必ず`findOwnedAccount` → `requireGrowerAccess` → 入力の検証の順で確かめる（FR-023・FR-024）
- 入力内容は文字として表示するだけにし、`dangerouslySetInnerHTML`は使わない（research.md R13）
