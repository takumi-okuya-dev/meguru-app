# Research：チーム運用（008）

Phase 0 の調査と決定。spec の Clarifications（2026-10-09）と、001〜007 の実装を前提にする。

## R1. 役割の持ち方：memberships に partner・editor を足す

- **決定**：Constitution原則IVのとおり、役割は`memberships.role`としてAccountごとに持つ。列挙型`membership_role`に`partner`・`editor`を足し、パートナー・編集者がAccountに関わるときは、その人の`memberships`の行を作る。行には、どのチーム経由かを`team_id`で持つ（オーナーはNULL）。チームと手伝いの関係（`teams`・`team_editors`・`account_partners`）は別の表で持ち、`memberships`はそこから作る「アクセスの写し」とする。
- **理由**：
  - 既存の「自分が関わるAccount」の問い合わせ（`/api/me`、要確認の件数、ログイン後の画面）は、`memberships`を見るだけで役割つきで広げられる。
  - 1つのAccountに1人1行（`memberships_user_account_unique`）なので、「同じAccountで役割が重ならない」（spec Edge Cases）がDBの制約で守られる。
  - パートナーを複数にする将来（FR-016）も、`account_partners`の一意の制約を外すだけで済む。
- **代わりの案**：
  - `account_partners`・`editor_assignments`だけを持ち、判定のたびに組み立てる → 判定の問い合わせが複雑になり、`/api/me`などすべての一覧の問い合わせを書き換えることになる。原則IVの文言（`Membership.role`）からも外れる。
  - Clerk Organizations → 原則と技術スタックの制約で使わない（2026-10-08決定）。
- **整合の守り方**：`memberships`のpartner・editorの行は、チームの操作（参加・外す・担当の付け外し・編集者を外す）と同じトランザクションの中でだけ作る・消す。`team_id`の外部キーは`ON DELETE CASCADE`にし、チーム・手伝いの関係が消えれば行も消える。
- 既存の`member`の値は使わない（PostgreSQLの列挙型から値は消せないので残し、コメントで「使わない」と書く）。

## R2. 判定を1か所に集める：`authorizeAccount`

- **決定**：`apps/api/src/services/access.ts`の`findOwnedAccount`を、`authorizeAccount(db, user, accountId, permission)`に置き換える。1回の問い合わせで、Account、自分の`memberships`の行（役割）、オーナー（`users`の行。名前と登録日時）、手伝いの関係（任せる範囲）、「チームがあるか」をまとめて読み、`AccountAccess`を返す。許されなければ`AppError`を投げる。
  - Accountに関わっていない（行がない） → 404 `ACCOUNT_NOT_FOUND`（存在の有無を漏らさない。001から同じ）。
  - 関わっているが、その操作が許されていない → 403 `ROLE_FORBIDDEN`（`details`に必要な権限）。
- 許可の表は`packages/shared/src/permissions.ts`に置き、APIの判定と画面の出し分けの両方で使う（[contracts/permissions.md](./contracts/permissions.md)）。
- チームの判定（`authorizeTeam`・`listTeamAccounts`・`authorizeAssignment`）も同じ`access.ts`に置き、`/api/team/*`と`team-service.ts`・`partner-summary.ts`はそこを通す（[contracts/permissions.md](./contracts/permissions.md)「チームの判定」）。役割による判定がAccountとチームで別々の場所に散らないようにする。
- 既存の59か所の`findOwnedAccount`を、操作に合った権限で`authorizeAccount`に置き換える。置き換えの漏れは、ルートの一覧を役割×権限で全部たたくテスト（SC-002）で見つける。
- **理由**：Constitution原則V（3.0.0）「判定を1か所に集め、すべてのAPIがそこを通す」。009（決済）は、この関数の中に「オーナーが契約中か」を足すだけで済む（FR-080）。
- **代わりの案**：Honoのミドルウェアで`/accounts/:accountId/*`をまとめて判定 → 操作ごとの権限（承認・設定など）はルートごとに違うので、結局ルートの中で2回目の判定が要る。トランザクションの中で読み直したい処理（承認・設定の保存）とも合わない。

