---
description: "重複検知・承認/却下・NGワード（CORE RULES）の実装タスク"
---

# タスク（Tasks）：重複検知・承認/却下・NGワード（CORE RULES）

**入力**：`specs/004-review-approval/`の設計文書

**前提**：
- [plan.md](./plan.md)、[spec.md](./spec.md)、[research.md](./research.md)、[data-model.md](./data-model.md)
- [contracts/api.md](./contracts/api.md)、[contracts/prompt-template.md](./contracts/prompt-template.md)、[contracts/policy-cautions.md](./contracts/policy-cautions.md)、[contracts/ui-routes.md](./contracts/ui-routes.md)
- [quickstart.md](./quickstart.md)、[docs/ui-design.md](../../docs/ui-design.md)、003の[contracts](../003-prompt-bulk-register/contracts/)

**テスト**：quickstart.mdの「自動テスト」の表にあるテストを、該当するフェーズで先に書く（失敗することを確認してから実装する）。

**構成**：ユーザーストーリーごとにフェーズを分け、各ストーリーを単独で実装・テストできるようにする。

## 書式：`[ID] [P?] [Story] 説明`

- **[P]**：並行して進められる（別ファイルで、未完了のタスクに依存しない）
- **[Story]**：対応するユーザーストーリー（US1〜US5）
- 説明には、変更するファイルのパスを含める

## パスの規約（plan.mdの構成）

- API：`apps/api/src/`、テストは`apps/api/test/`
- Web：`apps/web/src/`、テストは`apps/web/test/`
- 共通：`packages/shared/src/`、テストは`packages/shared/test/`

## 002・003から使い回す部品

- **API**：
  - `findOwnedAccount`（`apps/api/src/services/access.ts`）
  - `requireGrowerAccess`・`canEditProfile`（`apps/api/src/services/grower-access.ts`）
  - `assertItemId`・`updateWithVersion`（`apps/api/src/services/item-service.ts`）
  - `parseBody`（`apps/api/src/lib/validate.ts`）
  - `withTransaction`（`apps/api/src/db/client.ts`）
  - `toPostDraft`・`listDraftRows`（`apps/api/src/services/draft-service.ts`）
  - 「Account × 下書き」のロックのキー`account_items:{accountId}:post_drafts`（003の`createDraftBatch`）
  - テストの`createUserWithAccount`・`setAccount`・`AFTER_TRIAL`・`resetDb`・`db`（`apps/api/test/helpers/app.ts`）
- **Web**：
  - `PageHeader`、`useUnsavedChanges`、`useItemForm`・`FormDialogFrame`、`ConflictDialog`、`FieldWithCounter`
  - `GrowerRequiredNotice`・`PLAN_CHANGE_CONTACT`、`SettingRow`（`apps/web/src/components/settings/SettingRow.tsx`）
  - 003の`ThreadsLengthBar`・`DraftList`・`PasteComposer`・`DraftEditDialog`・`messages.ts`、`formatDateTime`
- **共通**：`threadsLength`・`countLinks`・`isOverThreadsLimit`（`packages/shared/src/threads-text.ts`）、`buildPrompt`（`packages/shared/src/prompt.ts`）

---

## Phase 1：セットアップ

本featureで足す依存はない（plan.md「技術コンテキスト」）。Phase 1のタスクはなし。

---

## Phase 2：基盤（すべてのユーザーストーリーの前提）

**目的**：次のものを用意し、003の画面が新しい一覧の形のまま動く状態にする。
- 共通の判定（正規化・NGワード・配信できるか・却下理由）
- 上限・スキーマ
- DBのマイグレーション
- 一覧のAPIの新しい形

**⚠️ このフェーズが終わるまで、ユーザーストーリーの作業は始めない**

### 共通パッケージ

- [X] T001 [P] 共通の判定のテストを書く（失敗を確認する）。
  - `packages/shared/test/normalize.test.ts`：
    - `normalizeForMatch`が1文字ずつNFKC → 小文字にすること（「ＡＢＣ」→「abc」、「ｱｲ」→「アイ」、「ア」はそのまま、「あ」はカタカナにならない）
    - 正規化した位置から元の位置への対応表が、「㌔」（→「キロ」）や絵文字（サロゲートペア）の前後でも正しいこと
  - `packages/shared/test/ng-words.test.ts`：quickstart.mdの表の「NGワードの正規化」「NGワードの強調の位置」の行。あわせて次も確かめる。
    - 1つの本文に同じ語が2回あれば、範囲が2つ返る
    - 複数のNGワードが重なる範囲も返す
    - NGワードが空の配列なら空を返す
  - `packages/shared/test/review.test.ts`：
    - `checkPublishable`：NGワードを含む・Threadsの上限を超える（501文字、リンク6個）・どちらもない、の3通りの結果
    - `REJECT_REASONS`の6つのコードと表示名がresearch.md R10の表のとおりであること
- [X] T002 [P] `packages/shared/src/normalize.ts`に`normalizeForMatch(text: string): { normalized: string; toOriginal: number[] }`を作る（research.md R4）。
  - 元の文字列をコードポイントごとに`String.prototype.normalize("NFKC")`→`toLowerCase()`にかけてつなぐ。
  - `toOriginal[i]`は、正規化した文字列のUTF-16の位置`i`が、元の文字列のどのUTF-16の位置から来たかを表す。最後に、元の長さを1つ足す。
  - 範囲を元の位置に戻す`toOriginalRange(map, start, end): [number, number]`も作る。
- [X] T003 `packages/shared/src/ng-words.ts`に次の2つを作る（T002の後。research.md R4、FR-015・FR-016）。
  - `normalizeNgWord(word: string): string`：前後の空白を除いてから、`normalizeForMatch`の`normalized`を返す。
  - `findNgWords(body: string, ngWords: { word: string; normalized: string }[]): { word: string; ranges: [number, number][] }[]`
    - 照合は`normalizeForMatch(body).normalized`への部分文字列の検索（`indexOf`の繰り返し）。正規表現は使わない。
    - 範囲は、元の本文のUTF-16の位置で返す。
- [X] T004 `packages/shared/src/review.ts`に次を作る（research.md R10・R14）。
  - `REJECT_REASONS`：`[{ code: "similar", label: "似た投稿がある" }, { code: "tone", label: "トーンが違う" }, { code: "thin", label: "内容が薄い" }, { code: "inaccurate", label: "事実と違う" }, { code: "too_promotional", label: "宣伝っぽすぎる" }, { code: "policy", label: "規約に触れそう" }]`
  - `REJECT_REASON_CODES`と`rejectReasonLabel(code)`
  - `checkPublishable(body, ngWords)`。返す値は`{ ngWords: ReturnType<typeof findNgWords>; overThreadsLimit: boolean; policyCautions: [] }`と、`approvable`（NGワードなし、かつ上限内）
    - `policyCautions`はUS5（T055）で中身を入れる。それまでは空の配列を返す。
- [X] T005 `packages/shared/src/limits.ts`に、次の上限を足す。
  - `APPROVED_LIMIT = 500`、`REJECTED_LIST_MAX = 500`、`REVIEW_MAX_ITEMS = 500`
  - `NG_WORD_LIMIT = 200`、`NG_WORD_MAX = 50`
  - `CORE_RULES_MAX = 2000`、`REJECT_NOTE_MAX = 200`
  - `PROMPT_REJECTED_DRAFTS = 10`
  - `SIMILARITY_THRESHOLD = 80`、`SIMILARITY_MIN_LENGTH = 10`、`SIMILARITY_TOP_MATCHES = 3`、`SIMILARITY_EDIT_DISTANCE_MAX_LENGTH = 300`
