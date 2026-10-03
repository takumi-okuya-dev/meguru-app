# API契約：戦略プロファイル

**対象feature**：[spec.md](../spec.md) ／ **データモデル**：[data-model.md](../data-model.md) ／ **001のAPI契約**：[001 contracts/api.md](../../001-login-account-setup/contracts/api.md)

`apps/api`に足すエンドポイントの契約。リクエストとレスポンスの形は`packages/shared`のzodスキーマで定義し、Webと共有する。

## 共通事項

001の共通事項（ベースパス`/api`、Clerkのトークンによる認証、CORS、エラーの形、設定の確認）をそのまま使う。本featureのエンドポイントは、すべて**認証が必要**である。

- **Accountの確認**：パスの`:accountId`は、リクエストしたユーザーが`owner`であるAccountでなければならない。形が違う・存在しない・他人のものは、どれも`404 ACCOUNT_NOT_FOUND`にする（存在の有無を漏らさない。FR-023）。
- **子の行の確認**：`:promotionId`などは、そのAccountの行でなければならない。形が違う・存在しない・別のAccountのものは、どれも`404 ITEM_NOT_FOUND`にする。
- **接続状態**：Threadsへの接続が「要再接続」のAccountでも、すべて使える（FR-025）。Threads APIは呼ばない。
- **CORS**：001で許可しているメソッド（`GET`・`POST`・`PUT`・`DELETE`）だけを使う。
- **grower機能の判定**（FR-024、research.md R14）：`POST`・`PUT`・`DELETE`は、そのAccountでgrower機能を使えなければ`403 GROWER_FEATURE_REQUIRED`を返す。`GET`は判定せず、レスポンスに`canEdit`（編集できるか）を入れる。
- **検証の失敗**：`400 VALIDATION_FAILED`。`details`に、違反した項目名（リクエストのキー名）を入れる。

  ```json
  { "error": { "code": "VALIDATION_FAILED", "message": "invalid strategy", "details": ["finalAction", "toneNotes"] } }
  ```

- **競合**（research.md R3）：保存のリクエストには`expectedVersion`を付ける。DBの`version`と一致しなければ`409 STALE_UPDATE`を返し、`latest`に最新の値を入れる。

  ```json
  { "error": { "code": "STALE_UPDATE", "message": "updated elsewhere" }, "latest": { /* その資源の最新の値 */ } }
  ```

## 追加するエラーコード

`packages/shared`の`ERROR_CODES`に足す。画面の文言は[ui-routes.md](./ui-routes.md)の「エラー文言」を参照。

| コード | HTTP | いつ |
|---|---|---|
| `STALE_UPDATE` | 409 | 別のタブ・端末で先に保存されていた（FR-020） |
| `ITEM_NOT_FOUND` | 404 | 宣伝内容・参考投稿・キーワードが見つからない（別のタブで削除された場合を含む） |
| `ITEM_LIMIT_REACHED` | 409 | 件数の上限に達している（FR-022） |
| `KEYWORD_DUPLICATE` | 409 | 同じキーワードがすでにある（FR-014） |
| `GROWER_FEATURE_REQUIRED` | 403 | プラン2以上でも無料体験中でもないAccountで、編集しようとした（FR-024） |

## 型