## R3. grower機能の判定：オーナーの登録日時で行う

- **決定**：`canEditProfile`・`requireGrowerAccess`（002〜006）は、リクエストした人ではなく、Accountのオーナーの`users.created_at`で無料体験を判定する。`AccountAccess`にオーナーの登録日時を入れて渡す。
- **理由**：今は「操作した人の登録日時」で判定しているため、パートナー・編集者が操作すると、オーナーの状態と違う結果になる。spec の前提「各Accountのオーナーの状態で判定する扱いのまま、パートナー・編集者にも同じ結果を適用する」。009の課金の判定もオーナー単位になる。

## R4. 招待リンク：推測できない文字列。照合はハッシュ、表示は暗号化した写し

- **決定**：
  - 文字列は32バイトの暗号学的乱数をbase64url（43文字）にする。種類を見分けやすいよう、先頭に`p_`（パートナー）・`e_`（編集者）を付ける。
  - DBには、照合用のSHA-256（16進）と、表示用の暗号化した写し（001のトークンと同じ鍵の仕組み`createTokenCipher`、AES-GCM）を持つ。平文では持たない。
  - URLは`{WEB_ORIGIN}/invite/{token}`。
- **理由**：
  - LINEグループのように「いつでも同じリンクを表示・コピーできる」ためには、元の文字列を取り出せる必要がある（ハッシュだけでは表示できない）。
  - リンクを持つ人は参加できるので、DBが漏れたときに使えないよう、平文では持たない。照合はハッシュの完全一致で行う。
- **代わりの案**：平文で保存 → DBが漏れると、パートナー待ちのAccountに入れてしまう。ハッシュだけ → 再表示できず、表示のたびに作り直すことになり、「常設リンク」にならない。
- **作り直し・取り消し**：行の文字列を差し替える（パートナーの招待は行を消す）。前の文字列は照合に一致しなくなる。理由ごとの履歴は持たず、使えないリンクには「作り直された・取り消された・すでにパートナーが参加しているなど」をまとめた案内を出す（FR-017）。参加済みの人が同じAccountのリンクを開いた場合は、参加済みとして案内する。
- **確認画面の情報**：`GET /api/invites/:token`はログインなしで読める（FR-013）。返すのは、Accountの表示名・@ユーザー名・アイコン、招いた人の名前、チーム名、種類だけ。文字列は256ビットなので、総当たりで当てることはできない。

## R5. QRコード：ブラウザで作る（`uqr`）

- **決定**：Webに`uqr`（MIT、依存なし、数KB）を足し、招待リンクのQRコードをSVGで作る（`renderSVG`）。APIは関わらない。
- **理由**：Workersの無料プランのCPU時間を使わない。表示のたびにブラウザで作るので、保存しない。
- **代わりの案**：`qrcode`（依存が多く、サイズが大きい）。自前の実装（誤り訂正の実装が大きい）。
- 実装時に、`uqr`の最新版の書き出しの関数名と、生成したSVGの見た目（余白・色）を確かめる。暗いテーマでも白地に黒で出す（読み取れるように）。
- 確かめた結果（2026-10-10）：`uqr@0.1.3`。書き出しは`encode`・`renderSVG`ほか。`renderSVG`はSVGの文字列を返すため、HTMLとして流し込まずに済むよう、`encode(text).data`（`boolean[][]`、余白込み）からReactで`<rect>`を並べて描く。

## R6. 共有：端末の共有機能（Web Share API）

- **決定**：`navigator.share`があるとき（主にスマートフォン）だけ「送る」を出し、`{ title, text, url }`を渡す。ないとき（多くのPCのブラウザ）は「コピー」だけにする。コピーは`navigator.clipboard.writeText`、失敗したら入力欄を選択状態にして手でコピーしてもらう。

## R7. 参加の流れとログイン