- [X] T006 `packages/shared/src/schemas.ts`に、contracts/api.mdの型のスキーマを足す・変える。`packages/shared/src/index.ts`から`normalize`・`ng-words`・`review`をexportする。
  - **下書き**：
    - `postDraftStatusSchema`を`z.enum(["needs_review", "approved", "rejected"])`にする
    - `rejectReasonCodeSchema`（`REJECT_REASON_CODES`）を足す
    - `postDraftSchema`に`reviewedAt: z.string().nullable()`・`rejectReasons: z.array(rejectReasonCodeSchema)`・`rejectNote: z.string().nullable()`を足す
  - **一覧と件数**：
    - `draftCountsSchema`（`needsReview`・`approved`・`rejected`）
    - `ngWordSchema`（`id`・`word`・`normalized`・`createdAt`）
    - `postDraftListSchema`を`{ needsReview, approved, rejected, counts, limits: { needsReview, approved }, ngWords, canGeneratePrompt, promptPostCount }`に変える
  - **状態の変更**：
    - `reviewRequestSchema`：`action`は`approve`・`reject`・`reopen`。`items`は`{ id: uuid, expectedVersion: 1以上の整数 }`の1〜`REVIEW_MAX_ITEMS`件で、`id`の重複は不可。`confirmPolicyCaution`は任意のboolean。`reject`は任意
      - `reject`の`reasons`は重複のないコードの配列。`note`は`REJECT_NOTE_MAX`文字まで
      - `action`が`reject`のときだけ`reject`が必須で、`reasons`が1件以上か、`note`が空白でない
      - それ以外の`action`で`reject`があれば不可（`superRefine`で`details: ["reject"]`）
    - `skipReasonSchema`（`NG_WORD`・`OVER_THREADS_LIMIT`・`POLICY_CONFIRM_REQUIRED`・`STALE`・`NOT_FOUND`・`LIMIT`）
    - `reviewResponseSchema`（`updated`・`skipped: { id, reason, latest?: PostDraft }[]`・`counts`）
  - **編集**：`updatePostDraftResponseSchema`（`{ draft, reopened }`）
  - **投稿のルール**：
    - `postingRulesSchema`（`ngWords`・`ngWordLimit`・`coreRules`・`coreRulesVersion`・`canEditCoreRules`）
    - `addNgWordsRequestSchema`：`words`は1〜`NG_WORD_LIMIT`件。各語は、前後の空白を除いて`NG_WORD_MAX`文字まで
    - `addNgWordsResponseSchema`（`added`・`duplicates`・`reopenedCount`）
    - `coreRulesRequestSchema`（`text`は`CORE_RULES_MAX`文字まで、空も可。`expectedVersion`）
    - `coreRulesResponseSchema`（`coreRules`・`coreRulesVersion`）
  - **プロンプト**：`promptSummarySchema`に`coreRuleCount`・`ngWordCount`・`rejectedCount`を足す。`buildPrompt`は、US4（T058）までこの3つを0で返す。

### DB

- [X] T007 `apps/api/src/db/schema.ts`を、data-model.mdのとおりに変える。
  - **列挙型**：`postDraftStatus`を`["needs_review", "approved", "rejected"]`にする
  - **`accounts`**：
    - `core_rules`（text、NOT NULL、既定値`''`、CHECK `char_length(core_rules) <= 2000`）
    - `core_rules_version`（integer、NOT NULL、既定値1）
  - **`post_drafts`**：
    - `reviewed_at`（timestamptz、NULL可）
    - `reject_reasons`（text[]、NULL可）
    - `reject_note`（text、NULL可、CHECK `char_length(reject_note) <= 200`）
    - CHECK制約`post_drafts_review_state`（状態は`status::text`の文字列で比べる。data-model.md）：
      - `status::text = 'needs_review'`：`reviewed_at`・`reject_reasons`・`reject_note`がすべてNULL
      - `status::text = 'approved'`：`reviewed_at`がNOT NULL、`reject_reasons`・`reject_note`がNULL
      - `status::text = 'rejected'`：`reviewed_at`がNOT NULL、かつ`coalesce(cardinality(reject_reasons), 0) >= 1 OR coalesce(btrim(reject_note), '') <> ''`
    - インデックス`(account_id, status, reviewed_at DESC)`を足し、003の`post_drafts_account_status_idx`を消す
  - **`ng_words`**：
    - `id`（uuid、PK）
    - `account_id`（uuid、NOT NULL、FK → `accounts.id` ON DELETE CASCADE）
    - `word`（text、NOT NULL、`1 <= char_length <= 50`）
    - `normalized`（text、NOT NULL）
    - `created_at`（timestamptz、NOT NULL）
    - 一意制約`(account_id, normalized)`
- [X] T008 `pnpm --filter api db:generate --name review_approval`で`apps/api/drizzle/0003_review_approval.sql`を作り、ローカルDBに当てる。
  - 生成されたSQLを確かめ、列挙型の値の追加が`ALTER TYPE "public"."post_draft_status" ADD VALUE 'approved'`・`'rejected'`になっていることを確かめる。drizzleが型を作り直す形で出した場合は、手で`ADD VALUE`に直す。追加した値は、同じマイグレーションの中で列挙型として使わない（data-model.md）。
  - 生成されたSQLのCHECK制約が、状態を`status::text`で比べていることを確かめる。
  - 003の下書きが残ったDBと空のDBの両方に、`db:migrate`を1回で当てられることを確かめる。
  - 003で作った下書きが残ったまま当てられることを確かめる。
  - `apps/api/test/helpers/app.ts`の`resetDb`と、`e2e/tests/helpers.ts`の`resetAll`の`TRUNCATE`に`ng_words`を足す。

### 一覧のAPIの新しい形

- [X] T009 `apps/api/src/services/draft-service.ts`を変える（research.md R9）。
  - `toPostDraft`に`reviewedAt`（ISO 8601またはnull）・`rejectReasons`（NULLなら`[]`）・`rejectNote`を足す。
  - `listAllDrafts(db, accountId)`を足し、次の4つを`Promise.all`で取得して返す。
    - 要確認：003の並び
    - 承認済み：`reviewed_at`の降順、同じなら`id`の降順
    - 却下：`reviewed_at`の降順に`REJECTED_LIST_MAX`件
    - 件数：状態ごとの`count`
  - `countDrafts(db, accountId)`も足す。
  - そのAccountの`ng_words`を古い順に読む`listNgWords(db, accountId)`を、`apps/api/src/services/posting-rules-service.ts`（新規）に作る。
- [X] T010 `apps/api/src/routes/post-drafts.ts`の`GET /post-drafts`を、contracts/api.mdの新しい形（`needsReview`・`approved`・`rejected`・`counts`・`limits`・`ngWords`・`canGeneratePrompt`・`promptPostCount`）にする。`GET /api/accounts/:accountId/post-drafts/counts`も足す。`apps/api/test/integration/post-drafts.test.ts`の一覧のテストを、新しい形に直す。
- [X] T011 Webを新しい形に追従させる。
  - `apps/web/src/lib/api-client.ts`の`listPostDrafts`のスキーマを変え、本featureの呼び出しを足す。
    - `getDraftCounts`、`reviewPostDrafts`、`getPostingRules`、`addNgWords`、`deleteNgWord`、`putCoreRules`
    - `updatePostDraft`の戻り値を`{ draft, reopened }`にする
  - `apps/web/src/lib/query.ts`の`queryKeys`に`draftCounts(id)`（`["account", id, "post-drafts", "counts"]`）と`postingRules(id)`（`["account", id, "posting-rules"]`）を足す。
  - `apps/web/src/pages/stock.tsx`・`apps/web/src/components/stock/DraftList.tsx`は、`items`の代わりに`needsReview`を使う（003の動作のまま）。
  - `apps/web/test/stock.test.tsx`の一覧のデータを新しい形に直す。

**完了条件**：
- `pnpm --filter @threads-grower/shared test`（T001）が通る
- 003までの既存のテストが、形を直したうえで引き続き通る
- 投稿ストックの画面が003と同じに動く

---

## Phase 3：ユーザーストーリー1 - 下書きを承認・却下する（優先度：P1）🎯 MVP

**ゴール**：
- 要確認の下書きを、1件ずつ・まとめて承認・却下（理由は必須）できる。
- 承認済み・却下を、要確認に戻せる。
- NGワードを含む・Threadsの上限を超える下書きは、サーバーで承認を止める。
- 承認済みの編集は、要確認に戻る。

