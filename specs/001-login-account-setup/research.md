# 調査結果（Phase 0 Research）：ログインとThreadsアカウント登録

**対象feature**：[spec.md](./spec.md) ／ **計画**：[plan.md](./plan.md) ／ **調査日**：2026-10-01

技術スタックはConstitution「技術スタック制約」で確定済みのため、ここでは本featureで生じる未確定事項だけを扱う。各項目は「決定／理由／検討した代替案」の形式で記す。

---

## R1. リポジトリ構成

- **決定**：pnpm workspacesによるモノレポとし、`apps/web`（Vite + React SPA、Cloudflare Pages）、`apps/api`（Cloudflare Workers + Hono）、`packages/shared`（プラン上限・エラーコード・入出力スキーマ）の3パッケージ構成にする。
- **理由**：フロントエンドとバックエンドをTypeScriptで統一する方針（Constitution）のもと、HonoのRPCクライアントで型を共有できる。プラン上限やエラーコードを両側で同じ定義から参照すれば、表示と判定のずれを防げる。
- **検討した代替案**：
  - 1パッケージにまとめる：Pages用とWorkers用でビルドとデプロイの単位が異なるため不採用。
  - DBスキーマを独立パッケージにする：DBに触れるのは現時点で`apps/api`だけなので、YAGNI（原則V）に従い`apps/api`内に置く。

## R2. ログインとセッション（FR-001〜FR-007）

- **決定**：
  - Clerkを使う。フロントエンドは`@clerk/react`（Core 3、v6）、APIはClerkのバックエンドSDK（Hono用ミドルウェア）でセッショントークンを検証する。
  - Clerkダッシュボードで「Googleのみ」を有効にし、メール＋パスワードなどの他の手段は無効にする。本番ではClerk共有のGoogle OAuth認証情報ではなく、自前のGoogle OAuthクライアントを登録する。
  - ユーザーの同一性はClerkのユーザーID（Googleアカウントの不変IDに紐づく）で判定する。アプリ側の`users`行は、APIへの初回認証済みリクエスト時に作成する（JIT作成）。
  - セッションの最大有効期間は、Clerkの既定値である**7日**とする。
- **理由**：
  - Clerkの採用はConstitutionで確定済み。プラン1〜3はClerk Userのみで完結させ、Organizationsは使わない（原則IV・V）。
  - JIT作成なら、Clerkのwebhookを受ける仕組みを作らずに済み、構成が小さい。
  - Clerkの無料プランでは、本番環境でセッションの最大有効期間を変更できない（変更は有料プラン限定）。月額固定費$0の制約を優先し、spec.mdのAssumptions（目安30日）を7日に改めた。
- **検討した代替案**：
  - Clerk webhook（`user.created`）でユーザーを同期する：webhookのエンドポイント・署名検証・再送への対応が増えるため不採用。ユーザー削除への追従（`user.deleted`）は、必要になった時点で追加する。
  - 有料プランで30日にする：固定費が発生するため、検証段階では不採用。
