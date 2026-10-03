# API契約：AIプロンプトの生成と投稿案の一括登録

**対象feature**：[spec.md](../spec.md) ／ **データモデル**：[data-model.md](../data-model.md) ／ **これまでのAPI契約**：[001](../../001-login-account-setup/contracts/api.md)、[002](../../002-strategy-profile/contracts/api.md)

`apps/api`に足すエンドポイントの契約。入出力の形は`packages/shared`のzodスキーマで定義し、Webと共有する。

## 共通事項

001・002の共通事項をそのまま使う：認証、`404 ACCOUNT_NOT_FOUND`・`404 ITEM_NOT_FOUND`の使い分け、`400 VALIDATION_FAILED`（`details`に項目名）、`409 STALE_UPDATE`（`latest`に最新の値）、要再接続のAccountでも使えること（FR-025）。

- **grower機能の判定**：プロンプトの取得（`GET /prompt`）と作る件数の保存（`PUT /prompt-settings`）だけを判定し、使えなければ`403 GROWER_FEATURE_REQUIRED`。下書きの操作は全プランで使える（research.md R10）。

## 追加するエラーコード

`packages/shared`の`ERROR_CODES`に足す。画面の文言は[ui-routes.md](./ui-routes.md)の「エラー文言」を参照。

| コード | HTTP | いつ |
|---|---|---|
| `PASTE_TOO_LARGE` | 400 | 貼り付けが1回の上限（50件・50,000文字）を超えた、または分割した1件が2,000文字を超えた（FR-014、research.md R6）。`details`に`["drafts"]`（件数）・`["text"]`（全体の文字数）・`["draft:12"]`（12件目が長い。1始まり）のどれかを入れる |

件数の上限（要確認の下書き500件）を超える場合は、002の`409 ITEM_LIMIT_REACHED`を使う。

## 型

```ts
type PromptSummary = {
  strategyFilledCount: number;  // 含めた課題の項目の数（16項目のうち）
  promotionCount: number;       // 含めた宣伝内容の件数
  referencePostCount: number;   // 含めた参考投稿の件数
  recentDraftCount: number;     // 含めた直近の下書きの件数
  length: number;               // 全文の文字数
};

type PostDraft = {
  id: string;
  batchId: string;
  position: number;             // 登録のまとまりの中での順番（0始まり）
  body: string;
  status: "needs_review";       // 004 で "approved" | "rejected" を足す
  version: number;
  createdAt: string;            // ISO 8601
  updatedAt: string;
};

type DraftBatchResult = {
  batchId: string;
  draftCount: number;           // 登録した件数
  delimiterFound: boolean;      // 区切り（@@@）が見つかったか
  overLimitCount: number;       // Threadsの上限（500文字・リンク5個）を超える下書きの件数
  drafts: PostDraft[];          // 登録した下書き（position の昇順）
};
```

- Threadsの長さ（`threadsLength`）とリンクの数（`countLinks`）はレスポンスに含めない。Webが`packages/shared`の同じ関数で求める（research.md R4）。

## エンドポイント

### GET /api/accounts/:accountId/prompt

プロンプトを組み立てて返す（FR-001〜FR-008）。表示のたびに最新の材料から作る（FR-007）。

- **クエリ**：`count`（任意、1〜50の整数）。省略するとAccountの`prompt_post_count`を使う。
- **200**：`{ "prompt": string, "count": number, "summary": PromptSummary }`
- **400** `VALIDATION_FAILED`：`count`が範囲外
- **403** `GROWER_FEATURE_REQUIRED`

### PUT /api/accounts/:accountId/prompt-settings

作る件数を保存する（FR-004、research.md R11）。競合は検知しない（後勝ち）。

- **リクエスト**：`{ "postCount": 1〜50の整数 }`
- **200**：`{ "postCount": number }`
- **400** `VALIDATION_FAILED` ／ **403** `GROWER_FEATURE_REQUIRED`

### GET /api/accounts/:accountId/post-drafts

要確認の下書きの一覧（FR-018）。並び順は、登録のまとまりの作成日時の降順 → `position`の昇順。

- **200**：

  ```json
  {
    "items": [ /* PostDraft[] */ ],
    "limit": 500,
    "canGeneratePrompt": true,
    "promptPostCount": 30
  }
  ```

- `canGeneratePrompt`：そのAccountでgrower機能を使えるか（FR-024）。
- `promptPostCount`：保存済みの作る件数（`canGeneratePrompt`が`false`でも返す）。

### POST /api/accounts/:accountId/draft-batches

貼り付けたテキストを分割して、下書きとして一括登録する（FR-009〜FR-016、research.md R3・R5・R6）。

- **リクエスト**：`{ "clientRequestId": uuid, "text": string }`
- **201**：`DraftBatchResult`（新しく登録した）
- **200**：`DraftBatchResult`（同じ`clientRequestId`の2回目。新しく登録せず、1回目の結果を返す。`drafts`は今も残っているものだけ）
- **400** `VALIDATION_FAILED`：`text`が空・空白だけ、`clientRequestId`の形が違う
- **400** `PASTE_TOO_LARGE`：件数が50件を超える、全体が50,000文字を超える、1件が2,000文字を超える
- **409** `ITEM_LIMIT_REACHED`：要確認の下書きが500件を超える（何も登録しない）

### DELETE /api/accounts/:accountId/draft-batches/:batchId

直前の登録を取り消す（FR-016a、research.md R8）。その登録の下書きのうち、要確認のものをまとめて削除する。

- **200**：`{ "deletedCount": number }`（すでに消えていれば0）
- **404** `ITEM_NOT_FOUND`：登録のまとまりがない、または別のAccountのもの

### PUT /api/accounts/:accountId/post-drafts/:draftId

下書きの本文を編集する（FR-019）。

- **リクエスト**：`{ "body": string（空白だけは不可、2,000文字まで）, "expectedVersion": number }`
- **200**：`PostDraft`
- **400** `VALIDATION_FAILED` ／ **404** `ITEM_NOT_FOUND` ／ **409** `STALE_UPDATE`（`latest`は`PostDraft`）

### POST /api/accounts/:accountId/post-drafts/delete

下書きを1件、またはまとめて削除する（FR-020、research.md R9）。

- **リクエスト**：`{ "ids": string[] }`（1〜500件、UUID）
- **200**：`{ "deletedCount": number }`。そのAccountの要確認の下書きだけを削除し、すでに消えているIDは無視する。
- **400** `VALIDATION_FAILED`

## 既存のエンドポイントへの影響

- `DELETE /api/accounts/:accountId`とMetaのデータ削除要求の処理：変更しない。`ON DELETE CASCADE`で本featureの行も消える（FR-026）。
- `GET /api/accounts/:accountId/profile-status`（002）：変更しない。