**単独でのテスト**：要確認の下書きを3件用意し、次を行って、各タブの件数と中身が変わることを確かめる（quickstart.md「手動の確認 2」の3〜6）。
- 1件を承認する
- 1件を理由付きで却下する
- 残る1件を「まとめて承認」する

### テスト（先に書いて失敗を確認する）

- [X] T012 [P] [US1] `apps/api/test/integration/review.test.ts`を作る（quickstart.mdの表の該当する行）。
  - 「承認・却下・戻す」：
    - 承認で`status: approved`・`reviewedAt`が入り、`version`が1増える
    - 却下で理由（コードと自由記述）が入る
    - `reopen`でそれらが消える
    - `counts`がそのたびに正しい
  - 「承認のチェック」：
    - `ng_words`に直接入れた語を含む下書き → `skipped: NG_WORD`
    - 501文字・リンク6個の下書き → `OVER_THREADS_LIMIT`
    - 状態は変わらない
  - 「まとめての承認」：10件のうち2件がNGワード → 8件が`updated`、2件が`skipped: NG_WORD`
  - 「二重の記録の防止」：
    - 同じ承認・却下を2回送ると、2回目も`updated`で、`version`・`reviewedAt`・理由が変わらない
    - `version`が古く、目的の状態でもない → `STALE`（`latest`付き）
    - 却下 → 承認 → `STALE`
  - 「理由のない却下」：
    - `reasons: []`・`note: "  "`は`400 VALIDATION_FAILED`
    - `approve`に`reject`を付けても`400`
    - `items`が0件・501件・`id`の重複も`400`
    - DBに直接、理由のない`rejected`の行を入れるとCHECK制約で失敗する。`reject_reasons`・`reject_note`が両方NULLの行と、`reject_reasons = '{}'`で`reject_note`がNULLの行の両方で確かめる
  - 「上限」：
    - 承認済みが500件のAccountでの承認 → `skipped: LIMIT`
    - 要確認が500件のAccountでの`reopen` → `skipped: LIMIT`
    - 同じ送信で先に変えた分も数える
  - 別のAccountの下書きのID → `NOT_FOUND`
  - 他人のAccount → `404 ACCOUNT_NOT_FOUND`
  - 要再接続のAccount、無料体験の後のプラン1でも使える（FR-034・FR-035）
- [X] T013 [P] [US1] `apps/api/test/integration/post-drafts.test.ts`に足す。
  - 「承認済みの編集」：
    - 承認済みの下書きの`PUT`は`200`で、`reopened: true`、`draft.status: needs_review`、`reviewedAt: null`、`version`が1増える
    - 要確認の下書きでは`reopened: false`
    - 却下の下書きの`PUT`は`404 ITEM_NOT_FOUND`
  - `POST /post-drafts/delete`：要確認と却下の下書きを消し、承認済みのIDは無視する
  - `DELETE /draft-batches/:id`：その登録の要確認の下書きだけを消し、承認済み・却下は残す
  - 一覧：承認済み・却下が`reviewedAt`の新しい順。却下は500件まで返り、`counts.rejected`は全件
  - 「件数のAPI」：`GET /post-drafts/counts`が一覧の`counts`と一致する
- [X] T014 [P] [US1] `apps/web/test/stock.test.tsx`に足す。
  - タブ：「要確認 {n}」「承認済み {n}」「却下 {n}」が出る。`?tab=approved`で開くと承認済みのタブになる
  - 「承認と元に戻す」：
    - 「承認」で`reviewPostDrafts`に`{ action: "approve", items: [{ id, expectedVersion }] }`が渡り、要確認の一覧から消える
    - トーストの「元に戻す」で`reopen`が送られる
  - 却下理由の入力：
    - 候補のチップが6つある
    - 候補も自由記述も空なら「却下する」が押せず、「理由を1つ以上選ぶか、書いてください」が出る
    - 「トーンが違う」を選んで確定すると`reject: { reasons: ["tone"], note: "" }`が渡る
    - 却下のタブに「却下理由：トーンが違う」が出る
  - まとめての操作：
    - 3件を選ぶと選択のバーに「まとめて承認」「まとめて却下」「削除」が出る
    - 「まとめて承認」の結果に`skipped`（`NG_WORD` 1件）があると、「2件を承認しました。1件は承認できませんでした（NGワード 1件）」が出て、飛ばした下書きは選ばれたまま残る
  - 選択のバーのタブごとの中身（承認済みは「要確認に戻す」だけ、却下は「削除」「要確認に戻す」）
  - NGワードを含む下書き（`ngWords`にある語）は「承認」が無効で、「NGワードを含むため承認できません。本文を直すか却下してください」が出る
  - 承認済みの下書きの「編集」で案内が出る。保存の結果が`reopened: true`なら「直したので、要確認に戻しました。もう一度承認してください」が出る
  - `skipped`の理由ごとの文言（contracts/ui-routes.mdの表）
  - サイドバーの「投稿ストック」の右に要確認の件数が出る。0件なら出ない

### 実装

- [X] T015 [US1] `apps/api/src/services/review-service.ts`に`reviewDrafts(env, accountId, req)`を作る（research.md R2・R3、contracts/api.md「POST /post-drafts/review」）。
  1. `withTransaction`の中で、003と同じ`pg_advisory_xact_lock(hashtextextended('account_items:<accountId>:post_drafts', 0))`を取る。
  2. 対象の下書き（`id IN (…) AND account_id = …`）と、そのAccountの`ng_words`と、状態ごとの件数を読む。
  3. 各項目を、contracts/api.mdの「処理」の順（`NOT_FOUND` → すでに目的の状態 → `STALE` → 移れない状態 → `approve`のチェック → 上限）で判定する。
     - `approve`のチェックは`checkPublishable(body, ngWords)`で行う
     - `POLICY_CONFIRM_REQUIRED`はUS5（T056）で足す
     - 上限は、この送信で先に変えた分も足して数える（承認済み`APPROVED_LIMIT`、`reopen`は要確認`NEEDS_REVIEW_LIMIT`）
  4. 変える下書きは、目的の状態ごとに1回の`UPDATE … WHERE id IN (…) AND version = …`でまとめて更新する。
     - `version = version + 1`、`updated_at = now()`
     - `approve`：`reviewed_at = now()`、`reject_reasons = NULL`、`reject_note = NULL`
     - `reject`：`reviewed_at = now()`、`reject_reasons = {reasons}`（空なら`NULL`）、`reject_note = {note}`（空白だけなら`NULL`）
     - `reopen`：3列を`NULL`
  5. `{ updated, skipped, counts }`を返す。`skipped`の`latest`は、`NOT_FOUND`以外で今の行を`toPostDraft`したもの。
  - 外部キー違反（`23503`）は`404 ACCOUNT_NOT_FOUND`。
- [X] T016 [US1] `apps/api/src/routes/post-drafts.ts`に`POST /api/accounts/:accountId/post-drafts/review`を足す（`findOwnedAccount` → `parseBody(reviewRequestSchema)` → `reviewDrafts`）。grower機能は判定しない。
- [X] T017 [US1] `apps/api/src/services/draft-service.ts`を変える（research.md R5、FR-007・FR-009）。
  - `updateDraft`：
    - 対象を`status IN ('needs_review', 'approved')`に広げ、003と同じロックを取ったトランザクションで更新する
    - 承認済みなら、同じ`UPDATE`で`status = 'needs_review'`・`reviewed_at = NULL`にする
    - `{ draft, reopened }`を返す
    - 要確認の上限は確かめない
  - `deleteDrafts`：対象を`status IN ('needs_review', 'rejected')`にする。
  - `apps/api/src/routes/post-drafts.ts`の`PUT /post-drafts/:draftId`のレスポンスを`{ draft, reopened }`にする。
