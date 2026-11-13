# 出来事の取り決め：人物メモが受け取るもの

**対象**：spec FR-030・Edge Cases（退会） | **決めた理由**：[research.md](../research.md) R19 | **仕組み**：029の出来事（[029 contracts/platform-entry.md](../../../meguru/029-threads-pattern1/contracts/platform-entry.md) 3。送り出しの表と、書いた直後・5分ごとの届け。2回届くことがある）

## 1. 共通 → 人物メモ

| 出来事 | 中身 | 人物メモがすること |
|---|---|---|
| `user.withdrawn` | `{ userId }` | `user_id = userId`のイベント（取り込み・回答・手で足した会ったイベント・消した人の数と印・声かけも外部キーで）・人（同意の記録も）・列の対応・同意の選択肢の対応・設定を消す |

- 登録：`apps/api/src/apps/people/register.ts`の`registerPeople()`で`registerConsumer("people", "user.withdrawn", onUserWithdrawn)`。`registerPeople()`は`app.ts`・`index.ts`（定期処理）・`jobs/daily-jobs.ts`で、`registerThreads()`と同じ場所で呼ぶ。
- `reportUsage`は呼ばない（共通が、届いたあとで利用の数の行も消す）。

## 2. 受け取りの決まり

- `withTransaction`の中で、まず`people.received_events`に出来事の番号を書く（`ON CONFLICT DO NOTHING`）。書けなければ（もう受け取った）何もしないで成功を返す（2回届いても同じ結果）。
- 例外を投げたら失敗。共通がやり直す（029の決まり）。
- ログには出来事の番号と消した行の数だけを出す（名前を出さない。R18）。

## 3. 人物メモが出す出来事

- 001では出さない。集金管理・めぐる Threadsのイベントとのつなぎ（spec Assumptions「イベントのつなぎ」）は、あとのfeatureで出来事の形を決める。
