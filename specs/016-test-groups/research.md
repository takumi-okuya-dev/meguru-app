# Research：テスト用のグループ

**Feature**：[spec.md](./spec.md) | **計画**：[plan.md](./plan.md) | **日付**：2026-10-31

Phase 0の調べと決めたこと。各項目は「決定・理由・ほかの案」の順。ユーザーは就寝中で、spec.mdのClarificationsとリポジトリの慣習に沿って決めた（起きてから見直せるよう、ほかの案を残す）。

## R1. ON/OFFの設定と、運営者の決め方

**決定**：
- 環境の変数`TEST_GROUPS_ENABLED`（`"true"`か`"false"`。必須）で切り替える。`BILLING_ENABLED`（013 R11）と同じく、未設定や列挙外の値を黙ってOFFにせず、設定の誤り（`CONFIG_ERROR`）にする。値は`wrangler.toml`の`[env.staging.vars]`で`"true"`、`[env.production.vars]`で`"false"`、手元（`.dev.vars`）とテストは`"false"`（016のテストだけ`"true"`）。
- 運営者は変数`OPERATOR_CLERK_USER_IDS`（ClerkのユーザーIDのカンマ区切り。任意）で決める。秘密ではないが、個人のIDをリポジトリに置かないため、`wrangler secret put`で入れる（デプロイで消えない）。空なら運営者はいない（管理の画面を誰も開けない。グループの判定は働く）。
- 判定は`testGroupsModeOf(env)`の1か所で作り、決済のモード（`BillingMode`）に`testGroups`として載せる（R4）。

**理由**：015の「環境の違いはコードの分岐でなく設定に置く」。運営者をメールアドレスでなくClerkのIDで決めるのは、Googleのアカウントのメールアドレスは変えられ、同じアドレスの利用者が2人いる場合（013の`set-billing-exempt`の`ambiguous`）もあるため。

**ほかの案**：運営者をDBの列（`users.is_operator`）にする案は、最初の1人を入れる手段（SQLを直接打つ）が要り、画面から運営者を増やす仕組みはspecの範囲外なので採らない。

## R2. 「テスト環境に入れる人」の判定と、前からいた人

**決定**：
- `users.signed_up_open`（真偽。既定true）を足す。利用者の行を作るとき（認証のミドルウェアのJITの作成）に、**グループの仕組みがOFFなら true**、ONなら false で作る。既定が true なので、今いる利用者の行と、列を足してから新しいAPIに替わるまでの間に古いAPIが作った行は true になる。
- 入れる人＝`signed_up_open`が true、または閉じていないグループに入っている人、または運営者（R1）。
- SQLの条件`testAccessSql(u)`（`u`は`users`の表か別名）を1つ作り、認証のミドルウェア・定期処理・権限の判定のすべてで使う。

**理由**：FR-007（機能が出た時点でいた人を締め出さない）とFR-016（OFFからONに戻したとき、その時点で使っていた人を締め出さない）を、1つの列で満たせる。OFFの間に登録した人は true で作られるので、ONに戻しても入れる。本番（OFF）の利用者は全員 true になるので、本番を将来ONにしても、その時点の利用者は締め出されない。

**ほかの案**：
- ONにした時刻を変数で持ち、`users.created_at`と比べる案：OFF→ON→OFF→ONの往復で、間の人の扱いが崩れる。
- 前からいた人を「既存の人」というグループに入れる案：上限・閉じるなどの操作が既存の人にも効いてしまい、締め出す危険がある。

## R3. グループに入る・外れる（人数の上限と同時の参加）