- [X] T018 [P] [US1] `apps/web/src/components/stock/StatusTabs.tsx`を作る（contracts/ui-routes.md「状態のタブ」）。
  - 3つのタブ（`role="tablist"`）と件数を出す。
  - 選んだタブは`useSearchParams`の`tab`（`needs_review`（既定）・`approved`・`rejected`）に持つ。
- [X] T019 [P] [US1] `apps/web/src/components/stock/RejectDialog.tsx`を作る（contracts/ui-routes.md「却下理由の入力」）。
  - `FormDialogFrame`で、見出し（1件／「{n}件を却下する理由」）と説明を出す。
  - 候補のチップ（`REJECT_REASONS`。`aria-pressed`で複数選べる）を並べる。
  - 自由記述（`FieldWithCounter`、`REJECT_NOTE_MAX`文字まで、記入例「例：語尾がきつい」）を置く。
  - `initialReasons`のpropで、最初から選ぶ候補を受け取る。
  - 理由が空なら「却下する」を無効にし、案内を出す。
  - 自由記述を書きかけのときは、`useUnsavedChanges`に登録する。
- [X] T020 [US1] `apps/web/src/components/stock/use-review.ts`を作る（research.md R2）。
  - `review(action, drafts, options)`：`reviewPostDrafts`を呼び、成功したら次を古いものとして扱う。
    - `queryKeys.postDrafts(id)`
    - `queryKeys.draftCounts(id)`
    - `["account", id, "prompt"]`で始まるキー
  - トーストの出し分け：
    - すべて`updated`：「承認しました」「却下しました」「{n}件を承認しました」「{n}件を要確認に戻しました」と「元に戻す」（約5秒）
    - `skipped`がある：理由ごとの件数の文言
  - 「元に戻す」は、`updated`の下書きに逆の操作を送る。
    - 承認・却下の取り消し：`reopen`
    - 要確認に戻すのを取り消す：元の状態が承認済みなら`approve`、却下なら元の理由で`reject`
  - `skipped`の理由ごとの文言は`apps/web/src/components/stock/messages.ts`に置く（contracts/ui-routes.mdの表）。
- [X] T021 [US1] `apps/web/src/components/stock/DraftCard.tsx`を作り、003の`DraftList.tsx`から1件分の表示を移す（contracts/ui-routes.md「下書きのカード」）。
  - チェックボックス、本文、`ThreadsLengthBar`
  - タブごとの操作：
    - 要確認：「却下」「承認」。PCは右下に小さく、`md`未満は横幅いっぱいに2つ
    - 承認済み：「{日時}に承認」
    - 却下：却下した日時と「却下理由：…」
  - 「⋯」メニュー：要確認は「編集」「削除」、承認済みは「編集」「要確認に戻す」、却下は「要確認に戻す」「削除」
  - 「承認」は`checkPublishable(body, ngWords).approvable`が偽なら無効にし、理由の1行を出す。
  - 押せる範囲は44px角以上。
- [X] T022 [US1] `apps/web/src/components/stock/DraftList.tsx`をタブごとの一覧にする。
  - 要確認は003の見出しつきの並び、承認済み・却下は`reviewedAt`の新しい順に`DraftCard`を並べる。
  - 空の状態の文言（承認済み・却下）を出す。
  - 承認済みのタブの上の案内「承認した投稿は、自動投稿の設定ができると順に投稿されます」（FR-011）を出す。
  - 却下が500件を超えるときは「新しい500件を表示しています」を出す。
  - 「すべて選択」を各タブの見出しの右に置く。
- [X] T023 [US1] `apps/web/src/components/stock/PasteComposer.tsx`の選択のバーを、タブごとの中身にする（contracts/ui-routes.md「選択のバー」）。
  - 「まとめて承認」：飛ばした下書きは選んだまま残し、承認したものだけ選択から外す。
  - 「まとめて却下」：`RejectDialog`を開き、選んだ全件に同じ理由で送る。
  - 「要確認に戻す」：確認なしで送る。
  - 「削除」：003の確認なし・「元に戻す」付きの削除のまま。
- [X] T024 [US1] `apps/web/src/components/stock/DraftEditDialog.tsx`を変える。
  - 承認済みの下書きでは、上に「保存すると要確認に戻り、もう一度承認が必要になります」を出す。
  - 保存の結果が`reopened: true`なら、トースト「直したので、要確認に戻しました。もう一度承認してください」を出す。
- [X] T025 [US1] `apps/web/src/pages/stock.tsx`に、次を組み込む。
  - `StatusTabs`、タブごとの`DraftList`、`use-review`、`RejectDialog`
  - 却下は、1件は`DraftCard`の「却下」から、まとめては選択のバーから開く
  - タブを変えたら選択を解除する
  - 状態の変更・編集・削除の後は、`queryKeys.draftCounts(id)`も古いものとして扱う
- [X] T026 [US1] `apps/web/src/components/layout/Sidebar.tsx`の「投稿ストック」の右に、`getDraftCounts`の`needsReview`を出す（0件なら出さない。FR-013）。投稿ストックの一括登録・取り消し（003）の後も、`queryKeys.draftCounts(id)`を古いものとして扱う。

**完了条件**：T012〜T014が通り、quickstart.md「手動の確認 2」の3〜6ができる

---

## Phase 4：ユーザーストーリー2 - NGワードを設定し、NGワードを含む下書きを止める（優先度：P1）

**ゴール**：
- 「このアカウントの設定」でNGワードを追加・削除できる。
- NGワードを含む下書きにラベルと強調が出る。
- 追加した語を含む承認済みの下書きは、要確認に戻る。

**単独でのテスト**：
1. NGワードに「絶対」を登録する。
2. 「絶対に伸びる方法」の下書きが承認できないことを確かめる。
3. 本文を直すと承認できることを確かめる。
4. 承認済みの下書きに含まれる語を足すと、要確認に戻ることを確かめる。

（quickstart.md「手動の確認 1」の1〜2、「2」の2・7）

### テスト（先に書いて失敗を確認する）

- [X] T027 [P] [US2] `apps/api/test/integration/posting-rules.test.ts`を作る。
  - `GET /posting-rules`：`ngWords`が古い順で、`ngWordLimit: 200`・`coreRules: ""`・`coreRulesVersion: 1`・`canEditCoreRules`が返る
  - 「NGワードの重複・上限」：
    - 「絶対」がある状態で`["絶対", "ＡＢＣ", "abc", "  "]`を送ると、`added`は「ＡＢＣ」だけ、`duplicates`は「絶対」「abc」になる
    - 空白だけの語は`400`ではなく除かれる
    - 既存199語に2語を送ると`409 ITEM_LIMIT_REACHED`で、何も足されない
    - 51文字の語・201件は`400`
  - 「NGワードの追加で戻す」：
    - 承認済みの下書き「絶対に伸びる」と、要確認の下書きがあるAccountで「絶対」を足すと、`reopenedCount: 1`になる
    - その下書きは`needs_review`・`reviewedAt: null`・`version`が1増える
    - その後「絶対」を`DELETE`しても、下書きは要確認のまま
  - 「NGワードと承認の同時実行」：「絶対」を含む要確認の下書きの承認と、「絶対」の追加を`Promise.all`で20回繰り返し、毎回、終わった後に「絶対」を含む承認済みが0件であること
  - `DELETE /ng-words/:id`：`204`。別のAccountの語のIDは`404 ITEM_NOT_FOUND`
  - 無料体験の後のプラン1でもNGワードを追加・削除できる（FR-017）。他人のAccountは`404 ACCOUNT_NOT_FOUND`
