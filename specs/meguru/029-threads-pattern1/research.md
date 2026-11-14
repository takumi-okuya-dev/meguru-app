# 調べたことと決めたこと（Research）：029 Threadsをパターン①にそろえる

**日付**：2026-11-12 | **仕様**：[spec.md](./spec.md)

## 今の結びつき（2026-11-12に数えた）

| 何 | 数 | 中身 |
|---|---|---|
| Threadsが共通から読む部品 | 35種類（50ファイル） | 多い順に`AppEnv`20・`accounts`19・`authorizeAccount`18・`recordActivity`14・`AccountAccess`10・`updatedByOf`9・`AccountRow`7・`withActivityTx`7・`effectiveSlotMinutes`5・`memberships`4・`users`4・`effectiveLimits`4 など |
| Threadsの表から共通の表への外部キー | 25本 | ほとんどが`users.id`（作った人・直した人）と`accounts.id` |
| 共通の表とSQLでつないでいるThreadsの処理 | 2か所 | 自動投稿（`publish/auto-post-runner.ts`）と数字の取得（`metrics/metrics-runner.ts`）。持ち主の`users`・`subscriptions`・`memberships`とJOINし、`featureOnSql`・`billingExemptSql`・`fullAccessSql`・`testAccessSql`・`dailyPostLimitSql`で、使えるかをSQLの中で決めている |
| Threadsの中身を読む共通の小分け | 11か所 | `identity/me-routes.ts`・`billing/billing-service.ts`（料金の数を`memberships`から数える）・`features/feature-sql.ts`・`operator/limit-service.ts`・`referrals`・`test-groups`（チームの招待の部品を使う）・`withdrawal`・`access`・`accounts`・`teams`・`activity` |
| 今の知らせ | 5種類 | `accountDeleting`・`userWithdrawing`・`userAccountsDeleted`・`limitsChanged`・`accountOpened`（`platform/hooks.ts`） |
| ThreadsのAPIで、Threadsの道筋の外にあるもの | 約110本 | `/api/accounts/…`77・`/api/teams/…`18・`/api/invites/…`2・`/api/me/needs-review-counts`・`/api/operator/accounts`・`/api/operator/tester-applications/…`・`/api/operator/tester-settings` など。`/api/threads/…`は6本（接続・Metaの通知） |
| `/api/me`を読む画面のファイル | 27 | うちThreadsのデータ（`accounts`・`landingAccountId`・`teams`・`accountLimit`・`threadsAccessMode`・`threadsConnectMethods`）を読むのは11 |

## R1. 持ち主を移すもの・残すもの

- **決定**：次をThreadsへ移す：`accounts`・`memberships`・`teams`・`team_members`・`team_accounts`・`activity_logs`の6表と、権限の判定（`access/`）・アカウント（`accounts/`）・チーム（`teams/`。招待を含む）・活動の記録（`activity/`）の処理と入口。`operator_settings.tester_slot_capacity`はThreadsの設定の表へ移す。共通に残すのは、利用者（`users`・`withdrawn_users`）・契約（`subscriptions`）・機能のON/OFF・上限・テストのグループ・運営の設定と記録・紹介・退会。
- **理由**：spec FR-001・FR-006と、Clarifications（チームはまるごとThreads、`accounts`はThreads）。活動の記録は、アカウントとチームの操作の記録なのでThreadsに置く。
- **招待の部品**：`teams/invite-service.ts`の招待のトークンの部品（`newInviteToken`・`sealInviteToken`・`openInviteToken`・`inviteUrl`）は、テストのグループと紹介も使っている。業務の判断を持たない部品なので、土台（`kernel/invite-token.ts`）へ移し、チームの招待の処理だけをThreadsへ移す。
- **見送った案**：チームを共通に残す（Clarificationsで否決）。`accounts`の番号と名前だけ共通に残す（027の形。料金・権限がまた共通とThreadsにまたがるので否決）。

## R2. 置き場所（スキーマ）

