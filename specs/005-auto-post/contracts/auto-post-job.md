# 定期処理の契約：自動投稿（`runAutoPost`）

**対象feature**：[spec.md](../spec.md) ／ **根拠**：[research.md](../research.md) R3・R6・R7 ／ **データモデル**：[data-model.md](../data-model.md)

5分ごとのCron（`*/5 * * * *`）で呼ぶ`runAutoPost(env, now)`の手順。`now`は回の実際の開始時刻（`new Date()`。Cronの予定時刻`scheduledTime`ではない。開始が遅れても、60分の幅・持ち時間・やり直しを実際の時刻で判断するため）。テストでは、`now`を渡して直接呼ぶ。

## 定数（`packages/shared/src/limits.ts`）

| 名前 | 値 | 意味 |
|---|---|---|
| `AUTOPOST_SLOT_LIMIT` | 10 | 1日の時刻の上限（FR-001） |
| `AUTOPOST_MIN_GAP_MINUTES` | 30 | ずらすときの、時刻どうしの間（FR-001a） |
| `AUTOPOST_JITTER_SECONDS` | 600 | ずらす幅（前後10分） |
| `AUTOPOST_LATE_WINDOW_MINUTES` | 60 | 予定を過ぎても投稿してよい幅（FR-011） |
| `AUTOPOST_RETRY_MAX` | 3 | 1つの時刻の中でのやり直しの回数（FR-013） |
| `AUTOPOST_RETRY_DELAYS_MINUTES` | [5, 10, 15] | やり直しまでの間（1回目・2回目・3回目） |
| `AUTOPOST_DAILY_API_LIMIT` | 250 | 24時間の投稿の上限（FR-017） |
| `AUTOPOST_MAX_PER_TICK` | 4 | 1回の定期処理で進める試みの数（R3） |
| `AUTOPOST_LEASE_SECONDS` | 120 | 試みを進める処理の持ち時間 |
| `AUTOPOST_GATE_MAX_SLEEP_MINUTES` | 1440 | 関所の待ちの上限（R3） |
| `AUTOPOST_LATE_WARN_MINUTES` | 10 | これを超える遅れで`warn`を出す（SC-004） |
| `LATE_NIGHT_HINT_MINUTES` | [120, 300) | 設定の画面で案内を出す時間帯（2:00〜4:59。FR-001b） |
| `AUTOPOST_FIND_PUBLISHED_HOURS` | 24 | 結果が分からない投稿を探し続ける時間（R6） |
| `AUTOPOST_RECHECK_MIN_MINUTES`・`AUTOPOST_RECHECK_MAX_MINUTES` | 4・60 | 結果を確かめられず待機にした試みを、次に確かめるまでの間（試みの古さの1/4をこの範囲に収める。R6） |
| `AUTOPOST_PERMALINK_RETRY_MINUTES` | 60 | URLの取り直しに失敗した投稿を、次に取り直すまでの間（手順5） |
| `AUTOPOST_RECONCILE_SKEW_SECONDS` | 60 | 結果が分からない投稿を探すとき、`publish_requested_at`より前に見てよい幅（Threadsとの時計のずれ。R6） |

暫定値はspec Assumptionsのとおり、実運用で見直す。

## 手順

### 0. 関所（DBに触れない）

1. KVから`autopost:gate`（`{ nextCheckAt, runStartedAt }`）と`autopost:wake`（`{ at }`）を読む。
2. 次のどれでもなければ、何もせず終わる。
   - `now >= nextCheckAt`
   - `wake.at > runStartedAt`
   - どちらかのキーが読めない・値が壊れている（安全側）
3. `runStartedAt = now`として、以下を行う。

### 1. 続きの処理（試みを先に進める）

次の試みを読む。

- `state = 'in_progress'`で、`lease_until`が過ぎている（前の処理が途中で止まった、または待機の「次に確かめる時刻」が来た）
- `state = 'retry_wait'`で、`next_retry_at <= now`

前に確かめたのが古い順（`lease_until`の早い順。空のものが先。同じなら`slot_at`の古い順）に、1件ずつ`lease_until`を条件付きの更新で取る（取れなければ、ほかの処理が進めているので飛ばす）。取るときに`lease_token`を新しい値にする（手順3で試みを作るときも同じ）。そのうえで、下の「4. 公開まで進める」を行う。

### 2. 時刻の処理（新しい試みを作る）

1. `posting_schedules`の`enabled = true`の行を読む（Accountの接続の状態と一緒に）。
2. Accountごとに、今日と昨日（日本時間）の予定の時刻を`plannedSlotTime`で求める。次をすべて満たす時刻を「来ている時刻」とする。
   - `slot_at <= now`
   - `slot_at > now - 60分`（FR-011）
   - `slot_at > effective_from`（FR-012・FR-016）