- [X] T028 [P] [US2] `apps/web/test/account-settings.test.tsx`を作る。
  - 「このアカウントの設定」に「投稿のルール」の区分が、「Threadsとの接続」より上にある。NGワードの行に「{n}語」と「編集」がある
  - NGワードのダイアログ：
    - 「絶対、必ず儲かる」を入れて「追加」（またはEnter）を押すと、`addNgWords`に`["絶対", "必ず儲かる"]`が渡る（改行・「,」でも区切る）
    - `duplicates`があれば「{語}はすでにあります」が出る
    - `reopenedCount: 2`なら、トースト「NGワードを含む承認済みの下書き2件を、要確認に戻しました」が出る
    - チップの「×」で`deleteNgWord`が呼ばれ、トースト「「{語}」を削除しました」が出る。トーストの「元に戻す」で`addNgWords([語])`が呼ばれる
    - 200語に達したら入力欄が無効になり、案内が出る
  - `apps/web/test/stock.test.tsx`に、NGワード「絶対」があるとき、要確認の下書きに「NGワード：絶対」のラベルが出て、本文の「絶対」が`mark`で強調されることを足す

### 実装

- [X] T029 [US2] `apps/api/src/services/posting-rules-service.ts`に、次の3つを作る（research.md R6）。
  - `getPostingRules(db, account, user)`：`canEditCoreRules`は`canEditProfile`で求める。
  - `addNgWords(env, accountId, words)`：次の順に行う。
    1. 003と同じロックを取ったトランザクションを始める。
    2. 各語を`trim`し、空を除く。
    3. `normalizeNgWord`で正規化し、既存・送信内の重複を`duplicates`に分ける。
    4. 既存＋追加が`NG_WORD_LIMIT`を超えれば`409 ITEM_LIMIT_REACHED`を返す。
    5. 残った語を`INSERT`する。
    6. そのAccountの承認済みの下書きを読み、足した語で`findNgWords`に当たるものを、1回の`UPDATE`で`status = 'needs_review'`・`reviewed_at = NULL`・`version + 1`にする。
    7. `{ added, duplicates, reopenedCount }`を返す。
  - `deleteNgWord(db, accountId, id)`：なければ`404 ITEM_NOT_FOUND`。
- [X] T030 [US2] `apps/api/src/routes/posting-rules.ts`を作り、`apps/api/src/app.ts`に登録する（contracts/api.md）。
  - `GET /api/accounts/:accountId/posting-rules`
  - `POST /api/accounts/:accountId/ng-words`
  - `DELETE /api/accounts/:accountId/ng-words/:ngWordId`（`assertItemId`）
  - どれもgrower機能は判定しない。
- [X] T031 [P] [US2] `apps/web/src/components/settings/NgWordsDialog.tsx`を作る（contracts/ui-routes.md「NGワードのダイアログ」）。
  - 説明文を出す。
  - 入力欄と「追加」を置く。入力は改行・「、」・「,」で区切って送る。
  - 登録済みの語を、古い順のチップで並べる。「×」の読み上げ名は「{語}を削除」。押すと確認なしで削除し、トースト「「{語}」を削除しました」と「元に戻す」を出す。「元に戻す」は同じ語を`addNgWords`で足し直す（contracts/ui-routes.md）。
  - 「{n}/200語」を出す。上限に達したら入力欄を無効にする。
  - 追加・削除の後は、次を古いものとして扱う。
    - `queryKeys.postingRules(id)`
    - `queryKeys.postDrafts(id)`
    - `queryKeys.draftCounts(id)`
    - `["account", id, "prompt"]`で始まるキー
- [X] T032 [US2] `apps/web/src/components/settings/PostingRulesSection.tsx`を作る。
  - 小見出し「投稿のルール」と、角の丸い枠の中に`SettingRow`の行を並べる（contracts/ui-routes.md「このアカウントの設定」）。
  - まずNGワードの行（「この言葉を含む下書きは承認できません。{n}語」と「編集」→`NgWordsDialog`）を作る。投稿ルールの行はT049、規約の行はT060で足す。
  - `apps/web/src/pages/account-settings.tsx`の既存の区分より上に置き、`getPostingRules`で読み込む。
- [X] T033 [P] [US2] `apps/web/src/components/stock/DraftLabels.tsx`を作る。
  - NGワードのラベル「NGワード：{言葉}、{言葉}」（`--destructive`の文字）を出す。
  - 本文の該当範囲を`<mark>`で強調する`HighlightedBody`を作る。範囲は`findNgWords`の`ranges`。文字として描き、`dangerouslySetInnerHTML`は使わない。
  - Threadsの上限のラベルは、003の`ThreadsLengthBar`の表示のままにする。
- [X] T034 [US2] `apps/web/src/components/stock/DraftCard.tsx`のラベルの行と本文を`DraftLabels`・`HighlightedBody`で描く（NGワードのラベルは要確認のタブだけ。FR-016）。`apps/web/src/components/stock/DraftEditDialog.tsx`の本文の欄の下にも、入力に合わせてNGワードのラベルを出す。

**完了条件**：T027・T028が通り、quickstart.md「手動の確認 1」の1〜2と「2」の2・7ができる

---

## Phase 5：ユーザーストーリー3 - 似ている下書きに気づく（重複検知）（優先度：P2）

**ゴール**：要確認の各下書きに類似度%を出し、80%以上は警告にする。似ている相手を見られ、却下の候補「似た投稿がある」が最初から選ばれる

**単独でのテスト**：承認済みの下書きと1文字だけ違う下書きを登録し、類似度のラベルと似ている相手が出ることを確かめる（quickstart.md「手動の確認 3」）

### テスト（先に書いて失敗を確認する）

- [X] T035 [P] [US3] `packages/shared/test/similarity.test.ts`を作る（quickstart.mdの表の「類似度」の行、SC-003）。
  - 同じ本文は100
  - 10・20・150文字の本文の1文字違い・2文字違い（離れた位置の置き換え）は80以上
  - 2文の順番を入れ替えた本文は80以上
  - 空白・改行・句読点・絵文字だけが違う本文は100
  - 正規化した後の長さが10文字未満の本文は、比べる側にも比べられる側にも入らない（結果なし）
  - 内容の違う2つの日本語の投稿は80未満
  - 自分自身とは比べない
  - 似ている相手は高い順に最大3件
  - 長い本文（1,000文字）の1文字違いも80以上（編集距離を省き、Dice係数だけで判定する）
- [X] T036 [P] [US3] `apps/web/test/stock.test.tsx`に足す。
  - 要確認の下書きに「類似度 {n}%」が出る。承認済みとほぼ同じ下書きは注意の色の「類似度 9x%」と「似ている投稿があります」
  - ラベルを押すと「似ている投稿」のポップオーバーに、相手の状態のラベル（承認済み）と本文が出る。行を押すと承認済みのタブに切り替わる
  - 類似度が80%以上の下書きの「却下」で、「似た投稿がある」が最初から選ばれている。まとめて却下では、選んだうち1件でも当てはまれば選ばれている
  - 類似度が80%以上でも「承認」は押せる

### 実装

- [X] T037 [US3] `packages/shared/src/similarity.ts`に`computeSimilarities(targets: { id: string; body: string }[], others: { id: string; body: string }[]): Map<string, { score: number; matches: { id: string; score: number }[] }>`を作り、`index.ts`からexportする（research.md R8）。
  - **正規化**：`normalizeForMatch` → `/[\s\p{P}\p{S}\p{Extended_Pictographic}‍️]/gu`を除く。長さが`SIMILARITY_MIN_LENGTH`未満は除外する。
  - **Dice係数**：2文字組の多重集合で求める。`others`の2文字組 → 出現の逆引きの表を作り、各`target`の共通の数を数える。
  - **編集距離**：Dice係数が0.3以上の組のうち、各`target`の上位5件だけに、編集距離の比`1 − 距離 ÷ 長いほうの長さ`を求める（2行のDPで、メモリはO(n)）。どちらかの長さが`SIMILARITY_EDIT_DISTANCE_MAX_LENGTH`を超える組は、編集距離を求めない。
  - 各組の類似度は`round(max(dice, editRatio) × 100)`。
  - `score`はもっとも高い値（相手がいなければ0）、`matches`は高い順に`SIMILARITY_TOP_MATCHES`件。
  - `targets`と`others`に同じ`id`があっても、自分とは比べない。