- **決定**：Threadsの表は、Postgresのスキーマ`threads`に置く（Drizzleの`pgSchema("threads")`）。共通の表は今の`public`のまま（名前を変えると、共通の表を読むすべての問い合わせと、手で書いたSQLのマイグレーションのテストを直すことになり、得るものが少ない）。
- **移し方**：`ALTER TABLE … SET SCHEMA threads`で移す。表の中身・索引・制約・Threadsの中の外部キーはそのまま保たれ、データの写しも要らない（テスト環境のデータが残る。spec FR-018）。
- **drizzle-kit**：スキーマの移動は、`drizzle-kit generate`が対話で「移したのか・作ったのか」を聞く。対話のない場では「消して作る」になり、データが消える危険がある。そこで、マイグレーションはまず`generate`で作らせ、**できたSQLに`DROP TABLE`・`CREATE TABLE`がなく、`ALTER TABLE … SET SCHEMA`になっていることを読んで確かめる**。対話が要る場合は、端末を持つ形（`script`コマンドなど）で答えて作る。それでも「消して作る」にしかならないときは、SQLを手で書き（`--custom`）、そのあと`generate`で差がないこと（スナップショットが合うこと）を確かめる。どれでも、[release-runbook.md](../../../docs/release-runbook.md) 3の「できたSQLを読んでからコミットする」を守る。
- **見送った案**：共通の表も`platform`スキーマへ移す（今回の目的に要らない。2作目の様子を見て決める）。別のDBに分ける（spec の範囲外）。

## R3. 外部キーを外したあとの約束

- **決定**：Threadsの表から`users`への外部キー（25本の大半）を外し、列は`uuid`の値として残す。外部キーが保っていた約束は次のように置き換える。
  - 「利用者を消したら、その人のThreadsのデータを消す（`cascade`）」→ 退会の出来事（R5）で、Threadsが自分で消す。
  - 「利用者を消したら、作った人・直した人の欄を空にする（`set null`）」→ 今も利用者の行は消さず、退会は`withdrawn_users`に残す作り（013）なので、行が消える場面は手で消すときだけ。退会の出来事のときに、Threadsが空にする列を空にする。
  - 共通の`operator_events.application_id`からThreadsの`tester_applications`への外部キーも外し、値として残す（[module-map.md](../../../docs/module-map.md) 4章の例外がなくなる）。
- **理由**：spec FR-003・FR-004。`set null`の列は表示のための記録で、空にするのが少し遅れても困らない。

## R4. 共通の入口の関数（アプリが共通に頼むもの）

- **決定**：共通は`platform/index.ts`から、アプリ向けの関数を出す（[contracts/platform-entry.md](./contracts/platform-entry.md)）。アプリは共通の表の定義を読まない。
  - `currentUser(c)`：ログインしている人（番号・メール・名前）。今の`AuthUser`。
  - `loadEntitlement(db, userId, app)`・`loadEntitlements(db, userIds, app)`：利用権。使えるか（すべて・読むだけ・使えない）、料金なしか、運営者か、ONの機能、上限の値。**まとめて読む形を出す**（自動投稿・数字の取得の定期処理で、持ち主の多くの人をまとめて調べるため）。
  - `peopleNames(db, userIds)`：画面に出す名前（今の`personName`）。
  - `reportUsage(db, userId, app, { quantity, using })`：利用の数と利用の状態（R6）。
  - `operatorOnly`：運営者だけの関所（今のまま）。
- **定期処理のJOINの置き換え**：自動投稿と数字の取得は、まずThreadsの表だけで候補（アカウントと持ち主の番号）を読み、持ち主の番号をまとめて`loadEntitlements`に渡し、使える人の分だけを処理する（SQLの中で共通の表とJOINしない）。今の利用者の数（テスト版で数十人）なら、問い合わせが1回増えるだけ。1回の処理で調べる持ち主は、今の上限（1回4件の投稿など）より少ないので、`IN`の長さも問題にならない。
- **見送った案**：Threadsの中に利用権の写し（表）を持ち、出来事で直す（切り出したあとに速いが、写しのずれを直す仕組みが要る。今の規模では要らない。切り出すときに考える）。

## R5. 出来事の仕組み