3. 来ている時刻のうち、**もっとも新しい1つだけ**を扱う。それより前の時刻は、行を作らずに飛ばす（まとめて投稿しない）。
   - ただし、そのAccountに`in_progress`・`retry_wait`の試みがあるときは、新しい時刻の行を作らない（research.md R6「同じAccountの試みは、1つずつ進める」）。その時刻は来ている時刻のまま残り、前の試みが終わった後の回で、60分の幅の中なら処理する。
4. その時刻の行を`INSERT … ON CONFLICT (account_id, slot_at) DO NOTHING`で作る（`state = 'in_progress'`、`lease_until = now + 120秒`）。作れなければ、もう扱った時刻なので飛ばす。
5. 予定の古いものから、続きの処理と合わせて最大4件まで進める。残りがあれば、手順7で`nextCheckAt = now`にする。

### 3. 取り出し（1つのトランザクション）

`lockAccountDrafts`（004）を取ってから、`posting_schedules`の行を共有ロック（`FOR SHARE`）で読み直す。手順2で読んだ設定の後に、設定の変更・再接続で`effective_from`が進んだり、時刻・ずらすかが変わったりして、その時刻が今の設定の予定の時刻（`slot_at > effective_from`、`slot_minutes`に含まれ、`plannedSlotTime`が一致）でなくなっていれば、試みの行を作らずに終わる（FR-012・FR-016）。共有ロックにより、設定の更新はこの取り出しの前か後のどちらかになる。

続いて、次を順に確かめる。満たさなければ、試みを`skipped`（理由）にして終わる。

| 確かめること | 理由 |
|---|---|
| 自動投稿がオン | `auto_post_off` |
| 接続が`connected` | `needs_reconnect` |
| `paused_until`が過ぎている（または空） | `rate_limited` |
| `slot_date`の投稿済みの件数（`published_at`が日本時間のその日）が、時刻の数より少ない | `daily_limit`（SC-008） |
| 直前24時間の投稿済みの件数が250件より少ない | `rate_limited`（`paused_until`は入れない） |

続いて、投稿の順（research.md R4）で承認済みの下書きを読み、先頭から次を行う。

1. その時点のNGワードで`checkPublishable(body, ngWords)`を行う。
2. NGワードに当たる、またはThreadsの上限を超える場合は、その下書きを要確認に戻して、次の下書きへ進む（FR-007）。
   - `blocked_at = now`
   - `blocked_reason`
   - `blocked_words`
   - `reviewed_at`・`prioritized_at`・`carryover_attempt_id`を消す
   - `version + 1`
3. 問題がなければ、その下書きを`publishing`にし（`version + 1`）、試みに`draft_id`・`is_carryover`（下書きに`carryover_attempt_id`があったか）を入れる。持ち越しの下書きなら、`carryover_attempt_id`は消す。
4. 承認済みが尽きたら、試みを`skipped`（`no_drafts`）にする。

### 4. 公開まで進める（ロックを持たない）

トークンを復号し（001 R5）、試みの記録から次の段階を決める。

**持ち主の確認**：試みの更新は、すべて`state = 'in_progress'`かつ`lease_token`が取ったときの値と同じことを条件にする。下書きの更新も、同じトランザクションで先に試みを更新し、札が同じときだけ行う。条件に合わなければ（持ち時間が切れてほかの処理に取られた、再接続で片付けられた）、それ以上何も書かずに終える。`publish_requested_at`の保存も同じ条件で行うので、持ち主でない処理は公開を送らない。

**再接続**（001 の接続の書き込み）：同じトランザクションで、そのAccountの`in_progress`・`retry_wait`のうち`publish_requested_at`がない試みを`skipped`（`needs_reconnect`。`draft_id`・`lease_until`・`lease_token`を消す）にし、下書きを`approved`に戻す（`version + 1`）。取り消しの後、次の回より前に再接続されても、再接続より前の試みを公開しないため（`effective_from`より前の時刻を公開しない。FR-016）。`publish_requested_at`がある試みは、結果の確認を続ける。

Accountが要再接続なら（トークンを復号できるか・接続の行が残っているかによらず。連携の取り消しでは接続の行が消える）、`publish_requested_at`がない試み（まだ公開を送っていない）は公開に進まず、「失敗の扱い」の「認証」と同じく`skipped`（`needs_reconnect`）にして下書きを`approved`に戻す。`publish_requested_at`がある試みは、結果の確認（公開はしない）だけを続ける。

