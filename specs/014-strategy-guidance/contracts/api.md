# API契約：課題の入力を手助けする

**Feature**：[spec.md](../spec.md) | **データ**：[data-model.md](../data-model.md)

すべて`/api`の下。認証・エラーの形・`authorizeAccount`による権限の判定（読むだけは`403 BILLING_REQUIRED`）は001〜013と同じ。権限の名前は011の`permissions.md`のとおり（`read`・`view`・`content`・`settings`など）。

## 変更するAPI

### GET・PUT `/accounts/:accountId/strategy`（002）

- 応答・リクエストに6つのキーを足す：`purposeOrigin`・`purposeSelf`・`purposeOthers`・`purposeFuture`・`purposeStance`・`activityAxis`（文字列。`""`は未入力。2,000文字まで）。
- PUTでは6つのキーを**省略できる**。省略したキーは今の値を残す（FR-054）。今の19のキーと`tonePreset`は今のまま必須。
- `filledCount`・`totalCount: 16`は今のまま（目的の5問を数えない。FR-020）。
- 権限：GETは`read`、PUTは`content`（今のまま）。

### GET・POST・PUT `/accounts/:accountId/reference-posts`（002）

- 参考投稿に足す項目（応答・リクエスト。リクエストではどれも省略でき、省略は既定値）：

```json
{
  "platform": "threads",
  "postedDateMode": "exact",
  "postedDate": "2026-10-10",
  "metrics": { "likes": 820, "replies": 140, "views": 32000, "saves": null, "reposts": null, "followers": 1800 },
  "author": "",
  "memo": ""
}
```

- 検証：`platform`は5つのどれか。`postedDateMode = "exact"`なら`postedDate`が必須で、今日（日本時間）より後でない。それ以外なら`postedDate`は`null`。`metrics`の各値は0以上の整数か`null`（21億まで）。`author`は100文字、`memo`は500文字まで。通らなければ`400 VALIDATION_FAILED`（`fields`に項目名）。
- GETの応答の各参考投稿に`freshness`（`"latest"`・`"active"`・`"archive"`・`"unknown"`。今日の日本時間で求める）と`shortId`（R8）を足す。並びは今のまま登録の新しい順。

### GET `/accounts/:accountId/prompt`（003）

応答に足すもの：

```json
{
  "prompt": "…1つにまとめた全文…",
  "parts": ["…1つ目…", "…2つ目…"],
  "count": 10,
  "length": 14820,
  "splitRecommended": true,
  "settings": {
    "postCount": 10,
    "length": { "target": 150, "shortLength": 55, "mediumLength": 100, "longLength": 135, "shortRatio": 35, "mediumRatio": 45, "longRatio": 20 },
    "version": 3
  },
  "summary": { "…今の summary…": 0 },
  "materials": {
    "strategy": {
      "items": [{ "key": "targetPersona", "status": "short", "chars": 18 }],
      "done": 8, "review": 2, "purposeDone": 3
    },
    "drafts": { "profileBio": true, "pinned": [true, false, false] },
    "promotions": { "included": 3, "missingCta": 1 },
    "research": { "total": 5, "included": 5, "explained": 2, "pending": 3 }
  }
}
```

- `length`は1つにまとめた全文の文字数（コードポイント）。`splitRecommended`は`length > 12000`（R12）。
- `parts`の2つを合わせた節は、`prompt`と同じ（重なるのは「最初に確認すること」と冒頭の指示だけ。SC-020）。
- `materials`はプロンプトを作るときの数え方のまま（R9、FR-123）。`strategy.items`は目的の5問・活動の軸・16項目の順。活動の軸は`status: null`（判定しない）。
- `settings`は作る件数と文字数・割合（R11）。今`GET /post-drafts`が返している`promptPostCount`・`promptPostCountVersion`は互換のため残す。
- 権限：今のまま`view`。

### PUT `/accounts/:accountId/prompt-settings`（003）

```json
{ "postCount": 10, "length": { "target": 200, "shortLength": 70, "mediumLength": 135, "longLength": 180, "shortRatio": 35, "mediumRatio": 45, "longRatio": 20 }, "expectedVersion": 3 }
```

- `length`は省略できる（省略なら文字数・割合は変えない。今のクライアントを壊さない）。
- 検証：`target`は50〜500で10刻み、各長さは10〜500で5刻みかつ`target`以下、各割合は0〜100で5刻み、割合の合計が100。通らなければ`400 VALIDATION_FAILED`（`fields`に`length.longLength`などの項目名、`details.reason`に`ratio_sum`・`length_over_target`）。
- 版：今の`prompt_post_count_version`で衝突を見る（`409 STALE_UPDATE`。`latest`に`postCount`・`length`・`version`）。
- 応答：`{ "postCount": 10, "length": {…}, "version": 4 }`。
- 操作の記録：件数が変われば今の`prompt_count_saved`、文字数・割合が変われば`prompt_length_saved`（要約「200字・35/45/20%」）。
- 権限：今のまま`settings`（オーナー）。

