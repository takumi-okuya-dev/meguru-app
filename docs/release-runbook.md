# リリースの手順書

公開したあとに機能を足すとき、**ステージングと本番を壊さないため**の決まりと手順です。

- ブランチの決まり（`main`・`develop`・`feature/*`）は[README](../README.md)「ブランチとデプロイ」と[Constitution](../.specify/memory/constitution.md)「開発ワークフロー」。
- ステージングと本番を最初に用意する手順は[外部サービスの準備手順](./external-services-setup.md)「9. 公開のための準備」。
- デプロイの仕組み（何がどの順に動き、途中で止まると何が起きるか）は[contracts/deploy.md](../specs/015-deploy-environments/contracts/deploy.md) 2。

## 1. 全体の流れ

```
feature/* ──PR──▶ develop ──自動──▶ ステージング（テストユーザー）
                     │                 ここで確かめる（4）
                     └──リリースのPR──▶ main ──自動──▶ 本番（お客さま）
```

- 本番に出る変更は、**必ず先にステージングを通る**。マイグレーションも、本番ではじめて当たることがない。
- 例外は急ぎの修正だけ（7）。

## 2. ふだんの機能追加（`feature/*` → `develop`）

- **PRは小さく**。1つのリリースに混ざる変更が少ないほど、壊れたときに原因を探しやすく、戻しやすい。
- PRの説明の「チェック」の欄（[.github/pull_request_template.md](../.github/pull_request_template.md)）を埋める。
- **レビューは「セルフレビュー → Codexレビュー」の順**（2026-11-12に決めた）。Codex（`chatgpt-codex-connector`）はPRを開くと自動でレビューを始めるので、先にセルフレビューで見つかるものを直してから回す。
  1. PRは**下書き（draft）**で出す（`gh pr create --draft`）。下書きのあいだはCodexは動かない。
  2. セルフレビュー（Claude Codeの`/code-review`など）をして、指摘を直してpushする。
  3. **「Ready for review」**にする（`gh pr ready <番号>`）。ここでCodexのレビューが始まる。直したあとにもう一度見てもらうときは、PRに `@codex review` とコメントする。
- **CIは、PRにラベル「run-ci」を付けると流れる**（付け直すと、もう一度流れる。[.github/workflows/ci.yml](../.github/workflows/ci.yml)）。付けないと流れない。
  - **ラベルを付けるのは、コードを変えたPRだけ**。GitHubのCIは従量課金なので、結果が変わらないPRでは流さない（2026-10-31に[external-services-setup.md](external-services-setup.md) 9-12で決めた決まりを、2026-11-12にここへ書いた）。
  - 流す：lint・型チェック・テストの結果が変わりうる変更。`apps/`・`packages/`・`e2e/`・`eslint-rules/`のコード、`package.json`・`pnpm-lock.yaml`、TypeScript・ESLint・Vitestの設定、`.github/workflows/`。
  - 流さない：文書（`docs/`・`specs/`・`*.md`）・`.specify/`・スキルの本文だけのPR。CIの成功が要るブランチの規則は、管理者がPRから`gh pr merge --admin`でマージして通す（マージしてよいかは、いつもどおりユーザーが決める）。
  - 迷ったら流す。
- **大きな機能は、設定で止められるように作る**。`BILLING_ENABLED`・`THREADS_CONNECT_METHODS`と同じ形で、`apps/api/wrangler.toml`の環境ごとの`vars`で切り替える。
  1. 本番は「切」のまま出す。
  2. ステージングで「入」にして確かめる。
  3. 問題がなければ、本番も「入」にする（`[env.production.vars]`の1行を変えるPR）。

  こうしておくと、出したあとに困っても**コードを戻さず、設定の1行で止められる**。
- 環境ごとの違いを、コードの分岐（`if (APP_ENV === "production")`など）にしない。設定の値で分ける。

## 3. マイグレーションの決まり

デプロイは**マイグレーション → API → Web**の順に動きます。マイグレーションが当たってから新しいAPIに切り替わるまでの間は、**前の版のAPIが新しいDBで動いています**。途中で止まったときや、APIを前の版に戻したとき（6-1）も同じです。だから、**マイグレーションは、そのとき本番で動いている前の版のAPIでも壊れない形だけ**にします（[research.md R4](../specs/015-deploy-environments/research.md)）。

| 変更 | 出し方 |
|---|---|
| 表を足す | 1回でよい |
| 列を足す（空を許す、または既定値つき） | 1回でよい |
| 索引を足す | 1回でよい |
| 列を足す（`NOT NULL`で既定値なし） | **だめ**。前の版のAPIの`INSERT`が失敗する。既定値を付けるか、空を許す |
| 列や表を消す | **2回に分ける**。1回目：アプリがその列を読みも書きもしない版を出す（`NOT NULL`なら、ここで外す）。2回目：消す |
| 列の名前を変える | まず、**DBの列の名前は変えずに、コードの中の名前だけ変える**（Drizzleなら`headline: text("title")`）。それで済まないときだけ、下の例の4回に分ける |
| 列の型を変える | 新しい列を足して写す。下の例と同じ4回 |
| 既存の行が通らないかもしれない制約（`UNIQUE`・`CHECK`・`NOT NULL`）を付ける | **2回に分ける**。1回目：違反する値を書かない版を出す。2回目：残っている行を直してから、制約を付ける |

