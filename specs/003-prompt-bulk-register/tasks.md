---
description: "AIプロンプトの生成と投稿案の一括登録の実装タスク"
---

# タスク（Tasks）：AIプロンプトの生成と投稿案の一括登録

**入力**：`specs/003-prompt-bulk-register/`の設計文書

**前提**：[plan.md](./plan.md)、[spec.md](./spec.md)、[research.md](./research.md)、[data-model.md](./data-model.md)、[contracts/api.md](./contracts/api.md)、[contracts/prompt-template.md](./contracts/prompt-template.md)、[contracts/ui-routes.md](./contracts/ui-routes.md)、[quickstart.md](./quickstart.md)、[reference-prompt.md](./reference-prompt.md)、[docs/ui-design.md](../../docs/ui-design.md)

**テスト**：quickstart.mdの「自動テスト」の表にあるテストを、該当するフェーズで先に書く（失敗することを確認してから実装する）。

**構成**：ユーザーストーリーごとにフェーズを分け、各ストーリーを単独で実装・テストできるようにする。

## 書式：`[ID] [P?] [Story] 説明`

- **[P]**：並行して進められる（別ファイルで、未完了のタスクに依存しない）
- **[Story]**：対応するユーザーストーリー（US1〜US3）
- 説明には、変更するファイルのパスを含める

## パスの規約（plan.mdの構成）

- API：`apps/api/src/`、テストは`apps/api/test/`
- Web：`apps/web/src/`、テストは`apps/web/test/`
- 共通：`packages/shared/src/`、テストは`packages/shared/test/`

## 002から使い回す部品

- API：`findOwnedAccount`（`apps/api/src/services/access.ts`）、`requireGrowerAccess`・`canEditProfile`（`apps/api/src/services/grower-access.ts`）、`assertItemId`・`updateWithVersion`（`apps/api/src/services/item-service.ts`）、`parseBody`（`apps/api/src/lib/validate.ts`）、`withTransaction`（`apps/api/src/db/client.ts`）、テストの`createUserWithAccount`・`setAccount`・`AFTER_TRIAL`（`apps/api/test/helpers/app.ts`）
- Web：`PageHeader`・`PageBody`、`useUnsavedChanges`、`useItemForm`・`FormDialogFrame`・`DeletedElsewhereNotice`・`ConfirmDeleteDialog`、`FieldWithCounter`、`GrowerRequiredDialog`・`PLAN_CHANGE_CONTACT`、`isStale`・`isGrowerRequired`・`saveErrorMessage`、`formatDateTime`

---

## Phase 1：セットアップ

本featureで足す依存はない（plan.md「技術コンテキスト」）。Phase 1のタスクはなし。

---

## Phase 2：基盤（すべてのユーザーストーリーの前提）

**目的**：共通の判定関数（分割・Threadsの長さ）、DB、エラーコード、投稿ストックの画面の骨組みとサイドバーを用意する

**⚠️ このフェーズが終わるまで、ユーザーストーリーの作業は始めない**

### 共通パッケージ

- [X] T001 [P] `packages/shared/test/drafts.test.ts`と`packages/shared/test/threads-text.test.ts`を書く（失敗を確認する）。quickstart.mdの表の次の行をすべて含める。
  - `drafts.test.ts`：「分割の基本」「区切りの揺れ」「前後の空白・空の部分」「区切りなし」。区切りの揺れは、行全体が` @@@ `・`＠＠＠`・`@@@@`・`**@@@**`・`` `@@@` ``のとき分割し、`本文の中の@@@`（行の一部）では分割しないこと。改行`\r\n`・`\r`も扱えること。外部LLMが付けた番号（`1. `・`【1】`）は消さず、そのまま本文に残ること（spec エッジケース）
  - `threads-text.test.ts`：「Threadsの長さ」。日本語100文字は100、「😀」は4、「🇯🇵」は8、ZWJで結合した絵文字「👨‍👩‍👧」はそのUTF-8のバイト数（18）。`countLinks`は`https://a.example/x`・`http://b.example`・`www.c.example`をそれぞれ1と数える。上限の判定（`threadsLength > 500`または`countLinks > 5`で超え）
