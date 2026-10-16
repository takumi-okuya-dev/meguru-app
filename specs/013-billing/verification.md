# 検証の記録：決済＋退会

**日付**：2026-10-16 | **タスク**：[tasks.md](./tasks.md) T062 | **手順**：[quickstart.md](./quickstart.md)

## 1. 自動の確認

| コマンド | 結果 |
|---|---|
| `pnpm --filter api db:migrate` | 0014_billing をローカルのDBに当てた |
| `pnpm lint` | エラーなし |
| `pnpm typecheck` | shared・api・web・e2e とも通る |
| `pnpm build` | 通る。APIのWorkerは `wrangler deploy --dry-run` で 2,141 KiB（gzip 411 KiB。無料プランの上限 3 MB の内） |
| `pnpm test` | shared 21ファイル・222件、web 41ファイル・392件、api 76ファイル・693件（マイグレーションの4ファイルを含む）がすべて通る |
| `pnpm e2e` | 14件すべて通る。既存の13件は決済OFF（project `default`）、決済の1件は決済ONのAPI・偽のStripe（project `billing`） |

E2E は、`e2e/.env.local`の3人に加えて、`E2E_CLERK_USER_EMAIL`にオーナー役（`E2E_OWNER_EMAIL`）を渡して流した。決済のE2Eは、Playwright が決済ONのAPI（8788）・偽のStripe（8791）・それに向けたWeb（5174）を起動する（`e2e/playwright.config.ts`）。

成功の基準ごとのテスト：

| 基準 | テスト |
|---|---|
| SC-001（無料体験は1件まですべて使え、2件目は止まる） | `apps/api/test/integration/account-limit-billing.test.ts`（並べた作成を含む）、`apps/web/test/account-create.test.tsx`、`e2e/tests/billing.spec.ts` |
| SC-002（契約して10秒以内に「契約中」） | `billing-sync-webhook.test.ts`（戻ったときの読み直し）、`apps/web/test/billing-page.test.tsx`（`?checkout=success`のくり返し）、`e2e/tests/billing.spec.ts`。「3分以内に契約を終える」は、Stripeの画面の操作なので手で確かめる（下の2） |
| SC-003（読むだけの書き込みがどの経路でも止まり、自動投稿・取得が動かない） | `read-only-access.test.ts`（オーナー・担当の人・見せてもらっている人×API）、`auto-post-billing.test.ts`、`metrics-runner.test.ts`（読むだけのオーナー）、`team-billing.test.ts` |
| SC-004（支払えば1分以内に戻る） | `billing-sync-webhook.test.ts`（知らせで読み直す）、`e2e/tests/billing.spec.ts` |
| SC-005（請求の金額＝1,000円＋(件数−1)×500円） | `packages/shared/test/billing.test.ts`（`nextInvoiceAmount`・`billingQuantity`）、`billing-quantity.test.ts`（Stripeの数が`max(n,1)`、日割りなし）、`billing-summary.test.ts` |
| SC-006（知らせの重複・順番の入れ替わり） | `billing-sync-webhook.test.ts`（同じ知らせ2回・古い中身の知らせ・古い読み直し） |
| SC-007（退会で何も残らず、管理者は引き継がれる） | `withdrawal.test.ts`（契約・アカウント・トークン・担当・記録の名前・Clerk・チームの引き継ぎと削除・途中の失敗とやり直し・日次の続き） |
| SC-008（決済OFF・料金なし） | `billing-modes.test.ts`、`read-only-access.test.ts`（状態ごとの表）、001〜012 の既存のテストとE2E（決済OFFで今のまま通る） |
| SC-009（規約へのリンクが契約の前に見える） | `apps/web/test/billing-page.test.tsx`、`legal-commerce.test.tsx`、`terms-page.test.tsx` |
| FR-047（読むだけの人のデータを消さない） | 日次の処理（`daily-jobs.ts`）に、読むだけの人のデータを消す処理がないことを確かめた |
| マイグレーション | `apps/api/test/migration/migration-0014.test.ts` |

## 2. 手で確かめること（まだ）

自動の確認では、偽のStripe・偽のClerkの削除を使っている。次は、公開の前にStripeのテスト用環境で手で確かめる（quickstart.md 2 の1〜9）。

