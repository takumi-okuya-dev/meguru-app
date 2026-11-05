# 定期処理の契約：メンションの返信の段階

**日付**：2026-11-05 | **計画**：[../plan.md](../plan.md)

005の `runAutoPost`（5分ごと）の、6. 反応数の段階のあとに「7. メンションの返信の段階」（`runMentionStage`）を足す。この段階が失敗しても、ログに出すだけで、公開・反応数の結果に影響させない。

## 7-1. 対象を読む（1回の問い合わせ）

次の行を、返信の時刻の古い順に `MENTION_MAX_PER_TICK`（10）件まで読む。

- `post_mentions.state = 'pending'`
- 借りが空いている（`lease_until` がNULLか過去）
- `next_attempt_at` がNULLか過去
- 返信の時刻（`mentionDueAt`）が今以前

それぞれ、下書きの状態・`threads_media_id`・`published_at`、Accountの接続・機能のまとまり・`replies_denied_at` を結合して読む。読んだ行は借りる（`lease_token`・`lease_until = 今＋5分`）。

## 7-2. 行ごとの判定（出す前）

| 条件 | 結果 |
|---|---|
| 下書きが `published` でない（投稿に失敗した・削除された）。投稿に失敗したときは、005の公開の処理が失敗にするときに、同じく `failed`（`post_failed`）にする | `failed`（`post_failed`） |
| 返信の時刻から24時間を過ぎた（時間差を24時間にしても出せるよう、投稿の時刻ではなく返信の時刻から数える） | `failed`（`expired`） |
| `replies_denied_at` がある | `failed`（`no_permission`） |
| 要再接続・オーナーが読むだけ・自動投稿のまとまりがOFF | 借りを返して待つ（24時間までは次の回に） |
| 返信の文にNGワード（今のNGワードで確かめる） | `failed`（`ng_word`） |
| 過去24時間に出した返信に入っている人がいる | 文を書き換えずに `failed`（`limit`）（承認した文だけを出す。原則II） |

## 7-3. 出す（research.md R4）

1. `container_id` がなければ、`createTextContainer(token, userId, text, { replyToId: threads_media_id })` を呼び、`container_id` を保存する。
2. `publish_requested_at` がなければ、それを保存してから `publishContainer` を呼ぶ。成功したら `state = 'sent'`・`sent_at`・`reply_media_id` を保存する。
3. `publish_requested_at` があり、結果が分からない行は、`getContainerStatus` で確かめる。
   - `PUBLISHED`：`sent` にする（`reply_media_id` はNULL）。
   - `FINISHED`：公開を送り直す。
   - `ERROR`・`EXPIRED`：`container_id`・`publish_requested_at` を消して作り直す。
4. エラーごとの扱い：

| エラー | 結果 |
|---|---|
| 投稿が見つからない（返信先のidが無効） | `failed`（`not_found`） |
| 権限のエラー | `failed`（`no_permission`）。`accounts.replies_denied_at` を入れる |
| 認証のエラー | 005と同じく要再接続にし、この行は待つ |
| 一時的な失敗（通信・5xx・429） | `attempts + 1`、`next_attempt_at = 今＋5分×attempts`。3回目で `failed`（`error`） |

## 7-4. 関所

- この回の残り（読んだ件数が上限に届いた）があれば、`immediate`（すぐ続ける）にする。
- 残りがなければ、次の `pending` の返信の時刻（最も早いもの）を、`computeNextCheckAt` の候補に足す。

## ログ

- `mention: sent`（件数）
- `mention: failed`（理由ごとの件数）
- `mention: stage failed`（例外）

本文・ユーザー名・トークンは出さない。
