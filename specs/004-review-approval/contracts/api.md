# API契約：重複検知・承認/却下・NGワード（CORE RULES）

**対象feature**：[spec.md](../spec.md) ／ **データモデル**：[data-model.md](../data-model.md) ／ **これまでのAPI契約**：[002](../../002-strategy-profile/contracts/api.md)、[003](../../003-prompt-bulk-register/contracts/api.md)

`apps/api`に足す・変えるエンドポイントの契約。入出力の形は`packages/shared`のzodスキーマで定義し、Webと共有する。

## 共通事項

001〜003の共通事項をそのまま使う。
- 認証
- `404 ACCOUNT_NOT_FOUND`・`404 ITEM_NOT_FOUND`の使い分け
- `400 VALIDATION_FAILED`（`details`に項目名）
- `409 STALE_UPDATE`（`latest`に最新の値）
- 要再接続のAccountでも使えること（FR-035）

本featureの追加：

- **grower機能の判定**：投稿ルールの保存（`PUT /core-rules`）だけを判定し、使えなければ`403 GROWER_FEATURE_REQUIRED`。承認・却下・NGワードは全プラン（FR-034）。
- **直列化**：状態の変更、承認済みの下書きの編集、NGワードの追加・削除は、「Account × 下書き」のアドバイザリーロックの中で行う（research.md R3）。
- 追加するエラーコードはない。上限は002の`409 ITEM_LIMIT_REACHED`、競合は`409 STALE_UPDATE`を使う。

## 型

```ts
type PostDraftStatus = "needs_review" | "approved" | "rejected";

type RejectReasonCode = "similar" | "tone" | "thin" | "inaccurate" | "too_promotional" | "policy";

type PostDraft = {
  id: string;
  batchId: string;
  position: number;
  body: string;
  status: PostDraftStatus;
  version: number;
  reviewedAt: string | null;      // 承認・却下した日時（ISO 8601）。要確認では null
  rejectReasons: RejectReasonCode[]; // 却下でないときは []
  rejectNote: string | null;      // 却下の自由記述
  createdAt: string;
  updatedAt: string;
};

type NgWord = {
  id: string;
  word: string;        // 入力のまま
  normalized: string;  // 照合に使う値（research.md R4）
  createdAt: string;
};

type SkipReason = "NG_WORD" | "OVER_THREADS_LIMIT" | "POLICY_CONFIRM_REQUIRED" | "STALE" | "NOT_FOUND" | "LIMIT";

type DraftCounts = { needsReview: number; approved: number; rejected: number };

type PromptSummary = {
  // 003 の5項目に加えて
  coreRuleCount: number;  // 含めた投稿ルールの行数
  ngWordCount: number;    // 含めたNGワードの数
  rejectedCount: number;  // 含めた却下の下書きの件数
};
```

- 類似度・NGワードの該当・規約に注意・Threadsの長さは、レスポンスに含めない。Webが`packages/shared`の同じ関数で求める（research.md R7・R8）。

## 変更するエンドポイント

### GET /api/accounts/:accountId/post-drafts（003）

3つの状態の下書きと、ラベルに必要な材料を返す（FR-001、FR-012、research.md R9）。

- **200**：

  ```json
  {
    "needsReview": [ /* PostDraft[]。登録のまとまりの新しい順 → position の昇順 */ ],
    "approved":    [ /* PostDraft[]。reviewedAt の新しい順 */ ],
    "rejected":    [ /* PostDraft[]。reviewedAt の新しい順に最大500件 */ ],
    "counts": { "needsReview": 12, "approved": 30, "rejected": 640 },
    "limits": { "needsReview": 500, "approved": 500 },
    "ngWords": [ /* NgWord[]。古い順 */ ],
    "canGeneratePrompt": true,
    "promptPostCount": 30
  }
  ```

- 003の`items`・`limit`は、`needsReview`・`limits.needsReview`に置き換える（Webも同時に変える）。