- [X] T038 [US3] `apps/web/src/components/stock/use-similarities.ts`を作る。
  - 一覧のデータ（要確認・承認済み・却下）から、`targets` = 要確認、`others` = 全部で`computeSimilarities`を呼び、結果を`useMemo`で覚える。
  - 要確認が100件を超えるときは、計算を`requestIdleCallback`（なければ`setTimeout`）で区切って行い、終わるまで「計算中」を返す。
- [X] T039 [US3] `apps/web/src/components/stock/DraftLabels.tsx`に、類似度のラベルとポップオーバーを足す（contracts/ui-routes.md「似ている相手のポップオーバー」）。
  - ラベル：「類似度 {n}%」。`SIMILARITY_THRESHOLD`以上なら注意の色にし、「似ている投稿があります」を添える。計算中は「類似度 計算中」。
  - ポップオーバー：相手の類似度・状態のラベル・本文の先頭3行。
  - 行を押すと、次を行う。
    1. `StatusTabs`のタブを切り替える
    2. その下書きの要素（`id="draft-{id}"`）までスクロールする
    3. 枠を一瞬強調する
  - `apps/web/src/components/stock/DraftCard.tsx`の要確認のカードに出す。
- [X] T040 [US3] `apps/web/src/pages/stock.tsx`の却下の開き方を変え、`RejectDialog`の`initialReasons`を渡す。類似度が`SIMILARITY_THRESHOLD`以上なら`similar`を含める。まとめて却下では、選んだうち1件でも当てはまれば含める。

**完了条件**：T035・T036が通り、quickstart.md「手動の確認 3」ができる

---

## Phase 6：ユーザーストーリー4 - 却下の傾向とCORE RULESを次のプロンプトに生かす（優先度：P2）

**ゴール**：
- 投稿ルールを保存できる（grower機能）。
- プロンプトに次が入る。
  - 「■絶対に守るルール(CORE RULES)」：規約上のルール → 投稿ルール → NGワード
  - 「■過去に却下された投稿」：直近10件と理由

**単独でのテスト**：
1. 投稿ルールに「断定口調は使わない」、NGワードに「絶対」を設定する。
2. 1件を「トーンが違う」で却下する。
3. プロンプトの2つの節に入っていることを確かめる。

（quickstart.md「手動の確認 5」）

### テスト（先に書いて失敗を確認する）

- [X] T041 [P] [US4] `packages/shared/test/prompt.test.ts`に足す（quickstart.mdの表の「CORE RULESの節」「却下の節」「長さの目安」、contracts/prompt-template.md）。
  - **CORE RULESの節**：
    - 材料がなくても「■絶対に守るルール(CORE RULES)」があり、話者の直後にある
    - 中は、規約上のルール6つ（`POLICY_PROMPT_RULES`の順）→ 投稿ルールの行（空の行を除き、行頭の「・」「-」もそのまま「・」の後に残る）→「・次の言葉は使わないこと: 絶対、必ず儲かる」の順
    - NGワードがなければ最後の行がない
  - **却下の節**：
    - 宣伝内容の後・リサーチの前にある
    - 理由の書き方3通り（候補だけ・自由記述だけ・両方）
    - 11件を渡すと10件だけ入る
    - 0件なら節がない
  - 宣伝内容の節の最後の文が「…上記のCORE RULES・トーンをそのまま守ること。」になる
  - 重複防止の節は、却下があるとき「上に書かれている却下された投稿・宣伝内容・リサーチ内容…」になる
  - 長さの目安：30,000文字を超える材料では、直近の下書き → 却下 → 参考投稿の順に減らし、CORE RULESの節は減らさない
  - 要約の`coreRuleCount`（規約上のルールは数えない）・`ngWordCount`・`rejectedCount`が、実際に含めた数と一致する
- [X] T042 [P] [US4] API のテストを足す。
  - `apps/api/test/integration/posting-rules.test.ts`：
    - `PUT /core-rules`で保存すると`coreRulesVersion`が1増え、`GET /posting-rules`に反映される
    - 同じ`expectedVersion`の2回目は`409 STALE_UPDATE`（`latest`付き）
    - 2,001文字は`400`
    - 無料体験の後のプラン1は`403 GROWER_FEATURE_REQUIRED`で、`GET /posting-rules`は`canEditCoreRules: false`
  - `apps/api/test/integration/prompt.test.ts`：
    - `GET /prompt`に、保存した投稿ルール・NGワード・却下の下書き（新しく却下した順、理由の表示名つき）が入る
    - 要確認に戻した却下の下書きは入らない
    - 「直近の下書き」に承認済みが入る
    - `summary`に3つの件数が入る
- [X] T043 [P] [US4] Web のテストを足す。
  - `apps/web/test/account-settings.test.tsx`：
    - 投稿ルールの行に「{n}件」または「未入力」と「編集」がある
    - ダイアログで書いて保存すると`putCoreRules`に`{ text, expectedVersion }`が渡る
    - `409`で競合のダイアログが出る
    - `canEditCoreRules: false`では行の操作が「見る」で、欄が読み取り専用になり、「投稿ルールはAIプロンプトの生成（プラン2以上）で使われます」が出る
  - `apps/web/test/stock.test.tsx`：プロンプトのカードの要約に「ルール 3件・NGワード 2語・却下 5件」が足される（0件の項目は出ない）

### 実装

- [X] T044 [US4] `packages/shared/src/policy.ts`を作り、`POLICY_LIST_VERSION = "2026-10-04"`と`POLICY_PROMPT_RULES`（[contracts/policy-cautions.md](./contracts/policy-cautions.md)「規約上のルール」の6つの文面、その順）を定める。`index.ts`からexportする。
- [X] T045 [US4] `packages/shared/src/prompt.ts`を、[contracts/prompt-template.md](./contracts/prompt-template.md)のとおりに変える（research.md R12）。
  - **入力**：`coreRules: string[]`、`ngWords: string[]`、`rejectedDrafts: { body: string; reasonLabels: string[]; note: string | null }[]`を足す。
  - **節**：
    - `coreRulesSection`（常に。話者の後）を足す
    - `rejectedSection`（却下が1件以上のとき。宣伝内容の後）を足す。入力の先頭`PROMPT_REJECTED_DRAFTS`件を使う
  - **文面の変更**：
    - `promotionSection`の最後の文を「上記のCORE RULES・トーンをそのまま守ること」に直す
    - `dedupeSection`に、却下があるときの「却下された投稿・」を足す
  - **長さの目安**：減らす順を、直近の下書き → 却下 → 参考投稿にする。
  - **要約**：`coreRuleCount`・`ngWordCount`・`rejectedCount`を返す。
- [X] T046 [US4] `apps/api/src/services/prompt-service.ts`の材料を足す。
  - `coreRules`：`account.coreRules`を行に分け、`trim`して空でない行。
  - `ngWords`：`listNgWords`の`word`（古い順）。
  - `rejectedDrafts`：却下の下書きを`reviewed_at`の降順に`PROMPT_REJECTED_DRAFTS`件。`reasonLabels`は`rejectReasonLabel`で表示名にする。
  - `recentDrafts`：要確認と承認済みを、登録のまとまりの新しい順 → `position`の昇順に`PROMPT_RECENT_DRAFTS`件。
  - 取得は`Promise.all`で並べる。
- [X] T047 [US4] 投稿ルールの保存を作る（research.md R11）。
  - `apps/api/src/services/posting-rules-service.ts`に`saveCoreRules(db, accountId, { text, expectedVersion })`を作る。
    - `UPDATE accounts SET core_rules = trim(text), core_rules_version = core_rules_version + 1 WHERE id = … AND core_rules_version = …`
    - 0行なら、今の値を`latest`に入れて`409 STALE_UPDATE`
  - `apps/api/src/routes/posting-rules.ts`に`PUT /api/accounts/:accountId/core-rules`（`findOwnedAccount` → `requireGrowerAccess` → `parseBody(coreRulesRequestSchema)`）を足す。
