# Research：アカウントを先に作る

**日付**：2026-10-14 | **仕様**：[spec.md](./spec.md) | **計画**：[plan.md](./plan.md)

## R1.未接続の持ち方

- **決定**：
  - 列挙型`connection_status`に`not_connected`を足す（`connected`・`needs_reconnect`・`not_connected`）。新しいアカウントは`not_connected`で作る。
  - `accounts.threads_user_id`・`accounts.username`・`accounts.connection_method`を`NULL`を許す列にする。未接続の間はどれも`NULL`、つないだら3つとも入る。CHECK制約で「未接続 ⇔ 3つが`NULL`」を守る。列挙型の値は同じマイグレーションの中で使えないので、CHECKは`connection_status::text = 'not_connected'`で比べる（004の`post_drafts`と同じやり方）。
  - `threads_user_id`の一意制約はそのまま（Postgresの一意制約は`NULL`どうしを重ならないものとして扱う）。ユーザー名の索引（`lower(username)`）もそのまま。
  - Threadsの接続（`threads_connections`）の行は、未接続のアカウントには作らない。
- **理由**：未接続を「`threads_user_id`が`NULL`」だけで表すと、`connection_status`が`connected`のまま残り、`connectionStatus !== "connected"`で投稿を止めている所（`publish-claim.ts`・`publish-executor.ts`）の守りが、`threads_connections`の行がないことだけに頼る形になる。状態を1つ足せば、今の`connected`で絞っている毎日の処理・自動投稿・反応数の取得は、何も変えずに未接続を飛ばす（spec FR-035、SC-005）。
- **検討した案**：
  - 「Threadsのアカウント」を別の表に分け、`accounts`には名前だけを持つ → 001〜011の問い合わせ（`accounts.username`・`threads_user_id`を読む所、およそ30か所）をすべて書き直すことになり、本featureの大きさに見合わないので不採用。
  - `connection_status`を`NULL`可にして未接続を`NULL`で表す → `NULL`の比べ方の取りこぼし（`<> 'connected'`が`NULL`で偽にならない）を招くので不採用。

## R2.アカウントの名前

- **決定**：`accounts.name`（`text NOT NULL`、前後の空白を除いて1〜50文字。CHECK制約）を足す。マイグレーションで、今のアカウントの名前を`COALESCE(NULLIF(trim(display_name), ''), username)`の先頭50文字で埋める（spec FR-044）。名前の重なりは止めない（Edge Cases）。
- **表示の決まり**（Clarifications 2026-10-14）：主の名前はいつも`name`。@ユーザー名はあれば添える。画像はThreadsのプロフィール画像、なければ`name`の頭文字。未接続なら「未接続」の印を添える。共通の関数`accountLabel(account)`（`packages/shared`）で、主の名前・添える名前・頭文字を1か所で決める。
- **名前を直す**：オーナーだけ（`owner`の権限）。`PATCH /api/accounts/:id`。チームに入っているアカウントでは、操作の記録に残す（`settings`の`account_renamed`、前後の名前つき）。
- **プロンプト**：今の`displayName ?? @username`（`prompt-service.ts`）を`name`に替える（spec FR-037）。Threadsの表示名はプロンプトに使わない（つなぐ前後でプロンプトが変わらないように）。
- **理由**：つなぐ前後で見え方を変えないため（Clarifications）。Threadsの表示名で埋めるので、今の利用者の見た目はほぼ変わらない（SC-007）。
- **検討した案**：`name`を`NULL`可にして、`NULL`ならThreadsの表示名を出す → 表示のたびに分岐が増え、FR-042の「主の名前はアカウントの名前のまま」とぶつかるので不採用。

## R3.アカウントを作るAPI

- **決定**：`POST /api/accounts`（本文`{ name }`）。1つのトランザクションで、`users`の行ロック → 上限の再判定（`assertCanAddAccount`、001 FR-017）→ `accounts`（`not_connected`・`plan = initialPlanFor(...)`）と`memberships`（owner）の作成。応答は`AccountSummary`（201）。初期の設定（宣伝投稿の割合など）は列の既定値なので、今の`completeConnection`の作成と同じになる（spec FR-003）。
- **同時の作成**：行ロックの中で上限を数えるので、上限を超えない（spec FR-004）。同じ名前で2回押したときは、2つ作られてよい（名前の重なりは止めない）。画面は送信中にボタンを止める。
- **理由**：つなぐことと作ることを分けると、作る側にThreadsへの問い合わせが要らなくなり、上限の判定も1か所（このAPI）に集まる。

## R4.つなぐ流れ（モードの整理）

