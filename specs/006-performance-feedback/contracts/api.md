# API契約：パフォーマンス分析と改善フィードバック

**対象feature**：[spec.md](../spec.md) ／ **データモデル**：[data-model.md](../data-model.md) ／ **これまでのAPI契約**：[005](../../005-auto-post/contracts/api.md)

`apps/api`に足す・変えるエンドポイントの契約。入出力の形は`packages/shared`のzodのスキーマで定義し、Webと共有する。反応数の取り込みの手順は[metrics-job.md](./metrics-job.md)、CSVの列は[csv.md](./csv.md)。

## 共通事項

001〜005の共通事項をそのまま使う。
- 認証と、Accountの`owner`だけに許可すること（FR-032）
- `404 ACCOUNT_NOT_FOUND`・`404 ITEM_NOT_FOUND`・`400 VALIDATION_FAILED`（`details`に項目名）
- 要再接続のAccountでも、読むことはできる

本featureの追加：

- **grower機能**：本featureのエンドポイントは、grower機能を使えるAccount（有料の契約中か無料体験中。今は`hasGrowerAccess`）だけに許可する。使えなければ`403 GROWER_FEATURE_REQUIRED`（002と同じコード）。Webは、このコードで「パフォーマンス分析は有料の契約で使えます」の案内を出す（FR-031）。

## 型

```ts
type Judgment = "good" | "normal" | "poor";
type MetricsState = "pending" | "updating" | "confirmed" | "late_confirmed" | "unmeasurable";
// pending は「行がない」（まだ一度も取っていない）を表す。DBの列挙型にはない
type MetricsKind = "h24" | "d3" | "d7" | "late";
type PerformanceTab = "all" | "good" | "normal" | "poor" | "pending";
// pending のタブ＝確定待ち（pending と updating）

type Metrics = {
  views: number | null; likes: number | null; replies: number | null;
  reposts: number | null; quotes: number | null; shares: number | null;
};

type PerformanceItem = {
  id: string;                      // post_drafts.id
  body: string;
  publishedAt: string;
  threadsPermalink: string | null; // null なら「Threadsで開く」を出さない
  state: MetricsState;
  metrics: Metrics | null;         // pending と、一度も取れていない unmeasurable は null
  lastFetchedAt: string | null;
  lastElapsedHours: number | null; // 整数（切り捨て）
  nextFetchAt: string | null;      // pending のとき、次に取り込む目安（投稿から24時間後）
  confirmAt: string | null;        // pending・updating のとき、確定の目安（投稿から7日後）
  judgment: Judgment | null;       // 確定して判定済みのときだけ
  ratio: number | null;            // 丸める前の値。表示は小数第1位
  unmeasurableReason: "no_media_id" | "not_found" | null;
  feedback: {                      // judgment が poor のときだけ
    memo: string | null;
    includeInPrompt: boolean;
    inNextPrompt: boolean;         // 次のプロンプトに入る5件か（FR-022）
  } | null;
};

type PerformanceSummary = {
  baseline: number | null;         // 基準値。基準値に使える投稿が5件未満なら null
  baselineSampleCount: number;     // 基準値に使える確定の件数（最大30）
  judgeableCount: number;          // 確定した投稿の数（5件未満なら「いま{n}件」に使う）
  baselineIsZero: boolean;         // 5件以上あるが基準値が0（FR-009）
  lastFetchedAt: string | null;    // Account全体の最後の取り込み
  insightsDenied: boolean;         // 反応数を読む権限がない（research.md R11）
  needsReconnect: boolean;
  counts: Record<PerformanceTab, number>;
};
```

## エンドポイント

### `GET /accounts/:accountId/performance`

パフォーマンスの画面の最初の表示と、タブの切り替え・「さらに表示する」。

- **クエリ**：`tab`（`PerformanceTab`、既定`all`）、`before`（続きのカーソル。005の投稿済みの一覧と同じ形）、`limit`（既定50、最大50）
- **200**：

```ts
{
  summary: PerformanceSummary;   // before があるときも返す（件数が変わっていれば画面を合わせる）
  items: PerformanceItem[];      // published_at の新しい順、同じなら id の順
  nextCursor: string | null;
}
```

