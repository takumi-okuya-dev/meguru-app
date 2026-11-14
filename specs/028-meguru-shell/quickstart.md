# 確かめ方（Quickstart）：めぐるの外枠とWebの分割

**日付**：2026-11-12 | **計画**：[plan.md](./plan.md)

## 0. 準備

```sh
docker compose up -d --wait      # 手元のDB（APIのテストとE2E）
pnpm install
pnpm --filter api db:migrate     # PR3のあと：0025（users.last_app_id）
```

## 1. どのPRでも流すもの

```sh
pnpm typecheck
pnpm lint          # 境界の規則のテスト（node --test）と ESLint
pnpm test          # 共有・Web・API
pnpm e2e           # PR2・PR3（URLを変えるもの）
```

期待：すべて通る。テストの数は前のPRより減らない（spec SC-003）。

## 2. 境界のチェック（PR1、spec US2・SC-004）

1. `apps/web/src/shell/`のファイルに`import { threadsApp } from "@/apps/threads";`を書く → `pnpm lint`が②で失敗する。
2. `apps/web/src/apps/threads/`のファイルで`@/shell/layout/Sidebar`を読む → ③で失敗する。`@/shell`なら通る。
3. `apps/web/src/lib/`のファイルで`@/shell`を読む → ④で失敗する。
4. `apps/web/src/pages/foo.tsx`を置く → ⑦で失敗する。
5. 試したコードを消す。`pnpm lint`で違反0件（地図の例外を除く）。

規則のテスト（`eslint-rules/web-module-boundaries.test.js`）が、①〜⑦と仮のアプリ（`apps/sample/`）を確かめている。

## 3. URLと転送（PR2、spec US1）

`pnpm dev`で手元のWeb（`http://localhost:5173`）を開き、Threadsのアカウントを持つ人でログインする。

| 操作 | 期待 |
|---|---|
| `/` を開く | `/threads/accounts/<番号>`（最後に使ったアカウントのホーム）。サイドバーは今と同じで、アプリの切り替えは出ない |
| `/accounts/<番号>/external-media?view=work` を開く | `/threads/accounts/<番号>/external-media?view=work` に移る。戻るボタンで前のURLに戻らない |
| `/teams/<番号>/assign` を開く | `/threads/teams/<番号>/assign` |
| ログアウトして `/accounts/<番号>/stock` を開く | `/threads/accounts/<番号>/stock` → ログインの画面（ログインのあとは、分割の前と同じく入口 `/` から最後に使ったアカウントへ） |
| `/terms`・`/guide/threads-token`・`/invite/<トークン>`・`/r/<コード>` を開く | URLは変わらず、今と同じ画面 |
| アカウントの設定から接続する（`pnpm dev:fake`） | `/threads/complete` → `/threads/accounts/<番号>/settings?connected=…` |
| `/threads/nothing` を開く | 見つかりません |

## 4. 見た目が変わらないこと（PR2、spec SC-002）

ステージングで、PR2のデプロイの前後に、Threadsだけを使っている人で次の画面のスクリーンショットを撮り、URLのほかに差がないことを見比べる（1024px以上と、スマホの幅）。

ホーム・投稿をつくる・投稿ストック・このアカウントの設定・チーム・設定（外観）

## 5. すべてのアプリと入口（PR3、spec US3）

| 操作 | 期待 |
|---|---|
| 新しい人で登録してログインする | `/apps`。「足せるアプリ」にめぐる Threads（月1,000円・「詳しく見る」・「使い始める」）。「使っているアプリ」の区分は出ない |
| 「詳しく見る」 | 説明が開く。使い始めたことにはならない（`/` を開き直しても `/apps`） |
| 「使い始める」 | `/threads/accounts/new`。そこから先は今と同じ（契約前なら契約前の画面） |
| アカウントを作ったあとで `/` を開く | `/threads/accounts/<番号>` |
| ユーザーメニュー → 「すべてのアプリ」 | `/apps`。Threadsは「使っているアプリ」 |
| ログアウトして紹介リンク `/r/<コード>` から登録する | `/apps` を挟まず、Threadsの「アカウントを作る」 |
| `GET /api/me` | `apps`：`available`・`using`・`last`・`landing`（contracts/api.md 1） |

## 6. アプリの切り替え（PR3、spec US4）

本番の利用者には出ないので、Webのテストで確かめる（research.md R13）。

```sh
pnpm --filter web test -- app-switcher
```

確かめていること：仮のアプリを足した一覧で、両方を使っている人にアプリの切り替えが出る・1本の人には出ない・切り替えでそのアプリのホームへ移る・`landing`が仮のアプリなら入口で仮のアプリが開く・アプリのパスを開くと`PUT /api/me/last-app`を1回呼ぶ・仮のアプリを足すのに外枠を直していない（`buildRoutes`に渡す一覧だけ）。

## 7. マイグレーション（PR3）

```sh
pnpm --filter api db:generate   # 0025 のあとは「変更なし」
```
