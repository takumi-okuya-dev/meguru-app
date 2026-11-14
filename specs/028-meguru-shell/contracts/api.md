# API契約：めぐるの外枠とWebの分割

**日付**：2026-11-12 | **計画**：[../plan.md](../plan.md)

001〜027のAPIの書き方に従う。
- エラーは`{ error: { code, message, details? } }`。
- 新しい環境変数・エラーコードは足さない（入力の誤りは今の`VALIDATION_FAILED`）。

## 1. `GET /api/me`（項目を足す。PR3）

今の項目はすべてそのまま。`apps`を足す。

```json
{
  "apps": {
    "available": ["threads"],
    "using": ["threads"],
    "last": "threads",
    "landing": "threads"
  }
}
```

| 項目 | 意味 |
|---|---|
| `available` | その人に出せるアプリ（`APP_CATALOG`の`released`。一覧の順） |
| `using` | 使っているアプリ。Threadsは、`accounts`（オーナーと担当）が1件以上 |
| `last` | 最後に使ったアプリ（`users.last_app_id`）。`available`に入っていなければ`null` |
| `landing` | 入口の行き先。`last`が`using`に入っていれば`last`、なければ`using[0]`、なければ`null` |

- 今の`landingAccountId`（Threadsのホームの行き先）は変えない。
- 例：登録した直後の人 → `{ "available": ["threads"], "using": [], "last": null, "landing": null }`。

## 2. `PUT /api/me/last-app`（新規。PR3）

最後に使ったアプリを覚える。外枠が、アプリのパスの下の画面を開いたとき、`me.apps.last`がそのアプリでなければ呼ぶ。

- 認証：要る（今の`authed`）。契約の有無・テスト版の入場の制限は今の`/api/me`と同じ扱い（契約前でも呼べる）。
- 入力：`{ "app": "threads" }`（`lastAppRequestSchema`）
- 応答：`204`（本文なし）
- エラー：
  - `400 VALIDATION_FAILED`（`details: ["app"]`）：`app`が`APP_CATALOG`のIDでない、または`released`でない。
- 使っていないアプリでも覚えてよい（すべてのアプリの画面から「使い始める」で開いた直後など）。入口の行き先には、使い始めるまで効かない（1の`landing`）。
- 書くのは`users.last_app_id`だけ。`updated_at`も更新する。

## 3. APIが作るWebのURL（変える。PR3）

デプロイは API を Web より先に出す（`.github/workflows/deploy.yml`）。PR2 で API を先に変えると、Web が出るまでのあいだ、古い Web の知らない `/threads/…` へ人を送ってしまう。そのため PR2 では API は前のURLのまま返し、Web の前のURLの転送で受ける。`/threads/…` に変えるのは、PR2 の Web が出たあとの PR3（2026-11-12 のセルフレビュー）。

| 場所 | 変える前 | 変えた後 |
|---|---|---|
| `app.ts`：設定の不備で`/api/threads/callback`を断るとき | `${WEB_ORIGIN}/accounts/new?error=CONFIG_ERROR` | `${WEB_ORIGIN}/threads/accounts/new?error=CONFIG_ERROR` |
| `POST /api/threads/complete`の`redirectTo`：state が使えない・エラー | `/?error=<code>` | `/threads?error=<code>` |
| 同上：接続の完了・失敗（アカウントあり） | `/accounts/<番号>/settings?…` | `/threads/accounts/<番号>/settings?…` |

変えないもの：決済から戻るURL（`/settings/billing?checkout=…`）・ポータルから戻るURL（`/settings/billing`）・Metaのデータ削除の確認のURL（`/data-deletion/<code>`）・チームとテストのグループの招待のURL（`/invite/…`・`/test-invite/…`）・接続の戻り先（`/threads/complete`）。

## 4. テスト

- `GET /api/me`：`apps`の4つの項目（登録した直後・Threadsのアカウントあり・担当だけ・`last_app_id`が知らないID・`last_app_id`が`null`）。
- `PUT /api/me/last-app`：覚える・知らないIDで400・`released`でないIDで400・ログインなしで401。
- 3の3か所の`redirectTo`・転送先（今のテストの期待値を新しいURLに直す）。
- APIの入口の一覧のテスト（027の`routes-snapshot`）に`PUT /api/me/last-app`を足す。
