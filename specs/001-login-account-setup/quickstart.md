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
| 鍵のローテーション | 鍵リングに新旧の鍵を入れて現在のバージョンを上げると、旧鍵の行も復号でき、新規の暗号化は新鍵になる。移行スクリプトの後は旧バージョンの行が0件になる。鍵が欠けたバージョンの行は復号エラーになり、接続状態は変わらない | research.md R5 |
| 定期更新 | 期限まで7日を切った接続は更新され、認証エラーなら`needs_reconnect`になる | FR-018、FR-021 |
| 削除の確認 | `confirmUsername`が違えば`422`で何も消えず、一致すれば関連行がすべて消える。`@takumi`・`takumi`・` @Takumi `のどれでも一致する | FR-022 |
| 上限到達時の再認可 | 上限に達したユーザーでも、`mode = reconnect`なら接続中のAccountを認可し直せ、Accountは増えない | FR-013、FR-020 |
| Cronと再接続の競合 | Cronがトークンを読んだ後に再接続が完了すると、Cronの更新結果・認証エラーは反映されず、新しい接続が`connected`のまま残る | research.md R6 |
| 接続行の作り直し（ABA） | Cronがトークンを読んだ後に、アンインストールで接続行が消え、再接続で作り直されても、Cronの結果は新しい接続に反映されない | research.md R6 |
| 画面を開いたときの確認 | 偽サーバーでトークンを無効にしてから`POST /api/accounts/:id/open`を呼ぶと、そのレスポンスで`needs_reconnect`になり、`GET /api/me`の一覧にも反映される | FR-018、SC-007 |
| 最後に使ったAccountの記録 | `open`が2回失敗しても3回目の再試行で記録され、次の`GET /api/me`の`landingAccountId`がそのAccountになる | FR-007、SC-004 |
| 古い`open`の再試行 | Aの`open`が失敗して再試行を待つ間にBを開くと、Aの再試行は中止される。中止をすり抜けてAの古い`openedAt`のリクエストが後から届いても、`landingAccountId`はBのまま | FR-007、research.md R10 |
| データ削除要求 | 署名の正しい`signed_request`でAccountと関連行がすべて消え、状況確認APIが`completed`を返す。削除を失敗させると`failed`になり、Cronの再試行で`completed`になる | research.md R7 |
| 中断した削除要求の回収 | 受付の記録だけ残して処理を中断した`pending`の要求は、15分経つ前のCronでは再試行されず、15分経った後のCronで`completed`になる。`failed`の要求も同じリースで扱われる | research.md R7 |
| 再試行Workerの重複 | 2つのWorkerが同じ古い要求を読み取り、Aが削除して`completed`にした後、ユーザーが新しい認可フローで再接続する。その後でBが処理を続けても、Bはclaimに失敗して何も削除せず、再接続したAccountが残る | research.md R7 |
| 削除要求とcallbackの競合 | 認可フローを始めた後に削除要求を処理すると、そのcallbackは`THREADS_DATA_DELETION_REQUESTED`になり、Accountは作られない。削除要求より後に始めた認可フローは成功する | research.md R7 |
| 削除後の識別子 | 完了した削除要求の平文のIDはNULLになっている。完了から15分以上経った後のCronでhmacもNULLになる | research.md R7 |
| `state`の漏えい防止 | `authorizeUrl`以外のレスポンスとログの出力に、`state`の値が含まれない | FR-010 |
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
   - **期待**：アンインストールのcallbackが届けば、そのAccountに「要再接続」のバナーと警告アイコンが出る。callbackが届かなくても、そのAccountの画面を開き直した時点で「要再接続」になる（US4-1、SC-007）。
2. 「再接続」を選び、同じThreadsアカウントで許可する。
   - **期待**：「再接続しました」と表示され、警告が消える（US4-2）。1分以内（SC-007）。
3. もう一度「再接続」を選び、別のThreadsアカウントで許可する。
   - **期待**：`RECONNECT_ACCOUNT_MISMATCH`の文言が出る（US4-3）。
4. プラン1（上限1件）のまま、接続中のAccountの設定画面で「Threadsとの接続を認可し直す」を選び、同じThreadsアカウントで許可する。
   - **期待**：上限の案内は出ず、Accountは増えずに接続が更新される（US4-5）。
5. 設定画面で「Accountを削除」を選び、`@`付きの@ユーザー名を入力して確定する。
   - **期待**：一覧から消え、上限の使用数が1減る（US4-4）。

### Metaのデータ削除要求

1. テスター用のThreadsアカウントでAccountを登録しておき、Threadsアプリの「ウェブサイトのアクセス許可」から、このアプリへのデータ削除を要求する。
   - **期待**：Account一覧からそのAccountが消える。Metaに返した確認URL（`/data-deletion/:code`）を開くと「削除が完了しました」と完了日時が表示される。

### 秘密情報の確認

```bash
pnpm --filter api db:psql -c "select access_token_ciphertext from threads_connections limit 1"
```

- **期待**：暗号文（バイト列）だけが見え、トークンの平文は見えない。
- `wrangler dev`のログを`access_token`・`code=`・`client_secret`で検索して、何も見つからないことを確かめる（SC-005）。