- **出典**：[Clerk Session options](https://clerk.com/docs/guides/secure/session-options)、[Clerk Core 3 upgrade guide](https://clerk.com/docs/guides/development/upgrading/upgrade-guides/core-3)

## R3. Threadsアカウントの接続（FR-008、FR-009、FR-012、FR-013、FR-020）

- **決定**：Threads公式のOAuth（認可コード方式）を使い、APIを起点に次の流れで処理する。詳細は[contracts/api.md](./contracts/api.md)を参照。
  1. Webが`POST /api/threads/connect`を呼ぶ。APIは登録数上限を判定し（FR-017。認可に進む**前**に判定する）、使い捨ての`state`を発行して認可URLを返す。
  2. ブラウザが`https://threads.com/oauth/authorize`へ遷移する。パラメーターは`client_id`、`redirect_uri`、`scope`、`response_type=code`、`state`。
  3. ThreadsからAPIの`GET /api/threads/callback`へ戻る。APIは`state`を検証して消費し、次の順に処理する。
     - 認可コードを短期トークン（有効期間1時間）に交換する（`POST graph.threads.com/oauth/access_token`）。
     - 短期トークンを長期トークン（有効期間60日）に交換する（`GET /access_token?grant_type=th_exchange_token`）。
     - プロフィールを取得する（`GET /v1.0/me?fields=id,username,name,threads_profile_picture_url`）。
     - Accountを作成または更新する。
  4. 処理が終わったら、結果に応じてWebの画面へリダイレクトする。
- **要求するスコープ**：`threads_basic`、`threads_content_publish`、`threads_manage_insights`。MVPで使うものを接続時にまとめて要求し、1か所の定数で管理する。
- **ローカル開発**：Threadsのredirect URIはHTTPSが必須で、`localhost`は登録できない。そのため、Cloudflare Tunnel（`cloudflared`）で固定のHTTPSホスト名をローカルのAPIに向ける。ステージングでは`*.workers.dev`のURLを登録する。
- **テスター制限**：Meta App Review前は、アプリのテスターに追加され、Threadsの設定画面で招待を承認したアカウントしか認可できない。テスター以外のアカウントで認可しようとするとMeta側の画面でエラーになり、アプリに戻らない場合がある。そのためアプリ側では確実に検知できない。代わりに、アカウント追加画面に「検証期間中は招待済みのThreadsアカウントのみ接続できます」という案内と問い合わせ先を常に表示し、specのエッジケースに対応する。
- **理由**：
  - トークンを手で貼り付ける方式を禁止した（spec FR-008）ため、公式OAuth一択になる。
  - スコープを後から追加すると全Accountの再認可が必要になる。自動投稿（FR-8）と分析（FR-9）で必ず使うため、最初から要求する。
- **検討した代替案**：
  - スコープを必要になった時点で段階的に追加する：再接続をユーザーに強いるため不採用。App Review前は各スコープの用途を説明する必要がないので、先に要求しても不利益はない。
  - Webでcallbackを受けてAPIへ中継する：トークン交換にはApp Secretが要るため、どのみちAPIで処理する必要がある。経路が増えるだけなので不採用。
- **出典**：[Threads: Get Access Tokens and Permissions](https://developers.facebook.com/docs/threads/get-started/get-access-tokens-and-permissions)、[Threads Profiles](https://developers.facebook.com/documentation/threads/threads-profiles)、[Threads APIの公式ドキュメントにない落とし穴（note）](https://note.com/shogo_works/n/na47d5d8f202a?hl=en)、[Postiz: Threads](https://docs.postiz.com/providers/threads)

## R4. callbackでの本人確認とCSRF対策

- **決定**：Threadsからのcallbackはトップレベルのナビゲーションで届くため、ClerkのBearerトークンを伴わない。そこで、`state`を「誰が」「どの操作を」始めたかを結びつける唯一の鍵として扱う。
  - `state`は32バイトの乱数とする。DBにはSHA-256ハッシュだけを保存し、有効期限は10分、使えるのは1回だけとする。
  - `oauth_states`テーブルに`user_id`、`mode`（`new` / `reconnect`）、`target_account_id`を記録する。
  - callback時に該当行を削除しながら取得し、期限切れや存在しない場合はエラーとして扱う。
- **理由**：`state`が推測できず、1回しか使えず、有効期限が短ければ、callbackを第三者に悪用されない。DBにハッシュだけを置くことで、DBが漏えいしても`state`を再利用されない。
- **検討した代替案**：署名付きCookieに`state`を入れる方式：WebとAPIが別オリジンになるため、サードパーティCookieの制約を受ける。不採用。

## R5. トークンの保管と暗号化（FR-010）

- **決定**：
  - Workersの標準Web Crypto APIでAES-256-GCMを使う。
  - 鍵は**バージョン別の鍵リング**として、1つのWorkers Secret（`TOKEN_ENCRYPTION_KEYS`）にJSONで置く。例：`{"1":"<32バイトのbase64>","2":"<32バイトのbase64>"}`。新しく暗号化するときに使うバージョンは、変数`TOKEN_ENCRYPTION_KEY_VERSION`で指定する。
  - 復号するときは、行に保存した`key_version`の鍵を鍵リングから選ぶ。起動時に、現在のバージョンの鍵が鍵リングにあること、各鍵が32バイトであることを検証し、満たさなければ起動を失敗させる。
  - DBには暗号文・IV（12バイト）・鍵バージョンを保存する。AAD（追加認証データ）にAccount IDを使い、暗号文を別のAccountの行に付け替えても復号できないようにする。
  - Threads APIへの呼び出しでは、トークンをURLのクエリではなく`Authorization`ヘッダーで渡す。ヘッダーで渡せないエンドポイント（トークン交換・更新）では、リクエストURLをログに出さない。
  - ロガーは`access_token`、`code`、`client_secret`、`signed_request`のキーを持つ値を自動的にマスクする。
- **鍵のローテーション手順**（PR #2の4回目のレビューで指摘。鍵が1つしか持てないと、鍵を替えた瞬間に既存のトークンをすべて復号できなくなるため）：
  1. 新しい鍵を生成し、古い鍵を残したまま、新しいバージョンとして鍵リングに追加してデプロイする。
  2. `TOKEN_ENCRYPTION_KEY_VERSION`を新しいバージョンに切り替えてデプロイする。以後、新規の接続・再接続・定期更新は新しい鍵で暗号化される。
  3. 移行スクリプト（`pnpm --filter api admin:rotate-token-key`）で、古いバージョンの行を新しい鍵で暗号化し直す。各行の書き込みは、読んだ時点の`key_version`と`accounts.connection_generation`を条件にし、その間に再接続などで書き換わった行は飛ばす（トークンの値は変わらないので、世代番号は上げない）。
  4. 古いバージョンの行が0件になったことを確かめる（スクリプトが最後に件数を表示する）。
  5. 古い鍵を鍵リングから外してデプロイする。
  - 行の`key_version`に対応する鍵が鍵リングにない場合（手順5を早まったなどの設定ミス）は、復号をエラーにしてログに残し、接続状態は変えない。設定ミスで全Accountが`needs_reconnect`になり、設定を直しても戻らない事態を避けるためである。移行スクリプトも、鍵が欠けているバージョンの行があれば開始しない。
  - データ削除のtombstoneに使う`IDENTIFIER_HASH_KEY`は、鍵を替えると未完了の削除要求と照合できなくなる。替えるのは、`threads_user_hmac`が残っている行がない（未完了の要求がなく、完了から15分以上経った後の日次Cronが済んだ）ときに限る（research.md R7）。
- **理由**：追加ライブラリなしでWorkersで動き、改ざんも検知できる。鍵リングとバージョンを持たせておけば、サービスを止めずに鍵を入れ替えられる。
- **検討した代替案**：
  - Postgresの`pgcrypto`で暗号化する：鍵をSQLに渡すことになり、クエリログに残る恐れがあるため不採用。
  - 外部のKMSを使う：固定費とレイテンシが増えるため、MVPでは不採用。

## R6. トークンの有効期限・更新・失効の検知（FR-018、FR-021）

- **決定**：
  - 長期トークンの有効期間は60日。Cloudflare Cron Triggerで**1日1回**（03:00 JST）、有効期限まで7日を切ったトークンを`GET /refresh_access_token?grant_type=th_refresh_token`で更新する。更新できるのは発行から24時間以上経ち、まだ期限切れでないトークンだけである。
  - 更新に成功したら、同時にプロフィール（ユーザー名・表示名・プロフィール画像）も取得し直す。
  - 次のいずれかに当たる場合は`connection_status = needs_reconnect`にする：更新時に認証エラー（OAuthエラー190など）が返った、有効期限を過ぎた、アンインストールのcallbackを受け取った、画面を開いたときの確認で認証エラーが返った（R14）。後続featureがThreads APIを呼んで認証エラーを受けた場合も、共通のヘルパーで同じ処理をする。
  - 同じCronで、期限切れの`oauth_states`も削除する。
  - **再接続との競合制御**：`accounts`に世代番号`connection_generation`（bigint）を持たせる。トークンを書き込む・消すたびに（接続、再接続、定期更新、アンインストールによる削除）、同じ文の中で1増やす。Cron・画面を開いたときの確認・後続featureのヘルパーは、次の手順で書き込む。
    1. トークンを読むときに`accounts.connection_generation`も読む。
    2. Threadsを呼び出す。
    3. 結果を書き込むときは`WHERE accounts.id = $1 AND connection_generation = <読んだ値>`を条件にする。トークンの更新は、`accounts`の世代番号を上げる`UPDATE … RETURNING`をCTEにし、その結果があるときだけ`threads_connections`を更新する1つの文にする。
    4. 更新件数が0なら、その間に再接続・アンインストールなどで接続が変わったということなので、結果を捨てる。`needs_reconnect`への変更も同じ条件で行うため、古いトークンの認証エラーで新しい接続を壊すことはない。
    - 再接続（callback）は条件なしで上書きし、世代番号を1増やす。ユーザーの操作をつねに優先する。
    - 世代番号を`threads_connections`ではなく`accounts`に置くのは、アンインストールで接続行を削除して作り直しても、番号が初期値に戻らないようにするためである。接続行の側に置くと、「古い処理がversion 1を読む → アンインストールで行を削除 → 再接続で行をversion 1で作り直す → 古い処理の条件が新しい行に一致する」というABA問題が起きる（PR #2の2回目のレビューで指摘）。`accounts`の行はAccountを削除するまで消えないので、番号は単調に増え続ける。
- **理由**：
  - 1日1回の処理なら、Neonの無料枠（100 CU-hours/月）への影響はごくわずかで、Constitutionの既知リスク（高頻度ポーリング）にも当たらない。
  - 7日の余裕があれば、Cronが数回失敗しても期限切れを避けられる。
  - Meta CDNのプロフィール画像URLは期限付きで失効するため、トークン更新と同じタイミングで取り直す。表示側では、画像を読み込めないときはイニシャルを表示する。
- **検討した代替案**：
  - アクセスのたびにその場で更新する：アクセスのないAccountが60日で失効してしまうため不採用。
  - 1時間ごとに実行する：60日の有効期間に対して頻度が過剰で、Neonの負荷が増えるため不採用。
- **出典**：[Threads: Long-Lived Access Tokens](https://developers.facebook.com/docs/threads/get-started/long-lived-tokens)

## R7. Metaのアンインストール・データ削除のcallback

- **決定**：Threadsアプリの設定でredirect URIを保存するには、アンインストールとデータ削除のcallback URLの登録が必須である。そこで2つのエンドポイントを用意する。
  - **アンインストール**：`signed_request`をApp SecretのHMAC-SHA256で検証し、該当するThreadsユーザーのAccountを`needs_reconnect`にして、接続情報（トークン）を削除する。
  - **データ削除**：同じく検証したうえで、該当するThreadsユーザーのAccountを関連データごと削除する（FR-022と同じ削除処理）。受け付けた時点で要求を記録し、削除の成否を`pending` / `completed` / `failed`で持つ。状況確認ページはこの状態をそのまま表示する。
- **中断からの回復**：
  - 削除処理は冪等にする（「このThreadsユーザーのAccountが残っていれば消す」）。何度実行しても結果は同じ。
  - 日次のCronは、**最後に試みてから15分以上経った`pending`と`failed`の要求**を再試行する。`pending`と`failed`の両方に、同じ15分のリースを使う。受付を記録した直後にWorkerが強制終了し、`failed`に移せなかった要求も、これで回収できる（PR #2の2回目のレビューで指摘）。
  - 15分という猶予は、通常の削除処理（数秒）が終わるのを待つためのリース期間である。受付のリクエスト自体がまだ処理中の要求を、Cronが拾わないようにする。
- **試行ごとの原子的なclaim**：
  - 「冪等だから二重に処理しても害はない」とは言えない。次の競合があるためである（PR #2の3回目のレビューで指摘）。
    1. 2つのWorker（AとB）が、同じ古い要求を読み取る。
    2. Aが削除して`completed`にする。
    3. ユーザーが削除の完了後に、新しい認可フローで正当に再接続する（tombstoneの規則上、削除要求より後に始めた接続は許可される）。
    4. 遅れて動いたBが、先に読み取っていた`threads_user_id`を使い、再接続されたAccountまで削除してしまう。
  - そこで、削除の試行（webhookでの最初の試行も、Cronの再試行も）は、すべて次の手順を**1つのトランザクション**で行う。
    1. Threadsユーザー単位のアドバイザリーロックを取る。
    2. 削除要求の行を`SELECT … FOR UPDATE`で読み直す。
    3. 読み直した行の`status`・`threads_user_id`・`last_attempted_at`を確認する。次のどれかに当たれば、何もせずに終える。
       - `status`が`pending` / `failed`ではない（他のWorkerが完了させた）
       - `threads_user_id`がNULLになっている、またはロックのキーに使ったIDと違う
       - `last_attempted_at`が、最初に読み取った値から変わっている（他のWorkerが先に試行した）
    4. 条件付きの`UPDATE … SET attempts = attempts + 1, last_attempted_at = now() WHERE confirmation_code = $1 AND status IN ('pending', 'failed') AND last_attempted_at = <最初に読み取った値> RETURNING threads_user_id`で、この試行の担当を確定（claim）する。更新件数が0なら、claimに失敗したので削除しない。
    5. claimできた場合だけ、`RETURNING`で得た`threads_user_id`のAccountを削除し、`status = completed`・`completed_at`を記録し、平文の`threads_user_id`をNULLにしてコミットする。
  - claim・削除・完了の記録が同じトランザクションなので、「claimしたが削除は終わっていない」状態は外から見えない。途中で失敗すればすべてロールバックされ、要求は試行前の状態に戻り、次のCronで再試行される。そのうえで、別のトランザクションで`status = failed`、`attempts + 1`、`last_attempted_at = now()`にする（`status <> 'completed'`を条件にする）。
  - ロックを取ってから読み直すので、先行するWorkerが完了させた要求を、後続のWorkerが古い読み取り結果のまま処理することはない。
- **進行中のOAuth callbackとの直列化（tombstone）**：
  - 次の競合を防ぐ。`mode = new`のcallbackがプロフィールの取得を終え、Account作成のトランザクションに入る前に削除要求が処理されると、削除して`completed`にした直後に、callbackが同じThreadsユーザーのAccountを作り直してしまう（PR #2の2回目のレビューで指摘）。
  - 対策として、callbackのトランザクションと削除処理のトランザクションの両方で、最初に**Threadsユーザー単位のアドバイザリーロック**（`pg_advisory_xact_lock`。キーは`threads_user_id`から作る）を取る。2つの処理は必ずどちらかが先に終わる。
  - callbackはロックを取った後、このThreadsユーザーについて次のどちらかに当たる削除要求（tombstone）があるかを確認する。あれば登録を拒否し、`THREADS_DATA_DELETION_REQUESTED`としてWebに戻す。
    1. **未完了**（`status`が`pending`または`failed`）の要求。受け付けた時刻は問わない。
    2. **自分の認可フローを始めた時刻（`oauth_states.created_at`）以降に受け付けた**要求。状態は問わない。
  - 1の規則が必要なのは、次の問題を防ぐためである（PR #2の4回目のレビューで指摘）。削除に失敗して要求が`pending` / `failed`のまま残っている間に、ユーザーがその後で始めた認可フローで接続できてしまうと、後からCronの再試行がその新しいAccountを削除してしまう。未完了の要求がある間は接続させず、ユーザーには削除が完了してからやり直してもらう。
    - 削除が先に終わった場合：callbackが2の規則でtombstoneを見つけて拒否するので、Accountは作り直されない。
    - callbackが先に終わった場合：作られたAccountを、続く削除処理が消す。
    - 削除が失敗して未完了のまま残っている場合：1の規則で拒否する。Cronの再試行で`completed`になるまで、新しい接続は作られない。
  - 削除が**完了した後**に始めた認可フローは、ユーザーが削除を求めた後で改めて接続し直したという意味なので、拒否しない。
- **削除後に残す情報（識別子の消去）**：
  - 再試行のため、完了するまでは平文の`threads_user_id`を保持する。
  - `completed`になった時点で、同じトランザクションの中で平文の`threads_user_id`をNULLにする。代わりに、tombstoneの確認に使う鍵付きハッシュ（`HMAC-SHA256(IDENTIFIER_HASH_KEY, threads_user_id)`）だけを残す。鍵はWorkersのSecretで、鍵なしでは元のIDを復元・照合できない。
  - tombstoneが意味を持つのは、受付時点で進行中だった認可フロー（`state`の有効期限は10分）の間だけである。そのため、完了から15分以上経った要求の鍵付きハッシュは、日次のCronでNULLにする。最終的に残るのは、確認コード・状態・日時・試行回数だけである（PR #2の2回目のレビューで指摘）。
  - 確認コード・状態・日時は、Metaの状況確認URLに応えるために残す。保存期間は、`TODO(COMMERCIAL_LAUNCH_GATE)`でプライバシーポリシーを定めるときに決める。
- **理由**：
  - アンインストールの検知は、FR-018の「取り消しの検知」そのものである。
  - データ削除の要求は、ユーザー本人がThreads側で「このアプリから自分のデータを消してほしい」と明示的に求めたものである。確認コードを返す以上、要求を実際に履行し、その進み具合を正直に返す必要がある。接続情報だけを消して「受け付けました」と表示する設計では、Account・プロフィール・運用データが無期限に残り、App Reviewの要件とユーザーデータの保護の両方を満たせない（PR #2のレビューで指摘）。
  - 削除はAccount単位のカスケード削除なので、1回のリクエストで同期的に終わる。非同期のキューは要らない。
- **検討した代替案**：
  - 接続情報だけを消し、Account本体の削除はユーザーのアプリ内操作に任せる（当初案）：上記のとおり削除要求を履行できないため不採用。
  - 削除を非同期キュー（Cloudflare Queues等）で行う：削除量がAccount 1件分で小さく、同期処理で足りる。YAGNI（原則V）に従い不採用。
  - ロックだけで直列化し、tombstoneを持たない：削除が先に終わると、callbackはロックを取った後に何も見つけられず、Accountを作り直してしまう。順序を決めるだけでは防げないため不採用。
  - 平文のIDを完了後もそのまま残す：削除を求めたユーザーを識別できる情報が残り続けるため不採用。
  - 識別子の消去のためにCronを1時間ごとに動かす：Neonが1時間ごとに起動し、無料枠の消費が増える。鍵付きハッシュは単独では元のIDに戻せないので、最長1日残っても実害は小さい。日次で足りると判断した。

## R8. DBアクセスと同時実行の制御（FR-012、FR-013、FR-017）

- **決定**：
  - Drizzle ORMとNeonのサーバーレスドライバーを使う。通常のクエリはHTTP経由（`neon-http`）で発行する。
  - Account作成を伴うcallback処理と、データ削除処理（R7）は、WebSocket経由（`neon-serverless`のPool。リクエストごとに作成して破棄する）の対話的トランザクションで行う。callbackは次の手順で処理する。
    1. Threadsユーザー単位のアドバイザリーロックを取る（R7）。
    2. `SELECT … FROM users WHERE id = $1 FOR UPDATE`で、そのユーザーの処理を直列化する。
    3. 認可フローの開始後に受け付けた削除要求（tombstone）があれば拒否する（R7）。
    4. `threads_user_id`で既存のAccountを探す。
    5. 見つかった場合：自分のAccountなら接続を更新する。他人のAccountなら拒否する。
    6. 見つからない場合：上限を再判定してから、AccountとMembershipを作成する。
  - **ロックの順序**：どの処理も「Threadsユーザー単位のアドバイザリーロック → `users`の行ロック」の順で取る。データ削除処理はAccountを削除する際、`users.last_account_id`のNULL化で`users`の行もロックする。順序をそろえないと、callbackと削除処理が互いの持つロックを待ってデッドロックする。
  - 最後の防衛線として、`accounts.threads_user_id`に一意制約を張る。
- **理由**：
  - 上限判定はconnect開始時（FR-017の「認可に進む前」）とcallback時の2回行う。2回目をロック付きトランザクションで行えば、複数タブからの同時操作でも上限を超えない（spec エッジケース）。
  - 2人のユーザーが同じThreadsアカウントを同時に登録しようとする競合は、ユーザー単位のロックでは防げない。これは一意制約が防ぐ。
- **検討した代替案**：HTTPドライバーの一括トランザクション（`batch`）：途中の読み取り結果によって処理を分けられないため不採用。

## R9. プラン上限の判定（FR-014〜FR-017）

- **決定**：
  - `packages/shared`に、プランの順位と上限を定数で持つ：`auto-only`（1件）< `auto-grower`（1件）< `multi-account`（5件）< `team`（5件）。
  - ユーザーの上限は、そのユーザーが`owner`であるAccountのうち最上位のプランの上限とする。
  - 新しいAccountのプランは、最初の1件なら`auto-only`、2件目以降は保有Accountの最上位プランを引き継ぐ。
  - 課金feature（FR-12）ができるまでの検証期間中、運営者は`apps/api`のスクリプト（`pnpm --filter api admin:set-plan <accountId> <plan>`）でプランを手動で変更する。管理画面は作らない。
- **理由**：spec Clarifications（2026-10-01）の決定をそのまま実装に落とした。`plan`は`accounts`、`role`は`memberships`に分けて持ち、Constitution原則IVを守る。
- **検討した代替案**：上限をDBの設定テーブルに持つ：変更頻度が低いうえ、Web側の表示と同じ定義を共有したいため、コード上の定数にする。

## R10. 「最後に使ったAccount」とログイン後の遷移先（FR-004、FR-005、FR-007）

- **決定**：
  - `users.last_account_id`（Account削除時にNULLになる外部キー）と`accounts.last_used_at`を持つ。
  - `GET /api/me`が遷移先のAccount IDを返す。優先順位は、`last_account_id` → `last_used_at`がもっとも新しいもの → `created_at`がもっとも新しいもの → なし（アカウント追加画面へ）。
  - 記録のタイミングは「切り替えの操作」ではなく、「Accountの画面を開いたこと」とする。Webは`/accounts/:accountId`配下を開くと`POST /api/accounts/:accountId/open`を呼び、APIがその中で記録する（R14の接続確認も同じリクエストで行う）。
  - 記録に失敗しても画面の表示は止めない。Webは失敗した呼び出しを、指数バックオフで最大3回まで再試行する。それでも失敗した場合は、次に画面へフォーカスが戻ったときや再読み込みのときに、開いているAccountについてもう一度呼ぶ。
  - **古い再試行で新しい記録を上書きしない**（PR #2の4回目のレビューで指摘）。Account Aの記録が失敗して再試行を待っている間にユーザーがAccount Bへ移ると、Bの記録の後にAの再試行が成功し、記録がAに戻ってしまう。これを2重に防ぐ。
    1. **Web**：Accountの画面を離れたら、そのAccountについて待機中・実行中の再試行を中止する（`AbortController`で取り消し、待機中の再試行は破棄する）。
    2. **API**：リクエストに「その画面を開いた時刻」（`openedAt`）を含める。再試行でも、最初に開いた時刻をそのまま送る。サーバーは`users.last_account_opened_at`より新しい`openedAt`のときだけ、`last_account_id`と`last_account_opened_at`を更新する。Webの中止がすり抜けても、古い記録は新しい記録を上書きできない。
    - `openedAt`はブラウザの時計に依存するため、サーバーの現在時刻より未来の値は現在時刻に丸める。別の端末どうしで時計が大きくずれている場合は順序が入れ替わり得るが、そのときも「どちらかの端末で最後に開いたAccount」になるだけで、実害は小さい。
- **理由**：
  - 遷移先の判断をサーバー側の1か所にまとめれば、Webのルーティングは結果に従うだけで済み、テストもしやすい。
  - 「切り替えたとき」だけに記録すると、1回の呼び出しが失敗しただけで記録が古いまま残る（PR #2のレビューで指摘）。「画面を開いている間は記録が成功するまで再試行する」形にすれば、ユーザーが最後に見ていたAccountが記録から漏れない。サイドバー以外の経路（URLの直接入力、ブラウザの戻る・進む）で開いた場合も記録される。
- **検討した代替案**：
  - ブラウザの`localStorage`に保存する：別の端末からログインしたときに引き継がれないため不採用。
  - 切り替えのときに`PUT /api/me/last-account`を1回だけ呼ぶ（当初案）：失敗したときに回復できないため不採用。
  - `GET /api/accounts/:accountId`の副作用として記録する：GETに書き込みを持たせると、先読みやキャッシュの再検証で意図しない記録が起きるため不採用。

## R11. フロントエンドの構成と画面の骨格

- **決定**：
  - React 19、Vite、React Router v7（SPAモード）、TanStack Query、Honoの型付きRPCクライアント、shadcn/ui（Tailwind CSS v4）を使う。
  - レイアウトは、左サイドバー（Account切り替え、アカウント追加、ユーザーメニュー）と右メインパネルの2列とし、ダークモードはOSの設定に従う。画面一覧と遷移の規則は[contracts/ui-routes.md](./contracts/ui-routes.md)を参照。
  - エラーコードと表示文言（日本語）の対応表は`packages/shared`に置く。
- **理由**：Constitutionで確定したUIの方針（ChatGPT風のニュートラルな質感、左サイドバー＋右メインパネル）を、このfeatureで画面の骨格として確立する。アプリ全体の詳細なデザインは、投稿ストックのfeatureに入る前に改めて決める（2026-10-01のユーザーとの合意）。
- **検討した代替案**：TanStack Router：型安全性は高いが、画面数が少ないMVPでは学習コストに見合わないため不採用。

## R12. テスト方針

- **決定**：
  - **API**：Vitestと`@cloudflare/vitest-pool-workers`を使い、Workersのランタイム上でテストする。DBは、Docker ComposeでPostgres 17と`local-neon-http-proxy`を起動し、本番と同じNeonドライバーで接続する。
  - **Threads APIの差し替え**：Threads APIはベースURL（`THREADS_GRAPH_BASE_URL`・`THREADS_AUTH_BASE_URL`）を環境変数で切り替えられるようにし、テストでは偽のThreadsサーバー（Honoで実装）に向ける。
  - **Web**：VitestとTesting Libraryでテストする。
  - **E2E**：Playwrightと`@clerk/testing`でログインを自動化し、Threadsの認可画面は上記の偽サーバーで置き換える。本物のMetaの認可画面を使う確認は、[quickstart.md](./quickstart.md)の手動の手順で行う。
- **理由**：本物のMetaのログイン画面は自動化できず、自動化すべきでもない。ベースURLの差し替えで、callback以降のロジックを本番と同じコードのまま検証できる。
- **検討した代替案**：DBをPGliteに置き換える：ドライバーとトランザクションの挙動が本番と異なり、R8の同時実行制御を検証できないため不採用。
- **出典**：[Neon: Local development with Neon](https://neon.com/guides/local-development-with-neon)、[local-neon-http-proxy](https://github.com/TimoWilhelm/local-neon-http-proxy)

## R13. Account削除（FR-022）

- **決定**：
  - `DELETE /api/accounts/:accountId`は、確認用の入力値としてThreadsのユーザー名を受け取り、サーバー側で一致を検証する。
  - Accountに紐づくテーブルにはすべて`ON DELETE CASCADE`を付ける。これは後続featureでも守る規約とする。
- **理由**：画面側だけで確認すると、APIを直接呼べば確認なしで削除できてしまう。カスケード削除を規約にしておけば、後続featureでテーブルが増えても削除漏れが起きない。
- **確認入力の正規化**：ユーザー名の比較では、両方の値について前後の空白を除き、先頭の`@`を1つ除き、小文字にしてから比べる。画面では`@username`と表示しているので、ユーザーが`@`付きで入力しても`@`なしで入力しても削除できるようにする。正規化の関数は`packages/shared`に1つだけ置き、Webのボタンの有効・無効の判定とAPIの検証の両方で使う（PR #2のレビューで指摘）。
- **検討した代替案**：論理削除（`deleted_at`）：specが復元手段を求めておらず、トークンを残すと情報漏えいの面でも不利なため不採用。

## R14. 画面を開いたときの接続確認（FR-018、SC-007）

- **決定**：
  - ユーザーがAccountの画面を開いたとき（`POST /api/accounts/:accountId/open`、R10）に、保存しているトークンでThreadsのプロフィール取得（`GET /v1.0/me`）を1回呼ぶ。
  - 認証エラーが返れば、その場で`needs_reconnect`にして画面に返す。書き込みにはR6の`connection_generation`による競合制御を使う。
  - 成功すればプロフィールを最新にする。期限付きの画像URLも、ここで取り直せる。
  - Account一覧（サイドバー）では、Accountごとの確認はしない。その時点までに検知してDBに保存されている状態を表示する。
- **理由**：
  - アンインストールのcallbackが届かないままトークンだけが無効になった場合、日次のCronは「期限まで7日を切った接続」しかThreadsに問い合わせない。そのため最長で約53日間、無効な接続が`connected`と表示されてしまう（PR #2のレビューで指摘）。
  - 画面を開いたときに確かめれば、SC-007「そのAccountを開いた時点で『要再接続』と表示される」を満たせる。
  - 呼び出しは画面を開いたときに1回だけで、規模はユーザー数十人・Accountは最大5件なので、ThreadsのAPI制限やNeonの無料枠への影響は小さい。
- **検討した代替案**：
  - 一覧を開いたときも、全Accountを確認する：Accountの数だけThreadsを呼ぶことになり、一覧の表示が遅くなる。一覧には最新の検知結果を表示すれば足りるため不採用。SC-007の対象も「そのAccountを開いた時点」に絞った。
  - Cronの頻度を上げて全接続を確認する：効果は画面を開いたときの確認と変わらないのに、Neonの負荷が増えるため不採用。

---

## 未解決事項

なし。Technical Contextの「要確認」はすべて上記で解消した。

## specへの反映

- R2：セッションの目安を30日から7日へ（spec.mdのAssumptions）。
- PR #2のレビュー対応（2026-10-01）：
  - FR-018：画面を開いたときの確認を検知の経路に追加（R14）
  - FR-020：「要再接続」のときに限らず、既存のAccountを認可し直せるようにした
  - SC-007：一覧は最新の検知結果の表示とし、確認のタイミングを「Accountを開いた時点」に絞った
  - Assumptions：初期プランの記述をFR-014にそろえた
- PR #2の2回目のレビュー対応（2026-10-01）：
  - エッジケース：データ削除の要求を受けた後は、それより前に始めた接続フローでAccountを作り直さないことを追記（R7）
- PR #2の4回目のレビュー対応（2026-10-02）：
  - エッジケース：削除の要求が完了するまでの間は、そのThreadsアカウントでの新しい接続を受け付けないことを追記（R7）
