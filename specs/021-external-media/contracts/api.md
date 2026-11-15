# API契約：外部媒体展開

**日付**：2026-11-04 | **計画**：[../plan.md](../plan.md)

001〜020のAPIの書き方（エラーは`{ error: { code, message, details? } }`、日時はISO 8601）に従う。新しいエラーコードは足さない。すべて `authorizeAccount(..., { feature: "strategy" })` を通す（019）。

## 宣伝内容（002を変える）

- `promotionInputSchema` に `event: promotionEventSchema.nullable().optional()` を足す（data-model.md）。`POST`・`PUT /api/accounts/:accountId/promotions[/:id]` で保存し、一覧・1件の応答に `event` を返す。
- 入れなければ今と同じ（NULL）。`PUT` で `event` を省いたときは今の値を変えない、`null` を送ると消す。
- `GET /api/accounts/:accountId/prompt` の宣伝内容の行に、`event` があるときだけ日時・場所・参加費・定員の1行が入る（research.md R9）。

## GET /api/accounts/:accountId/external-media

判定：`view`。外部媒体展開の最初の画面。

```ts
{
  promotions: Array<{
    id: string; title: string; version: number;
    event: PromotionEvent | null;        // 開催日時がなければ選べない（FR-001b）
    listings: Array<{ media: Media; status: ListingStatus; postedUrl: string | null }>; // 行のある媒体だけ
  }>;
  canEdit: boolean;                       // content があるか
}
```

並び：開催日時の近い順（終わったものは後ろ）、開催日時のないものは最後。

## GET /api/accounts/:accountId/external-media/:promotionId/:media

判定：`view`。入力の画面。

```ts
{
  promotion: Promotion;                  // 元の情報（event を含む）
  media: Media;
  listing: {
    status: ListingStatus; postedUrl: string | null; imageStyle: "illustration" | "photo";
    fields: Record<string, string> | null; // null＝まだ作っていない
    fixes: ListingFix[];
    generatedAt: string | null; sourceVersion: number | null; version: number | null; // 行がなければ null
  };
  defaults: Record<string, string>;      // 媒体の既定値
  sourceChanged: boolean;                // sourceVersion と今の宣伝内容の version が違う（R8）
  canEdit: boolean;
}
```

ルールのチェック・作業のSTEP・画像とAIのプロンプトは、Webが共有の関数で作る（応答に入れない。research.md R1・R5）。

- `promotionId` がそのAccountの宣伝内容でない：`404 ITEM_NOT_FOUND`。
- `media` が5つのどれでもない：`404 ITEM_NOT_FOUND`。

## POST /api/accounts/:accountId/external-media/:promotionId/:media/generate

判定：`content`。掲載内容を作る（作り直す）。`buildListing` で `fields`・`fixes` を作り、`generated_at`・`source_version`（今の宣伝内容の version）を入れる。状況が `not_started` なら `drafting` にする。

- リクエスト：`{ expectedVersion: number | null }`（行がなければ null）。違えば `409 STALE_UPDATE`。
- 開催日時のない宣伝内容：`422 VALIDATION_FAILED`（details `["event"]`）。
- 応答：上の GET と同じ形。
- 操作の記録：`listing_generated`（kind `content`、summary は「宣伝内容のタイトル（媒体名）」）。

## PUT /api/accounts/:accountId/external-media/:promotionId/:media

判定：`content`。欄・状況・掲載URL・画像の種類を保存する。

```ts
{
  expectedVersion: number | null;
  status?: ListingStatus;
  postedUrl?: string | null;             // https?:// で始まる、2000文字まで
  imageStyle?: "illustration" | "photo";
  fields?: Record<string, string>;       // その媒体の欄の key だけ。各値は欄の max まで（max のない欄は15,000文字まで）
}
```

- `fields` を送ったときは、`fixRules` を通し直して `fixes` を足す（貼った文に禁止の行があれば外す。FR-012a・FR-022）。
- 知らない key：`400 VALIDATION_FAILED`。
- 応答：GET と同じ形。操作の記録：状況を変えたとき `listing_status_changed`、欄だけなら `listing_saved`。

## PUT /api/accounts/:accountId/media-defaults/:media

判定：`content`。`{ expectedVersion: number | null, values: Record<string, string> }`。その媒体の `defaultable` の欄の key だけ。応答 `{ media, values, version }`。`GET /api/accounts/:accountId/media-defaults` は `view` で5媒体分を返す。

## 守り

- 関わりのない人：`404 ACCOUNT_NOT_FOUND`。見せてもらっている人（`read` だけ）：`403 ROLE_FORBIDDEN`。戦略が使えない：`403 FEATURE_DISABLED`。決済で読むだけ：書き込みは `BILLING_REQUIRED`（013のまま）。
- 応答に、ほかのAccountの宣伝内容・掲載内容を入れない。
