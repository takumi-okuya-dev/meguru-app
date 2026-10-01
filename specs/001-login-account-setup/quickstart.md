# 動作確認ガイド（Quickstart）：ログインとThreadsアカウント登録

**対象feature**：[spec.md](./spec.md) ／ **契約**：[contracts/api.md](./contracts/api.md)、[contracts/ui-routes.md](./contracts/ui-routes.md)

本featureが端から端まで動くことを確かめる手順。実装コードは含めない。各コマンドの中身は実装フェーズ（`tasks.md`）で用意する。

## 前提

- Node.js 22 LTS、pnpm、Docker、`cloudflared`がインストールされている。
- 外部サービスのアカウントと設定：
  - **Clerk**：開発用インスタンス。ログイン手段はGoogleのみを有効にする（research.md R2）。
  - **Meta**：Threadsのユースケースを持つアプリ。テスターとして自分のThreadsアカウントを追加し、Threadsアプリの「設定 → アカウント → ウェブサイトのアクセス許可 → 招待」で承認しておく。
  - **Cloudflare Tunnel**：固定のホスト名（例：`api-dev.<自分のドメイン>`）をローカルのAPI（`localhost:8787`）に向けておく。
- Metaのアプリ設定に次のURLを登録する（research.md R3・R7）：
  - リダイレクトコールバックURL：`https://api-dev.<自分のドメイン>/api/threads/callback`
  - アンインストールのコールバックURL：`https://api-dev.<自分のドメイン>/api/threads/webhooks/uninstall`
  - データ削除のコールバックURL：`https://api-dev.<自分のドメイン>/api/threads/webhooks/data-deletion`

## セットアップ

```bash
pnpm install
docker compose up -d                 # Postgres 17 + local-neon-http-proxy
cp apps/api/.dev.vars.example apps/api/.dev.vars   # 環境変数（contracts/api.md の表）を埋める
cp apps/web/.env.example apps/web/.env.local       # Clerkの公開キーとAPIのURL
pnpm --filter api db:migrate
```

## 自動テスト

```bash
pnpm --filter api test     # API：Workersランタイム上、ローカルDB、偽のThreadsサーバー
pnpm --filter web test     # Web：コンポーネントとルーティングのガード
pnpm e2e                   # Playwright：Clerkのテスト用ログイン + 偽のThreadsサーバー
```

**期待する結果**：すべて成功する。とくに次のテストがあり、成功していること。

| テスト | 確かめること | 対応 |
|---|---|---|
| 上限の同時実行 | 上限1件のユーザーで2つのcallbackを同時に処理しても、作られるAccountは1件だけ | FR-017、research.md R8 |
| 他人のThreadsアカウント | 別ユーザーが登録済みの`threads_user_id`で`THREADS_ACCOUNT_TAKEN`になる | FR-012 |
| 自分のAccountの再接続 | 同じ`threads_user_id`ならAccountは増えず、接続情報だけ更新される | FR-013 |
| 別アカウントでの再接続 | `RECONNECT_ACCOUNT_MISMATCH`になり、接続情報は変わらない | FR-020 |
| `state`の使い回し | 同じ`state`で2回目のcallbackは`OAUTH_STATE_INVALID`になる | research.md R4 |
| 平文が出ない | APIのレスポンスとログの出力に、偽サーバーが返したトークン文字列が含まれない | FR-010、SC-005 |
| 暗号文の付け替え | 別のAccountの`account_id`をAADにすると復号に失敗する | research.md R5 |
| 定期更新 | 期限まで7日を切った接続は更新され、認証エラーなら`needs_reconnect`になる | FR-018、FR-021 |
| 削除の確認 | `confirmUsername`が違えば`422`で何も消えず、一致すれば関連行がすべて消える | FR-022 |
| 未ログインのガード | 認証が必要なルートは、内容を描画せずに`/sign-in`へ遷移する | FR-003、SC-003 |

## 手動での確認（本物のGoogleとThreadsを使う）

```bash
pnpm dev                             # web（Vite）と api（wrangler dev）を同時に起動
cloudflared tunnel run <トンネル名>   # 別ターミナルで
```

各シナリオの「期待」が満たされればOK。番号はspec.mdの受け入れシナリオに対応する。

### US1：初回ログインと最初の登録

1. まだ使ったことのないGoogleアカウントで、`http://localhost:5173/`を開く。
   - **期待**：`/sign-in`に遷移する。
2. 「Googleでログイン」を選んで許可する。
   - **期待**：`/accounts/new`に遷移し、テスター制限の案内が表示される（US1-1）。
3. 「Threadsアカウントを接続」を選び、Threadsの画面で許可する。
   - **期待**：`/accounts/:id`に遷移し、プロフィール画像・表示名・@ユーザー名と「@… を追加しました」が表示される（US1-2）。ここまで3分以内（SC-001）。
4. 別のブラウザで新しいユーザーとしてログインし、Threadsの画面で「キャンセル」を選ぶ。
   - **期待**：`/accounts/new`に戻り、「接続がキャンセルされました」と再試行のボタンが出る（US1-4）。

### US2：再訪とログアウト

1. ログアウトする。
   - **期待**：`/sign-in`に遷移し、ブラウザの「戻る」でもAccountの内容が出ない（US2-4）。
2. ログアウトした状態で`/accounts/<さっきのid>`を直接開く。
   - **期待**：`/sign-in`に遷移する（US2-1）。
3. もう一度ログインする。
   - **期待**：さっきのAccountの画面に直接遷移する（US2-2）。

### US3：複数Accountと上限

1. プラン1のまま、サイドバーの「＋ 追加」を開く。
   - **期待**：接続ボタンが無効で、上限の案内が出る（US3-2）。
2. 運営者用スクリプトでプランを上げる：`pnpm --filter api admin:set-plan <accountId> multi-account`。
3. 2つ目のテスター用Threadsアカウントを接続する。
   - **期待**：2件目が一覧に出る（US3-1）。
4. サイドバーで1件目に切り替えてからログアウトし、再びログインする。
   - **期待**：1件目の画面に戻る（US3-3）。

### US4：再接続と削除

1. Threadsアプリの「設定 → アカウント → ウェブサイトのアクセス許可」で、このアプリを削除する。
   - **期待**：数秒〜数分でアンインストールのcallbackが届き、そのAccountに「要再接続」のバナーと警告アイコンが出る（US4-1）。
2. 「再接続」を選び、同じThreadsアカウントで許可する。
   - **期待**：「再接続しました」と表示され、警告が消える（US4-2）。1分以内（SC-007）。
3. もう一度「再接続」を選び、別のThreadsアカウントで許可する。
   - **期待**：`RECONNECT_ACCOUNT_MISMATCH`の文言が出る（US4-3）。
4. 設定画面で「Accountを削除」を選び、@ユーザー名を入力して確定する。
   - **期待**：一覧から消え、上限の使用数が1減る（US4-4）。

### 秘密情報の確認

```bash
pnpm --filter api db:psql -c "select access_token_ciphertext from threads_connections limit 1"
```

- **期待**：暗号文（バイト列）だけが見え、トークンの平文は見えない。
- `wrangler dev`のログを`access_token`・`code=`・`client_secret`で検索して、何も見つからないことを確かめる（SC-005）。
