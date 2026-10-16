# Research：決済＋退会

**Feature**：[spec.md](./spec.md) | **計画**：[plan.md](./plan.md) | **日付**：2026-10-15

Phase 0の調べと決めたこと。各項目は「決定・理由・ほかの案」の順。

## R1.使える状態の判定（1つの純粋な関数）

**決定**：`packages/shared/src/billing.ts`に`entitlementOf(input)`を置き、利用者の使える状態をここだけで決める。入力は、決済のモード（ON/OFF）、料金なしの印、登録日時、契約（状態・今の期間の終わり・解約の予約）、今の時刻。出力は次の表のとおり。

| 条件（上から順に見る） | 状態（`state`） | すべて使える | 読むだけの理由（`reason`） | アカウントの上限 |
|---|---|---|---|---|
| 決済がOFF | `billing_disabled` | ○ | — | なし |
| 料金なしの印 | `exempt` | ○ | — | なし |
| 契約が`trialing` | `subscribed_trial` | ○ | — | なし |
| 契約が`active`で解約の予約あり | `canceling` | ○ | — | なし |
| 契約が`active` | `active` | ○ | — | なし |
| 契約が`past_due`・`unpaid`・`paused` | `read_only` | × | `payment_failed` | 0（作れない） |
| 無料体験中（登録から1か月。002の`trialEndsAt`） | `trial` | ○ | — | 1 |
| 契約が`canceled`（一度契約した） | `read_only` | × | `canceled` | 0 |
| それ以外（契約なし・`incomplete`・`incomplete_expired`） | `read_only` | × | `trial_ended` | 0 |

- 支払いの失敗は、無料体験の期間より先に見る（Clarifications：すぐに読むだけ）。
- `incomplete`（最初の支払いが済んでいない）は「契約なし」と同じに扱う。無料体験中なら`trial`のまま。
- 画面・API・定期処理のすべてがこの関数を使う。SQLに同じ条件を書き写さない（書き写すと2か所がずれる）。

**理由**：Constitution原則V（判定を1か所に）。表をそのままテスト（`billing.test.ts`）にできる。

**ほかの案**：DBのビュー・SQLの式で判定する案は、定期処理の絞り込みが速いが、TypeScriptの判定と2か所になるので採らない。利用者の数が少ない（Constitutionの運用コスト制約の前提）ので、候補を読んでから関数で絞れば足りる。

## R2.判定に足す場所（`authorizeAccount`）と新しい権限`remove`

**決定**：
- `authorizeAccount`（`apps/api/src/services/access.ts`）の1回の問い合わせに、オーナーの`users.billing_exempt`と`subscriptions`の行を左結合で足し、R1の関数でオーナーの状態を求める。オーナーが読むだけなら、関わり（オーナー・担当・見せてもらっている）から求めた権限を、`READ_ONLY_PERMISSIONS = {read, view, activity, remove}`との共通部分に絞る。
- 新しい権限`remove`（アカウントの削除。オーナーだけ）を足す。今`DELETE /api/accounts/:id`は`owner`の権限を見ているので`remove`に変える。`owner`の権限（Threadsとの接続・名前の変更）は読むだけで外れる（FR-040・FR-042）。
- 絞った結果で権限が足りなくなったときは、`ROLE_FORBIDDEN`ではなく`403 BILLING_REQUIRED`を返す（details：`reason`。オーナー以外には`owner_inactive`だけを返し、支払いの詳細を出さない。FR-045）。
- 判定する人の型`RequestUser`を`{ id: string; billing: BillingMode }`にする。`BillingMode`は環境の`BILLING_ENABLED`から作る値で、認証のミドルウェアが`c.get("user")`に入れる。ルートは今のまま`c.get("user")`を渡すので書き換えが要らない。サービスの中で`{ id: userId }`を作っている所（`deleteAccount`・`completeConnection`・`createAccount`など）は、型の誤りとして見つかるので、モードを受け取る形に直す。
- 画面の出し分けのため、`GET /api/accounts/:id/access`の応答に`readOnly: { reason } | null`を足す。