- **決定**：
  - 接続の要求のモードを`connect`（未接続のアカウントにはじめてつなぐ）と`reconnect`（001・010のまま）の2つにし、`new`（つなぐことでアカウントを作る）をなくす（spec FR-005）。`POST /api/threads/connect`・`POST /api/threads/token-connect`の本文は、どちらのモードも`accountId`を持つ。
  - 列挙型`oauth_mode`に`connect`を足す。`new`は使わない値として残す（列挙型から値を消せないため。011の`partner`と同じ）。公開の時点で10分以内に始めた`new`の`state`は、callbackで`OAUTH_STATE_INVALID`として扱う。
  - `completeConnection`の`mode = connect`の手順（同じトランザクション）：
    1. 今のロックの順（Threadsユーザー → ユーザー名 → 利用者の行）を保つ。
    2. 取り消し・削除の要求の確認は今のまま。
    3. 対象のアカウントを`FOR UPDATE`で読み、オーナーかを確かめる（`authorizeAccount(..., "owner")`）。なければ`ACCOUNT_NOT_FOUND`。
    4. 対象がもう`not_connected`でなければ`ACCOUNT_ALREADY_CONNECTED`（spec FR-018。同じThreadsアカウントでも、黙って接続し直しにしない）。
    5. ユーザーIDとユーザー名で照合する（今の`candidates`）。一致したら、自分の別のアカウントなら`ACCOUNT_ALREADY_REGISTERED`（`details`にそのアカウントのIDと名前。spec FR-022）、他の利用者なら`THREADS_ACCOUNT_TAKEN`（spec FR-021）。
    6. `writeConnection`で、接続とプロフィールと方法を書き、`connected`にする。`posting_schedules.effective_from`を今にするのも今のまま。
    7. チームがあるアカウントなら操作の記録（`threads_connected`、方法つき。spec FR-019）。ただし未接続のアカウントはチームに入れないので、ふつうは記録しない（R7）。
  - 上限の判定は`connect`ではしない（アカウントは増えない。spec FR-016）。
  - `mode = new`の手順（ユーザーの`last_account_deleted_at`の確認、上限の再判定と作成）は消す。
  - 自分の別のアカウントと重なったとき、`existing`の更新（001 FR-013「接続を更新する」）は`connect`ではしない（Clarifications：止めて案内する）。
- **callbackの戻り先**：`connect`・`reconnect`とも、成功は`/accounts/:id/settings?connected=connect|reconnect`、失敗は`/accounts/:id/settings?error=CODE`。`state`が読めないときの戻り先は`/`（振り分け）にする。
- **理由**：つなぐ入口を「このアカウントの設定」の1つにすると、照合の分岐（新規・更新・接続し直し）が「はじめてつなぐ」と「接続し直す」の2つに減る。`ACCOUNT_ALREADY_CONNECTED`を分けるのは、2つのタブで別々のThreadsアカウントにつなごうとしたときに、後の方が`RECONNECT_ACCOUNT_MISMATCH`の「別のThreadsアカウントです」と出るのを避けるため（spec US3-4）。
- **検討した案**：`connect`を作らず、`reconnect`の中で「対象が未接続ならはじめての接続」と分ける → 上のFR-018の文言を出せず、二重の照合（自分の別のアカウント）の扱いも`reconnect`と混ざるので不採用。

## R5.未接続の間の扱い（APIの側）

- **決定**：
  - 投稿：`publish-claim.ts`・`publish-executor.ts`・`auto-post-runner.ts`は`connected`で絞っているので、変えない。
  - 自動投稿をオンにする：`savePostingSchedule`の`checkThreadsPublish`は、接続の行がないと`needs_reconnect`を返す。`threads-check-service.ts`で`not_connected`を先に見て、`{ status: "not_connected" }`を返す。`THREADS_NOT_READY`の`details`に`not_connected`が入り、画面は「Threadsにつなぐと使えます」を出す（spec FR-032）。オフのまま時刻を保存するのは今のまま通る。
  - 自動投稿の状態：`toAutoPostState`の止まっている理由に`not_connected`を足す（オンのまま未接続になることはないが、型として扱う）。自動投稿の画面は、`account.connectionStatus`で案内を出す。
  - 毎日の処理：期限の延長（`token-refresh.ts`）・確かめ直し（`token-recheck.ts`）・反応数（`metrics-runner.ts`）は`threads_connections`との内部結合か`connected`で絞っているので、未接続を飛ばす（spec FR-035）。テストで確かめる。
  - 画面を開いたときの確認（`verifyConnection`）：接続の行がなければ何もしない（今のまま）。
  - パフォーマンス：`getPerformanceSummary`に`notConnected`を足し、未接続なら数字を数えずに返す。書き出しは`ACCOUNT_NOT_CONNECTED`（409）で拒む。
  - 投稿の権限の確認（`/threads-check`）：未接続なら`not_connected`を返し、Threadsに問い合わせない。
  - データ削除・取り消しの通知：`threads_user_id`で探すので、未接続には当たらない。
- **理由**：今の守りの多くが`connected`の絞り込みか接続の行の有無に乗っているので、足す所は「案内の種類」だけで済む。

## R6.未接続の間の画面

