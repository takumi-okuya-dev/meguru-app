# Research：自分のMetaアプリのトークンでアカウントを追加

**日付**：2026-10-10 | **仕様**：[spec.md](./spec.md) | **計画**：[plan.md](./plan.md)

## R1.トークンの受け取りと形の確認

- **決定**：`POST /api/threads/token-connect`の本文で受け取る（URLやクエリには載せない）。前後の空白・改行・引用符（`"` `'` `` ` ``）を取り除いた後、長さ32〜2048文字、英数字と`_ - . |`だけからなるかを確かめる。合わなければThreadsに問い合わせず`TOKEN_INVALID`（400）にし、失敗に数える（FR-015）。判定は`packages/shared/src/token.ts`に置き、画面でも同じ判定で「形が違うようです」を先に出す。
- **理由**：明らかに違う文字列（URL・パスワード・日本語）でThreadsに問い合わせない。Threadsのトークンの形は公開の仕様がないため、先頭の文字列（`TH…`）では判定しない。
- **検討した案**：先頭が`TH`かで判定する → Metaが形を変えたときに正しいトークンを弾くため不採用。

## R2.プロフィールと有効かの確認

- **決定**：最初に`GET /v1.0/me?fields=id,username,name,threads_profile_picture_url`（001の`getProfile`）を、貼り付けたトークンで呼ぶ。`ThreadsAuthError`・`ThreadsApiError`なら`TOKEN_INVALID`（400）にし、失敗に数える。`ThreadsTransientError`・`ThreadsRateLimitError`は失敗に数えず、`THREADS_UNAVAILABLE`（503）で「時間をおいてもう一度」を出す。
- **理由**：プロフィールが読めることが、Accountを作る最低条件（FR-010）。Threads側の一時的な不具合を、利用者の失敗に数えない。

## R3.期限・権限の読み取り（debug_token）と短期トークン

- **決定**：`GET /v1.0/debug_token?access_token=<T>&input_token=<T>`（同じトークンを両方に入れる）で、`is_valid`・`expires_at`・`issued_at`・`scopes`を読む。
  - `is_valid`がfalse → `TOKEN_INVALID`。
  - `expires_at`が今から48時間未満 → 短期トークンとみなし`TOKEN_SHORT_LIVED`（400）。失敗に数える。
  - `expires_at`が0（期限なし）→ 60日とみなす。
  - 読めた値は`threads_connections.expires_at`・`issued_at`・`scopes`に入れ、`recheck_at`は入れない。
  - `debug_token`が権限・未対応などで読めない（`ThreadsAuthError`以外の失敗）→ 期限を今から60日、`issued_at`を今、`scopes`を001の3つとみなし、`recheck_at`を今から2時間後にする（Clarifications 2026-10-10、FR-012）。
- **理由**：Metaの文書では、`debug_token`の`access_token`は「同じアプリのテスターのトークン」で、`input_token`は同じアプリのトークンなら別の人でもよい。利用者のMetaアプリのトークンは、その持ち主（アプリの管理者＝テスター）のトークンなので、トークン自身で調べられる見込みが高い。ただし確証はないため、読めないときの道を残す。
- **検討した案**：延長（`refresh_access_token`）を試して見分ける → 発行から24時間未満の長期トークンも延長できないので、見分けに使えない。不採用。
- **確かめること（実装時）**：実際のMetaアプリのトークンで`debug_token`を呼び、応答の形（`data`の下か）を確かめて、この節の末尾に1行で書き足す。

## R4.投稿・反応数の権限

- **決定**：プロフィールの後、`getPublishingLimit`（005 `threads-check`と同じ）で投稿の権限を、`getFollowersCount`（006と同じ）で反応数の権限を確かめる。`ThreadsPermissionError`なら、その権限がないものとして案内を返し（応答の`warnings`）、Accountは作る（FR-011）。反応数の権限がなければ、確定のときに`accounts.insights_denied_at`を今にする（006の印をそのまま使う）。`debug_token`の`scopes`が読めたときも、確かな判定はこの2つの呼び出しで行う（`scopes`は保存用）。
- **理由**：005・006と同じ判定に揃え、権限がないときの画面の扱い（自動投稿の「投稿できない」、パフォーマンスの「反応数を読めない」）をそのまま使う。

## R5.確定の処理を共通にする

- **決定**：`completeConnection(env, input)`の`input.state`（OAuthのstateの行）を、`ConnectionRequest = { userId, mode: "new" | "reconnect", targetAccountId, startedAt, method: "app" | "token" }`に置き換える。OAuthのcallbackはstateの行からこれを作り、トークンの要求はリクエストから作る（`startedAt`はリクエストを受け取った時刻）。取り消し・削除要求の確認（手順3・4）は、トークンの接続では`authorizedAt`をリクエストの時刻として同じく行う。
- **理由**：Accountの作成・上限の再判定・接続の書き込み・古い投稿の試みの片付け（005 PR #6）を2か所に書かない。
- **権限**：トークンの接続し直しは、ルートで`authorizeAccount(..., "owner")`を通し、トランザクションの中でも同じく確かめる（008の判定。パートナー・編集者は`ROLE_FORBIDDEN`）。

## R6.二重登録の照合（ユーザーIDとユーザー名）

- **決定**：
  1. ロックの順序を「Threadsユーザーのロック → ユーザー名のロック（新規：`threads_username:<正規化したユーザー名>`）→ usersの行ロック」にする。OAuth・トークン・データ削除のどれも、この順で取る（データ削除はユーザー名のロックを取らないので、順序に影響しない）。
  2. 既存のAccountを`threads_user_id = ID OR lower(username) =正規化したユーザー名`で探す。
  3. ユーザー名だけが一致したら（FR-023）、トランザクションの外で、一致したAccountの保存済みトークンでプロフィールを取り直す（復号できない・要再接続・認証のエラーなら、一致したものとして扱う）。ユーザー名が変わっていれば、そのAccountの`username`を更新してから、もう一度確定の処理をやり直す（1回まで）。
  4. 一致したAccountが自分のもの：新規の要求なら、OAuthは001どおり接続を更新（`kind: "updated"`）、トークンは`ACCOUNT_ALREADY_REGISTERED`（409、`details: [accountId]`）で接続し直しへ案内する（FR-021）。他人のもの：`THREADS_ACCOUNT_TAKEN`（001と同じ）。
- **理由**：Metaの文書はThreadsのユーザーIDを「アプリごとのユーザー」としており、同じ人でもアプリが違えばIDが違う見込みがある。ユーザー名はある時点で1人だけが持つので、照合の補いになる。ユーザー名は手放された後に他の人が取れるため、一致したら相手の今の名前を確かめる。
- **索引**：`accounts_username_lower_idx`（`lower(username)`、一意にしない）。古い名前が残っている間は、同じ名前のAccountが2つ一時的にありうるため。
- **トークンで追加するとき「自分のもの」をOAuthのように更新しない理由**：別のMetaアプリのトークンで黙って接続の方法を変えると、利用者が気づかないまま方法が切り替わる。接続し直しの操作で明示的に選んでもらう（US3）。

## R7.接続の方法とユーザーIDの更新

- **決定**：`accounts.connection_method`（`app`／`token`、既存の行は`app`）。`writeConnection`で接続の方法と`threads_user_id`を書き換える。接続し直しで同じThreadsアカウントか（FR-032）は「ユーザーIDが同じ、またはユーザー名が同じ」で判定する（001の「IDが同じ」だけの判定を広げる。OAuthでの接続し直しにも使う）。新しいIDが別のAccountの`threads_user_id`と重なるときは、二重登録として`THREADS_ACCOUNT_TAKEN`（他人）または`ACCOUNT_ALREADY_REGISTERED`（自分）にする。
- **理由**：方法を切り替えるとIDが変わりうる（R6）。Accountの行をそのまま使い、データを残す（FR-033）。
- **データ削除・取り消しの記録**：`threads_revocations`・`threads_deletion_requests`は、このアプリのMetaアプリから届く通知の記録で、IDのHMACで照合している。トークンの接続には通知が届かないが、照合はそのまま行う（害がない）。

## R8. 2時間後の確かめ直し

- **決定**：`threads_connections.recheck_at`。トークンでの確定で`debug_token`が読めなかったときだけ入れる。5分ごとの定期処理（`auto-post-runner`）で、関所の「次に見る時刻」の候補に`min(recheck_at)`を足し、時刻を過ぎた接続についてプロフィールを読む。
  - 読めた → `recheck_at`を消す（このとき`debug_token`をもう一度試し、読めれば期限を直す）。
  - 認証のエラー → 要再接続にし、`accounts.reconnect_hint = 'short_lived_token'`を入れる（画面の文言を「短期トークンだった可能性があります…」にする）。`recheck_at`を消す。
  - 一時的な失敗 → 10分後にやり直す（`recheck_at`を10分延ばす）。
  - トークンの確定のAPIは`autopost:wake`を書き、関所に新しい候補を知らせる（005と同じ書き方）。
  - 書き込みは世代番号（`connection_generation`）を条件にし、その間に接続し直していれば結果を捨てる（001 R6と同じ）。
- **理由**：新しいCronを足さず、用のない回はDBに触れない関所（005 R3）を保つ。
- **検討した案**：日次の処理で確かめる → 最大24時間、短期トークンの失効に気づかないので不採用。

## R9.確認の失敗の待ち

- **決定**：表`token_check_failures (id, user_id, failed_at)`。トークンの確認の前にusersの行ロックを取り、直近10分の失敗が5件以上なら、もっとも古い失敗から数えた待ちの残り（最大10分）を`TOKEN_CHECK_LOCKED`（429、`details: [残りの秒]`）で返す。失敗（形・無効・短期・別のアカウント）を数え、成功しても消さない（Clarifications）。日次の処理で1日より古い行を消す。
- **理由**：利用者ごと・DBで数えれば、Workersの複数の実体でも数がずれない。KVは書き込みの反映に遅れがあり、数える用途に向かない。
- **待ちの長さの計算**：5件目の失敗から10分。10分の間にさらに失敗しても、Threadsに問い合わせないので数は増えない（待ちが延び続けない）。

## R10.画面

- **決定**：
  - 追加の画面：主のボタンの下に、`<details>`相当の折りたたみ「自分のMetaアプリのトークンで追加する」。開くと`TokenConnectForm`（短い手順5つ・詳しい手順へのリンク・入力欄（`type="password"`・`autocomplete="off"`・`spellcheck=false`）・「追加する」・トークンの扱いの説明と利用規約へのリンク）。
  - 接続し直し：`ReconnectButton`と設定の「Threadsとの接続」から、`ReconnectDialog`（「Threadsで許可する」「トークンを貼り付ける」）を開く。トークンを選ぶと同じダイアログの中で`TokenConnectForm`を出す。設定の区分に「今の接続：このアプリで許可／自分のMetaアプリのトークン」を出す。
  - 応答の`warnings`（投稿・反応数の権限がない）は、移った先のホームでトーストではなく、設定と同じ`Alert`で1回出す（`?connected=new&warn=publish,insights`）。
- **理由**：開かなければ今の画面と同じ（SC-007）。トークンを扱う部品を1つにし、入力欄の扱い（隠す・保存させない）を1か所で守る。

## R11.利用規約と詳しい手順のページ

- **決定**：ログイン不要の`/terms`（利用規約）と`/guide/threads-token`（トークンの作り方）をWebに置く。どちらも静的な文面（TSX）。運営者向けの`docs/threads-token-guide.md`には、画面の手順の元・Metaの画面の名前が変わったときに直す場所・確かめた日を書く。トップページの足元に「利用規約」、追加の画面と手順のページから利用規約へリンクする。
- **理由**：利用者はリポジトリのdocsを読めないため、「詳しい手順」はアプリの公開ページとして出す（specの「ドキュメントのページ」をこう解釈した。2026-10-10）。文面の元をdocsに置くと、Metaの画面が変わったときの直し方が残る。
- **利用規約の文面**：spec FR-052の項目を下書きとして書き、運営者が公開の前に確かめる（Assumptions）。運営者の名前・連絡先は環境変数ではなく文面に書く（011で特商法の表示と合わせて見直す）。

## R11a.操作の記録

- **決定**：チームがあるAccountで、接続し直し（どちらの方法でも）を`threads_reconnected`（kind `settings`、`details: { method: "app" | "token" }`）として記録する。OAuthのcallbackでも記録する（今は記録していない）。トークンの値は書かない（FR-035）。
- **理由**：spec FR-035は「このアプリの接続での接続し直しと同じく」と書いたが、今はどちらも記録していなかったため、両方を記録する形に揃える（specのFR-035の文言を合わせて直す）。

## R12.文書の番号の変更（FR-060）

- **決定**：Constitutionを3.0.1（PATCH、Last Amended 2026-10-10）にし、原則Vの「決済（feature 009）」を「決済（feature 011）」に直す。Sync Impact Reportをファイルの先頭に残す（コミットの前に消すのは003以前の運用で、008では残さなかったため、008と同じく残さない）。008のspec FR-080・research.md R15・contracts/permissions.md、PRD §6.1の「009（決済）」を「011（決済）」に直す。
- **補足**：Constitutionの「開発ワークフロー」には、公開時に`main`／`develop`／`feature/*`の3段構成に切り替える方針がすでにある（011 notes.mdの内容と同じ）。

## R13.偽のThreads（テスト・E2E）

- **決定**：`apps/api/test/fake-threads`に、(1)任意の利用者のトークンを発行する開発用のエンドポイント（`POST /__test/tokens`：`{ user, appScope, lifetime: "long" | "short", debug: true | false, scopes }`）、(2) `debug_token`、(3)アプリごとに違うユーザーIDを返す`/me`（`appScope`ごとにIDを変える）を足す。E2Eの画面では、偽のThreadsの「トークンを作る」ページで作ったトークンを貼り付ける。
- **理由**：二重登録の3通り（SC-003）と、短期・`debug_token`が読めない場合を、実際のMetaアプリなしで確かめる。
