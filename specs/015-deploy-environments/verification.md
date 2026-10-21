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
pnpm test       packages/shared 307 / apps/web 515 / apps/api 807　すべて成功（計1,629）
pnpm e2e        18 成功
```

この機能で足したテスト。

| 確かめること | どこ | 結果 |
|---|---|---|
| `wrangler.toml`の`[env.staging]`・`[env.production]`に`vars`・`kv_namespaces`・`triggers`がそろっている。ステージングと本番でWorkerの名前が違う。秘密情報が書かれていない | `apps/api/test/unit/wrangler-config.test.ts`（新規13件） | 成功 |
| `APP_ENV`が無い・知らない値なら`CONFIG_ERROR`で止まる | `apps/api/test/unit/config.test.ts`（1件追加） | 成功 |
| 記録（ログ）に`app_env`が入る。呼び出しごとの値で上書きされない | `apps/api/test/unit/logger.test.ts`（3件追加） | 成功 |
| 帯が`production`以外で出る・知らない値でも本番の見た目にしない・閉じるボタンがない・ほかの帯より上 | `apps/web/test/env-banner.test.tsx`（新規6件） | 成功 |
| 375pxで帯がはみ出さず、上部バーの操作に重ならない。骨格の外の画面（利用規約）にも出る | `e2e/tests/phone-width.spec.ts`（1件追加） | 成功 |

**T038（設定の抜けがないか）**

```text
pnpm --filter api exec wrangler deploy --env staging --dry-run     成功（AUTOPOST_KV と vars 10件を確認）
pnpm --filter api exec wrangler deploy --env production --dry-run  成功（同上）
```

**T035（リポジトリに秘密がないか）**：今のファイルと**全履歴**を、鍵の形（`sk_live_`・`pk_live_`・`whsec_`＋28文字以上・利用者名とパスワード付きの`postgres://`）で検索した。見つかったのは手元のDockerのDB（`postgres://postgres:postgres@…`）だけで、秘密情報ではない。

**T036**：`.gitignore`に`.dev.vars`・`.env`・`.env.local`・`.env*`（`!.env.example`）が入っていることを確認。

## 3. 計画からの変更

| 変えたこと | なぜ |
|---|---|
| `wrangler.toml`の`[env.*].vars`に、**見本の値**（`pk_test_xxx`・`https://api.example.com`など）を入れた | ドメインとClerkの本番インスタンスが決まるまで本物を書けない。見本の値のままだと今ある設定の確認（`src/lib/config.ts`）が`CONFIG_ERROR`で止めるので、入れ忘れに必ず気づく |
| 一番上の`name`と`[env.production].name`を同じ（`threads-grower-api`）にした | [contracts/environments.md](./contracts/environments.md) 1のとおり。`--env`を付けない`wrangler deploy`は本番に出るので、`wrangler.toml`の先頭とREADMEに注意を書いた |
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
