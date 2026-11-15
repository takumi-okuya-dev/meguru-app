# リリースの手順書

ステージングと本番に出す・戻すときの手順です（運用手順書）。ふだんの開発の決まりは[docs/rules/](./rules/development-flow.md)。

- ブランチの決まり（`main`・`develop`・`feature/*`）は[開発の流れの決まり](./rules/development-flow.md) 1と[Constitution](../.specify/memory/constitution.md)「開発ワークフロー」。
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

ブランチ・PR・レビュー・CI・マージの決まりは、2026-11-15に[開発の流れの決まり](./rules/development-flow.md)へ移した。設定で止められるように作る決まりは[コードの書き方の決まり](./rules/coding.md) 2。

## 3. マイグレーションの決まり

2026-11-15に[コードの書き方の決まり](./rules/coding.md) 3へ移した（前の版のAPIでも壊れない形だけにする・消す/名前を変えるときは何回かに分ける・`develop`に入ったファイルは書き換えない）。

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
- [ ] このリリースに入るマイグレーションを読み、[コードの書き方の決まり](./rules/coding.md) 3に沿っている。

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
2. ラベル`run-ci`を付けてCIを流し、成功を確かめてマージする（リリースのPRはコードを含むので、必ず流す）。
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
| 新しい機能だけがおかしい（設定で止められる作り） | その機能の設定を「切」にする（[コードの書き方の決まり](./rules/coding.md) 2） |
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

- 数秒で切り替わります。DB・KVの中身は戻りません（[マイグレーションの決まり](./rules/coding.md)を守っていれば、前の版のAPIでも動きます）。
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
