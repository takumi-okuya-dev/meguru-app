# データモデル：AIと壁打ちして課題を埋める

**日付**：2026-11-02 | **計画**：[plan.md](./plan.md) | **調査**：[research.md](./research.md)

DB・API・ブラウザの保存は変えない（FR-032）。反映は、課題の画面の未保存の変更（`values`）を置き換えるだけで、保存は今の「保存」（002・014・008のまとめて保存・版による衝突の検知・操作の記録）が行う。

以下は、画面の中と共通パッケージの関数だけで使う形。

## 対象の項目（`SPARRING_KEYS`。定数）

表示の順の21のキー（research.md R4）。

| 区分 | キー |
|---|---|
| 目的（`purpose`） | `purposeOrigin`・`purposeSelf`・`purposeOthers`・`purposeFuture`・`purposeStance`・`activityAxis` |
| 営業導線（`sales`） | `finalAction`・`targetPersona`・`realWorries`・`desiredSelfImage`・`perceivedImage` |
| アカウント（`account`） | `contentThemeMix`・`antiPersona`・`benchmarkAccounts` |
| 集客導線（`funnel`） | `funnelDesign`・`postGenres`・`dmReplyTemplate`・`inquiryQualityTips` |
| 人柄（`tone`） | `toneNotes` |
| その他（`other`） | `differentiation`・`successMetrics` |

- 入れない：`tonePreset`（近い人間性）、`profileBioDraft`・`pinnedPostDraft1〜3`（下書き）。
- 名前・説明・考えるヒントは`STRATEGY_FIELDS`・`STRATEGY_HINTS`のもの（FR-007）。活動の軸はヒントを持たないので、名前と説明だけ。

## 範囲（画面の状態）

| 項目 | 型 | はじめ | 意味 |
|---|---|---|---|
| `sections` | 区分のIDの集まり | 6つすべて | 選んだ区分（`purpose`・`sales`・`account`・`funnel`・`tone`・`other`） |
| `onlyIncomplete` | 真偽 | 真 | 「未入力と短めの項目だけにする」 |

- 質問の対象＝`selectSparringTargets(values, 範囲)`（FR-004）。`onlyIncomplete`なら、`checkStrategy`の判定が`empty`・`short`の項目と、空の`activityAxis`だけ。
- 欄を閉じると、はじめに戻す（保存しない）。

## 答えの読み取りの結果（`parseSparringAnswer`の戻り値）

| 項目 | 型 | 意味 |
|---|---|---|
| `items` | 対象のキー → 文（表示の順） | 読み取れた項目ごとの完成版（前後の空白を除く。空は入れない。同じ項目は後のもの） |
| `unknown` | 文字列の一覧 | 対象の項目に引き当てられなかった名前（重ねない。出てきた順） |
| `markerFound` | 真偽 | 始まりの目印が1つでもあったか |

## 反映の候補（画面の状態）

`items`の項目ごとに1つ。

| 項目 | 型 | 意味 |
|---|---|---|
| `key` | 対象のキー | 項目 |
| `current` | 文 | 今の入力（画面の今の`values`。その都度出す。research.md R6） |
| `proposed` | 文 | 新しい案 |
| `selected` | 真偽 | 反映するか。はじめは「`current`が空で、`proposed`と違う」とき真 |
| `same` | 真偽 | `proposed`と`current`（前後の空白を除く）が同じ。「今と同じ」と出す |
| `over` | 真偽 | `proposed`が`STRATEGY_TEXT_MAX`（2000字）を超える |

状態の移り変わり：

```text
（欄を閉じている）
   │ 「AIと壁打ちして埋める」
   ▼
範囲を選ぶ ──「プロンプトをコピーする」──▶ 外のAIと相談（アプリの外）
   │ 答えを貼る
   ▼
候補が並ぶ（貼った文が変わるたびに読み取り直し、はじめの選択に戻す）
   │ 「選んだ項目を反映する」（選んだ数が1以上）
   ▼
入力欄が置き換わる（未保存）・欄を閉じる ──「保存」──▶ サーバーに残る
```

- 貼った答えがあるまま閉じる・ほかの画面へ移るときは、確かめる（research.md R1）。
