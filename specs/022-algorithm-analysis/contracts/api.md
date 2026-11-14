# API契約：Threadsのアルゴリズムの解析

**日付**：2026-11-05 | **計画**：[../plan.md](../plan.md)

001〜021のAPIの書き方（エラーは`{ error: { code, message, details? } }`、日時はISO 8601）に従う。新しいエラーコードは足さない。すべて `authorizeAccount(..., { feature: "autopost" })` を通す（019、research.md R10）。

## GET /api/accounts/:accountId/analysis

判定：`view`。解析の画面。

クエリ：`scope`＝`all`（初め）・`regular`（ふだんの投稿だけ。research.md R9）。ほかの値は `VALIDATION_FAILED`。

```ts
{
  period: { from: string; to: string; days: 90 };   // 日本時間の日付（YYYY-MM-DD）
  scope: "all" | "regular";
  totals: {
    confirmed: number;      // 期間の確定した投稿（選んだ範囲）
    promo: number;          // そのうち宣伝の投稿
    withFollowers: number;  // 広がりを求められる投稿
    classified: number;     // 内容の分類が付いた投稿
  };
  needMore: number | null;  // ANALYSIS_MIN_TOTAL に足りない件数。足りていれば null。null でないとき下の表は空
  trends: Trend[];          // 倍率の大きい順、5つまで（research.md R5）
  time: BucketRow[];        // 朝・昼・夕方・夜・深夜の順
  day: BucketRow[];         // 平日・休日
  length: BucketRow[];      // 短い・中くらい・長い（label に字数の幅）
  features: FeatureRow[];
  opening: BucketRow[];     // 書き出しの型の7つ（分類の付いた投稿だけ）
  theme: BucketRow[];       // テーマの一覧の順（分類の付いた投稿だけ）
  recommended: {
    available: boolean;     // 広がりを求められる投稿が10件以上
    posts: RecommendedPost[];                  // 広がりの大きい順（すべて）
    compare: {
      recommended: CompareValues; others: CompareValues;  // FR-021
    } | null;
  };
  schedule: { slotTimes: string[] };          // 今の投稿の時刻（HH:mm）。「自動投稿の時刻の見直しの参考に」
  settings: { trendsInPrompt: boolean; themes: { id: string; name: string }[]; version: number | null }; // null＝まだ保存していない
  canEdit: boolean;         // content があるか
}

type CompareValues = {
  count: number; firstSpeed: number | null; laterGrowth: number | null;
  replyRate: number | null; length: number | null; questionCount: number;
};
```

- 未接続のアカウントでも返す（確定した投稿が0件なら `needMore` が20）。
- `totals.promo` は、選んだ範囲によらず期間の全体で数える。
- 投稿の本文は、おすすめに乗った目安の `head`（初めの40文字）だけを返す。

## PATCH /api/accounts/:accountId/analysis/settings

判定：`content`。

```ts
// 入力（analysisSettingsRequestSchema）
{ expectedVersion: number | null; trendsInPrompt?: boolean; themes?: { id?: string; name: string }[] }  // 021の既定値と同じ書き方
// 応答
{ settings: { trendsInPrompt: boolean; themes: { id: string; name: string }[]; version: number } }
```

- 行がないときは `expectedVersion: null`。今の版と合わなければ `STALE_UPDATE`（409。`details` なしで、今の設定を返す）。
- `themes` は10個まで、名前は前後の空白を除いて1〜20文字、重なりは `VALIDATION_FAILED`。`id` のないものは新しいid（`t`＋英数字）を付ける。前の一覧にあって今回ないidは消したものとして、そのテーマの分類の `theme_id` をNULLにする（同じトランザクション）。
- 操作の記録：`analysis_settings_updated`（`kind: "content"`）。

## GET /api/accounts/:accountId/analysis/classifications

判定：`content`（分類を付ける・直す画面のため）。

クエリ：`mode`＝`unclassified`（初め）・`classified`。

```ts
{
  posts: Array<{
    draftId: string; body: string; publishedAt: string;
    openingType: OpeningType | null; themeId: string | null;
  }>;
  remaining: number;        // unclassified のとき、この50件のほかに残っている件数
  themes: { id: string; name: string }[];
}
```

- 期間（90日）の確定した投稿だけ。`unclassified` は分類のない投稿の新しい順に50件まで、`classified` は分類のある投稿の新しい順に200件まで。

## PUT /api/accounts/:accountId/analysis/classifications

判定：`content`。

```ts
// 入力（classificationsRequestSchema）
{ source: "ai" | "manual"; items: Array<{ draftId: string; openingType: OpeningType; themeId: string | null }> } // 1〜50件
// 応答
{ saved: number; skipped: string[] }   // skipped：そのAccountの確定した投稿でない・知らないテーマの draftId
```

- あるものは入れ替える（`ON CONFLICT (draft_id) DO UPDATE`）。
- 操作の記録：`posts_classified`（`summary` は件数）。

## 投稿のプロンプト（003・006を変える）

- `GET /api/accounts/:accountId/prompt`：`analysis_settings.trends_in_prompt` が true（行なしも true）のとき、「ふだんの投稿」で傾向を求め、`promptable` な傾向を CORE RULES・NGワードで絞って（research.md R7）、「■伸びた傾向」の節に入れる。
- 応答の `summary` に `trendCount`（入れた傾向の数）を足す。
- 入れる傾向がなければ、プロンプトの文は今と同じ（SC-004）。