**理由**：Constitution原則Vの「決済による利用の制限は、この判定に足す形で入れる」。002の`requireGrowerAccess`（書き込みの前に別に呼ぶ）は呼び忘れがありうるが、権限の集合を絞れば、すべてのAPIが今の`authorizeAccount`の呼び出しのまま守られる。

**ほかの案**：
- モジュールの変数に決済のモードを入れる案：テストで環境を変えると前のテストの値が残りうるので採らない。
- `authorizeAccount`に引数を足す案：呼び出しが約30か所あり、書き忘れても型で見つからない（省略できる引数になる）ので採らない。

## R3.料金の持ち方

**決定**：
- Stripeの料金（Price）は1つ。月ごと・JPY・段階制（`tiers_mode = graduated`：1件目まで1,000円、2件目から1件500円）・`tax_behavior = inclusive`（税込み）。契約の数（quantity）は`max(オーナーのアカウントの数, 1)`。0件でも1にするので、基本料金は下がらない（spec US4-4）。
- 金額は`packages/shared/src/billing.ts`の`BILLING_BASE_PRICE_JPY = 1000`・`BILLING_EXTRA_PRICE_JPY = 500`に置く。APIは`GET /api/billing`の`prices`と次の請求の見込みをここから出し、Webの「契約と支払い」・アカウントを作る画面は`prices`を使う。利用規約・特定商取引法に基づく表記（ログイン不要の画面）だけは、Webで定数を直接使う。Stripeの料金のIDは環境の`STRIPE_PRICE_ID`で指す。2つの値がそろっているかは、手順書（FR-064）の確認の手順に入れる。
- 次の請求の見込みは、`BASE + EXTRA × (max(n,1) − 1)`で計算する（Stripeの「次の請求書の見込み」を読まない。画面を開くたびの問い合わせを減らす）。
- 適格請求書の登録番号を載せるときは、Stripeの設定に登録番号と10%（内税）の税率を入れ、環境の`STRIPE_TAX_RATE_ID`（任意）を契約の既定の税率にする。アプリの金額は変わらない（spec Assumptions「適格請求書」）。

**理由**：段階制の1つの料金なら、契約の項目が1つで、数を変える操作が1回で済む。2つの料金（基本＋追加）にすると、追加の数が0のときの扱いと、2つの項目をそろえて変える手間が増える。

**ほかの案**：
- 基本料金と追加の料金を別の項目にする案：上の理由で採らない。
- 金額をStripeから毎回読む案：利用規約は法的な表示で、金額を変えるときは告知と規約の改定が要るので、コードの定数と一緒に直す方が漏れない（spec FR-024を、この決定に合わせて直した）。

## R4.契約を作る（Checkout）

