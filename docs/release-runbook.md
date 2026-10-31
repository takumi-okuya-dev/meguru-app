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
- **大きな機能は、設定で止められるように作る**。`BILLING_ENABLED`・`THREADS_CONNECT_METHODS`と同じ形で、`apps/api/wrangler.toml`の環境ごとの`vars`で切り替える。
  1. 本番は「切」のまま出す。
  2. ステージングで「入」にして確かめる。
  3. 問題がなければ、本番も「入」にする（`[env.production.vars]`の1行を変えるPR）。

  こうしておくと、出したあとに困っても**コードを戻さず、設定の1行で止められる**。
- 環境ごとの違いを、コードの分岐（`if (APP_ENV === "production")`など）にしない。設定の値で分ける。

## 3. マイグレーションの決まり

デプロイは**マイグレーション → API → Web**の順に動き、途中で止まると「DBだけ新しく、アプリは前の版」のまま残ります。さらに、APIを前の版に戻したとき（6-1）も、DBは新しいままです。だから、**マイグレーションは前の版のアプリでも壊れない形だけ**にします（[research.md R4](../specs/015-deploy-environments/research.md)）。

| 変更 | 1回で出してよいか |
|---|---|
| 表を足す | よい |
| 列を足す（空を許す、または既定値つき） | よい |
| 索引を足す | よい |
| 列を足す（`NOT NULL`で既定値なし） | **だめ**。前の版のアプリの`INSERT`が失敗する |
| 列や表を消す | **2回に分ける** |
| 列や表の名前を変える | **2回に分ける** |
| 列の型を変える | **2回に分ける**（新しい列を足して写す） |
| 既存の行が通らないかもしれない制約（`UNIQUE`・`CHECK`・`NOT NULL`）を付ける | **2回に分ける**（先に行を直す） |

**2回に分ける例**：列`title`を`headline`に変える

1. 1回目のリリース：`headline`を足し、`title`の値を写す。アプリは両方に書き、`headline`を読む。
2. 2回目のリリース（1回目が本番で落ち着いてから）：アプリが`title`を使わなくなったことを確かめて、`title`を消す。

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
- [ ] 本番のDBに、戻せる地点を作った（6-3の1）。マイグレーションがあるリリースでは必ず。
- [ ] 出したあと30分ほど、様子を見られる時間がある（夜遅くや出かける前に出さない）。

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

**1. リリースの前に、戻せる地点を作る**（4のチェック）

Neonの本番のプロジェクトで、Branches → **New branch** から、今の`main`（`production`）を元にしたブランチを作ります。名前は`before-release-YYYYMMDD`のようにします。

- 中身を写さずに作るので、すぐにでき、容量もほとんど使いません。
- 落ち着いたら（例：1週間後）消します。プランにはブランチの数の上限があります。

**2. 戻すとき**

Neonの画面の復元（Restore）から、1で作ったブランチ、または保持期間内の時刻に戻します。何時間前まで戻せるかはプランで決まるので、公開の前にNeonの画面で確かめておきます。

- **戻した時刻より後に書かれたデータは消えます**（その間の投稿の予約や決済の記録など）。DBを戻すのは最後の手段で、まず6-1・6-2で済まないかを考えます。
- 戻す前に、Cloudflareの画面でAPIの定期実行を止めるか、APIを前の版に戻してから行います。

## 7. 急ぎの修正

本番だけが壊れていて、`develop`を通す時間がないときの手順です（[contracts/deploy.md](../specs/015-deploy-environments/contracts/deploy.md) 5）。

1. `main`から`fix/…`を作り、`main`へのPRでマージする（本番に出る）。
2. 同じ変更を`develop`にも入れる（`main`→`develop`のPR）。
3. `git log --oneline origin/main ^origin/develop`が空になったことを確かめる。

急ぎの修正でも、マイグレーションの決まり（3）は同じです。