```ts
type TonePreset =
  | "energetic_casual" | "polite_warm" | "formal" | "casual_frank"
  | "introspective_calm" | "passionate" | "humorous";

// 課題の項目のキー（data-model.md の strategy_designs の列を camelCase にしたもの）
type StrategyTextField =
  | "finalAction" | "targetPersona" | "realWorries" | "desiredSelfImage" | "perceivedImage"
  | "contentThemeMix" | "antiPersona" | "benchmarkAccounts"
  | "funnelDesign" | "postGenres" | "dmReplyTemplate" | "inquiryQualityTips"
  | "toneNotes" | "differentiation" | "successMetrics"
  | "profileBioDraft" | "pinnedPostDraft1" | "pinnedPostDraft2" | "pinnedPostDraft3";

type StrategyValues = Record<StrategyTextField, string> & {   // 未入力は ""
  tonePreset: TonePreset | null;                               // 未選択は null
};

type Strategy = StrategyValues & {
  version: number;           // まだ保存していなければ 0
  filledCount: number;       // 16項目のうち入力済みの数（FR-005）
  totalCount: 16;
  updatedAt: string | null;  // ISO 8601。まだ保存していなければ null（FR-006）
};

type PromotionStatus = "active" | "paused" | "ended";

type PromotionInput = {
  title: string;                   // 必須、100文字まで
  content: string;                 // 必須、2,000文字まで
  targetLocation: string;          // 任意（"" は未入力）、100文字まで
  targetPersona: string;           // 同上
  targetAgeRange: string;          // 同上
  cta: string;                     // 同上
  linkedUrl: string;               // 任意、http/https のみ、2,000文字まで
  priority: number;                // 0〜100 の整数
  status: PromotionStatus;
  validUntil: string | null;       // "YYYY-MM-DD"
};

type Promotion = PromotionInput & {
  id: string;
  isExpired: boolean;              // 掲載期限 < 日本時間の今日（research.md R6）
  isTargetable: boolean;           // status = active かつ 期限切れでない
  version: number;
  createdAt: string;
  updatedAt: string;
};

type ReferencePostInput = {
  body: string;                    // 必須、2,000文字まで
  keyword: string;                 // 任意、100文字まで
  postUrl: string;                 // 任意、http/https のみ、2,000文字まで
  whyGood: string;                 // 任意、2,000文字まで
};

type ReferencePost = ReferencePostInput & {
  id: string; version: number; createdAt: string; updatedAt: string;
};

type ResearchKeywordInput = {
  keyword: string;                 // 必須、100文字まで
  purpose: string;                 // 任意、100文字まで
};

type ResearchKeyword = ResearchKeywordInput & {
  id: string; version: number; createdAt: string; updatedAt: string;
};
```

- 任意のテキストは、未入力を`""`で表す（`null`は使わない）。前後の空白だけの値は`""`として扱う（research.md R2）。
- 文字数はUnicodeのコードポイントの数で数える（research.md R2）。

## エンドポイント

### GET /api/accounts/:accountId/profile-status

Accountのホームに出す入力状況（FR-017、research.md R11）。

- **200**：

  ```json
  {
    "strategy": { "filledCount": 11, "totalCount": 16 },
    "promotions": { "targetableCount": 1, "totalCount": 3 },
    "research": { "referencePostCount": 0, "keywordCount": 2 },
    "access": { "canEdit": true, "inTrial": true, "trialEndsAt": "2026-11-02T03:00:00.000Z" }
  }
  ```

### GET /api/accounts/:accountId/strategy

課題を返す（FR-001、FR-006）。まだ保存していなければ、全項目が`""`・`tonePreset: null`・`version: 0`・`updatedAt: null`を返す。

- **200**：`Strategy & { canEdit: boolean }`

### PUT /api/accounts/:accountId/strategy

課題の全項目をまとめて保存する（FR-004、FR-018。research.md R1・R3）。

- **リクエスト**：`StrategyValues & { expectedVersion: number }`。すべてのキーが必要（省略は検証の失敗）。
- **200**：保存後の`Strategy`（`version`が1増えている）
- **400** `VALIDATION_FAILED`：文字数の超過、`tonePreset`の値が違う、キーの不足
- **409** `STALE_UPDATE`：`latest`は`Strategy`

### GET /api/accounts/:accountId/promotion-settings

- **200**：`{ "ratioPercent": 20, "canEdit": true }`

### PUT /api/accounts/:accountId/promotion-settings

宣伝投稿の割合を保存する（FR-010）。競合は検知しない（research.md R7）。

- **リクエスト**：`{ "ratioPercent": 0〜100の整数 }`
- **200**：`{ "ratioPercent": … }`
- **400** `VALIDATION_FAILED`

### GET /api/accounts/:accountId/promotions

宣伝内容の一覧を、FR-009の順で返す。