**決定**：
- `POST /api/billing/checkout`：利用者の行に鍵をかけ、R1の状態が`subscribed_trial`・`active`・`canceling`・`read_only(payment_failed)`ならCheckoutを作らない（`409 ALREADY_SUBSCRIBED`。支払いの失敗はカスタマーポータルでカードを直す）。
- Stripeの顧客は利用者に1つ。はじめての契約のときに作り（冪等キー`customer-<users.id>`、メタデータに`user_id`）、`subscriptions.stripe_customer_id`に残す。
- 前に作ったCheckoutのセッションが開いていれば、新しいものを作る前に期限切れにする（`POST /v1/checkout/sessions/:id/expire`）。開いているセッションを1つにすれば、2つの画面で両方を終えて契約が2つになることを防げる（FR-022）。それでも2つできたとき（期限切れにする前に終えていた）は、R5の読み直しで古い方を残し、新しい方をすぐに止めてログに残す（返金は運用が手で行う）。
- セッション：`mode = subscription`、`line_items = [{ price: STRIPE_PRICE_ID, quantity: max(n,1) }]`、`locale = ja`、`client_reference_id = users.id`、`success_url = <WEB_ORIGIN>/settings/billing?checkout=success`、`cancel_url = <WEB_ORIGIN>/settings/billing?checkout=canceled`、`subscription_data.proration_behavior = none`。
- **無料体験中の契約（Clarifications）**：Checkoutの`subscription_data.trial_end`は「48時間以上先」でないと受け付けない（[Stripe API：Create a Checkout Session](https://docs.stripe.com/api/checkout/sessions/create)）。無料体験の残りが48時間以上なら`trial_end = trialEndsAt`。残りが48時間未満なら`trial_period_days = 1`（最初の請求は契約から1日後。体験の終わりとのずれは最大1日。spec Edge Casesに足した）。無料体験が終わっていれば試用を付けない（その場で請求。FR-025）。この計算は`checkoutTrialFor(trialEndsAt, now)`として`billing.ts`に置き、テストする。
- 戻ってきたら、Webが`POST /api/billing/sync`を呼び、APIがStripeから今の契約を読み直す（R5の同期と同じ処理）。Webhookを待たずに10秒以内に「契約中」を出す（FR-023・SC-002）。

**理由**：Constitutionの技術スタック制約（Stripe Billing + Checkout）。カードの情報をアプリで持たない（spec FR-021）。

**ほかの案**：アプリ内でカードを入れる（Stripe Elements）：画面とテストが増え、カードの扱いの責任が大きくなるので採らない。

## R5.契約の状態の反映（知らせ・読み直し・Stripeとのつなぎ方）

**決定**：
- **読み直しを正とする**：Webhookで受けた知らせの中身は使わず、知らせの顧客について、Stripeから今の契約を読み直して`subscriptions`に書く（`syncCustomer(customerId)`）。同じ知らせが2回届いても、順番が入れ替わっても、最後に書かれるのはStripeの今の状態になる（FR-035・SC-006）。
- **古い読み直しで上書きしない**：読み直した時刻を`stripe_synced_at`に残し、更新は`WHERE stripe_synced_at IS NULL OR stripe_synced_at < 今回の時刻`のときだけ行う（同時の2つの読み直しで、先に読んだ方が後から書いても上書きしない）。
- **知らせの記録は持たない**：上の2つで冪等になるので、知らせのIDの表は作らない（spec Key Entitiesを、この決定に合わせて直した）。
- **受ける知らせ**：`checkout.session.completed`、`customer.subscription.created`・`updated`・`deleted`・`paused`・`resumed`、`invoice.paid`、`invoice.payment_failed`。どれも`syncCustomer`を呼ぶだけ。知らない顧客（退会した人など）は200を返して何もしない（FR-056）。
- **署名の確認**：`POST /api/stripe/webhook`は認証のミドルウェアを通さず、`Stripe-Signature`（`t=…,v1=…`）を`STRIPE_WEBHOOK_SECRET`のHMAC-SHA256（WebCrypto）で確かめる。時刻の差は5分まで。比べるのは一定時間の比較。合わなければ400を返し、本文をログに出さない。
- **日に1回の合わせ直し**（FR-036）：日次の処理に「契約の合わせ直し」を足し、`subscriptions`のうち終わっていないもの（`canceled`・`incomplete_expired`以外）と、数の合わせ直しが要るもの（R6）を読み直す。
- **Stripeとのつなぎ方**：公式のSDK（`stripe`）は使わず、`fetch`の薄いクライアント（`apps/api/src/lib/stripe-client.ts`）を作る。使うのは、顧客を作る、Checkoutのセッションを作る・期限切れにする、カスタマーポータルのセッションを作る、顧客の契約の一覧、契約の数を変える、契約を止める、の7つだけ。要求は`application/x-www-form-urlencoded`、`Stripe-Version`を固定する。接続先は`STRIPE_API_BASE_URL`（既定`https://api.stripe.com`）で、テストと手元では偽のStripe（`apps/api/test/fake-stripe/`。偽のThreadsと同じ形）につなぐ。

**理由**：Workersの無料プランは、スクリプトの大きさとCPU時間に上限がある。使う機能が少ないので、SDKを入れるより小さく、偽のサーバーでテストしやすい（001〜012の偽のThreadsと同じやり方）。

**ほかの案**：
- 公式のSDK：Workersでも動くが、7つの呼び出しのためにはスクリプトが大きく、テストではSDKの中の通信を偽にする手間がかかるので採らない。
- 知らせの中身をそのまま反映する案：順番の入れ替わりで古い状態に戻りうるので採らない。

## R6.アカウントの数を請求に反映する

**決定**：
- アカウントを作る・削除するトランザクションの中で、その利用者の`subscriptions.quantity_sync_needed = true`にする（契約がなければ何もしない）。
- トランザクションの後で、すぐにStripeの契約の数を`max(n,1)`に変える（`proration_behavior = none`。今の期間の請求・返金を作らない。FR-030）。成功したら`quantity`を書き、`quantity_sync_needed = false`にする。失敗してもアカウントの作成・削除は成功のまま返し、ログに残す。
- 日次の処理で、`quantity_sync_needed = true`の行をもう一度合わせる（R5の合わせ直しと同じ回）。
- 2件目以降を作る前の「1件につき月500円」の確認（FR-031）は画面で出し、APIは止めない（作ることは利用者の操作で、請求は次の回）。

**理由**：Stripeへの問い合わせをDBのトランザクションの中で待たない（Neonの接続を長く持たない）。印を同じトランザクションで残すので、Stripeに届かなかった分を取りこぼさない。

**ほかの案**：5分ごとの自動投稿のCronで合わせ直す案：自動投稿の関所（KV）は「用のない回はDBに触れない」ための仕組みで、別の用事を足すと関所の意味が薄れるので採らない。ずれは最大1日（spec Edge Casesに書いた）。

## R7.カスタマーポータルと支払いの失敗

**決定**：
- `POST /api/billing/portal`で、カスタマーポータルのセッションを作り、URLを返す（`return_url = <WEB_ORIGIN>/settings/billing`）。顧客がなければ`409 NO_SUBSCRIPTION`。
- ポータルの設定（Stripeの画面で行い、手順書に書く。任意で`STRIPE_PORTAL_CONFIGURATION_ID`）：支払い方法の変更・請求書と領収書の履歴・解約（期間の終わりに。理由のアンケートは任意）・解約の取り消しを許す。数の変更・料金の変更は許さない（数はアプリが決める）。
- 支払いの失敗：Stripeの契約が`past_due`になったら、R1のとおりすぐに読むだけにする。Stripeの支払いのやり直し（Smart Retries）は続け、払えれば`active`に戻り、すぐに戻る。やり直しがすべて失敗したら契約を止める（Stripeの設定。手順書に書く）。止まった後は`canceled`の読むだけ。
- Stripeのメール（領収書・支払いの失敗・カードの期限切れ）をStripeの設定でオンにする（spec Assumptions「お知らせのメール」）。

**理由**：カードの変更・解約・領収書は、Stripeの画面に任せれば、アプリの画面とテストが要らない（spec Assumptions「決済の仕組み」）。

## R8.読むだけの間の自動投稿とパフォーマンスの取得

**決定**：
- **自動投稿**（`auto-post-runner.ts`）：「2.時刻の処理」で読む設定の一覧に、オーナーの`users`と`subscriptions`を結合して読み、R1の関数で読むだけのオーナーのものを外す（未接続のアカウントを外している所と同じ。試み（飛ばした記録）も作らない）。時刻の処理の確定（`skipReasonOf`、トランザクションの中）でもう一度確かめ、読むだけなら新しい飛ばす理由`billing_inactive`にする（一覧を読んだ後に読むだけになった場合）。
- **やり直し待ち**（`retry_wait`）：やり直す前に同じ確認をし、読むだけなら投稿せずに失敗として終える（すでに投稿の結果を確かめている途中`in_progress`のものは、Threadsに出ているかもしれないので、結果の確認だけは続ける）。
- **戻ったとき**：承認済みの案と予約はそのまま。次の時刻から動き、止まっていた間の時刻はまとめて投稿しない（005 FR-011。60分を過ぎた時刻は飛ばす）。
- **パフォーマンスの取得**（`metrics-runner.ts`）：今の`hasGrowerAccess`とプランでの絞り込み（`inArray(accounts.plan, …)`）を、R1の関数に置き換える。
- **トークンの更新**（日次）は続ける（費用がかからず、戻ったときにつなぎ直さずに済む）。
- 自動投稿の関所（KV）は変えない。読むだけのオーナーの設定だけが残っていると、関所は開いたままになるが、1回の問い合わせで終わる。

**理由**：spec FR-041。費用のかかるThreadsへの問い合わせを止め、データは消さない。

## R9.アカウントの数の上限と、チームの入口

**決定**：
- `assertCanAddAccount`（`account-service.ts`）を、プランの上限からR1の状態に置き換える。`read_only`は`403 BILLING_REQUIRED`、`trial`はオーナーのアカウントが1件以上なら`409 ACCOUNT_LIMIT_REACHED`（details：`max = 1`）、それ以外は上限なし。利用者の行の鍵（`lockUserRow`）の中で数えるのは今のまま（同時の作成。001 FR-017）。
- オーナーのアカウントは、未接続のものも数える（012のまま。spec FR-013）。
- チームを作る・参加する入口（`assertOwnFreeAccounts`。011・012）に「その人がすべて使える」を足し、読むだけなら`403 BILLING_REQUIRED`（FR-043）。ほかのチームの操作（`authorizeTeamMember`・`authorizeTeamAdmin`を通るもの）は変えない（FR-044）。「チームに見せる」の切り替えもチームの操作として変えない。
- `GET /api/me`の`accountLimit`を`{ max: number | null, used }`にする（`null`は上限なし）。

## R10.退会の手順

**決定**：`POST /api/me/withdraw { confirmEmail }`。確認の画面のために`GET /api/me/withdrawal-preview`（消えるアカウントの名前、外れるチームと引き継ぎ先（または削除）、契約中か）を作る。手順は次のとおりで、どの段も2回目に走っても結果が同じになる。

1. **受け付け**（トランザクション1）：利用者の行に鍵をかけ、`confirmEmail`を`users.email`と比べる（前後の空白を除き、大文字・小文字を区別しない）。違えば`422 CONFIRMATION_MISMATCH`。合えば`users.withdrawal_requested_at`を今にする（すでにあれば変えない）。
2. **契約を止める**：`subscriptions`に終わっていない契約があれば、Stripeで今すぐ止める（`DELETE /v1/subscriptions/:id`、日割りの返金なし）。すでに止まっている・見つからないは成功とみなす。失敗したら`503 BILLING_UNAVAILABLE`で返し、ここで止める（データは消していない）。
3. **データを消す**（トランザクション2）：利用者の行に鍵をかけ、オーナーのアカウントをIDの順に、1件ずつ`beforeAccountDeleted`（011 FR-046。管理者の引き継ぎ・チームの削除）→ 削除する（関連のデータとThreadsのトークンはON DELETE CASCADEで消える。001 FR-022と同じ）。念のため、まだ管理者のチームが残っていれば同じ引き継ぎを行う（`teams.admin_user_id`はON DELETE RESTRICT）。ほかの人のアカウントの操作の記録で、`actor_user_id`がこの人の行の`actor_name`を「退会した人」に書き換える（FR-053。名前を残さない）。`withdrawn_users`にClerkのユーザーIDを入れ、`users`の行を消す（担当・チームの人・契約の行はON DELETE CASCADEで消える）。
4. **ログインの情報を消す**：Clerkのユーザーを消す（`users.deleteUser`）。見つからないは成功とみなす。成功したら`withdrawn_users.clerk_deleted_at`を今にする。失敗しても退会は成功として返す（日次で続ける）。

- **続きを終わらせる**：2・3の途中で失敗した人は、`withdrawal_requested_at`が残るので、画面でもう一度「退会する」を押せば続きから終わる（FR-054）。押さなくても、日次の処理が`withdrawal_requested_at`から1時間を過ぎた人について2〜4を行う。4だけが残った人（`clerk_deleted_at IS NULL`）も日次で続ける。
- **退会の途中の人**：認証のミドルウェアは、`withdrawal_requested_at`がある人には、退会のAPI（`POST /api/me/withdraw`・プレビュー）と`GET /api/me`以外を`409 WITHDRAWAL_IN_PROGRESS`で止める（途中でデータを足させない）。
- **退会した人のトークン**：Clerkのセッションのトークンは消した後も最大60秒ほど有効なので、その間の要求で`users`の行が作り直されない（JIT作成）よう、ミドルウェアは`withdrawn_users`にあるClerkのユーザーIDを`401 AUTH_REQUIRED`にする。`withdrawn_users`の行は、Clerkを消してから25時間で日次の処理が消す（001のデータ削除の識別子と同じ考え方）。新しくGoogleでログインすると、Clerkのユーザーが新しく作られるので、新しい利用者になる（FR-055）。
- Stripeの顧客は消さない（請求の記録を会計のために残す。spec Assumptions「退会と契約」）。アプリ側の`subscriptions`の行は消えるので、後から届く知らせは「知らない顧客」として無視される（FR-056）。

**理由**：外部（Stripe・Clerk）とDBを1つのトランザクションにできないので、「止めてから消す」の順にし、途中の状態を`withdrawal_requested_at`で表して、何度でもやり直せるようにする。契約を先に止めるので、「データは消えたのに請求が続く」は起きない（spec Edge Cases）。逆の「契約は止まったのにデータが残る」は、途中の失敗で一時的に起こりうるが、日次の処理か利用者の操作で必ず終わる。

**ほかの案**：
- Clerkを先に消す案：Clerkを消した後でDBが失敗すると、利用者はもうログインできず、画面からやり直せないので採らない。
- 退会を受け付けたら日次の処理だけで消す案：spec US5-3（押したらすぐ消える）を満たさないので採らない。

## R11.環境の切り替えと料金なしの印

**決定**：
- 環境変数`BILLING_ENABLED`（`"true"`か`"false"`）を必須にする。未設定・ほかの値は設定の誤り（`CONFIG_ERROR`。今の`validateConfig`の形）。黙ってOFFにしない（FR-063）。
- `BILLING_ENABLED = "true"`のときだけ、`STRIPE_SECRET_KEY`（`sk_(test|live)_`）・`STRIPE_WEBHOOK_SECRET`（`whsec_`）・`STRIPE_PRICE_ID`（`price_`）を必須として確かめる。`STRIPE_API_BASE_URL`・`STRIPE_PORTAL_CONFIGURATION_ID`・`STRIPE_TAX_RATE_ID`は任意。
- 決済がOFFのときは、R1の判定が全員を`billing_disabled`にし、`/api/billing/*`は`GET /api/billing`（`mode = disabled`を返す）以外を`404`にする。Webhookも`404`。契約の行は消さない（FR-061）。
- 環境ごとの値：本番＝`true`＋本番のキー（`sk_live_`）、ステージング＝`true`＋テスト用のキー（`sk_test_`）、手元とPRの確認＝`false`（決済を試すときだけ`true`＋テスト用のキー、またはStripe CLIの転送）。テストの既定は`false`で、決済のテストだけ`true`と偽のStripeを使う。
- 料金なしの印は`users.billing_exempt`（真偽）。運用のスクリプト`pnpm --filter api admin:set-billing-exempt <email> on|off`で付け・外す。付けるときに終わっていない契約があれば、警告を出して止める（`--force`で付ける。FR-062）。今の`admin:set-plan`（`scripts/set-plan.ts`）は消す。
- `apps/api/wrangler.toml`の`[env.staging]`・`[env.production]`とデプロイの仕組みは、このfeatureでは作らない（spec Assumptions「環境とデプロイ」）。手順書（`docs/external-services-setup.md`）に、環境ごとの値の表と、Stripeの準備（料金・Webhookの宛先と知らせの種類・ポータル・Smart Retries・メール・適格請求書）を書く（FR-064）。

**理由**：決済のON/OFFをコードではなく環境で切り替える（notes.md §1）。ONなのに鍵がない環境を、起動の確認で見つける。

## R12.旧プランを外す

**決定**：次を消し、R1・R2・R9に置き換える（FR-004）。
- DB：`accounts.plan`の列と、列挙型`account_plan`。
- 共通：`packages/shared/src/plans.ts`（`PLANS`・`limitFor`・`highestPlan`・`limitForOwnedPlans`・`initialPlanFor`）、`access.ts`の`hasGrowerAccess`（`trialEndsAt`・`isInTrial`は`billing.ts`に移して残す）、そのテスト。
- API：`services/grower-access.ts`（`canEditProfile`・`requireGrowerAccess`）とその呼び出し（戦略・宣伝内容・リサーチ・プロンプト）。書き込みは`authorizeAccount`の権限で守られる（R2）。`profile-status.ts`の`access`は、R1の結果から作る。`ownedPlans`・`accountLimitFor`の書き換え。`scripts/set-plan.ts`。
- エラー：`GROWER_FEATURE_REQUIRED`を`BILLING_REQUIRED`に置き換える。
- Web：`GrowerRequiredNotice.tsx`（「プラン2以上で使えます」「運営者にお問い合わせください」）を、読むだけの帯とダイアログ（R13）に置き換える。
- テストの準備（`test/helpers`）の`plan`の指定を外す。

**理由**：PRD FR-12（2026-10-08）で、機能ごとの出し分けをやめ、「契約中か無料体験中ならすべて使える」にした。

## R13.画面

**決定**（細部は[contracts/ui-routes.md](./contracts/ui-routes.md)）：
- 「アプリ全体の設定」に「契約と支払い」（`/settings/billing`、`sections.ts`に1行）を足す。
- 帯は2つ：(1) 無料体験の終わりの7日前からの帯（アプリ全体、閉じたらその日は出さない。閉じた日は`localStorage`に、読めなければ毎回出す）、(2) 読むだけのアカウントの帯（そのアカウントの画面の上）。今の`GrowerRequiredBanner`の場所に置く。
- 書き込みのボタンは、今の権限による出し分け（`useAccountAccess().can`）のまま。読むだけの間は権限が絞られて返るので、ボタンは押せない形になる。保存の途中で`403 BILLING_REQUIRED`を受けたら、`GrowerRequiredDialog`に代わるダイアログを出す（入力は残す）。
- 「アカウントを作る」（012）：無料体験中で1件あるときの上限の案内、読むだけのときの「契約する」、契約中の2件目以降の料金の確認。
- 退会：「設定 > アカウント」の下に「退会する」。確認のダイアログ（消えるもの・チーム・契約・メールアドレスの入力）。終わったらログアウトして入口の画面に「退会しました」。
- 規約：利用規約（`terms.tsx`）に料金・解約などの節を足し、特定商取引法に基づく表記（`/legal/commerce`、ログイン不要）を足す。入口の画面の下と「契約と支払い」から、利用規約といっしょにリンクする。

## R14.文書の更新

**決定**：実装の前に次を直す（Constitutionの開発ワークフロー）。
- PRD：§4.6 FR-12（読むだけ・無料体験中の上限・支払いの失敗・退会を確定した値にする）、§9 Assumptions Index、Glossary「grower機能」。
- 001・002のspec：プランと上限の記述に「013で置き換えた」を足す。
- `docs/ui-design.md`：設定の項目に「契約と支払い」、帯の種類。
- `docs/external-services-setup.md`：Stripeの準備と環境ごとの値（R11）。
- Constitutionは変えない（原則IV・Vと技術スタック制約のとおりに作る。カスタマーポータルはStripe Billingの一部）。