| 試みの記録 | 行うこと |
|---|---|
| `publish_requested_at`がある（結果が分からない） | `getContainerStatus`。下の「結果の確認」へ |
| `container_id`があり、`publish_requested_at`がない | `getContainerStatus`。`FINISHED`なら公開へ、`IN_PROGRESS`なら次の回、`EXPIRED`なら`container_id`を消して作り直し、`ERROR`なら確かな失敗 |
| どちらもない | `createTextContainer`。返ったIDを`container_id`に保存してから、公開へ |

**公開**：

1. `publish_requested_at`に、公開を送る直前の実際の時刻（Cronの予定時刻ではない）を保存する。
2. `publishContainer`を呼ぶ。呼び出しは、Accountの行（`FOR SHARE`）と試みの行（`FOR UPDATE`、`lease_token`が同じこと）をこの順にロックしたトランザクションの中で行う。再接続（Accountの行を更新し、続けて試みを片付ける）・ほかの処理の引き継ぎは送り終わるまで待つので、公開と再接続の順番が必ずどちらかに決まる。ロックを取った時点で、Accountが要再接続、または`connection_generation`が試みを進め始めたときに読んだ値と違う（その間に再接続がコミットされた。`authorized_at`はcallbackに入った時刻なので比べない。トークンの更新でも変わるが、その場合も送らない）なら、送らずに、ロックを持ったまま同じトランザクションで`publish_requested_at`を消し、`skipped`（`needs_reconnect`）にして下書きを`approved`に戻す（別のトランザクションに分けると、その間にほかの処理が引き継いで公開しうる）。送った後のコミットの失敗は「結果がわからない」として扱う。
3. 成功したら「成功の記録」へ進む。
4. 失敗したら「失敗の扱い」へ進む。ただし、`ThreadsTransientError`（通信の失敗・タイムアウト・HTTP 5xx）は「結果がわからない」として扱う。Threads側で公開まで済んでいる可能性があるため。`publish_requested_at`を残したまま`lease_until`を「次に確かめる時刻」にし（下の「待機」）、後の回に「結果の確認」をする。やり直しの回数は、「結果の確認」でコンテナーが公開されていないとわかった時点で増やす。

**待機**：結果を確かめられず次の回以降に続ける（下の表の「次の回」）ときは、`lease_until`を「次に確かめる時刻」＝`now + clamp(試みの古さ / 4, AUTOPOST_RECHECK_MIN_MINUTES, AUTOPOST_RECHECK_MAX_MINUTES)`にする。最初は次の回（5分ごと）に確かめ、解決しない試み（接続が消えたままなど）ほど間をあける。解決しない試みが、毎回の上限（`AUTOPOST_MAX_PER_TICK`）を使い切って、ほかのAccountの時刻を止めないため。

**結果の確認**（`getContainerStatus`の結果ごと）：

| 状態 | 行うこと |
|---|---|
| `PUBLISHED` | `listRecentThreads(since = publish_requested_at - 5分)`から、`timestamp`が`publish_requested_at - AUTOPOST_RECONCILE_SKEW_SECONDS`以降で、本文が下書きと同じ（前後の空白を除いて一致）もっとも古い投稿を探す（公開を送る前の同じ本文の投稿＝手動の投稿などを選ばない）。見つかれば「成功の記録」へ進む。見つからなければ次の回。`publish_requested_at`から24時間たっても見つからなければ、IDなしで成功にし、エラーのログを出す |
| `FINISHED` | 公開されていない。`publish_requested_at`を消し、一時的な失敗として「失敗の扱い」へ進む（`container_id`は残し、次は同じコンテナーで公開する） |
| `IN_PROGRESS` | 次の回 |
| `EXPIRED` | 公開されていない。`container_id`・`publish_requested_at`を消し、一時的な失敗として扱う |
| `ERROR` | 確かな失敗（`container_error`） |
| 呼び出しの失敗 | 次の回（やり直しの回数は増やさない）。認証の失敗なら、接続を要再接続にする。ただし試みは`in_progress`のまま（下書きは`publishing`のまま。結果を確かめるまで解かない） |

**成功の記録**（1回の更新・条件付き）：

1. 下書き：`publishing` → `published`。`published_at`は公開の応答を受けた時刻（探して見つけた場合は投稿の`timestamp`）。`threads_media_id`を入れ、**`prioritized_at`・`carryover_attempt_id`を消し**（data-model.mdのCHECK制約。`published`ではNULL）、`version + 1`とする。
2. 試み：`succeeded`
3. 続けて`getMedia`でURLを取り、`threads_permalink`に保存する。失敗しても記録はそのまま。

**失敗の扱い**（research.md R7の分類）：