- **Stripeの準備**：[docs/external-services-setup.md](../../docs/external-services-setup.md)「10. Stripe」（段階制の料金・Webhookの8つの知らせ・カスタマーポータル・Smart Retries・メール）。
- **本物のCheckout**（quickstart.md 2 の2）：テスト用のカードで契約し、戻って10秒以内に「無料体験中（契約済み）」。最初の請求日が無料体験の終わり。SC-002 の「3分以内」。
- **支払いの失敗・解約**（2 の3・4）：Test clock か失敗するカードで、読むだけになり、カードを直すと戻る。ポータルで解約し、期間の終わりまで使え、過ぎると読むだけ。
- **退会**（2 の6）：本物のClerkのユーザーが消え、同じGoogleでログインすると「アカウントを作る」から始まること。E2E にはしていない（下の4）。
- **スマートフォンの幅**（2 の9）：「契約と支払い」・退会のダイアログ・帯。
- **公開の前の事業者の手続き**：適格請求書、特定商取引法に基づく表記の販売者の情報（`apps/web/src/lib/seller-info.ts`）、今の利用者への料金なしの印（setup「10-7」）。
- 012・011 から残っている手での確認（本物のMetaの許可の画面など）。

## 3. 気づいたこと

- **ローカルの`.dev.vars`**：`BILLING_ENABLED`を必須にしたので、手元の`apps/api/.dev.vars`に`BILLING_ENABLED=false`を足した（ないとAPIが`CONFIG_ERROR`で止まる）。ほかの人の手元でも、`.dev.vars.example`のとおりに足す必要がある。
- **テストの時刻**：自動投稿・反応数のテストは「今」を2030年にしているので、決済ONのテストでは無料体験がいつも終わっている。決済ONの自動投稿のテストは、はじめに契約中にしてから状態を変えた。
- **OrbStack**：日をまたいで止まり、結合テストがDBにつながらなくなった。`orb start`と`docker compose up -d --wait`で戻した。

## 4. 計画からの変更

- **退会のE2E（T061）は作らなかった**：E2E のログインは、Clerk の開発用インスタンスに一度Googleでログインした3人を使っている（Googleだけの設定では、APIで作った利用者はチケットでログインできない。`e2e/tests/helpers.ts`）。退会のE2Eは、そのうち1人のClerkのユーザーを本当に消してしまい、以後のE2Eが手でログインし直すまで動かなくなる。退会は、APIの結合テスト（偽のClerk。`withdrawal.test.ts`）と、画面のテスト（`withdraw-dialog.test.tsx`）で確かめ、本物のClerkでの確かめは手で行う（上の2）。
- **退会の後の行き先**：contracts/ui-routes.md の`/?withdrawn=1`は、ログインが要るルートなので、`/sign-in?withdrawn=1`にし、ログインの画面に「退会しました」を出した（入口＝ログインの画面）。ログインの画面の下に「特定商取引法に基づく表記」へのリンクも置いた。
- **自動投稿の止まった理由**：読むだけのとき、自動投稿の状態に`stoppedReason: "billing_inactive"`を足し、予定の時刻を出さないようにした（ホームの「次の投稿」が、投稿されない時刻を出さないように）。T039 の「自動投稿の知らせ」は、この理由の文で出す（`NextPostCard`・投稿ストック）。
- **アカウントを作る画面の金額**：2件目からの料金の案内は、`GET /api/billing`を読まずに、共通の定数`BILLING_EXTRA_PRICE_JPY`から出す（`/api/me`だけで画面を作れるように）。「契約と支払い」は`prices`から出す。
- **引き継ぎ先の選び方**：`beforeAccountDeleted`の中の選び方を`chooseSuccessor`に分け、退会の確認の画面と同じものを使う。
- **退会で止める契約**：記録の契約だけでなく、Stripeから顧客の契約の一覧を読んで、終わっていないものをすべて止める。開いているCheckoutのセッションも期限切れにする（退会の後に契約ができて請求が続かないように）。
- **権限の判定**：`authorizeTeamMember`・`authorizeTeamAdmin`は、決済のモードを使わないので、利用者のIDだけを受け取る形にした（`Pick<RequestUser, "id">`）。
- **料金なしの印**：スクリプトの中身を`setBillingExemptByEmail`（`billing-service.ts`）に置き、結合テストで確かめる。
- **旧プランのテスト**：プランとgrower機能を前提にした001〜012のテストは、消すか名前を直し、読むだけの確かめは`read-only-access.test.ts`ほかの決済のテストにまとめた。