- **200**：`{ "items": Promotion[], "limit": 50, "canEdit": true }`

### POST /api/accounts/:accountId/promotions

宣伝内容を追加する（FR-007、FR-022。research.md R4）。

- **リクエスト**：`PromotionInput`（`status`を省略すると`active`、`priority`を省略すると0）
- **201**：`Promotion`
- **400** `VALIDATION_FAILED`
- **409** `ITEM_LIMIT_REACHED`

### PUT /api/accounts/:accountId/promotions/:promotionId

宣伝内容を更新する。状態の変更（一時停止・終了・有効に戻す）もこれで行う。

- **リクエスト**：`PromotionInput & { expectedVersion: number }`
- **200**：`Promotion`
- **400** `VALIDATION_FAILED`
- **404** `ITEM_NOT_FOUND`：別のタブで削除されていた（spec エッジケース）
- **409** `STALE_UPDATE`：`latest`は`Promotion`

### DELETE /api/accounts/:accountId/promotions/:promotionId

宣伝内容を削除する（FR-011）。確認は画面で行う。すでに消えていても成功とする。

- **204**

### GET /api/accounts/:accountId/reference-posts

参考投稿の一覧を、保存日時の新しい順で返す（FR-013）。

- **200**：`{ "items": ReferencePost[], "limit": 200, "canEdit": true }`

### POST /api/accounts/:accountId/reference-posts

- **リクエスト**：`ReferencePostInput`
- **201**：`ReferencePost`
- **400** `VALIDATION_FAILED`（本文が空、文字数の超過、URLの形）
- **409** `ITEM_LIMIT_REACHED`

### PUT /api/accounts/:accountId/reference-posts/:referencePostId

- **リクエスト**：`ReferencePostInput & { expectedVersion: number }`
- **200**：`ReferencePost`
- **400** `VALIDATION_FAILED` ／ **404** `ITEM_NOT_FOUND` ／ **409** `STALE_UPDATE`（`latest`は`ReferencePost`）

### DELETE /api/accounts/:accountId/reference-posts/:referencePostId

- **204**（すでに消えていても成功）

### GET /api/accounts/:accountId/research-keywords

- **200**：`{ "items": ResearchKeyword[], "limit": 100, "canEdit": true }`（作成日時の新しい順）

### POST /api/accounts/:accountId/research-keywords

- **リクエスト**：`ResearchKeywordInput`
- **201**：`ResearchKeyword`
- **400** `VALIDATION_FAILED`
- **409** `KEYWORD_DUPLICATE`（正規化した値が同じキーワードがある。research.md R5）／ `ITEM_LIMIT_REACHED`

### PUT /api/accounts/:accountId/research-keywords/:keywordId

- **リクエスト**：`ResearchKeywordInput & { expectedVersion: number }`
- **200**：`ResearchKeyword`
- **400** `VALIDATION_FAILED` ／ **404** `ITEM_NOT_FOUND` ／ **409** `STALE_UPDATE`（`latest`は`ResearchKeyword`）・`KEYWORD_DUPLICATE`

### DELETE /api/accounts/:accountId/research-keywords/:keywordId

- **204**（すでに消えていても成功）。参考投稿に記録したキーワードは消えない。

## 既存のエンドポイントへの影響

- `DELETE /api/accounts/:accountId`とMetaのデータ削除要求の処理：変更しない。`ON DELETE CASCADE`で本featureの行も消える（FR-026）。
- `GET /api/me`：レスポンスに`threadsAccessMode`（`"testers"`または`"public"`）を足す（FR-028、research.md R15）。
- `GET /api/accounts/:accountId`：変更しない。

## 環境変数（追加）

| 名前 | 必須 | 値 | 説明 |
|---|---|---|---|
| `THREADS_ACCESS_MODE` | 任意（既定`testers`） | `testers` / `public` | Threads連携の公開範囲。Meta App Reviewに通り、Metaのアプリを公開状態にしたら`public`にする。それ以外の値は`CONFIG_ERROR` |