### PUT /api/accounts/:accountId/post-drafts/:draftId（003）

下書きの本文を編集する（FR-007、research.md R5）。要確認と承認済みの下書きに使える。

- **リクエスト**：003と同じ（`{ "body", "expectedVersion" }`）
- **200**：`{ "draft": PostDraft, "reopened": boolean }`。承認済みの下書きを保存したときは`reopened: true`で、`draft.status`は`needs_review`になる。
- **404** `ITEM_NOT_FOUND`：ない、別のAccountのもの、または却下の下書き
- **409** `STALE_UPDATE`（`latest`は`PostDraft`）

### POST /api/accounts/:accountId/post-drafts/delete（003）

削除の対象を、要確認と却下の下書きに広げる（FR-009）。承認済みの下書きのIDは無視する。それ以外は003と同じ。

### GET /api/accounts/:accountId/prompt（003）

`summary`に`coreRuleCount`・`ngWordCount`・`rejectedCount`を足す（FR-025）。プロンプトの文面は[prompt-template.md](./prompt-template.md)のとおりに変わる。

## 追加するエンドポイント

### POST /api/accounts/:accountId/post-drafts/review

下書きの状態を変える。承認・却下・要確認に戻すを、1件でもまとめてでも扱う（FR-002〜FR-006、FR-008、FR-010、FR-040、research.md R2）。

- **リクエスト**（`action`ごとの例。PR #5 のCodexレビューで、承認の例から`reject`を外した）：

  ```json
  { "action": "approve", "requestId": "uuid", "items": [ { "id": "uuid", "expectedVersion": 3 } ], "confirmPolicyCaution": true }
  ```

  ```json
  { "action": "reject", "requestId": "uuid", "items": [ { "id": "uuid", "expectedVersion": 3 } ], "reject": { "reasons": ["tone"], "note": "" } }
  ```

  ```json
  { "action": "reopen", "requestId": "uuid", "items": [ { "id": "uuid", "expectedVersion": 4 } ] }
  ```

  - `action`：`approve`・`reject`・`reopen`
  - `requestId`：操作ごとのID（UUID）。Webが操作のたびに作り、同じ操作の再試行では同じ値を送る（research.md R2）
  - `items`：1〜500件。同じ`id`の重複は不可
  - `confirmPolicyCaution`：`approve`のときだけ使う。省略は`false`
  - `reject`：`reject`のときは必須で、それ以外では送らない。`reasons`（コードの配列、重複不可）と`note`（200文字まで）の、少なくとも一方が空でないこと
- **処理**：ロックを取ったトランザクションで、各下書きを次の順に判定する。
  1. そのAccountにない：`NOT_FOUND`
  2. すでに目的の状態：
     - 最後にその状態にした操作が同じ`requestId`（自分の再試行）：何もせず`updated`に入れる（二重の記録の防止）
     - 別の操作でその状態になっていた（別タブで先に承認された など）：`STALE`（`latest`付き）。古い画面からの操作を成功扱いにすると、Webの「元に戻す」で別タブの操作まで取り消せてしまうため（PR #5 のCodexレビュー）
  3. `version`が`expectedVersion`と違う：`STALE`
  4. 今の状態から目的の状態に移れない（例：却下 → 承認）：`STALE`
  5. `approve`のとき：
     - NGワードを含む：`NG_WORD`
     - Threadsの上限を超える：`OVER_THREADS_LIMIT`
     - 規約に注意で、`confirmPolicyCaution`が`false`：`POLICY_CONFIRM_REQUIRED`
     - 承認済みが500件を超える：`LIMIT`
  6. `reopen`のとき：要確認が500件を超える：`LIMIT`
  7. 状態を変え、`version`を1増やし、`last_review_request_id`に`requestId`を記録する。
     - `approve`：`reviewed_at`を記録する
     - `reject`：`reviewed_at`と理由を記録する
     - `reopen`：`reviewed_at`と理由を消す

  上限（500件）は、この送信で先に状態を変えた分も含めて数える。判定には`packages/shared`の`checkPublishable`（research.md R14）を使う。
