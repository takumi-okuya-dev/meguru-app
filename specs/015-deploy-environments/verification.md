# 確認の記録：公開のためのブランチと環境

**Feature**：[spec.md](./spec.md) | **確かめ方**：[quickstart.md](./quickstart.md) | **作業**：[tasks.md](./tasks.md)

**日付**：2026-10-22 ／ **ブランチ**：`feature/015-deploy-environments`

## 1. この回で終わったところ

ユーザーの判断で、**自動でできるところ（コード・設定・文書）を先に実装し、外部サービスの設定（【人】19件）は手順書にまとめて渡す**形にした。

| 区分 | 作業 | 状態 |
|---|---|---|
| Setup | T001〜T003 | 済み |
| Foundational（コード） | T004〜T009 | 済み |
| US1（コード） | T014〜T018 | 済み |
| US3（確かめるだけ） | T035・T036・T038 | 済み |
| US6（文書） | T043〜T046 | 済み |
| 仕上げ | T047〜T050 | 済み |
| **【人】外部サービス** | T010〜T013・T019〜T025・T027〜T032・T039・T040（19件） | **未着手**（手順は[docs/external-services-setup.md](../../docs/external-services-setup.md)「9. 公開のための準備」） |
| 【人】の後でないと確かめられない | T026・T033・T034・T037・T041・T042 | 未着手 |

## 2. 自動の確認の結果（2026-10-22）

```text
pnpm lint       成功
pnpm typecheck  成功
pnpm test       packages/shared 307 / apps/web 520 / apps/api 807　すべて成功（計1,634）
pnpm e2e        19 成功
```

この機能で足したテスト。

| 確かめること | どこ | 結果 |
|---|---|---|
| `wrangler.toml`の`[env.staging]`・`[env.production]`に`vars`・`kv_namespaces`・`triggers`がそろっている。ステージングと本番でWorkerの名前が違う。秘密情報が書かれていない | `apps/api/test/unit/wrangler-config.test.ts`（新規13件） | 成功 |
| `APP_ENV`が無い・知らない値なら`CONFIG_ERROR`で止まる | `apps/api/test/unit/config.test.ts`（1件追加） | 成功 |
| 記録（ログ）に`app_env`が入る。呼び出しごとの値で上書きされない | `apps/api/test/unit/logger.test.ts`（3件追加） | 成功 |
| 帯が`production`以外で出る・知らない値でも本番の見た目にしない・閉じるボタンがない・ほかの帯より上 | `apps/web/test/env-banner.test.tsx`（新規10件） | 成功 |
| どの骨格（`AppShell`・`CenteredLayout`・`SettingsLayout`の3通り・`TeamSharedAccountPage`）でも帯が出る | 同上＋`apps/web/test/team-shared-account.test.tsx`（1件追加） | 成功 |
| 375pxで帯がはみ出さず、上部バーの操作に重ならない。骨格の外の画面（利用規約）にも出る | `e2e/tests/phone-width.spec.ts`（1件追加） | 成功 |

**T038（設定の抜けがないか）**

```text
pnpm --filter api exec wrangler deploy --env staging --dry-run     成功（AUTOPOST_KV と vars 10件を確認）
pnpm --filter api exec wrangler deploy --env production --dry-run  成功（同上）
```

**T035（リポジトリに秘密がないか）**：今のファイルと**全履歴**を、鍵の形（`sk_live_`・`pk_live_`・`whsec_`＋28文字以上・利用者名とパスワード付きの`postgres://`）で検索した。見つかったのは手元のDockerのDB（`postgres://postgres:postgres@…`）だけで、秘密情報ではない。

**T036**：`.gitignore`に`.dev.vars`・`.env`・`.env.local`・`.env*`（`!.env.example`）が入っていることを確認。

## 2-1. PR #19 のCodexレビュー（1回目、2026-10-22）

5件（P1が2件・P2が3件）。すべて直した。