- **決定**：送り出しの表（outbox）と、受け取りの登録で作る（[contracts/platform-entry.md](./contracts/platform-entry.md) 3）。
  - 共通は、自分の表の変更と同じトランザクションで、`platform_events`に出来事を書く（種類・中身・作った日時）。
  - 組み立て（`app.ts`）で、アプリの受け取りを登録する（`registerConsumer("threads", "user.withdrawn", handler)`）。今の`registerModule`と同じく、何度呼んでも1回だけ。
  - 届けるのは、書いたあと**すぐ**（`ctx.waitUntil`で、応答を返したあとに試す）と、**5分ごとの定期処理**（取りこぼし・失敗のやり直し）。書いてから10分以内に届く（Clarifications）。
  - 受け取りごとに`platform_event_deliveries`に、済んだか・試した回数・次に試す時刻・最後の失敗を残す。失敗したら、間をあけて（1回目5分、以降は倍、最大1時間）やり直す。10回失敗したら「失敗」にして止め、ログに出す（運営者が表とログで調べられる。画面は作らない）。
  - アプリの受け取りは、自分のトランザクションの中で、受け取った出来事の番号を自分の表（`threads.received_events`）に書く。同じ番号がもうあれば何もしない（2回届いても同じ結果。spec SC-004）。
- **理由**：Clarifications（10分以内・Queuesは使わない）。すぐに試すので、ふだんは数秒で届き、上限の変更なども今とほぼ同じ速さで効く。
- **見送った案**：Cloudflare Queues（Clarificationsで否決）。毎日のまとめ処理だけ（遅すぎる）。

## R6. 利用の数と料金

- **決定**：共通に`app_usage`（利用者・アプリ・数・使っているか・直した日時）を置く。Threadsは、アカウントを作る・消す・持ち主が変わる・チームに入る・抜けるたびに、自分のトランザクションが終わったあとで`reportUsage`を呼ぶ。共通は`app_usage`を書き、料金の数が変わったら今の`quantity_sync_needed`の印を付け、今の仕組み（Stripeへ数を合わせる・失敗したら定期処理でやり直す）で合わせる。
  - 料金の数は、今の`countOwned`（持ち主としてのアカウントの数）の代わりに、`app_usage`のThreadsの数を使う。契約を始めるとき（Checkout）も同じ。
  - **PR1とPR2の間**：`app_usage`はPR1のマイグレーションで写すが、Threadsが`reportUsage`を呼ぶのはPR2から。そのため、PR2のマイグレーションで`memberships`から数え直して写し直してから、料金の数を`app_usage`に切り替える（/speckit-analyze G1）。
  - **ずれの防ぎ方**：`reportUsage`が失敗したとき（共通のDBの書き込みの失敗など）に備えて、Threadsは毎日のまとめ処理で、全員の数を数え直して`reportUsage`する（ずれを1日以内に直す）。作った直後に契約の画面を開いても、`reportUsage`はアカウントを作る応答を返す前に呼ぶので、古い数にはならない（spec FR-011）。
  - 「使っているアプリ」（`/api/me`の`apps.using`）は、`app_usage`の`using`から決める（spec FR-024）。Threadsは、自分のアカウントがあるか、チームに入っていれば`using = true`を伝える。
- **見送った案**：共通が料金の数を知りたいときにThreadsを呼ぶ（共通 → アプリの向きになる）。出来事でThreadsから共通へ伝える（アプリ → 共通の出来事の仕組みが別に要る。入口の関数で足りる）。

## R7. 機能のON/OFFと上限の名前

- **決定**：共通の表に**アプリの番号**の列（`app`）を足し、機能と上限は「アプリ・名前」で持つ。名前と意味はアプリが決め、組み立てで共通に登録する（`registerAppFeatures("threads", ["autopost", "strategy", "team"])`・`registerAppLimits("threads", { accounts: …, daily_posts: … })`）。共通のコードからThreadsの名前（`autopost`など）を消す（spec FR-012）。
  - 機能のON/OFF：`feature_disables`・`group_feature_disables`・`feature_setting_events`に`app`（既定`threads`）を足し、主キーに入れる。`feature`の値の`CHECK`（`autopost`・`strategy`・`team`）は、形の`CHECK`（英小文字と`_`）に替え、値は登録の一覧でコードが確かめる。
  - 上限：今の`users.account_limit`・`users.daily_post_limit`・`operator_settings.default_account_limit`・`default_daily_post_limit`を、`user_app_limits`（利用者・アプリ・名前・値）と`app_limit_defaults`（アプリ・名前・値）に写す。古い列は、新しい表を読む版が出たあと（PR5）で消す（[release-runbook.md](../../../docs/release-runbook.md) 3の「列を消すのは2回に分ける」）。
  - 共通の`@meguru/shared`の`FEATURES`は、Threadsの名前なので、`packages/shared/src/apps/threads/`へ移す（[product-structure.md](../../../docs/product-structure.md) 7の「Threads固有のものは移す候補」）。
