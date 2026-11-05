# Research：時間差のメンション

**Feature**：[spec.md](./spec.md) | **計画**：[plan.md](./plan.md) | **日付**：2026-11-05

## R1. Threadsで返信を出す方法と、要る権限

- **Decision**：
  - 返信は投稿と同じ2段階で出す。1つ目は `POST /{user-id}/threads`（`media_type=TEXT`・`text`・`reply_to_id=<投稿のmedia id>`）でコンテナーを作り、2つ目は `POST /{user-id}/threads_publish` で公開する。005の `createTextContainer`・`publishContainer` に `replyToId` を足して使う。
  - 権限：Metaの説明は、ページによって次のように食い違っている。
    - 「返信を作る」のページ：自分の投稿への返信は、元の投稿の持ち主なら出せる。
    - 「返信の取得と管理」のページ：返信を出すには `threads_manage_replies` が要る。
  - そこで、権限は次のように扱う。
    - トークンを作る案内（`/guide/threads-token`）と、ボタンでつなぐときに頼む権限（`THREADS_SCOPES`）に `threads_manage_replies` を足す。
    - つなぐとき・トークンを確かめるときに、`debug_token` の権限の一覧が読めて、そこに `threads_manage_replies` がなければ「返信の権限がない」とする（`accounts.replies_denied_at` に時刻を入れる）。
    - 一覧が読めないときは「分からない」とし、選べるままにする。
    - 返信を出したときに権限のエラー（`ThreadsPermissionError`）が返ったら、その返信を「出せなかった（返信の権限がありません）」にし、`replies_denied_at` を入れる。
    - つなぎ直すと `replies_denied_at` を消す（006の `insights_denied_at` と同じ扱い）。
  - テスト版のトークンを貼る方法で、`threads_manage_replies` の有り・無しの両方で返信を出し、どちらの説明が正しいかを確かめる（tasks の最後。マージの前にユーザーと行う）。
- **Rationale**：
  - 返信を出すまで確かな答えは分からないので、権限の確かめを、読むだけの呼び出しでは行えない（005・006は読むだけの呼び出しで確かめていた）。
  - 権限の一覧と、実際に出したときのエラーの2つで分かるようにする。
- **Alternatives considered**：
  - つなぐときに、試しに返信を出して確かめる：本物の投稿への返信が残るので、行わない。

## R2. 返信を出す処理の場所と、関所

- **Decision**：
  - 005の自動投稿の定期処理（`runAutoPost`、5分ごと）の最後に、「7. メンションの返信の段階」（`runMentionStage`）を足す。006の反応数の段階と同じく、この段階が失敗しても公開の結果に影響させない。
  - 1回の処理で出す返信は10件まで（`MENTION_MAX_PER_TICK`）。残りがあれば、関所は「すぐ続ける」にする。
  - 関所（`computeNextCheckAt`）の候補に、次の返信の予定の時刻を足す。
  - 次のときは `notifyWake` で関所を起こす。
    - 時間差のメンションを付けた下書きを承認したとき
    - 投稿済みの投稿で「返信する」を押したとき
- **Rationale**：新しいCronや処理の仕組みを足さずに済む（spec Assumptions）。関所に予定を入れないと、DBを読まない回が続き、返信が遅れる。

## R3. 返信の時刻

- **Decision**：
  - 承認のときに付けた返信：時刻 ＝ 投稿した日時（`post_drafts.published_at`）＋ 承認したときの時間差。時間差は `post_mentions.delay_minutes` に、付けたときに入れる。設定の時間差をあとで変えても、付けた分は変わらない（FR-005）。
  - 投稿済みの投稿に付けた返信：時刻 ＝ 「返信する」を押した時刻（`post_mentions.send_after`。`delay_minutes` はnull）。
  - 出す対象の条件：
    - 下書きが `published` で、`threads_media_id` がある
    - 状態が `pending`
    - 時刻を過ぎている
    - 返信の時刻から24時間以内（時間差を24時間にしても出せるよう、返信の時刻から数える）
  - 24時間を過ぎたら `failed`（`expired`）にする。
  - 下書きの投稿に失敗したら（005が `publish_failed` にするとき）、予定のメンションも `failed`（`post_failed`）にする。予定のまま残すと、その人をほかの投稿で選べないため。
- **Rationale**：時刻をその場で求めるので、投稿の時刻が決まる前（要確認・承認済み）でも同じ行で扱える。

## R4. 二重に出さない（FR-022）

- **Decision**：005の公開と同じ手順にする。
  - コンテナーを作ったら `container_id` を保存し、公開を送る前に `publish_requested_at` を保存する。
  - 公開の結果が分からないとき（通信の失敗・5xx）は、次の回に `getContainerStatus` で確かめる。
    - `PUBLISHED`：出した。`reply_media_id` は分からないままにする。
    - `FINISHED`：まだ出ていないので、同じコンテナーで公開を送り直す。
    - `ERROR`・`EXPIRED`：作り直す。
  - 処理は、005と同じく行ごとに「借りる」（`lease`）。同じ行を2つの回で同時に扱わない（`post_mentions.lease_token`・`lease_until`）。
- **Rationale**：1つのコンテナーは1回しか公開できない、というThreadsの決まりを使う（005 research.md R6）。