### POST `/accounts/:accountId/draft-batches`（003）

- 本文の分け方（`splitDrafts`）で、行の初めが```` ``` ````の行を取り除いてから分ける（R13、FR-170）。リクエスト・応答の形は変えない。

## 新しいAPI

### POST `/accounts/:accountId/reference-posts/batch`

ためた参考投稿をまとめて登録する（US7、R7）。

```json
{ "items": [ { "body": "…", "keyword": "", "postUrl": "", "whyGood": "", "platform": "threads", "postedDateMode": "unknown" } ] }
```

- `items`は1〜20件（`REFERENCE_BATCH_MAX`）。各要素は`POST /reference-posts`と同じ検証。1件でも通らなければ、1件も入れずに`400 VALIDATION_FAILED`（`fields`に`items.2.body`のような位置）。
- 上限：アドバイザリーロックのうえで「今の件数＋件数 ≤ 200」を確かめる。超えるなら`409 ITEM_LIMIT_REACHED`（`error.remaining`にあと何件）。
- 応答`201`：`{ "items": [ReferencePost, …] }`（送った順）。
- 操作の記録：1件（`reference_posts_added`、要約「〇件」、先頭の書き出し）。`touchMaterials(research)`。
- 権限：`content`。

### GET `/accounts/:accountId/reference-posts/explain-prompt`

解説のプロンプトを作る（US8、R8）。

- `?id=<referencePostId>`：その1件の解説のプロンプト（【ID】と区切りなし。編集の画面で使う）。`why_good`が空でなくても作れる。
- `id`なし：「なぜ良いか」が空の参考投稿を、投稿のプロンプトと同じ順（FR-099）で最大10件選んだ、まとめての解説のプロンプト。

```json
{ "prompt": "…", "items": [ { "id": "8f363364-…", "shortId": "8f363364" } ], "pendingCount": 12 }
```

- 空の参考投稿が0件なら`items: []`・`prompt: ""`・`pendingCount: 0`。
- 権限：`content`（解説を入れられる人だけ）。

### POST `/accounts/:accountId/reference-posts/explanations`

まとめての解説を保存する（US8、R8）。

```json
{ "items": [ { "id": "8f363364-…", "whyGood": "【型の名前】…" } ] }
```

- `items`は1〜10件（`EXPLAIN_BATCH_MAX`）。`whyGood`は1〜2,000文字。同じ`id`が2回あれば`400 VALIDATION_FAILED`。
- 1つのトランザクションで、各行を「このアカウントの参考投稿で、`why_good`が`NULL`か空白だけ」のときだけ更新し、版を1つ上げ、最終更新者を入れる。
- 応答`200`：`{ "saved": ["8f363364-…"], "skipped": [ { "id": "…", "reason": "already_explained" | "not_found" } ] }`。
- 操作の記録：保存が1件以上なら1件（`reference_posts_explained`、要約「〇件」）。`touchMaterials(research)`。
- 権限：`content`。

### GET `/accounts/:accountId/research-keywords/idea-prompt`

キーワードの案のプロンプトを作る（US9、R16）。

- 応答：`{ "prompt": "…" }`。課題の届けたい人・本音の悩み・なりたい姿・発信テーマの掛け合わせ・投稿ジャンルの入力のあるものと、出す形（15〜20個、1行に1つ「キーワード｜狙い」）。
- 権限：`content`。

### POST `/accounts/:accountId/research-keywords/batch`

キーワードの案をまとめて登録する（US9、R16）。

```json
{ "items": [ { "keyword": "20代後半 友達", "purpose": "社会人になって友達が増えない人の本音を探す" } ] }
```

- `items`は1〜20件（`KEYWORD_BATCH_MAX`）。各要素は`POST /research-keywords`と同じ検証。一覧の中で重なる（`normalizeKeyword`で同じ）なら`400 VALIDATION_FAILED`。
- 上限（100件）を超えるなら`409 ITEM_LIMIT_REACHED`（`error.remaining`）。登録済みと重なるなら`409 KEYWORD_DUPLICATE`（`details`に重なった言葉）。どちらも1件も入れない。
- 応答`201`：`{ "items": [ResearchKeyword, …] }`。
- 操作の記録：1件（`research_keywords_added`、要約「〇件」）。
- 権限：`content`。

## 権限のまとめ（新しいAPI）

| API | 権限 | 見せてもらっている人 | 読むだけ（013） |
|---|---|---|---|
| `POST /reference-posts/batch` | `content` | 403 | 403 `BILLING_REQUIRED` |
| `GET /reference-posts/explain-prompt` | `content` | 403 | 403 `BILLING_REQUIRED` |
| `POST /reference-posts/explanations` | `content` | 403 | 403 `BILLING_REQUIRED` |
| `GET /research-keywords/idea-prompt` | `content` | 403 | 403 `BILLING_REQUIRED` |
| `POST /research-keywords/batch` | `content` | 403 | 403 `BILLING_REQUIRED` |

判定は今の`authorizeAccount`だけで行う（Constitution原則V）。