- **運営者の画面**：見た目と結果は変えない。共通の運営の画面（外枠の`settings/features.tsx`・`limits.tsx`。今はThreadsの名前を直接書いている）は、新しいAPI `GET /api/operator/app-registry`が返す登録の一覧（機能の名前・表示名・説明、上限の名前・表示名・範囲）を出す。今はThreadsだけなので、今と同じ3つと2つ（/speckit-analyze G2）。

## R8. 知らせの置き換え

| 今の知らせ | 置き換え先 |
|---|---|
| `accountDeleting`（アカウントを消す前） | アカウントがThreadsの持ち物になるので、Threadsの中の処理（アカウントを消す関数の中で、テスター招待の取り下げを呼ぶ） |
| `userWithdrawing`（退会でアカウントを消す前） | 出来事`user.withdrawn`。Threadsが受け取り、その人が持ち主のアカウントを消し（テスター招待の片づけを含む）、メンバー・チームの人・担当から外し、作った人・直した人の欄を空にし、`reportUsage(0, false)` |
| `userAccountsDeleted`（退会でアカウントを消したあと） | 同じ`user.withdrawn`の受け取りの中で、Metaのデータ削除の要求を完了にする |
| `limitsChanged`（上限を保存したあと） | 出来事`limits.changed`。Threadsが受け取り、自動投稿を起こす（`notifyWake`） |
| `accountOpened`（アカウントを開いたあと） | アカウントを開くAPIがThreadsへ移るので、Threadsの中の処理 |

- 退会の流れ：今は退会の処理（共通）が、1つのトランザクションでThreadsのアカウントも消している。これからは、共通は契約の解約・利用者の退会の記録・出来事を書くまでで終わり、Threadsのデータは出来事で10分以内に消える。退会した人は共通の関所で止まるので、その間にThreadsのデータに触れることはない（spec Edge Cases）。
- **退会した人のアカウントが消えるまでの間**：出来事が届くまでの最大10分、退会した人が持ち主のアカウントは、チームのほかの人を含めて誰にも見せない。Threadsの権限の判定（`authorizeAccount`）で、持ち主の利用権が`none`で退会の記録があれば、見つからない扱いにする（今は退会で即座に消えるので、見える動きを変えない。/speckit-analyze U1）。
- 退会の前の確かめ（`/api/me/withdrawal-preview`：消えるアカウントの一覧）は、Threadsのデータを含むので、Threadsの`/api/threads/me/withdrawal-preview`に分ける。画面は両方を読む（共通は契約、Threadsは消えるアカウント）。
- `platform/hooks.ts`は消す。

## R9. APIの道筋

- **決定**：ThreadsのAPIは`/api/threads/…`の下に置く（[contracts/api-routes.md](./contracts/api-routes.md)）。`/api/accounts/…` → `/api/threads/accounts/…`、`/api/teams/…` → `/api/threads/teams/…`、`/api/invites/…` → `/api/threads/invites/…`、`/api/me/needs-review-counts` → `/api/threads/me/needs-review-counts`、`/api/operator/accounts`・`tester-applications`・`tester-settings` → `/api/threads/operator/…`。新しく`/api/threads/me`と`/api/threads/me/withdrawal-preview`。
- 今の`/api/threads/…`（接続・Metaの通知）は、そのままの道筋に残す（Metaに登録したURLを変えない。spec FR-016）。新しい道筋（`accounts`・`teams`・`invites`・`me`・`operator`）とぶつからない。
- **古い道筋**：APIが先にデプロイされるので、同じ処理を古い道筋にもつないでおく（PR4）。画面が新しい道筋に移ったことをテスト環境で確かめてから、最後のPR（PR5）で古い道筋を消す。`/api/me`のThreadsのデータも、PR5まで今の形で返す（組み立ての層で、Threadsの関数を呼んで足す。PR5で消す）。
- 招待のリンク（画面のURL。`/invite/:token`など）は変えない。

## R10. Webの呼び出しとキャッシュのキー