| 分類 | 試み | 下書き |
|---|---|---|
| 一時的（`retry_count < 3`） | `retry_wait`、`retry_count + 1`、`next_retry_at = now + 5・10・15分`、`last_error`。`container_id`は残す（次は状態を確かめてから使う） | `publishing`のまま |
| 一時的（`retry_count = 3`）で、持ち越しでない | `carried_over` | `approved`に戻し、`carryover_attempt_id = この試み` |
| 一時的（`retry_count = 3`）で、持ち越し | `failed` | `publish_failed`（`publish_error = last_error`） |
| 確かな失敗 | `failed` | `publish_failed` |
| 認証 | `skipped`（`needs_reconnect`）。Accountを要再接続にする（世代番号を条件に） | `approved`に戻す |
| 上限 | `skipped`（`rate_limited`）。`posting_schedules.paused_until`を翌日の0時（日本時間）にする | `approved`に戻す |

- 下書きを`approved`に戻すときは、`version + 1`。`reviewed_at`・`prioritized_at`は元のまま（投稿の順は変わらない）。
- 持ち越しの試み（`is_carryover`）で下書きを`approved`に戻すとき（認証・上限・要再接続・再接続の片付け）は、`carryover_attempt_id`をその試みにして付け直す。取り出しで消しているので、付け直さないと次の時刻の優先と「持ち越しは1回だけ」が失われる。
- 下書きを`publish_failed`にするときは、`prioritized_at`・`carryover_attempt_id`を消す（data-model.mdのCHECK制約。`publish_failed`ではNULL）。
- 下書きを戻す・失敗にする更新は、`status = 'publishing'`を条件にする。

### 5. 投稿のURLの取り直し

`status = 'published'`で`threads_permalink`が空、かつ`published_at`が7日以内の下書きを、1回に最大2件、`getMedia`で取り直す。サブリクエストに余裕があるときだけ行う。

- 対象は接続済みのAccountの投稿だけ。`permalink_checked_at`が空のもの、次に古いものの順（同じなら`published_at`の新しい順）に選ぶ。
- 取り直しに失敗したら`permalink_checked_at = now`を入れ、`AUTOPOST_PERMALINK_RETRY_MINUTES`の間は選ばない。失敗し続ける投稿が、後の投稿の取り直しを止めないため。
- この回に公開した投稿は、公開の直後に一度試しているので選ばない。そこで取れなかったら、次の回にすぐ取り直す。
- すぐ次の回に起こすのは、すぐ取り直せる対象がこの回の2件のほかに残っているとき、またはこの回に公開した投稿のURLを取れなかったときだけ。

### 6. 1件の失敗で全体を止めない

Accountごと・試みごとに`try/catch`で囲み、予期しないエラーはログに出す。その試みは`lease_until`が切れた後、次の回の「続きの処理」で拾われる。

### 7. 関所の書き込み

DBの処理の最後に、次のうちもっとも早い時刻を`nextCheckAt`とし、`autopost:gate`に`{ nextCheckAt, runStartedAt }`を書く。

- オンのAccountの、今より後の予定の時刻（`plannedSlotTime`。`effective_from`より後、`paused_until`の後）
- `retry_wait`の試みの`next_retry_at`
- `in_progress`の試みの`lease_until`（次に確かめる時刻）のうちもっとも早いもの
- `lease_until`が空の`in_progress`の試みがある、扱いきれなかった時刻がある、URLを取り直す下書きがある：`now`（次の回）
- 上限：`now + 24時間`

一定の間隔での見直しは入れない（research.md R3「見直しをやめた理由」）。DBの処理のたびに、オンのAccountすべての設定を読み直して求め直すので、ほかの人の予定の時刻に起きたついでに、設定の変更も拾える。

## ログ

- 1回の処理ごとに、`info`で件数を出す。
  - 進めた試み・成功・やり直し・持ち越し・失敗・飛ばした・直前のチェックで戻した
  - `deferred`：1回4件の上限で、次の回に回した試み・時刻の数
  - `expired`：60分を過ぎて飛ばした時刻の数（手順2の3で、行を作らずに飛ばしたもの）
- **遅れのログ**（research.md R3）：
  - 公開に成功したときに、予定の時刻（`slot_at`）からの遅れ（分）を出す。持ち越しの試みは、持ち越した先の時刻から数える。
  - 遅れが10分を超えたら`warn`（`auto-post: late publish`）。SC-004を外れたことを表す。
  - `expired`が1件以上なら`warn`（`auto-post: slots expired`）。
  - `deferred`が1件以上なら`info`。続けて出るようなら、Workers Paidへ移す時期の目安になる。
- 関所で何もせずに終えたときは、`debug`で1行だけ出す（`auto-post: gate closed`）。本番ではログを増やさない。
- 本文・トークン・Threadsの応答の本文は出さない。下書きのID・AccountのID・試みのIDだけを出す。
- 「結果が分からない」の発生と解決、IDなしの成功は`warn`・`error`で出す（運用で気づけるように）。