**決定**：
- 参加は`POST /api/test-invites/:token/join`。トランザクションの中で、グループの行に`FOR UPDATE`の鍵をかけてから、閉じていないこと・人数が上限より少ないことを確かめ、`test_group_members`に1行入れる。同時に押しても、鍵で直列になり上限を超えない（FR-005、SC-002）。
- 1人1グループは`test_group_members.user_id`の主キーで守る（FR-008）。すでに入っていれば`409 TEST_GROUP_ALREADY_MEMBER`（details：入っているグループ名）。
- `test_group_members`は**今入っている人だけ**の表にする。外す・閉じるときは行を消す（入っていた記録は`test_group_events`に残る。R6）。こうすると、外された人・閉じたグループの人が、別のグループに入り直せる（spec Edge Cases）。
- 閉じたグループは`test_groups.closed_at`を入れ、招待リンクは使えなくする（`404 TEST_INVITE_INVALID`）。閉じたグループは開き直さない（新しく作る）。
- 退会（013）で`users`の行が消えると、`test_group_members`の行も消える（外部キーのcascade）。人数は自然に1減る。

**理由**：チームの招待（011の`acceptTeamInvite`）と同じ形で、すでにテストで確かめた鍵のかけ方を使える。

**ほかの案**：行を消さずに`removed_at`を入れる案は、1人1グループの一意の索引を部分索引にする必要があり、数え方も複雑になる。履歴は`test_group_events`で足りる。

## R4. 自動投稿・反応の取り込みを止める（FR-014）と、判定の場所

**決定**：
- 決済のモード`BillingMode`に`testGroups?: boolean`を足す（`billingModeOf(env)`が`TEST_GROUPS_ENABLED`も読む）。モードはすでに認証のミドルウェア・定期処理・権限の判定（`authorizeAccount`）に渡っているので、呼び出しの形を変えずに届く。
- `entitlementFromFacts(mode, facts)`の入力`BillingFacts`に`testAccess?: boolean`を足す。`mode.testGroups`がtrueで`testAccess`がfalseなら、使える状態を`read_only`（理由`test_access`。アカウントの上限0）にする。`fullAccessSql(mode, now)`にも同じ条件（`testAccessSql(users)`）をANDで足す。
- 使える状態を読む5か所（`loadEntitlement`・`loadOwnerEntitlement`・`authorizeAccount`・自動投稿の候補・反応の取り込みの候補）は、行と一緒に`testAccess`を読む。こうすると、013で作った「オーナーが読むだけなら、自動投稿・反応の取り込みを止め、`billing_inactive`で飛ばす」の仕組み（013 R8）が、そのまま入れない人にも効く。
- 理由`test_access`は共通の型`ReadOnlyReason`に足し、画面の文言を足す（見せてもらっている人・担当の人がそのアカウントを開いたとき「オーナーがテスト版を使えなくなったため、読むだけです」）。

**理由**：Constitution原則V（判定を1か所に）。013で、決済の制限を`authorizeAccount`と`entitlementOf`に足し、定期処理・API・画面が同じ判定を使う形にした。テスト版に入れないことも「オーナーがすべては使えない」の1つとして足せば、止める場所を新しく作らずに済み、止め忘れがない。`billing-sql-parity.test.ts`（SQLと関数の結果が同じことのテスト）にも、入れる・入れないの行を足して確かめる。

**ほかの案**：自動投稿・反応の取り込みの各所に、別の条件「オーナーが入れる人か」を足す案は、4か所に同じ条件を書くことになり、013のPR #16のCodexレビューで直した「上限を読むだけの行が埋める」問題も4か所で考え直す必要がある。

## R5. 入れない人を止める場所（すべてのAPI）

**決定**：
- 認証のミドルウェア（`authMiddleware`）で、利用者の行を読むのと同じ問い合わせで`testAccess`（R2の条件）も読む。グループの仕組みがONで、入れる人でなければ、許す経路のほかは`403 TEST_ACCESS_REQUIRED`にする。
- 許す経路：`GET /api/me`（画面が状態を知るため）、`GET /api/me/withdrawal-preview`・`POST /api/me/withdraw`（自分で退会できるように）、`/api/test-invites/*`（参加するため）。退会の途中の扱い（013 R10の`WITHDRAWAL_ALLOWED`）と同じ形の一覧にする。
- `GET /api/me`は`testGroups: { enabled, admitted, operator }`を返す。画面は`admitted`がfalseなら「テスト版は招待された方だけが使えます」を出す。ほかのAPIが`TEST_ACCESS_REQUIRED`を返したときも同じ画面に替える（退会の途中と同じく、`api-client`の1か所で受ける）。