- [X] T048 [P] [US4] `apps/web/src/components/settings/CoreRulesDialog.tsx`を作る（contracts/ui-routes.md「投稿ルールのダイアログ」）。
  - `useItemForm`・`FormDialogFrame`で、見出し・説明を出す。
  - 欄は`FieldWithCounter`の複数行で`CORE_RULES_MAX`文字まで。記入例は「断定口調は使わない\n医療・投資の効果をうたわない」。
  - `409`は`ConflictDialog`で扱う。
  - `readOnly`のpropでは、欄を読み取り専用にし、案内と`PLAN_CHANGE_CONTACT`を出す。
- [X] T049 [US4] `apps/web/src/components/settings/PostingRulesSection.tsx`に投稿ルールの行を足す。
  - 説明：「AIプロンプトに「絶対に守るルール」として入ります。{n}件」（空でない行の数）または「未入力」。
  - 操作：`canEditCoreRules`なら「編集」、そうでなければ「見る」。
  - 保存の後は、`queryKeys.postingRules(id)`と`["account", id, "prompt"]`で始まるキーを古いものとして扱う。
- [X] T050 [US4] `apps/web/src/components/stock/PromptCard.tsx`の要約に、「・ルール {coreRuleCount}件」「・NGワード {ngWordCount}語」「・却下 {rejectedCount}件」を、0でないものだけ足す（FR-025）。

**完了条件**：T041〜T043が通り、quickstart.md「手動の確認 1」の3と「5」ができる

---

## Phase 7：ユーザーストーリー5 - Threadsの規約に触れやすい投稿に気づく（優先度：P2）

**ゴール**：
- 規約に触れやすい表現に「規約に注意」のラベルと強調を出し、承認の前に確認を求める。
- 確認のない承認は、APIでも止める。
- 規約の備えを、設定の画面で読める。

**単独でのテスト**：
1. 「この投稿にいいねした人の中から抽選でプレゼント」を登録する。
2. ラベルが出ること、承認で確認が出ること、確認すれば承認できることを確かめる。

（quickstart.md「手動の確認 4」）

### テスト（先に書いて失敗を確認する）

- [X] T051 [P] [US5] `packages/shared/test/policy.test.ts`を作る（quickstart.mdの表の「規約に注意」、SC-008）。
  - [contracts/policy-cautions.md](./contracts/policy-cautions.md)の4分類の「当たる例」がすべて、その分類に当たる。
  - 「当たらない例」が、どの分類にも当たらない。
  - 全角・半角の揺れ（「ＤＭ」「１００％」）でも当たる。
  - 範囲が元の本文の位置で返る。
  - `checkPublishable`の`policyCautions`に結果が入るが、`approvable`は変わらない（承認は止めない）。
- [X] T052 [P] [US5] `apps/api/test/integration/review.test.ts`に足す。
  - 規約に注意の下書きの承認は、`confirmPolicyCaution`なし・`false`で`skipped: POLICY_CONFIRM_REQUIRED`になり、状態が変わらない。
  - `true`なら承認される。
  - 規約に注意でない下書きは、`false`でも承認される。
- [X] T053 [P] [US5] Web のテストを足す。
  - `apps/web/test/stock.test.tsx`：
    - 規約に注意の下書きに「規約に注意：見返りでの反応集め」が出て、該当箇所が強調される
    - ラベルを押すと、関わる規約の名前・リンクと言い換えの方向が出る
    - 「承認」で確認のダイアログが出て、「キャンセル」なら`reviewPostDrafts`を呼ばない。「承認する」なら`confirmPolicyCaution: true`で呼ぶ
    - まとめて承認で、選んだうち2件が規約に注意なら「選んだうち2件に…」の確認が出る
    - 却下で「規約に触れそう」が最初から選ばれている
    - 承認済みの下書きが規約に注意のとき、ラベルの下に「規約に注意の表現があります。要確認に戻して確かめることをおすすめします」と「要確認に戻す」が出て、押すと`reopen`が送られる
    - 画面のどこにも「安全」「規約に適合」「違反しない」「問題ありません」が出ない
  - `apps/web/test/account-settings.test.tsx`：
    - 「Threadsの規約への備え」の行の「見る」で、規約上のルール6つと4つの分類（名前・説明・リンク）と版の日付が出る
    - 編集の手段がない

### 実装

- [X] T054 [US5] `packages/shared/src/policy.ts`に、`POLICY_CAUTIONS`と`findPolicyCautions(body)`を足す（research.md R7、[contracts/policy-cautions.md](./contracts/policy-cautions.md)）。
  - `POLICY_CAUTIONS`：4分類それぞれの`{ id, label, policyName, policyUrl, suggestion, patterns: RegExp[] }`。
    - `patterns`は、contracts/policy-cautions.mdの「照合の形」を、正規化した後の文字（小文字・半角）の正規表現にしたもの
    - 「〜」は`[^。\n]{0,15}`
  - `findPolicyCautions(body)`：`normalizeForMatch`で正規化した本文に各`pattern`を`matchAll`で当てる。当たった分類と、元の本文の位置の範囲を返す（`{ id, label, policyName, policyUrl, suggestion, ranges }[]`）。
- [X] T055 [US5] `packages/shared/src/review.ts`の`checkPublishable`の`policyCautions`に、`findPolicyCautions`の結果を入れる。`approvable`には含めない。
- [X] T056 [US5] `apps/api/src/services/review-service.ts`の`approve`のチェックに、次を足す（FR-040、research.md R7）。
  - `checkPublishable(...).policyCautions`が1件以上で、`req.confirmPolicyCaution !== true`なら`POLICY_CONFIRM_REQUIRED`にする。
  - 判定の順は、`NG_WORD`・`OVER_THREADS_LIMIT`の後、`LIMIT`の前。
- [X] T057 [P] [US5] `apps/web/src/components/stock/PolicyConfirmDialog.tsx`を作る（contracts/ui-routes.md「承認」「選択のバー」）。
  - 見出しと本文を出す。1件のときは当たった分類の名前、まとめてのときは「選んだうち{k}件に…」。
  - 「キャンセル」「承認する」を置く。
- [X] T058 [US5] `apps/web/src/components/stock/DraftLabels.tsx`に、規約に注意のラベル（注意の色）とポップオーバーを足す。
  - ポップオーバーの中身：「Threadsの規約（{policyName}）に触れるおそれのある表現です。{suggestion}」と、新しいタブで開く規約へのリンク。
  - `HighlightedBody`の強調に、規約に注意の範囲（`--warning`系の背景）を足す。
  - `apps/web/src/components/stock/DraftCard.tsx`の承認済みのタブでは、規約に注意のとき、ラベルの下に「規約に注意の表現があります。要確認に戻して確かめることをおすすめします」と「要確認に戻す」（`reopen`）のボタンを出す（contracts/ui-routes.md）。
  - `apps/web/src/components/stock/DraftEditDialog.tsx`の入力中のラベルにも出す。
- [X] T059 [US5] `apps/web/src/components/stock/use-review.ts`の承認の流れを変える。
  - 対象に規約に注意のものがあれば`PolicyConfirmDialog`を出し、「承認する」で`confirmPolicyCaution: true`を付けて送る。
  - 「元に戻す」の`approve`（要確認に戻すのを取り消す）では、確認なしで`confirmPolicyCaution: true`を付ける（直前に確認済みの承認を戻すだけのため）。
  - `apps/web/src/pages/stock.tsx`の`RejectDialog`の`initialReasons`に、規約に注意なら`policy`を含める（まとめて却下では、1件でも当てはまれば）。
- [X] T060 [US5] 規約の備えを、設定の画面で読めるようにする（contracts/ui-routes.md「Threadsの規約への備えのダイアログ」）。
  - `apps/web/src/components/settings/PolicyInfoDialog.tsx`を作る。中身は次のとおり。
    - 説明文
    - 「AIプロンプトに入れるルール」（`POLICY_PROMPT_RULES`）
    - 「「規約に注意」と表示する表現」（`POLICY_CAUTIONS`の名前・言い換えの方向・規約へのリンク）
    - 「{POLICY_LIST_VERSION}時点のMetaコミュニティ規定をもとにしています」
  - `apps/web/src/components/settings/PostingRulesSection.tsx`に「Threadsの規約への備え」の行（「見る」）を足す。