- **決定**：`/invite/:token`は、ログインしていなくても開ける画面（`RequireAuth`の外）。「参加する」を押すと、ログインしていなければClerkのサインインに進み、戻り先を`/invite/:token`にする。戻ったら確認画面を出し直し、もう一度「参加する」で参加する（自動では参加しない。誰として参加するかを見せるため）。
- 「別のGoogleアカウント」は、ログアウトしてから同じ戻り先でサインインに進む。
- 参加（`POST /api/invites/:token/accept`）は1つのトランザクションで行う：
  - パートナー：招待の行を`FOR UPDATE`で取り、Accountにパートナーがいないこと、自分がそのAccountの関係者でないことを確かめ、チームがなければ作り（チーム名つき）、`account_partners`と`memberships`（partner）を作り、招待の行を消す。
  - 編集者：チームの行を`FOR UPDATE`で取り、人数（10人）と、自分がそのチームのパートナー・編集者でないことを確かめ、`team_editors`を作る。担当は付けない（FR-022）。
- 同時の参加は、行の鍵で1人ずつ処理されるので、パートナーは1人、編集者は10人を超えない（spec Edge Cases）。

## R8. 保存の衝突：既存の STALE_UPDATE に「誰が」を足す

- **決定**：002〜006の保存は、すでに`version`（または`updated_at`）で衝突を見つけて409 `STALE_UPDATE`と最新の値を返し、Webは`ConflictDialog`で「読み込み直す／上書きする」を選ばせている。本featureでは次を足す。
  - 保存した人を残す列`updated_by_user_id`を、衝突を見つけている表（`strategy_designs`・`promotions`・`reference_posts`・`research_keywords`・`post_drafts`（`edited_by_user_id`）・`posting_schedules`・`accounts`（投稿のルールの`core_rules_updated_by_user_id`））に足す。
  - 409の応答に`updatedBy: { name } | null`を足し、`ConflictDialog`に「（名前）さんが先に保存しました」と出す（名前がなければ今の文言）。
  - 衝突を見つけていない改善メモ（006）に`version`を足し、同じ扱いにする。
- **理由**：仕組みはすでにあり、足りないのは「誰が」だけ。個人運用の画面の見た目は、名前が自分になるだけで変わらない（FR-006）。
- 一覧から1件ずつ消す操作（NGワード、投稿の案の削除）は、衝突ではなく「すでに消えている」として扱う（今のまま）。

## R9. 操作の記録：同じトランザクションで書き、90日で消す

- **決定**：
  - 表`activity_logs`を足す。記録はその操作と同じトランザクションの中で書く（操作だけ成功して記録が欠けることをなくす。SC-006）。
    - 実装時の補足（2026-10-10）：承認の操作・投稿の案の登録・編集・削除・NGワード・メンバーの操作は、同じトランザクションで書く。戦略・宣伝内容・リサーチ・宣伝の割合・プロンプトの件数・改善メモ・投稿のルール・投稿のスケジュール・接続を確かめる、は既存の実装が1回の書き込みで行っているため、書き込みの直後に同じ接続で記録を書く（記録の書き込みだけが失敗した場合に1行欠けうる）。
  - 書くのは「チームがあるAccount」のときだけ。`AccountAccess.hasTeam`（パートナーがいる、または編集者の`memberships`がある）で決める。
  - まとめての操作は1行（`item_count`と、対象の書き出しを最大50件まで`details`に入れる。FR-050a）。004のまとめての操作は500件ずつの要求に分かれるので、要求1回で1行になる（同じ`requestId`の再試行では書かない）。
  - 削除は、約5秒の取り消しの猶予（003）の後にWebが送る削除の要求のときに書く（猶予の間に取り消されたものは書かない）。
  - した人の名前・役割は、その時点の値を写して持つ（後で外されても、記録の名前は残る。FR-054）。
  - 90日を過ぎた行は、日次の処理（`runDailyJobs`、日本時間3:00）で消す。画面の問い合わせも90日以内に絞る（消す前の行を見せない。FR-051）。
- **理由**：DBの容量はわずか（1Accountで1日数十行）。Cronを足さずに済む。
- **代わりの案**：別の表への非同期の書き込み → Workersの無料プランで後処理の仕組みがなく、記録が欠けうる。

## R10. 誰が作ったか・直したか