| # | 深刻度 | 指摘 | 直し方 |
|---|---|---|---|
| 1 | P1 | `deploy.yml`が`DATABASE_URL`を渡していたが、drizzle-kitが読むのは`DATABASE_URL_DIRECT`（`apps/api/drizzle.config.ts`）。マイグレーションが手元のlocalhostに向かい、必ず失敗する | ワークフローと手順書9-5の両方で`DATABASE_URL_DIRECT`として渡す。`data-model.md` 3-3にも書いた |
| 2 | P1 | 手順書9-10のStripeのWebhookの宛先が`/api/billing/webhook`になっていたが、実装は`POST /api/stripe/webhook`（`src/routes/stripe-webhook.ts`）。404になり、契約の状態が更新されない | `/api/stripe/webhook`に直した。`contracts/environments.md` 4も同じ誤りだったので直した |
| 3 | P2 | 帯を`AppShell`・`CenteredLayout`・`PlainPage`にしか置いていなかった。`/settings/*`（`SettingsLayout`）と`/teams/:teamId/accounts/:accountId`（`TeamSharedAccountPage`）は自分で外枠を描くので、ステージングでも帯が出ない | 両方に置いた（`SettingsLayout`は2列・スマートフォンの一覧・スマートフォンの中身の3通り）。骨格ごとに帯が出ることをテストで固定し、`contracts/ui-routes.md`に「外枠になるものすべてに置く」「読み込み中と失敗の画面には置かない（入れ子で二重になる）」と書いた |
| 4 | P2 | `workflow_dispatch`はどのブランチでも選べるので、`main`以外はすべてステージング扱いになり、未レビューのブランチをステージングに出せた | `main`・`develop`以外は、ワークフローの最初で止める |
| 5 | P2 | 安全弁が秘密2つだけを見ていたので、Environmentの変数が欠けていてもデプロイしてしまう（空のClerkの鍵、`localhost`向きのWeb） | 必須6つ（秘密2・変数4）を見る。**1つも入っていなければ何もしない／一部だけなら止める**に変えた。あわせて`VITE_APP_ENV`が出す先と合っているかも見る |

## 2-2. PR #19 のCodexレビュー（2回目・3回目、2026-10-22）

7件（P1が6件・P2が1件）。すべて直した。

| # | 深刻度 | 指摘 | 直し方 |
|---|---|---|---|
| 6 | P1 | 一番上の`name`が`[env.production].name`と同じなので、`--env`なしの`wrangler deploy`（`pnpm --filter api deploy`）が、`APP_ENV`もClerkもKVも足りない一番上の設定で**本番を上書き**する | 一番上を`threads-grower-api-dev`にして分けた。`package.json`の`deploy`を`deploy:staging`・`deploy:production`に置き換え、`--env`なしのデプロイを無くした。テストも「3つの名前がすべて違う」に直した |
| 7 | P1 | 手順書の`pnpm --filter web exec wrangler …`は動かない（wranglerは`apps/api`の開発用の依存で、`--filter web`からは呼べない。`ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL`になる） | `pnpm --filter api exec wrangler …`に直した（quickstart・tasksも） |
| 8 | P1 | 手順書の順番では、KVの`id`が`00000…`のままWorkerを出すので、最初のデプロイが拒まれる | 9-3（KV）と9-4（置き場所）を入れ替えた。T020・T022にも前後関係を書いた |
| 9 | P1 | `BILLING_ENABLED=true`のとき、Stripeの鍵が`sk_test_`でも`sk_live_`でも通る。取り違えると、本番がテストの決済で動く／ステージングが本当のお客さまに課金する | `validateConfig`で、`APP_ENV`に合う種類の鍵かを見る（本番＝`live`、ステージングと手元＝`test`）。Clerkの秘密の鍵・公開鍵も同じ |
| 10 | P2 | `AppShell`が帯を`banner`の仕組みにだけ載せていたので、上部バーを出さない画面（`/accounts/new`で既にアカウントがある人）には帯が出ない | `AppShell`が帯を**直接**出すようにした（サイドバーより上、画面のいちばん上）。`banner`からは外した。上部バーなしでも出ることをテストで固定 |
| 11 | P1 | 安全弁がClerkの鍵の種類を見ないので、本番に`pk_test_`のままデプロイできる | 本番は`pk_live_`、ステージングは`pk_test_`を必須にした（4通りを手元のbashで確認） |
| 12 | P1 | 9-9のとおりPagesに`staging.<ドメイン>`を足すだけでは、**本番の版**が出る。CNAMEの向き先を`develop.<プロジェクト>.pages.dev`に書き換える手順が抜けていた | 9-9に書き換えの手順とCloudflareの文書への参照を足した（quickstart・T023も） |