**完了条件**：T051〜T053が通り、quickstart.md「手動の確認 4」と「1」の4ができる

---

## Phase 8：仕上げと横断的な対応

**目的**：Account削除との関係、性能、全体の確認

- [X] T061 [P] `apps/api/test/integration/profile-cascade.test.ts`に足す（FR-036）。NGワード・投稿ルール・承認済み・却下の下書きを持つAccountを削除すると、`ng_words`・`post_drafts`の行がすべて消えることを確かめる。Account削除とMetaのデータ削除要求の両方で確かめる。
- [X] T062 [P] `packages/shared/test/similarity.test.ts`に、性能の確認を足す（research.md R8、plan.md 性能目標）。
  - 150文字前後のランダムな日本語の本文で、次の時間を測る。
    - 要確認30件 × 全体300件：100ms以内
    - 要確認500件 × 全体1,500件：1,000ms以内
    - 2,000文字の要確認50件 × 全体500件：1,000ms以内
  - 遅い環境（CI）で不安定なら、上限を2倍にして注記する。超える場合は、T037の候補の絞り込み（上位5件・0.3）を見直す。
- [X] T063 `pnpm lint`・`pnpm typecheck`・`pnpm test`を通す。新しくexportした関数・コンポーネントすべてにJSDocを付ける。入力内容は文字として表示するだけにし、`dangerouslySetInnerHTML`は使わない（002 research.md R13）。
- [ ] T064 quickstart.mdの「手動の確認」1〜6を、`pnpm dev:fake`で375・768・1024・1440pxの4つの幅で行う。
  - 375pxで、次を確かめる。
    - 却下・承認のボタンが横幅いっぱいに2つ並ぶ
    - 却下理由の入力が全画面のシートになる
    - 選択のバーが画面下端の操作バーに重ならない
  - 30件の下書きを、読みながら承認・却下し終えるまでの時間を測る（SC-002の目安：10分以内）。

---

## Phase 9：追加 — まとめて選ぶ方法と、まとめて承認の前の責任の確認（spec Clarifications 2026-10-05）

**目的**：1件ずつの承認の手間を減らす。一度に承認する機能は作らず、選び方を増やし、まとめて承認の前に、投稿の内容が運用者の責任で公開されることを確かめてもらう（FR-004a・FR-004b）

- [X] T065 [US1] `apps/web/test/stock.test.tsx`にテストを足す（失敗を確認する）。
  - 選び方のメニューの「承認できるものを選択」で、NGワード・規約に注意・類似度80%以上の下書きは選ばれず、それ以外だけが選ばれる
  - 登録のまとまりの「この{n}件を選択」で、そのまとまりの下書きだけが選択に足される
  - 「まとめて承認」で責任の確認が出て、件数と文言が出る。「キャンセル」なら`reviewPostDrafts`を呼ばない。確認すると呼ぶ
  - 規約に注意の下書きを含むまとめて承認では、確認は1回だけで、その件数が同じ確認に出て、`confirmPolicyCaution: true`で送る
  - 1件ずつの承認では、責任の確認は出ない
- [X] T066 [US1] `apps/web/src/components/stock/BulkApproveDialog.tsx`を作る（contracts/ui-routes.md「まとめて承認」の確認）。
- [X] T067 [US1] `apps/web/src/pages/stock.tsx`に、選び方のメニュー（「すべて選択」「承認できるものを選択（{n}件）」「選択を解除」）と、まとめて承認の流れ（`BulkApproveDialog`。規約に注意の確認を兼ねる）を足す。`apps/web/src/components/stock/DraftList.tsx`の登録のまとまりの見出しに「この{n}件を選択」を足す。

---

## 依存関係と実行順

### フェーズの依存

- **Phase 2（基盤）**：すぐ始められる。**すべてのユーザーストーリーを止める**
- **Phase 3（US1）**：Phase 2の後。承認のチェックは、Phase 2の`checkPublishable`とDBの`ng_words`で、US2の画面がなくてもNGワードを止める（Constitution原則I）
- **Phase 4（US2）**：
  - APIのタスク（T027・T029・T030）：Phase 2の後ならUS1と並行できる
  - Webのラベル（T033・T034）：US1の`DraftCard`（T021）の後
- **Phase 5（US3）**：
  - 共通の関数（T035・T037）：Phase 2の後ならいつでもよい
  - 画面（T036・T038〜T040）：US1の`DraftCard`・`RejectDialog`と、US2の`DraftLabels`の後
- **Phase 6（US4）**：
  - プロンプトとAPI（T041・T042・T044〜T047）：Phase 2の後ならいつでもよい。ただし、却下の材料の確認にはUS1の却下があるとよい
  - 設定の画面（T048・T049）：US2の`PostingRulesSection`（T032）の後
- **Phase 7（US5）**：US1（承認の流れ）、US2（`DraftLabels`・`PostingRulesSection`）、US4（`policy.ts`）の後
- **Phase 8（仕上げ）**：T061はPhase 2の後ならいつでもよい。T062はT037の後。T063・T064はすべてのストーリーの後

### ストーリーの中の順番

- テスト → 共通の関数 → APIのサービス・ルート → Webの部品 → 画面への組み込み
- 次の同じファイルを触るタスクは、ストーリーをまたいで並行にしない。
  - Web：`apps/web/src/pages/stock.tsx`、`apps/web/src/components/stock/DraftCard.tsx`、`DraftLabels.tsx`、`use-review.ts`、`apps/web/src/components/settings/PostingRulesSection.tsx`
  - API：`apps/api/src/services/review-service.ts`、`posting-rules-service.ts`、`apps/api/src/routes/posting-rules.ts`
  - 共通：`packages/shared/src/review.ts`、`policy.ts`、`prompt.ts`
  - テスト：`apps/web/test/stock.test.tsx`、`apps/web/test/account-settings.test.tsx`、`apps/api/test/integration/review.test.ts`、`posting-rules.test.ts`

## 並行して進められる例

### Phase 2

```text
T001 共通のテスト ／ T002 normalize.ts ／ T003 ng-words.ts
```

### US1

```text
T012 review の API テスト ／ T013 post-drafts の API テスト ／ T014 Web のテスト ／ T018 StatusTabs ／ T019 RejectDialog
```

### US1と並行してできるUS2・US3・US4の部分

```text
T027 posting-rules の API テスト → T029・T030 NGワードの API
T035 similarity のテスト → T037 similarity.ts
T041 prompt のテスト → T044・T045 policy.ts（ルール）・prompt.ts → T046 prompt-service
```

### US5

```text
T051 policy のテスト ／ T052 review の API テスト ／ T053 Web のテスト ／ T057 PolicyConfirmDialog
```

## 実装の進め方

### MVP（US1＋US2）

1. Phase 2を終える
2. Phase 3（US1 承認・却下）とPhase 4（US2 NGワード）を終える
3. **止めて確認**：人が承認した下書きだけが「承認済み」になり、NGワードを含む下書きは承認できない（Constitution原則I・II）

US1だけでも、承認のチェックはDBのNGワードで働く。ただし、ユーザーがNGワードを登録する手段がないと原則Iを満たした運用にならないため、MVPはUS1とUS2の両方とする。

### 少しずつ足す

1. US3（重複検知）→ US4（プロンプトへの反映）→ US5（規約への備え）の順に足し、それぞれ単独で確かめる
2. US4までで、却下ログがプロンプトに入り、Constitution原則VIを満たす。PRのマージは、US5まで終えてからにする（spec に入っているため）
3. Phase 8で、Account削除との関係・性能・全体の確認を行う

## メモ

- [P]のタスクは、別のファイルを触り、未完了のタスクに依存しない
- 各タスク、または論理的なまとまりごとにコミットする
- 本featureはThreadsへ投稿しない。承認済みの下書きの投稿は005（Constitution原則II、FR-011・FR-037）
- 画面の文言で「安全」「規約に適合」などの言葉を使わない（FR-043）