**列の名前を変える例**：`title`を`headline`に変える

どのリリースでも「マイグレーションが当たるときに動いている版」と「戻す先の版」が、新しいDBで正しく動くように並べます。

| リリース | マイグレーション | アプリ | 戻す先（1つ前の版）が困らない理由 |
|---|---|---|---|
| 1回目 | `headline`を足す（空を許す） | `title`と`headline`の**両方に書き**、`title`を読む | 前の版は`headline`を知らないだけ |
| 2回目 | すべての行で`title`を`headline`に写す | 両方に書き、**`headline`を読む** | 写すときに動いている1回目の版は両方に書くので、取りこぼさない。1回目に戻しても、`title`は書かれ続けている |
| 3回目 | `title`の`NOT NULL`を外す（付いていれば） | **`headline`だけに**書いて読む | 2回目の版は`headline`を読むので、`title`が古くなっても困らない |
| 4回目 | `title`を消す | 変えない | 3回目の版は`title`を使わない |

- 次のリリースは、前のリリースが本番で落ち着いてから出します。
- 前の版に安全に戻せるのは**1つ前まで**です。2つ前の版に戻すと、DBと合わないことがあります。

**そのほかの決まり**

- マイグレーションは`pnpm --filter api db:generate`で作り、**できたSQLを読んでからコミットする**。Drizzleは、名前の変更を「消して足す」として書くことがある。
- **一度`develop`に入ったマイグレーションのファイルは、書き換えない・消さない**。ステージングではもう当たっているので、書き換えてもステージングには当たり直さず、ステージングと本番のDBがずれる。直すときは、新しいマイグレーションを足す。

## 4. リリースの前に確かめること

`develop`→`main`のPRを作る前に、上から確かめます。

- [ ] `develop`の最新が、ステージングに出ている（Actionsの「Deploy」が`develop`で成功している）。
- [ ] ステージングで、主な流れを手で通した。
  - [ ] Googleでログインできる
  - [ ] Threadsアカウントの接続（または、つながっているアカウントの表示）
  - [ ] 投稿の登録 → 承認 → 予約
  - [ ] 予約した時刻に自動で投稿された（5分ごとの定期実行）
  - [ ] パフォーマンスの画面が開ける
  - [ ] 決済（Stripeのテスト用カード）。このリリースで決済を変えた場合
  - [ ] このリリースで足した・変えた機能
- [ ] 手元で`pnpm e2e`が通る（E2EはCIで動いていないため）。
- [ ] このリリースに入るマイグレーションを読み、3の決まりに沿っている。

  ```bash
  git fetch origin && git diff origin/main origin/develop -- apps/api/drizzle
  ```

- [ ] 新しい設定値があれば、本番にも入っている。
  - `vars`：`apps/api/wrangler.toml`の`[env.production.vars]`
  - 秘密：`pnpm --filter api exec wrangler secret list --env production`に名前が出る
  - GitHubの変数：Settings → Environments → `production`
- [ ] マイグレーションがあるリリースでは、マージする直前の時刻（UTC）を控えた（6-3の1）。
- [ ] 出したあと30分ほど、様子を見られる時間がある（夜遅くや出かける前に出さない）。

### 4-1. 024（テスター招待・上限・無料体験の廃止）をはじめて本番に出すとき

- [ ] 本番用のMetaアプリを作り、3つのコールバックのURLを登録した（[external-services-setup.md](external-services-setup.md) 9-8）。
- [ ] 本番の`THREADS_APP_ID`と`STRIPE_PRICE_ID`（1件1,000円の料金。10-2）を、`apps/api/wrangler.toml`の`[env.production.vars]`を直すPRで入れた。
- [ ] 本番の Secret に`THREADS_APP_SECRET`と、運営者の本番の Clerk のユーザーID（`OPERATOR_CLERK_USER_IDS`）を入れた。
- [ ] 本番の`THREADS_ACCESS_MODE`が`testers`（審査の前）になっている。

## 5. リリースする

1. `develop`→`main`のPRを作る（タイトルは「リリース：…」）。説明には、入る変更のPRを並べる。
2. CIの成功を確かめてマージする。
3. Actionsの「Deploy」（`main`）が成功したことを確かめる。
4. 本番のURLで、変更が出ていることを確かめる。
5. しばらくAPIのログを見る。エラーが続けて出ていないか。

   ```bash
   pnpm --filter api exec wrangler tail --env production
   ```

   Cloudflareの画面（Workers & Pages → `threads-grower-api` → Logs）でも見られる。

## 6. 困ったときの戻し方

まず、何が壊れたかで戻し方を選びます。