## 2-3. ついでに直した、このfeatureの外の不具合

`apps/api/test/integration/auto-post-status.test.ts`が、全部のテストを流したときにときどき落ちていた（2回連続）。原因は005の実装側で、`POST /api/accounts/:id/auto-post/notices/blocked/dismiss`が`blockedNoticeSeenAt`に`new Date()`（Workersの時計）を入れ、下書きの`blocked_at`はDBの`now()`で入っていたこと。Workersの`Date`は最後の入出力の時点で止まるので、直前に止められた下書きより**前**の時刻になり、「閉じた」はずの知らせが消えないことがあった。

`sql\`now()\``（DBの時計）に直した（`apps/api/src/routes/auto-post.ts`）。テストの不安定さだけでなく、利用者が「閉じる」を押しても知らせが残る不具合でもあった。このPRのCIを塞ぐため、ここで直した。

## 3. 計画からの変更

| 変えたこと | なぜ |
|---|---|
| `wrangler.toml`の`[env.*].vars`に、**見本の値**（`pk_test_xxx`・`https://api.example.com`など）を入れた | ドメインとClerkの本番インスタンスが決まるまで本物を書けない。見本の値のままだと今ある設定の確認（`src/lib/config.ts`）が`CONFIG_ERROR`で止めるので、入れ忘れに必ず気づく |
| 一番上の`name`を`threads-grower-api-dev`にして、本番（`threads-grower-api`）と分けた | 当初は契約どおり本番と同じ名前にしたが、`--env`を付けない`wrangler deploy`が、足りない一番上の設定のまま**本番を上書き**してしまう（Codexレビュー2回目 P1）。あわせて`apps/api`のスクリプトを`deploy:staging`・`deploy:production`だけにした |
| 読みもののページ（利用規約・特定商取引法の表記・トークンの作り方）を、ルーターの入れ物（`PlainPage`）で包んだ | 3つのファイルを作り変えずに、帯を画面の一番上に出すため。ルートの確認は`apps/web/test/helpers/routes.ts`の`isPublicPath`に寄せた |
| Webのテストの既定を`VITE_APP_ENV=production`にした（`apps/web/vitest.config.ts`） | 既存の515件のテストに帯が割り込まないようにするため。帯そのものは`env-banner.test.tsx`で`vi.stubEnv`を使って確かめる |
| 帯の`role`を`status`にした（`alert`ではなく） | ずっと出ている知らせなので。読むだけの帯（013）と同じ |
| `docs/external-services-setup.md`「9」の題を「本番公開時の追加作業（今は不要）」から**「公開のための準備（ステージングと本番）」**に変えた | 「今は不要」ではなくなったため。参照していた`specs/013-billing/notes.md`・`plan.md`・`quickstart.md`も直した |
| `deploy.yml`に「設定がそろっているか見る」の安全弁を入れた | 【人】の設定（9-11）が済むまでは、`main`・`develop`へのマージのたびにデプロイが失敗して赤くなる。設定が入るまでは警告を出して何もしない。9-11が済んだら、このステップと各ステップの`if`は消してよい |
| Constitutionを**4.1.0（MINOR）**にした | ブランチ運用を「公開時に3段構成に切り替える」から「3段構成とする」に変えたのは、原則の実質的な変更のため |

## 4. まだ確かめていないこと（【人】の作業の後）

[quickstart.md](./quickstart.md) 3の、実際にデプロイしないと確かめられないもの。

- **SC-001・SC-002（マージから10分以内）**：T026・T033で、マージからその環境で見えるまでの時間を測って、ここに記録する。
- **SC-003**：ステージングのデータが本番のDBに入らないこと（T037）。
- **SC-005**：マイグレーションが失敗したとき、APIとWebが入れ替わらないこと（T034）。
- ステージングの決済（T041）・急ぎの修正の流れ（T042）。
- 許可していないメールアドレスでステージングに登録できないこと（T024の後）。

### 記録する場所（デプロイしたら、ここに足す）

| 確かめること | 日付 | 結果 |
|---|---|---|
| SC-001：`develop`へのマージ → ステージングで見える | — | — |
| SC-002：`main`へのマージ → 本番で見える | — | — |
| SC-003：データが混ざらない | — | — |
| SC-005：マイグレーションの失敗で止まる | — | — |