- [X] T002 [P] `packages/shared/src/drafts.ts`に`splitDrafts(text: string): { parts: string[]; delimiterFound: boolean }`を作る（research.md R3）。
  1. 改行を`\n`にそろえる
  2. 各行をNFKC正規化し、前後の空白と`*`・`_`・`` ` ``を除いた結果が`/^@{3,}$/`に一致する行を区切りの行とする
  3. 区切りの行で分け、各部分は**元の文字のまま**（NFKCをかけない）前後の空白・改行を取り除き、空の部分は捨てる
  4. 区切りの行が1つもなければ、全体を前後の空白を除いて1件にし`delimiterFound: false`
- [X] T003 [P] `packages/shared/src/threads-text.ts`に`THREADS_TEXT_LIMIT = 500`、`THREADS_LINK_LIMIT = 5`、`threadsLength(text)`、`countLinks(text)`、`isOverThreadsLimit(text)`を作る（research.md R4、FR-013）。
  - `Intl.Segmenter`（`granularity: "grapheme"`）で書記素に分ける
  - 書記素が`/\p{Extended_Pictographic}|\p{Regional_Indicator}/u`に一致すれば、その書記素のUTF-8のバイト数を足す（コードポイントから計算：`< 0x80`は1、`< 0x800`は2、`< 0x10000`は3、それ以外は4。`TextEncoder`は使わない）
  - それ以外は、書記素のコードポイントの数を足す
  - `countLinks`は`/https?:\/\/\S+|\bwww\.\S+/gi`の一致数
- [X] T004 `packages/shared/src/limits.ts`に、`PASTE_MAX_DRAFTS = 50`、`PASTE_MAX_CHARS = 50000`、`DRAFT_BODY_MAX = 2000`、`NEEDS_REVIEW_LIMIT = 500`、`PROMPT_COUNT_MIN = 1`、`PROMPT_COUNT_MAX = 50`、`PROMPT_COUNT_DEFAULT = 30`、`PROMPT_REFERENCE_POSTS = 10`、`PROMPT_RECENT_DRAFTS = 20`、`PROMPT_LENGTH_TARGET = 30000`を足す
- [X] T005 `packages/shared/src/errors.ts`の`ERROR_CODES`に`PASTE_TOO_LARGE`を足し、`errorMessage`に「一度に登録できるのは50件・50,000文字まで、1件は2,000文字までです。分けて貼り付けてください。」（action `none`）を足す。`packages/shared/src/index.ts`から`drafts`・`threads-text`をexportする
- [X] T006 `packages/shared/src/schemas.ts`に、contracts/api.mdの型のスキーマを足す。
  - `postDraftSchema`（`status`は`z.enum(["needs_review"])`）、`postDraftListSchema`（`items`・`limit`・`canGeneratePrompt`・`promptPostCount`）
  - `createDraftBatchRequestSchema`（`clientRequestId: z.string().uuid()`、`text`は空白だけでない文字列）、`draftBatchResultSchema`（`batchId`・`draftCount`・`delimiterFound`・`overLimitCount`・`drafts`）
  - `updatePostDraftRequestSchema`（`body`は`requiredText(DRAFT_BODY_MAX)`、`expectedVersion`は1以上の整数）、`deletePostDraftsRequestSchema`（`ids`はUUIDの配列で1〜500件）、`deleteCountSchema`（`deletedCount`）
  - `promptSummarySchema`、`promptResponseSchema`（`prompt`・`count`・`summary`）、`promptSettingsSchema`（`postCount`は1〜50の整数）

### DB

- [X] T007 `apps/api/src/db/schema.ts`に、data-model.mdのとおり次を足す。
  - **列挙型**：`post_draft_status`（`needs_review`）
  - **`accounts`**：`prompt_post_count`（smallint、NOT NULL、既定値30、`1 <= 値 <= 50`）
  - **`draft_batches`**：`id`（uuid、PK）、`account_id`（NOT NULL、FK → `accounts.id` ON DELETE CASCADE）、`client_request_id`（uuid、NOT NULL）、`draft_count`（smallint、NOT NULL、`1 <= 値 <= 50`）、`delimiter_found`（boolean、NOT NULL）、`created_at`（timestamptz、NOT NULL）。一意制約`(account_id, client_request_id)`
  - **`post_drafts`**：`id`（uuid、PK）、`account_id`（NOT NULL、FK → `accounts.id` ON DELETE CASCADE）、`batch_id`（NOT NULL、FK → `draft_batches.id` ON DELETE CASCADE）、`position`（smallint、NOT NULL、`0 <= 値 < 50`）、`body`（text、NOT NULL、`1 <= char_length <= 2000`）、`status`（post_draft_status、NOT NULL、既定値`needs_review`）、`version`（integer、NOT NULL、既定値1）、`created_at`・`updated_at`。一意制約`(batch_id, position)`、インデックス`(account_id, status)`
- [X] T008 `pnpm --filter api db:generate --name post_drafts`でマイグレーション（`apps/api/drizzle/0002_post_drafts.sql`）を作り、ローカルDBに当てて、既存のAccountに`prompt_post_count = 30`が入ることを確かめる。`apps/api/test/helpers/app.ts`の`resetDb`と`e2e/tests/helpers.ts`の`resetAll`の`TRUNCATE`に`draft_batches`・`post_drafts`を足す

### Webの骨組み

- [X] T009 [P] `apps/web/src/lib/api-client.ts`の`api`に、本featureの呼び出し（`getPrompt(accountId, count?)`・`putPromptSettings`・`listPostDrafts`・`createDraftBatch`・`deleteDraftBatch`・`updatePostDraft`・`deletePostDrafts`）を、T006のスキーマで検証する形で足す。`apps/web/src/lib/query.ts`の`queryKeys`に`prompt(id, count)`（`["account", id, "prompt", count]`）・`postDrafts(id)`（`["account", id, "post-drafts"]`）を足す
- [X] T010 `apps/web/src/pages/stock.tsx`に投稿ストックの画面の骨組みを作る（contracts/ui-routes.md「投稿ストックの画面」、docs/ui-design.md 型C）：`PageHeader`（「投稿ストック」）、上部のカードの場所、状態のタブ（「要確認 {件数}」）と一覧の場所、画面下部に固定の貼り付け欄の場所（`md`未満は`pb-[env(safe-area-inset-bottom)]`で下端の操作バーを避ける）。`listPostDrafts`で一覧を取得し、読み込み中・失敗（`ApiErrorScreen`）を扱う
- [X] T011 `apps/web/src/router.tsx`に`/accounts/:accountId/stock`を足し、`apps/web/src/components/layout/Sidebar.tsx`に「投稿をつくる」（`SquarePen`。Accountの切り替えのすぐ下。押すと`/accounts/:id/stock`へ移動し、`location.state`の`focusComposer: true`で貼り付け欄にフォーカスを当てる）と、見出しなしの欄の「ホーム」の下に「投稿ストック」（`Inbox`）を足す（FR-021）

**完了条件**：`pnpm --filter @threads-grower/shared test`（T001）が通る。002までの既存のテストが引き続き通る。サイドバーから投稿ストックの画面（空の骨組み）を開ける

---

## Phase 3：ユーザーストーリー1 - プロンプトを作ってコピーする（優先度：P1）🎯 MVP

**ゴール**：戦略プロファイルを反映したプロンプトを、件数を選んでコピーできる。プラン1（無料体験の後）では案内に変わる

**単独でのテスト**：課題・宣伝内容・リサーチを入力済みのAccountでプロンプトをコピーし、入力した内容と出力の形の指示が含まれていることを確かめる（quickstart.md「手動の確認 1」）

### テスト（先に書いて失敗を確認する）

- [ ] T012 [P] [US1] `packages/shared/test/prompt.test.ts`を書く（quickstart.mdの表の「プロンプトの節」「宣伝に絡める件数」「参考投稿と下書きの上限」「長さの目安」）。
  - 入力済みの課題の項目だけが含まれ、プロフィール文・固定投稿の下書きは含まれない。人柄は表示名（「丁寧・温かい」）で含まれる
  - 材料のない節（課題0項目・宣伝の対象0件・割合0%・参考投稿0件・下書き0件）は見出しごと省かれる
  - 件数30・割合20%で「6件程度」、件数3・割合10%で「1件程度」（0のときは1）
  - 参考投稿は新しい順に10件、下書きは新しい順に20件まで。要約の件数が実際に含めた件数と一致する
  - 30,000文字を超える材料では、下書き → 参考投稿の順に古いものから減らして収める
  - 区切りの数の指示が「{件数-1}個」になり、最後の案内が「ThreadsGrowerの投稿ストックの画面にある貼り付け欄」になる
- [ ] T013 [P] [US1] `apps/api/test/integration/prompt.test.ts`を書く。
  - `GET /prompt`が保存済みの課題・宣伝の対象・参考投稿・直近の下書きを反映し、`count`省略時はAccountの`prompt_post_count`（既定30）を使う。`count=0`・`count=51`は`400`
  - `PUT /prompt-settings`で保存した件数が次の`GET /prompt`と`GET /post-drafts`の`promptPostCount`に反映される。`0`・`51`・`1.5`は`400`
  - 「プロンプトのプラン判定」：無料体験の後のプラン1は`GET /prompt`・`PUT /prompt-settings`が`403 GROWER_FEATURE_REQUIRED`、`GET /post-drafts`は`canGeneratePrompt: false`で`200`
  - 他人のAccountは`404 ACCOUNT_NOT_FOUND`、要再接続のAccountでも`200`
- [ ] T014 [P] [US1] `apps/web/test/stock.test.tsx`に、プロンプトのカードのテストを書く。
  - 要約（「課題 11/16・宣伝の対象 1件・参考投稿 3件を反映」）が出て、「コピー」で`navigator.clipboard.writeText`に全文が渡り、トーストが出る
  - 「コピーの失敗」：`writeText`が失敗すると、全文の欄が開いて全選択され、「自動でコピーできませんでした…」が出る
  - 「プロンプトを見る」で全文を書き換えてからコピーすると、書き換えた内容が渡る。「元に戻す」で元に戻る
  - 「プラン1の表示」：`canGeneratePrompt: false`では、プロンプトのカードの代わりに「AIプロンプトの生成はプラン2以上で使えます」が出て、`getPrompt`を呼ばない
  - 課題が0項目なら、要約の代わりに「課題を入力すると、投稿の精度が上がります」と課題の画面へのリンクが出る
  - 投稿ストックの画面を開くたびに`getPrompt`を呼ぶ（別の画面で戦略プロファイルを保存した後に開くと、新しいプロンプトになる。FR-007）

### 実装

- [ ] T015 [US1] `packages/shared/src/prompt.ts`に`buildPrompt(input): { prompt: string; summary: PromptSummary }`を作り、`packages/shared/src/index.ts`からexportする。
  - 文面は[contracts/prompt-template.md](./contracts/prompt-template.md)のとおり。「短文・中文・長文」と「出力形式」の節は、[reference-prompt.md](./reference-prompt.md)の原文を、prompt-template.mdに書いた差分だけ変えて埋め込む
  - 課題の項目の見出しと順は、prompt-template.mdの「アカウントの戦略設計」の表のとおりにする（002の`STRATEGY_FIELDS`のうち`counted: true`のもの）
  - 宣伝に絡める件数は`Math.max(1, Math.round(count * ratio / 100))`、型を使う件数は`Math.min(3, count)`
  - 長さの目安（30,000文字）を超えたら、直近の下書き → 参考投稿の順に、古いものから1件ずつ減らして組み立て直す
- [ ] T016 [US1] `apps/api/src/services/prompt-service.ts`に、材料を集めて`buildPrompt`を呼ぶ`getPrompt(db, account, count)`を作る（research.md R1）。課題（002の`getStrategy`）、宣伝の対象（002の宣伝内容から`isTargetable`のものを、掲載期限の近い順・期限なしは最後・同じなら優先度の高い順に）、宣伝投稿の割合、参考投稿（新しい順に10件）、要確認の下書き（登録の新しい順に20件）を、並べて（`Promise.all`）取得する。表示名はAccountの`displayName`、なければ`@username`
- [ ] T017 [US1] `apps/api/src/routes/prompt.ts`に`GET /api/accounts/:accountId/prompt`と`PUT /api/accounts/:accountId/prompt-settings`を作り、`apps/api/src/app.ts`に登録する。どちらも`findOwnedAccount` → `requireGrowerAccess`の順で確かめる。`count`のクエリは1〜50の整数で、範囲外は`400 VALIDATION_FAILED`（`details: ["count"]`）。`PUT`は`accounts.prompt_post_count`を更新する（競合は検知しない）
- [ ] T018 [P] [US1] `apps/web/src/components/stock/PromptCard.tsx`を作る（contracts/ui-routes.md「プロンプトのカード」）。
  - 見出し、要約、作る件数の入力欄（1〜50。変えたら0.5秒後に`putPromptSettings`で保存し、`getPrompt`を取り直す）、「コピー」、「プロンプトを見る」（開閉。全文の`Textarea`と「元に戻す」）
  - コピーは`navigator.clipboard.writeText`。失敗したら全文の欄を開いて`select()`し、カードの中に案内を出す（research.md R13）
  - プロンプトの取得の失敗は、カードの中に原因と「再読み込み」を出す
  - `canGeneratePrompt: false`のときは、案内の表示（「AIプロンプトの生成はプラン2以上で使えます」、貼り付けで登録できること、`PLAN_CHANGE_CONTACT`）に切り替える
- [ ] T019 [US1] `apps/web/src/pages/stock.tsx`の上部のカードの場所に`PromptCard`を置く。`listPostDrafts`の`canGeneratePrompt`・`promptPostCount`を渡す

**完了条件**：T012〜T014が通り、quickstart.md「手動の確認 1」ができる

---

## Phase 4：ユーザーストーリー2 - 外部LLMの回答を貼り付けて一括登録する（優先度：P1）

**ゴール**：貼り付けた回答を「@@@」で分割して「要確認」として一括登録し、一覧に並べる。登録直後の案内で取り消せる

**単独でのテスト**：「@@@」で区切った3件を貼り付けて送り、一覧に3件が貼り付けた順で増えること、「取り消す」で消えることを確かめる（quickstart.md「手動の確認 2」）

### テスト（先に書いて失敗を確認する）

- [ ] T020 [P] [US2] `apps/api/test/integration/post-drafts.test.ts`に、一括登録のテストを書く（quickstart.mdの表の次の行）。
  - 「一括登録は全プラン」「二重送信」「1回の上限」（51件・50,001文字・2,001文字の1件で`400 PASTE_TOO_LARGE`、何も登録されない、`details`がcontracts/api.mdのとおり）「下書きの上限と同時実行」（要確認490件に6件と6件を同時に送ると片方だけ成功）「並び順」「取り消し」
  - 区切りなしで`delimiterFound: false`の1件、Threadsの上限を超える下書きが`overLimitCount`に数えられる
  - 他人のAccountは`404`、要再接続のAccountでも`201`
- [ ] T021 [P] [US2] `apps/web/test/stock.test.tsx`に、貼り付け欄のテストを足す。
  - 「登録と取り消し」：貼り付けて送ると「{n}件を登録しました」が出て一覧の先頭に並び、「取り消す」で一覧から消えて欄に内容が戻る
  - 送信中は送るボタンと欄が無効になり、送信を再試行するときは同じ`clientRequestId`を送る
  - 空・空白だけのときは送れない。51件分を貼ると、送らずに上限の案内が出る
  - 区切りなし・上限を超える下書きがあるときの案内の文言
  - 登録で`409 ITEM_LIMIT_REACHED`を受けると、投稿ストック用の上限の文言が出て、再試行は出ず、一覧を取り直す。`400 PASTE_TOO_LARGE`（`details: ["draft:12"]`）では「12件目」が案内に出る
  - 書きかけの内容があるまま移動しようとすると、未保存の警告が出る（`UnsavedChangesProvider`で包む）

### 実装

- [ ] T022 [US2] `apps/api/src/services/draft-service.ts`に`createDraftBatch(env, accountId, { clientRequestId, text })`を作る（research.md R3・R5・R6）。
  1. `splitDrafts`で分割する。50件を超える・全体が50,000文字を超える・1件が2,000文字を超える場合は`400 PASTE_TOO_LARGE`（`details`はcontracts/api.mdのとおり）
  2. `withTransaction`の中で`pg_advisory_xact_lock(hashtextextended('account_items:<accountId>:post_drafts', 0))`を取る
  3. 同じ`(account_id, client_request_id)`の`draft_batches`があれば、新しく登録せず、その登録と今も残っている下書きを返す（呼び出し側は`200`）
  4. 要確認の下書きの件数＋今回の件数が500を超えれば`409 ITEM_LIMIT_REACHED`
  5. `draft_batches`の行と、`position`を0から振った`post_drafts`の行をまとめて作り、`overLimitCount`（`isOverThreadsLimit`の件数）を数えて返す（呼び出し側は`201`）
  - 外部キー違反（`23503`）は`404 ACCOUNT_NOT_FOUND`
- [ ] T023 [US2] `apps/api/src/services/draft-service.ts`に、一覧の取得`listDrafts(db, accountId)`（`draft_batches.created_at`の降順 → `position`の昇順。要確認だけ）と、取り消し`deleteBatch(db, accountId, batchId)`（その登録の要確認の下書きだけを削除して件数を返す。登録のまとまりの行は残す）を足す
- [ ] T024 [US2] `apps/api/src/routes/post-drafts.ts`に`GET /api/accounts/:accountId/post-drafts`（`items`・`limit: 500`・`canGeneratePrompt`（`canEditProfile`）・`promptPostCount`）、`POST /api/accounts/:accountId/draft-batches`（`201`／二重送信は`200`）、`DELETE /api/accounts/:accountId/draft-batches/:batchId`（`assertItemId`、なければ`404 ITEM_NOT_FOUND`）を作り、`apps/api/src/app.ts`に登録する。grower機能は判定しない（research.md R10）
- [ ] T025 [P] [US2] `apps/web/src/components/stock/ThreadsLengthBar.tsx`を作る（contracts/ui-routes.md「各下書き」の長さの表示、Clarifications Q3）：「{threadsLength}文字」と、500までの使用量の細いバー。80%を超えたら手前の色、超えたら注意の色と「Threadsの上限を超えています（500文字まで）」。リンクが6個以上なら「リンクは5個までです」
- [ ] T026 [US2] `apps/web/src/components/stock/DraftList.tsx`を作る（contracts/ui-routes.md「状態のタブと下書きの一覧」）：登録のまとまりごとの小見出し「{登録日時}に登録した{n}件」、各下書きの本文（改行を保って6行まで、「もっと見る」）と`ThreadsLengthBar`と登録日時、空の状態の文言（`canGeneratePrompt`で切り替え）、500件に達したときの案内
- [ ] T027 [US2] `apps/web/src/components/stock/PasteComposer.tsx`を作る（contracts/ui-routes.md「貼り付け欄」「登録直後の案内」）。
  - 複数行の欄（最大8行まで伸びる）、送るボタン（読み上げ名「投稿ストックに登録する」）、下の説明文
  - 送る前に`splitDrafts`で上限を確かめ、超えていれば送らずに案内を出す
  - 送信ごとに`crypto.randomUUID()`で`clientRequestId`を作り、失敗して再試行するときは同じIDを使う。成功したら欄を空にする。失敗したら内容を残し、次のように案内する。
    - `400 PASTE_TOO_LARGE`：ui-routes.md「エラー文言」の文言。`details`が`draft:N`ならN件目が長いことも出す。再試行は出さない
    - `409 ITEM_LIMIT_REACHED`：ui-routes.md「エラー文言」の投稿ストック用の文言を出し、再試行は出さず、一覧を取り直す（上限の案内と送るボタンの無効化が出る）
    - それ以外（通信の失敗など）：002の`saveErrorMessage`の文言と「もう一度送る」
  - 送った内容を手元に覚えておき、登録直後の案内（件数、区切りなし、上限を超える件数、「取り消す」「閉じる」）を出す。「取り消す」で`deleteDraftBatch`を呼び、欄に内容を戻してトースト「{n}件の登録を取り消しました」
  - 書きかけの内容を`useUnsavedChanges`に登録する。`location.state.focusComposer`のときは欄にフォーカスを当てる
- [ ] T028 [US2] `apps/web/src/pages/stock.tsx`の一覧の場所に`DraftList`、下部の場所に`PasteComposer`を置き、登録・取り消しのあとに`queryKeys.postDrafts(id)`と、`["account", id, "prompt"]`で始まるキー（件数によらず、すべてのプロンプト）を古いものとして扱う

**完了条件**：T020・T021が通り、quickstart.md「手動の確認 2」ができる

---

## Phase 5：ユーザーストーリー3 - 登録した下書きを確認・修正・削除する（優先度：P2）

**ゴール**：要確認の下書きを編集・1件ずつ削除・まとめて削除できる

**単独でのテスト**：下書きを1件書き直して一覧に反映されること、3件を選んでまとめて削除できることを確かめる（quickstart.md「手動の確認 3」）

### テスト（先に書いて失敗を確認する）

- [ ] T029 [P] [US3] `apps/api/test/integration/post-drafts.test.ts`に、編集と削除のテストを足す（quickstart.mdの表の「まとめての削除」「編集の競合」）。
  - `PUT /post-drafts/:id`で本文を更新し`version`が1増える。空白だけ・2,001文字は`400`。同じ`expectedVersion`の2回目は`409 STALE_UPDATE`（`latest`付き）。削除済みは`404 ITEM_NOT_FOUND`
  - `POST /post-drafts/delete`は自分のAccountの要確認の下書きだけを消し、他人のAccountの下書きのIDは無視して`deletedCount`に数えない。0件・501件・UUIDでないIDは`400`
  - 要再接続のAccountでも、`PUT /post-drafts/:id`・`POST /post-drafts/delete`・`DELETE /draft-batches/:id`が使える（FR-025）
- [ ] T030 [P] [US3] `apps/web/test/stock.test.tsx`に、選択と編集のテストを足す。
  - 下書きを選ぶと貼り付け欄の位置に選択のバー（「{n}件を選択中」「選択を解除」「選んだ下書きを削除」）が出て、確認のうえ`deletePostDrafts`に選んだIDが渡る
  - 「⋯」の「編集」で本文を直して保存すると一覧に反映される。`409`で競合のダイアログが出る

### 実装

- [ ] T031 [US3] `apps/api/src/services/draft-service.ts`に、編集`updateDraft(db, accountId, id, { body, expectedVersion })`（002の`updateWithVersion`。要確認の下書きだけを対象にし、本文の前後の空白を除いて保存する）と、まとめての削除`deleteDrafts(db, accountId, ids)`（そのAccountの要確認の下書きだけを削除して件数を返す）を足す
- [ ] T032 [US3] `apps/api/src/routes/post-drafts.ts`に`PUT /api/accounts/:accountId/post-drafts/:draftId`と`POST /api/accounts/:accountId/post-drafts/delete`を足す（contracts/api.md）
- [ ] T033 [P] [US3] `apps/web/src/components/stock/DraftEditDialog.tsx`を作る（contracts/ui-routes.md「下書きの編集」）：002の`useItemForm`・`FormDialogFrame`で、見出し「下書きを編集」、本文（必須、2,000文字まで）と、その下に`ThreadsLengthBar`
- [ ] T034 [US3] `apps/web/src/components/stock/DraftList.tsx`に、各下書きのチェックボックス（押せる範囲は44px角以上）、要確認のタブの見出しの「すべて選択」、「⋯」メニュー（「編集」「削除」）を足す。1件の削除は`ConfirmDeleteDialog`のあと`deletePostDrafts`（IDを1つ）を呼ぶ
- [ ] T035 [US3] 選択の状態（選んだ下書きのID）は`apps/web/src/pages/stock.tsx`で持ち、`DraftList`と`PasteComposer`に渡す。`apps/web/src/components/stock/PasteComposer.tsx`は、選択が1件以上あるとき、貼り付け欄の代わりに選択のバーを描く。「選んだ下書きを削除」は確認のダイアログ（「{n}件の下書きを削除しますか？ 元に戻せません。」）のあと`deletePostDrafts`を呼び、成功したら選択を解除して一覧を取り直す

**完了条件**：T029・T030が通り、quickstart.md「手動の確認 3」ができる

---

## Phase 6：仕上げと横断的な対応

**目的**：ホームの案内、Account削除との関係、全体の確認

- [ ] T036 [P] `apps/web/src/pages/account-home.tsx`の「次にやること」の4つ目（すべての材料がそろったとき）を、大見出し「投稿をつくりましょう」・説明「プロンプトをChatGPTやClaudeに送り、返ってきた投稿案を投稿ストックに登録します。」・「投稿ストックへ」のボタン（`/accounts/:id/stock`）に変える（contracts/ui-routes.md「ホーム」）。`apps/web/test/account-home.test.tsx`の該当するテストを直す
- [ ] T037 [P] `apps/api/test/integration/profile-cascade.test.ts`に、登録のまとまりと下書きを持つAccountを削除すると、`draft_batches`・`post_drafts`の行がすべて消えることを足す（FR-026。Account削除とMetaのデータ削除要求の両方）
- [ ] T038 `pnpm lint`・`pnpm typecheck`・`pnpm test`を通す。新しくexportした関数・コンポーネントすべてにJSDocを付ける
- [ ] T039 quickstart.mdの「手動の確認」1〜4を、`pnpm dev:fake`で375・768・1024・1440pxの4つの幅で行う。実際にChatGPTかClaudeにプロンプトを送り、30件の回答を貼り付けて登録できることを確かめる（SC-007）。50件・合計約30,000文字の回答を貼り付けて送り、登録の案内が出るまで待たされないこと（plan.md 性能目標の目安：500ms以内）を確かめる

---

## 依存関係と実行順

### フェーズの依存

- **Phase 2（基盤）**：すぐ始められる。**すべてのユーザーストーリーを止める**
- **Phase 3（US1）・Phase 4（US2）**：Phase 2の後。互いに独立していて、どちらからでも始められる。ただし、US1のプロンプトに「直近の下書き」が入ることを手動で確かめるには、US2の登録がある方がしやすい
- **Phase 5（US3）**：Phase 4（一覧と`draft-service.ts`）の後
- **Phase 6（仕上げ）**：T036・T037はPhase 2の後ならいつでもよい。T038・T039はすべてのストーリーの後

### ストーリーの中の順番

- テスト → 共通の関数 → APIのサービス・ルート → Webの部品 → 画面への組み込み
- 同じファイル（`apps/web/src/pages/stock.tsx`、`apps/web/src/components/stock/DraftList.tsx`、`apps/web/src/components/stock/PasteComposer.tsx`、`apps/api/src/services/draft-service.ts`、`apps/api/src/routes/post-drafts.ts`、`apps/web/test/stock.test.tsx`、`apps/api/test/integration/post-drafts.test.ts`、`apps/api/src/app.ts`）を触るタスクは、ストーリーをまたいで並行にしない

## 並行して進められる例

### Phase 2

```text
T001 共通のテスト ／ T002 drafts.ts ／ T003 threads-text.ts ／ T009 APIクライアント
```

### US1

```text
T012 prompt のテスト ／ T013 API のテスト ／ T014 Web のテスト ／ T018 PromptCard
```

### US2

```text
T020 API のテスト ／ T021 Web のテスト ／ T025 ThreadsLengthBar
```

## 実装の進め方

### MVP（US1＋US2）

1. Phase 2を終える
2. Phase 3（US1 プロンプト）とPhase 4（US2 一括登録）を終える
3. **止めて確認**：実際に外部LLMにプロンプトを送り、回答を貼り付けて登録できる（UJ-1の後半が通る）

US1だけでもプロンプトのコピーは使えるが、貼り付けて登録できないと流れが完結しないため、MVPはUS1とUS2の両方とする。

### 少しずつ足す

1. US1 → US2 → US3（確認・修正・削除）の順に足し、それぞれ単独で確かめる
2. Phase 6で、ホームの案内・Account削除との関係・全体の確認を行う

## メモ

- [P]のタスクは、別のファイルを触り、未完了のタスクに依存しない
- 各タスク、または論理的なまとまりごとにコミットする
- 下書きは本featureでは「要確認」のまま。Threadsへの投稿や承認の操作は作らない（Constitution原則II、FR-012）
- 入力内容は文字として表示するだけにし、`dangerouslySetInnerHTML`は使わない（002 research.md R13）
