# 011 決済：仕様づくりの前のメモ

**作成日**：2026-10-10

**位置づけ**：`/speckit-specify` の前に、決めたこと・検討することを残すメモ。仕様（spec.md）を作るときの入力にする。011の仕様ができたら、このメモの内容をspec.md・plan.mdに移す。

**Source**：[PRD §4.6 FR-12「契約・支払い」](../../_bmad-output/initiative-threads-grower-app/prd-threads-grower-app/prd-threads-grower-app.md)、[008 research.md R15「009（決済）への申し送り」](../008-team-operations/research.md)（番号の変更で、決済は011になった）、[008 contracts/permissions.md](../008-team-operations/contracts/permissions.md)、[docs/external-services-setup.md「9. 本番公開時の追加作業」](../../docs/external-services-setup.md)

## 1. 公開後のブランチと環境（2026-10-10 ユーザーの方針）

決済の実装が終わったら、次のブランチ構成にする予定。

| ブランチ | デプロイ先 | 使う人 | 決済 |
|---|---|---|---|
| `main` | 本番（SaaSとして商用公開） | 一般のお客さま | ON（Stripeの本番キー） |
| `develop` | ステージング | テストユーザー | 下の「決済の扱い」を参照 |
| `feature/*` | プレビュー（PRごとのURL）または手元 | 開発者 | OFF、またはStripeのテスト用環境（sandbox） |

### 決めておくこと（2026-10-10 の調査からの提案）

- **決済のON/OFFは、ブランチのコードではなく環境の設定で切り替える。** コードはどのブランチでも同じにし、違いは環境変数（例：`BILLING_ENABLED`）とStripeのキー（本番 `sk_live_`、テスト用 `sk_test_`）・Webhookの秘密の値に置く。ブランチごとにコードを変えると、`develop` を `main` にマージしたときに設定も本番に入ってしまう。
- **ステージングの決済は「OFF」より「Stripeのテスト用環境でON」を検討する。** OFFにすると、決済の変更を初めて動かすのが本番になる。テストユーザーに料金を求めないのは、決済全体を止めるのではなく、ユーザーごとの無料の印（または無料の招待コード）で行う案。→ specifyのときにユーザーと決める。
- **PRの行き先**：ふだんのPR（Codexのレビューを含む）は `develop` に向け、リリースは `develop` → `main` のPRで行う。
- **本番の急ぎの修正**：`main` から修正のブランチを作り、`main` にマージした後、同じ修正を `develop` にも戻す。
- **`develop` と `main` の差を長くためない**（目安：1〜2週間ごとにリリース）。

### 環境ごとに分けるもの（今はCIだけで、デプロイと環境の分け方はまだない）

- API：`apps/api/wrangler.toml` に `[env.staging]`・`[env.production]`（変数・自動投稿のKV・Cron）
- Web：Cloudflare Pagesの本番ブランチを `main` に、`develop` とPRはプレビュー（プレビューのURLは既定で公開なので、アクセスの制限を検討）
- DB：Neonの本番とステージングを分ける（008のマイグレーション0009・0010をステージングに当てるT085も残っている）
- Clerk：本番のインスタンスとGoogleのOAuthの設定
- Threads：環境ごとのコールバックのURL
- Stripe：本番とテスト用環境で、キーとWebhookの秘密の値を分ける
- **注意**：ステージングでも自動投稿のCronが動くと、テストユーザーの実際のThreadsアカウントに投稿される。ステージングの自動投稿の扱いを決める。

## 2. 008から持ち越した検討事項

- Stripe Checkout（Stripeの画面）か、アプリ内の画面か
- 日割り（途中でアカウントを足す・減らすとき）
- 支払いが失敗したときの猶予
- 無料体験中のアカウントの上限を1件にする（PRD FR-2・FR-12、2026-10-09）
- オーナーが未払いのとき、パートナー・編集者も読むだけにする（`authorizeAccount` と `listTeamAccounts` の1か所に足す。008 FR-080・R15）
- 旧プランの `PLANS`・`accounts.plan`・`limitForOwnedPlans`・`hasGrowerAccess` を外す

## 3. 番号の変更（2026-10-10）

- 009 = このアカウントのチーム（実装済み）、010 = 自分のMetaアプリのトークンでアカウントを追加、011 = 決済。
- Constitution（「決済（feature 009）」）、008 spec FR-080、research.md R15、contracts/permissions.md、PRD §6.1 に残っていた「009（決済）」の記述は、010で「011（決済）」に直した（010 FR-060。Constitution 3.0.1）。