**理由**：FR-006（画面だけでなくすべてのAPIで）。ミドルウェアは全ルートの入口なので、ルートごとの書き忘れがない。

**ほかの案**：Clerkの側で登録を絞る（Allowlist・招待制）案は、015でテストユーザーの段階では置かないと決めた。また、グループの人数の上限はClerkでは数えられない。

## R6. グループの記録（FR-013）

**決定**：`test_group_events`の表に、グループごとの出来事（作った・上限を変えた・名前を変えた・リンクを作り直した・閉じた・入った・外した）を、いつ・誰が・誰を、の形で残す。運営者の管理の画面のグループの詳しい画面に、新しい順に50件まで出す。90日で消すなどの片付けはしない（テスト環境の小さな表）。

**理由**：操作の記録（`activity_logs`、008）はアカウントごとの表で、グループの出来事には合わない。

## R7. 料金なしの印（013）との関係

**決定**：
- 入ったときに`users.billing_exempt`がfalseなら trueにし、`test_group_members.granted_billing_exempt`を trueにする。もともと trueなら触らず、`granted_billing_exempt`は false。
- 外す・閉じる・退会でグループを出るときは、`granted_billing_exempt`が trueの人だけ`billing_exempt`を falseに戻す。
- 運営者が`admin:set-billing-exempt <email> on`で手で付けたときは、その人の`granted_billing_exempt`を falseにする（グループを出ても、手で付けた印は残る。spec Edge Cases）。
- 入るときに契約（Stripe）が続いていても止めない。テスト環境のStripeはテスト用で、実際の請求は起きないため（013の`--force`の確認は本番のための守り）。

**理由**：spec Assumptions「グループから外れたときに外すのは、グループで付いた印だけ」。

## R8. 招待リンク

**決定**：チームの招待リンク（008 R4・011）と同じ作り方にする。32バイトの乱数のbase64urlに、`g_`を付けた文字列（チームは`t_`）。照合はSHA-256のハッシュ、運営者の画面に出すための写しはAES-GCMで暗号化して持つ（AADはグループのID）。URLは`WEB_ORIGIN/test-invite/{token}`。作り直すと前の文字列は使えなくなる。

**理由**：推測できない（FR-002）。平文をDBに置かない。

## R9. 画面

**決定**：
- 招待の画面`/test-invite/:token`は、ログインなしで開ける（チームの招待`/invite/:token`と同じ）。ログインしていなければ、グループ名・注意（料金なし・投稿は本物のThreadsに出る）と「Googleで始める」を出し、ログインのあとこのURLへ戻す（`/sign-in?next=`）。ログインしていれば同じ注意と「参加する」を出す。
- 入れない人の画面は、認証のガード（`RequireAuth`）の中で出す（退会の途中の画面と同じ置き方）。中身は「テスト版は招待された方だけが使えます」・招待のリンクを受け取った人への案内・「ログアウト」。
- 運営者の管理の画面は「設定」の中に「運営」の区分を作り、「テスト用のグループ」を置く（`/settings/test-groups`と`/settings/test-groups/:groupId`）。区分は運営者にだけ出す。スマートフォンの幅でも使える（設定の画面は016より前からスマートフォンに対応している）。

**理由**：「設定」の画面の骨組み（左の一覧・検索・スマートフォンの表示）をそのまま使え、新しいレイアウトを作らずに済む。

**ほかの案**：`/operator/...`の別の画面にする案は、骨組みを1つ作る手間に見合わない。
