# 計算と分類の契約：Threadsのアルゴリズムの解析

**日付**：2026-11-05 | **計画**：[../plan.md](../plan.md)

`packages/shared/src/analysis/` の関数。APIとWebが同じものを使う。値の定義・区切り・傾向の決まりは [research.md](../research.md) R3〜R7。

## 関数

| 関数 | 入力 | 出力 |
|---|---|---|
| `isJapaneseHoliday(date)` | `YYYY-MM-DD` | 祝日・振替休日・国民の休日なら true（2000〜2099年） |
| `postValues(post, lengthSettings)` | `AnalysisPost`、014の文字数の設定 | `PostValues` |
| `lengthBuckets(lengthSettings)` | 014の文字数の設定 | 短い・中くらい・長いの幅と名前 |
| `analyzePosts(posts, options)` | `AnalysisPost[]`、`{ lengthSettings, themes, now }` | `AnalysisResult`（API契約の `GET /analysis` の `period`・`settings`・`schedule`・`canEdit` を除いた部分） |
| `trendsForPrompt(trends, coreRules, ngWords)` | 傾向、CORE RULESの行、NGワード | 入れる傾向（`promptable` で、R7の守りを通ったもの。5つまで） |
| `classifyPrompt(posts, themes)` | 投稿（番号の順）、テーマ | 分類のプロンプト |
| `parseClassifyAnswer(text, posts, themes)` | 答え、投稿（番号の順）、テーマ | `{ items, problems }` |

## 傾向の文（`Trend.text`）

| 区切り | 文 |
|---|---|
| 時間帯 | 「夜（20〜23時）に出した投稿が伸びやすい」 |
| 曜日 | 「休日に出した投稿が伸びやすい」 |
| 文字数 | 「中くらい（78〜117字）の投稿が伸びやすい」 |
| 本文の特徴（あり） | 「最後に問いかけがある投稿が伸びやすい」 |
| 本文の特徴（なし） | 「絵文字のない投稿が伸びやすい」 |
| 書き出しの型 | 「『あるある』の書き出しが伸びやすい」 |
| テーマ | 「テーマ『転職』の投稿が伸びやすい」 |

`promptable`：文字数・本文の特徴・書き出しの型・テーマは true、時間帯・曜日は false（R7）。

## プロンプトの節

```text
■伸びた傾向(取りためた反応数から見た傾向。合わせすぎず、人柄とCORE RULESを優先すること)
・{text}({count}件。閲覧の中央値が、ほかの投稿の{ratio}倍)
```

`ratio` は小数第1位（`formatRatio`）。「■反応が低かった投稿」の節の後、「■リサーチで見つけた…」の節の前。

## 分類のプロンプト（`classifyPrompt`）

```text
あなたは、SNSの投稿を分類するアシスタントです。次のThreadsの投稿を、1件ずつ「書き出しの型」と「テーマ」に分けてください。

# 書き出しの型(この中から1つ)
あるある／問いかけ／言い切り／体験談／数字／告知／その他

# テーマ(この中から1つ。合うものがなければ「なし」)
仕事の悩み／転職／…

# 守ること
・一覧にない名前を作らない
・投稿の番号を変えない。全部の投稿に1行ずつ答える
・質問はせず、答えだけを返す

# 答えの形(この形の行だけを返す)
【1】書き出しの型：あるある／テーマ：仕事の悩み

# 投稿
【1】
(本文)

【2】
(本文)
```

テーマが1つもないときは、テーマの節を「# テーマ\nなし(テーマは付けない)」にし、答えの形を「【1】書き出しの型：あるある」にする。

## 答えの読み取り（`parseClassifyAnswer`）

- 行ごとに `【(\d+)】` と「書き出しの型：」「テーマ：」を探す。区切りは「／」「/」「、」、コロンは全角・半角。前後の文は無視する。
- `items`：`{ index, draftId, openingType, themeId }`。番号が投稿の範囲にあり、型が7つのどれか、テーマが一覧の名前か「なし」・空のもの。同じ番号が2回あれば後のほう。
- `problems`：`{ index, reason }`。理由は「知らない書き出しの型『…』」「知らないテーマ『…』」「答えがない」（番号のない投稿）。
- 名前の比べ方は、前後の空白と「」『』を除き、全角・半角をそろえる（`normalizeForMatch`）。