- **決定**：
  - ホーム：未接続なら一番上に控えめな帯（`NotConnectedBanner`）。オーナーには「Threadsにつなぐ」（`/accounts/:id/settings#threads`）。「次にやること」は、承認済みの案が1件以上（`GET /post-drafts/counts`の`approved`）で未接続なら、ほかより先に「Threadsにつないで自動投稿を始めましょう」にする（Clarifications 2026-10-14）。
  - 自動投稿（「このアカウントの設定」の投稿の時刻の区分`PostingScheduleSection`と、投稿ストックの`AutoPostNotices`・`NextPostCard`）：未接続なら「Threadsにつなぐと使えます」（`NotConnectedNotice`）を出す。時刻の入力は出し、オンのスイッチは使えなくする。
  - パフォーマンス（`/accounts/:id/performance`）：未接続なら、中身の代わりに`NotConnectedNotice`。
  - 要再接続のバナー（`account-layout.tsx`）・`ReconnectButton`・「接続し直す」・権限の案内は、`not_connected`では出さない（spec FR-036）。`ConnectionBadge`に「未接続」を足す。
  - 「このアカウントの設定」の「Threadsとの接続」：未接続なら「未接続」と、2つの方法（`ConnectMethods`：「Threadsで許可する」のボタンと、開くと出る`TokenConnectForm`）。今の`ReconnectDialog`の中身を、未接続のときは区分の中にそのまま出す形にする（010の見せ方を使い回す）。つないだ直後は「つながりました」と「自動投稿を始める」（Clarifications 2026-10-14）。
- **理由**：つなぐ入口を設定の1か所に集め、ホーム・自動投稿・パフォーマンスはそこへ案内するだけにする。

## R7.チームとの関係

- **決定**：
  - `assertOwnFreeAccounts`（チームを作る・入る・アカウントを足すの1か所。`invite-service.ts`）で、`not_connected`のアカウントを`ACCOUNT_NOT_CONNECTED`（409）で拒む（spec FR-050・FR-052）。
  - 招待の確認（`GET /api/invites/:token`）の`viewer.status`に`needs_connection`（アカウントはあるが、つないだものがない）を足す。`accounts`の各行に`connected`（真偽）と`name`を足し、画面は未接続を「Threadsにつなぐと入れられます」と選べない形で出す（spec US7-1・US7-2）。`needs_connection`のとき、画面は最初の未接続のアカウントの「Threadsとの接続」へ案内し、招待のリンクを覚えておく（011の`rememberInviteReturn`）。つないだ後の設定の画面で、覚えたリンクへ戻す。
  - 「チームを作る」のダイアログ（`CreateTeamDialog`）も、未接続のアカウントを選べなくし、つないだアカウントがなければ案内を出す（spec FR-051）。
  - チームのAPIの応答（メンバーの行のアカウント・担当の表・招待の選べるアカウント）に`name`を足す。`username`は`NULL`になりうる型にする（チームのアカウントは、つないだものだけなので、実際には`NULL`にならない）。
- **理由**：011の「1人1Threadsアカウント」をデータの入口1か所で守る（Constitution原則IV・V）。

## R8.今の画面・URLの片付け

- **決定**：
  - `/accounts/new`は「アカウントを作る」の画面（`AccountCreate`）にする（URLは残す。古いブックマーク・招待の`?next=`もそのまま使える。spec US6-4）。アカウントが0件なら、サイドバーのない1カラム（今のまま）。
  - 切り替えメニューの「Threadsアカウントを追加」を「アカウントを作る」にする。
  - `connected=new`の知らせ（`callback-result.ts`）と、ホームで招待へ戻す処理（011 T019）を、`connected=connect`（設定の画面）に移す。
  - 削除の確認：本文を`{ confirmName }`にし、前後の空白を除いたアカウントの名前と完全に一致するかで確かめる（spec FR-043）。未接続なら、トークンの注意を出さない。
  - 010の「自分のMetaアプリのトークンで追加する」（追加の画面の2つ目の方法）は、設定の「Threadsとの接続」の2つ目の方法になる。手順のページ（`/guide/threads-token`）の「追加の画面で」の文言を直す。
- **E2E**：`onboarding.spec.ts`を「名前で作る → 戦略 → 案の登録 → 承認 → 設定でつなぐ（トークン）」に書き直す。`token.spec.ts`・`reconnect-delete.spec.ts`・`team-flow.ts`は、作ってからつなぐ形にする。Threadsへの接続は、今と同じくE2E用のThreadsのスタブ（トークン）で行う。

## R9.文書の直し（spec FR-060）

- **決定**：001 spec FR-005・FR-018、010 spec FR-001・FR-013、011 spec FR-014に「012で改めた」の注を足す。PRD §4.1 FR-1（最初の画面）・FR-2（登録の流れ）と§2のUJ-1のPathを直す。docs/next-features.mdの「B」を消し（012のspecに移したため）、順番の表を更新する。Constitutionは変えない（原則IV「チームの人になれるのは、自分のThreadsアカウントを1つ以上チームに入れた人」は、未接続を入れない本featureと合う）。