- **並び・絞り込み**：
  - `all`：投稿済みのすべて（計測できませんを含む）
  - `good`・`normal`・`poor`：その判定の投稿
  - `pending`：まだ取っていない投稿と`updating`
- **エラー**：`403 GROWER_FEATURE_REQUIRED`、`400 VALIDATION_FAILED`（`tab`・`before`）

### `PATCH /accounts/:accountId/performance/:draftId/feedback`

低調の投稿の傾向メモと「プロンプトに入れる」を保存する（FR-021）。保存ボタンなしで、Webはメモの入力欄から離れたとき・切り替えを押したときに呼ぶ。

- **本文**：`{ memo?: string | null; includeInPrompt?: boolean }`（どちらか1つ以上。`memo`は前後の空白を除いて200文字まで。空なら`null`）
- **200**：`{ item: PerformanceItem; promptIds: string[] }`（`promptIds`は次のプロンプトに入る5件。繰り上がりを画面に出すため）
- **エラー**：
  - `404 ITEM_NOT_FOUND`：そのAccountの投稿でない、または低調と判定されていない
  - `400 VALIDATION_FAILED`：`memo`が長すぎる・項目がない
  - `403 GROWER_FEATURE_REQUIRED`
- **同時の編集**：後から保存したもので上書きする（版は確かめない。spec エッジケース）。

### `GET /accounts/:accountId/performance/export`

CSVの行のデータを返す。CSVはWebで組み立てる（research.md R7、[csv.md](./csv.md)）。

- **クエリ**：`kind`（`posts`・`snapshots`）、`before`（続きのカーソル）
- **200**：`{ rows: PostExportRow[] | SnapshotExportRow[]; nextCursor: string | null; generatedAt: string }`（200件ずつ）
  - `posts`：投稿済みの投稿を`published_at`の新しい順
  - `snapshots`：取り込みの履歴を`fetched_at`の新しい順
- **エラー**：`403 GROWER_FEATURE_REQUIRED`、`400 VALIDATION_FAILED`

## 変える既存のエンドポイント・処理

| 対象 | 変更 |
|---|---|
| `GET /accounts/:accountId/prompt`（003） | 「■反応が低かった投稿」の節の材料を読む（research.md R8、[prompt-template.md](./prompt-template.md)） |
| `PUT /accounts/:accountId/post-drafts/:draftId`（003の編集） | 本文が変わったら`body_edited_at`を入れる（FR-002e） |
| `POST /accounts/:accountId/draft-batches`（003の貼り付け） | `draft_batches`にプロンプトの材料の版を写す（FR-002g） |
| 宣伝内容・リサーチ・投稿ルールの追加・変更・削除（002・004） | `accounts`の`*_changed_at`に今の時刻を入れる（research.md R9） |
| 001の再接続（`writeConnection`） | `accounts.insights_denied_at`を消す |
| 005の公開の成功の記録（`publish-executor`） | `published_slot_minute`・`published_carryover`・`published_prioritized`を入れる（FR-002f） |
| 005の`runAutoPost` | 最後に反応数の段階を足し、関所の候補に「次の日本時間3:00」を足す（[metrics-job.md](./metrics-job.md)） |

## Threads APIの呼び出し（足すもの）

| 呼び出し | URL | 返り値 | 失敗の扱い |
|---|---|---|---|
| `getMediaInsights(token, mediaId)` | `GET {graph}/v1.0/{mediaId}/insights?metric=views,likes,replies,reposts,quotes,shares` | `Metrics`（返らない指標は`null`） | 404・コード100/サブコード33は`ThreadsNotFoundError`。コード10・200番台は`ThreadsPermissionError`。ほかは005と同じ分け方 |
| `getFollowersCount(token, userId)` | `GET {graph}/v1.0/{userId}/threads_insights?metric=followers_count` | `number` | 同上（`ThreadsNotFoundError`は起きない想定） |

どちらもトークンを`Authorization: Bearer`で渡し、タイムアウトは10秒（005と同じ）。

## 偽のThreadsサーバー（テスト）

`apps/api/test/fake-threads/server.ts`に、上の2つを足す。投稿ごとの値・返さない指標・投稿の削除（コード100/サブコード33）・権限のエラー（コード10）・上限（コード4）・5xxを、テストから設定できるようにする。