- **200**：

  ```json
  {
    "updated": [ /* PostDraft[]。状態を変えた（または、すでに目的の状態だった）下書き */ ],
    "skipped": [ { "id": "uuid", "reason": "NG_WORD", "latest": { /* PostDraft。NOT_FOUND 以外 */ } } ],
    "counts": { "needsReview": 11, "approved": 31, "rejected": 640 }
  }
  ```

- **400** `VALIDATION_FAILED`：`action`が不正、`requestId`がない・UUIDでない、`items`が0件・501件以上・重複、`reject`の理由が空、`reject`以外で`reject`がある

### GET /api/accounts/:accountId/post-drafts/counts

サイドバーの件数（FR-013、research.md R9）。

- **200**：`DraftCounts`

### GET /api/accounts/:accountId/posting-rules

このアカウントの設定の「投稿のルール」に必要な値（FR-014、FR-019、FR-020、FR-042）。

- **200**：

  ```json
  {
    "ngWords": [ /* NgWord[]。古い順 */ ],
    "ngWordLimit": 200,
    "coreRules": "断定口調は使わない\n医療・投資の効果をうたわない",
    "coreRulesVersion": 4,
    "canEditCoreRules": true
  }
  ```

- 規約上のルールと規約に注意の分類は、`packages/shared`の定数をWebが直接読む（APIでは返さない）。

### POST /api/accounts/:accountId/ng-words

NGワードを足す（FR-014、FR-016a、research.md R6）。

- **リクエスト**：`{ "words": string[] }`
  - 1〜200語
  - 各語は、前後の空白を除いて1〜50文字
  - Webが入力欄の文字を、改行・「、」・「,」で区切って送る
- **処理**：ロックを取ったトランザクションで、次の順に行う。
  1. 空の語と、既存・送信内の重複（正規化した値で判定）を除く。
  2. 上限を確かめる。
  3. 残った語を足す。
  4. 足した語を含む承認済みの下書きを要確認に戻す。要確認の上限（500件）は確かめず、該当するものはすべて戻す（安全を優先。data-model.md「件数の上限」）。
- **200**：

  ```json
  {
    "added": [ /* NgWord[] */ ],
    "duplicates": ["絶対"],
    "reopenedCount": 1
  }
  ```

- **400** `VALIDATION_FAILED`：`words`が0件・201件以上、または51文字以上の語がある
- **409** `ITEM_LIMIT_REACHED`：既存＋追加が200語を超える（何も足さない）

### DELETE /api/accounts/:accountId/ng-words/:ngWordId

NGワードを1つ消す（FR-014）。要確認に戻した下書きはそのまま。

- **204**
- **404** `ITEM_NOT_FOUND`

### PUT /api/accounts/:accountId/core-rules

投稿ルールを保存する（FR-019〜FR-021、research.md R11）。

- **リクエスト**：`{ "text": string（2,000文字まで。空も可）, "expectedVersion": number }`
- **200**：`{ "coreRules": string, "coreRulesVersion": number }`
- **400** `VALIDATION_FAILED` ／ **403** `GROWER_FEATURE_REQUIRED` ／ **409** `STALE_UPDATE`（`latest`は`{ coreRules, coreRulesVersion }`）

## 既存のエンドポイントへの影響

- `POST /draft-batches`（003）：要確認の件数の上限の数え方は変えない（要確認だけを数える）。
- `DELETE /draft-batches/:batchId`（003）：これまでどおり、その登録の要確認の下書きだけを消す。承認済み・却下のものは残す。
- `DELETE /api/accounts/:accountId`とMetaのデータ削除要求の処理：変更しない。`ON DELETE CASCADE`と`accounts`の列で、本featureのデータも消える（FR-036）。