## R5. NGワードを2回確かめる（原則I）

- **Decision**：
  - 1回目は承認のとき。`reviewDrafts` の `approve` で、下書きの本文と一緒に返信の文も `checkPublishable` に通す。NGワードがあれば `NG_WORD` で外す。投稿済みの投稿の「返信する」でも、同じ確かめをする。
  - 2回目は出す直前。`runMentionStage` で、出す前にそのAccountのNGワードで確かめる。あれば出さず、`failed`（`ng_word`）にする。
  - 返信の文は500文字まで（`threadsLength`）。規約に注意（`policyCautions`）は、下書きと同じく確認を経たときだけ承認する。
- **Rationale**：返信もThreadsへ出る内容なので、原則Iがそのまま当てはまる。

## R6. 同じ人へのメンションの回数（FR-014・SC-004）

- **Decision**：
  - 付けるときに選べない人：
    - 同じAccountで、まだ出していない時間差のメンション（`pending`）にもう入っている人
    - 過去24時間に返信を出した（`sent_at` が24時間以内の）時間差のメンションに入っている人
  - APIは、付けるときの応答で、選べない人とその理由を返す。
  - 出す直前にもう一度確かめ、過去24時間に出した返信に入っている人がいれば、文を書き換えずに、その返信を `failed`（`limit`）にする。
  - メンションする人を一覧から消したとき（FR-004）：要確認の下書きは、選んだ人と文からその人を外す（だれも残らなければ行を消す）。承認済みの下書きは同じく外したうえで要確認に戻す。投稿済みで `pending` の行は `canceled` にする。
- **Rationale**：
  - 付けたあとに投稿の時刻がずれても、決まりを守れる。
  - 承認した文をシステムが書き換えて出すと、人が承認していない文が出ることになる（原則II）。外すのではなく出さないことで、承認した文だけが出る。
  - 予定の時刻が決まらない要確認の下書きもあるので、「まだ出していない予定に入っている人」は時刻に関係なく選べないようにする（spec FR-014）。
- **選んだ人と文（spec FR-011）**：
  - 文を保存するときは、選んだ人（`usernames`）を「文の中に `@ユーザー名` として書かれている、一覧の人」で求め直す（`mentionUsernamesIn(text, people)`）。1〜5人でなければ保存できない。
  - 丸いボタンは、文の最後の行の `@ユーザー名` を足す・消す（`toggleMentionInText`）。
  - 一覧にない `@ユーザー名` は選んだ人に数えず、文のまま出す。24時間の数え方は、選んだ人だけで行う。

## R7. 解析の返信率（FR-033）

- **Decision**：022の `loadAnalysisPosts` で、時間差のメンションの返信が反応数の取り込みより前に出ていれば（`sent_at <= post_metrics.last_fetched_at`）、返信の数から1を引く（0未満にしない）。パフォーマンス（006）の画面とCSVの返信の数は、Threadsの値のまま変えない。
- **Rationale**：解析の返信率と傾向は、比べることが目的なので、自分の返信を除く。パフォーマンスの数はThreadsの画面と同じであることを保つ。

## R8. 画面（モック https://claude.ai/artifact/Wgz1WNWYUDdUXwn1GgS6GP ）

- **Decision**：
  - 要確認の下書きのカード（`DraftCard`）に `MentionPanel` を足す。
    - 「メンションを付ける」を1回押すと、「いつも付ける」の人で `PUT …/mention` を送り、カードの中に丸いボタン・文・予定が出る。
    - 丸いボタンを押すと、その場で `PUT` を送る。
    - 「文を直す」を押すと、その場が入力欄になり、「文を保存」で `PUT` を送る。
    - 「外す」は `DELETE` を送る。
  - 選んだときに出る操作（`SelectionBar`）に「メンションを付ける」を足す（`POST …/post-drafts/mentions`）。
  - 投稿済みのカード（`PublishedCard`）：
    - メンションのない投稿に「メンションを付ける」を出す。押すと、カードの中で人と文を決める（まだ保存しない）。
    - 「返信する」で `PUT …/mention` を送る。この送信が承認になる。
    - 予定・済み・出せなかったの状態と、「メンションをやめる」を出す。
  - 「このアカウントの設定」に `MentionSettingsSection`（時間差・ひとこと・メンションする人と「いつも付ける」）を足す。
  - 返信の権限がないときは、設定の区分の上に注意の帯を出し、カードの「メンションを付ける」は出さない（設定への案内だけにする）。
- **Rationale**：ユーザーの「ワンクリック」「画面の移り変わりを減らす」（spec Clarifications）。今の部品（`Button`・丸いボタン・`SettingCard`）で作り、新しい色は足さない。

## R9. 判定（FR-031）

- **Decision**：
  - メンションの設定を読む：`view`。変える：`settings`。
  - 付ける・直す・外す・やめる・返信する：`review`（承認と同じ）。
  - 下書きの応答の `mention`：`view` のあるとき（オーナーと担当の人）だけ入れる。見せてもらっている人にはnull。今の `toPostDraft(row, view)` の出し分けと同じ形にする。
  - どれも `feature: "autopost"`。
- **Rationale**：011の判定の1か所（原則V）と、019の機能のまとまりに合わせる。