| 何が起きたか | すること |
|---|---|
| 新しい機能だけがおかしい（設定で止められる作り） | その機能の設定を「切」にする（2） |
| APIがエラーを返す | APIを前の版に戻す（6-1） |
| 画面が壊れている | Webを前の版に戻す（6-2） |
| APIとWebの両方を変えたリリース | **両方を**前の版に戻す。片方だけ戻すと、APIとWebの組み合わせが合わなくなる |
| DBのデータが壊れた | DBを戻す（6-3）。最後の手段 |

**戻したあとに必ずすること**：戻しても、`main`には壊れたコードが残っています。次に`main`へマージすると、また出てしまいます。直す変更を急ぎの修正（7）の手順で`main`に入れてください。

> `main`の上でリリースのマージを`git revert`するのは避けます。打ち消した変更は`develop`ではすでに取り込み済みの扱いなので、次に`develop`→`main`をマージしても**戻ってこず**、気づかないまま機能が消えます。

### 6-1. APIを前の版に戻す（Cloudflare Workers）

```bash
# 出した版の一覧と日時。戻したい版のIDを控える
pnpm --filter api exec wrangler deployments list --env production

# その版に戻す
pnpm --filter api exec wrangler rollback <版のID> --env production --message "戻した理由"
```

- 数秒で切り替わります。DB・KVの中身は戻りません（3の決まりを守っていれば、前の版のAPIでも動きます）。
- Cloudflareの画面（Workers & Pages → `threads-grower-api` → Deployments）からも戻せます。

### 6-2. Webを前の版に戻す（Cloudflare Pages）

Cloudflareの画面で、Workers & Pages → `threads-grower-web` → Deploymentsを開き、前の本番のデプロイの「…」→ **Rollback to this deployment**。

- 戻せるのは本番だけです。ステージング（`develop`）は、直す変更を`develop`に入れて出し直します。

### 6-3. DBを戻す（Neon）

Neonは、本番のブランチ（プロジェクトを作ったときからある、元のブランチ）を、履歴の中の時刻に戻せます（[Neonの説明](https://neon.com/docs/postgres/backup-restore/branch-restore)）。自分で作った子のブランチは、復元元に選べません。

**1. 前もってすること**

- 公開の前に、Neonの本番のプロジェクトのSettings → Postgresで、**何時間前まで戻せるか**（履歴の保持期間）を確かめます。プランで決まり、延ばすとHistoryの料金が増えます。
- マイグレーションがあるリリースでは、**マージする直前の時刻（UTC）を控えます**（4のチェック）。戻すときは、この時刻を指定します。保持期間を過ぎると、その時刻には戻せません。

**2. 戻すとき**

**戻した時刻より後に書かれたデータは消えます**（その間の投稿の予約や決済の記録など）。DBを戻すのは最後の手段で、まず6-1・6-2で済まないかを考えます。

上から順に行います。

1. **APIからの書き込みを、HTTPと定期実行の両方とも止めます。** APIを前の版に戻すだけでは、HTTPも定期実行も動き続けます。定期実行を止めるだけでは、HTTPからの書き込みが残ります。Cloudflareの画面で`threads-grower-api`の設定（Settings）を開き、次の2つを外します。
   - 定期実行（Cronのトリガー）
   - 外から届く入口（独自ドメインと`workers.dev`）
2. **戻す先の時刻のDBに合う、APIとWebの版を決めます。** その時刻に本番で動いていた版です（`wrangler deployments list`の日時と、Pagesのデプロイの一覧で探す）。6-1・6-2でその版に戻します。
3. **DBを戻します。** Neonの画面で本番のブランチを選び、Backup & Restore → **Restore from history** → From historyで1の時刻を指定 → Next → Restore。
   - 戻す前の状態は、`<ブランチの名前>_old_<時刻>`というブランチに自動で残ります。消えたデータを後から探すときに使えます。
   - 接続は一度切れますが、接続文字列は変わりません。
4. **書き込みを再開します。** 1で外した入口と定期実行を元に戻します（定期実行は、次のデプロイでも`wrangler.toml`の値に戻ります）。主な画面を開き、ログ（5の5）にエラーが続いていないことを確かめます。

**戻したあとに気をつけること**：DBの中のマイグレーションの記録も、戻した時刻のものになります。次に本番へ出すと、**同じマイグレーションがもう一度当たります**。原因がマイグレーションそのものだった場合は、次のリリースの前に、それがもう一度当たっても壊れないように直す方法を決めます。

## 7. 急ぎの修正

本番だけが壊れていて、`develop`を通す時間がないときの手順です（[contracts/deploy.md](../specs/015-deploy-environments/contracts/deploy.md) 5）。

1. `main`から`fix/…`を作り、`main`へのPRでマージする（本番に出る）。
2. 同じ変更を`develop`にも入れる（`main`→`develop`のPR）。
3. `git log --oneline origin/main ^origin/develop`が空になったことを確かめる。

急ぎの修正でも、マイグレーションの決まり（3）は同じです。