- **決定**：`post_drafts`に`created_by_user_id`・`edited_by_user_id`を足す（`users`への外部キー、`ON DELETE SET NULL`）。直した時刻は006の`body_edited_at`を使う。カードに名前を出すのは「チームがあるAccount」のときだけ（FR-053）。本featureより前の行はNULLで、名前を出さない。

## R11. 一覧・切り替えメニュー・ログイン後の画面

- **決定**：
  - `/api/me`の`accounts`を、`memberships`のすべての役割に広げ、各行に`role`・`ownerName`を足す。並びは「自分のアカウント」（オーナー）→「手伝っているアカウント」の順で、それぞれ007と同じ並び。
  - `accountLimit`（001）は、オーナーとして持つAccountだけで数える（今のまま）。
  - `landingAccountId`は、`users.last_account_id`が開けるAccountならそれ、なければオーナーのAccount（今の順）、なければ手伝っているAccountの最初、なければNULL（FR-045）。
  - 手伝う人がAccountを開いたときは、`users.last_account_id`だけを記録し、`accounts.last_used_at`は変えない（オーナーの切り替えメニューの並びを、手伝う人の操作で動かさない）。
  - `/api/me`に`partnerTeam`（チーム名・担当未定の編集者の数）と`editorWaiting`（担当がなく、自分のAccountもない編集者のときのパートナー名）を足す（FR-026・FR-047）。
  - 要確認の件数（`/api/me/needs-review-counts`）も、関わるすべてのAccountに広げる。

## R12. パートナーのまとめ画面

- **決定**：`GET /api/team/accounts`で、チームが手伝うAccount（`account_partners`）ごとに、要確認件数・承認済み件数・残りの日数・次の投稿（005の`auto-post-status`の計算を使う）・直近7日の判定ごとの件数（006の`post_metrics`の確定日時が7日以内）・任せる範囲・担当の編集者・接続状態を返す。Accountの数ぶんの問い合わせにせず、表ごとにまとめて1回ずつ読む。（実装時の補足 2026-10-10：要確認・承認済み・判定・担当・スケジュールはまとめて1回ずつ読む。次の投稿の時刻だけは、005 の予定の計算（`upcomingSlots`）を、自動投稿がオンで止まっていないAccountごとに呼ぶため、そのAccountの数だけ問い合わせが増える。手伝い先が増えて遅くなったら、予定の計算をまとめて行う形に直す）
- 並びは要確認の多い順（同じなら表示名の順）。
- 手伝い先の上限は置かないが、1回の表示は100件まで（`[ASSUMPTION]`。超えたら「表示しきれません」と出す）。

## R13. スマートフォンの通知の位置（UI全体設計 §11）

- **決定**：`Toaster`（sonner 2.x）の位置を、767px以下では上部中央のまま、上の余白を「ヘッダーの高さ（52px）＋端末のセーフエリア＋8px」にする（`mobileOffset`）。幅は画面の幅から左右16pxずつ引いたもの。ヘッダーの下に出るので、メニュー・画面名・主な操作を隠さない。画面の下部（貼り付け欄・セーフエリア）にも出さない。
- 768px以上は今のまま（上部中央）。
- **確かめ方**：375px・390px幅で、削除の「元に戻す」の通知を出したまま、メニューを開く・画面名を見る・「元に戻す」を押す（Playwrightのテストと、quickstart の手動の確認）。

## R14. 費用と性能

- `authorizeAccount`は、今の`findOwnedAccount`（1回の問い合わせ）を、結合を足した1回の問い合わせに置き換える。往復の回数は増えない。
- 新しいCronは足さない。90日の削除は日次の処理に足す。
- QRコードはブラウザで作る。API・DBへの影響はない。
- 操作の記録の容量：1Accountで1日最大数十行、1行数百バイト。90日で数MB未満。Neon Freeの容量（0.5GB）に収まる。

## R15. 009（決済）への申し送り

- 契約による制限は、`authorizeAccount`の中で「オーナーの契約の状態」を見て、書き込みの権限を外す形で足す（読むだけ）。
- 旧プランの`PLANS`・`accounts.plan`・`limitForOwnedPlans`・`hasGrowerAccess`は、本featureでは触らない。