- **決定**：`apps/web/src/lib/api-client.ts`・`lib/query.ts`にあるThreadsのAPIの呼び出しとキーを、`apps/web/src/apps/threads/lib/api.ts`・`apps/threads/lib/query-keys.ts`へ移す。共通の部品には、共通のAPI（`me`・契約・運営の共通の部分・紹介・テストのグループ）だけを残す。
- `useThreadsMe()`（`/api/threads/me`）をThreadsの中に作り、今`me.accounts`・`me.landingAccountId`・`me.teams`などを読んでいる11ファイルを、こちらに替える。外枠（入口の振り分け・すべてのアプリ・アプリの切り替え）は、今どおり`/api/me`の`apps`を読む。
- **テストのモック**：今は約60のテストが`@/lib/api-client`をまるごとモックしている（028で分けなかった理由）。呼び出しの場所が変わるので、Threadsのテストは`@/apps/threads/lib/api`をモックする形に、機械的に直す（期待する結果は変えない。spec FR-022）。
- 退会の画面（共通の設定）は、`/api/me/withdrawal-preview`（契約）と`/api/threads/me/withdrawal-preview`（消えるアカウント）を両方読む。外枠がThreadsを読まない決まり（028のESLintの規則）は守るため、Threadsは「退会の前に見せる中身」を`AppModule`の項目として外枠に渡す（`withdrawalPreview`）。

## R11. 境界の自動のチェック

- **決定**：ESLintの規則`module-boundaries`を強める。
  - Threadsを含むすべてのアプリは、`platform/schema`（共通の表の定義）を読めない（今は2作目以降だけの予定だった）。
  - 共通は、`apps/*/schema`を読めない（今も読めないが、`db/schema.ts`経由の抜け道がないかを確かめる）。
  - `platform/index.ts`から、表の定義と、SQLの部品（`featureOnSql`など）を出さない（アプリが使えるのは入口の関数だけ）。
- 組み立て（`db/schema.ts`）は、drizzle-kitのために共通とThreadsの両方の表を読み直して出す（今のまま）。

## R12. PRの分け方とテスト環境での確かめ

- **決定**：5つのPRに分け、順に`develop`へ入れる（[quickstart.md](./quickstart.md)）。
  1. **PR1 共通の土台**：出来事（`platform_events`・`platform_event_deliveries`・受け取りの登録・すぐに届ける・5分ごとのやり直し）、`app_usage`と`reportUsage`（料金の数は、まだ今の`countOwned`と並べて同じ値になることを確かめる）、`loadEntitlements`、機能と上限の「アプリ・名前」化（マイグレーション：列と表を足す・写す）。動きは変えない。
  2. **PR2 持ち主の移動（コード）**：`accounts`・`memberships`・チーム・権限・活動の記録の処理と入口をThreadsへ移す。知らせ5種類を、Threadsの中の処理と出来事に置き換える。定期処理のJOINを`loadEntitlements`に替える。料金の数を`app_usage`に切り替える。`/api/threads/me`と`/api/threads/me/withdrawal-preview`を足す（`/api/me`はまだ今の形）。表の置き場所はまだ`public`。
  3. **PR3 置き場所の移動（DB）**：スキーマ`threads`を作り、Threadsの31表を移し、共通との外部キーを外す。マイグレーションのテスト（件数と中身が残る）。ESLintの規則を強める。**テスト環境で、件数の比べと主な流れを確かめる**。
  4. **PR4 道筋とWeb**：`/api/threads/…`の道筋を足す（古い道筋も残す）。Webの呼び出し・キー・`useThreadsMe`を移し、テストのモックを直す。
  5. **PR5 片づけ**：古い道筋・`/api/me`のThreadsのデータ・上限の古い列・`platform/hooks.ts`を消す。文書（app-separation・module-map・product-structure・architecture・Constitution）を直す。**テスト環境で、もう一度主な流れを確かめる**。
- **理由**：1つのPRで一度に動かすと、差が大きすぎてレビューと戻しが難しい（027も2つに分けた）。PR1・PR2はDBの置き場所を変えないので、ふつうの「前の版でも壊れない」マイグレーションだけで済む。前の版が壊れうるのはPR3（置き場所の移動）とPR5（列の削除）だけで、そこだけテスト環境の例外にする（spec FR-019）。
- **E2E**：各PRで手元のE2E（19件）を流す。テスト環境では、PR3とPR5のあとにユーザーが手で確かめる。
