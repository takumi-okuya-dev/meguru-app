# API契約：全保有Accountの要確認件数

**対象**：[spec.md](../spec.md) ／ **データモデル**：[data-model.md](../data-model.md) ／ **設計判断**：[research.md](../research.md) R1〜R3

## 新規：GET /api/me/needs-review-counts

切り替えメニューを開いたとき、ログイン中のユーザーが所有するすべてのAccountの要確認件数を1回で読む。既存の `GET /api/me` と、Account単位の `GET /api/accounts/:accountId/post-drafts/counts` は変更しない。

### 認証・対象

- 既存の `/api/me` と同じ認証が必要。未認証は既存の `401` エラー。
- クエリ文字列・リクエスト本文によるAccount IDの指定は受け付けない。サーバーが認証済みのユーザーIDと `Membership.role = owner` から対象を決める。
- チーム運用のパートナー・編集者のAccountは対象外（本featureの範囲外）。契約プランで件数の表示を制限しない。

### 200 応答

```json
{
  "counts": [
    { "accountId": "11111111-1111-4111-8111-111111111111", "needsReview": 2 },
    { "accountId": "22222222-2222-4222-8222-222222222222", "needsReview": 5 },
    { "accountId": "33333333-3333-4333-8333-333333333333", "needsReview": 0 }
  ]
}
```

- 各項目は `{ accountId: string, needsReview: integer >= 0 }`。同じIDを重複して返さない。
- 所有Accountすべてを含む。下書きがないAccountも `0` を返す。所有Accountがないときは `{ "counts": [] }`。
- `needsReview` はAccount単位の既存件数APIの `needsReview` と同じ `needs_review` の下書きの行数を意味する。公開済み・承認済み・却下済みは数えない。
- 件数と保有Accountの対応は取得時点のスナップショット。並び順は契約に含めず、Webは `accountId` で既存の `/api/me` の一覧と結ぶ。
- 本文や下書きID、ほかのユーザーのAccountの情報は返さない。
- `Cache-Control: no-store` とし、メニューを再度開いたときに古いHTTP応答を再利用しない。

### 失敗

- `401`：認証が無効。既存の共通認証エラーの形。
- 読み取りが失敗したときは、成功を装った `0` や空配列を返さず、既存の共通サーバーエラーの形で返す。
- このエンドポイントの失敗は `GET /api/me` の応答と既存の切り替え操作に影響しない。

### 境界と性能

- 所有Accountと `needs_review` の下書きを、Accountごとの繰り返しクエリではなく1回の集計として読む。
- 20件のAccountでもHTTP呼び出しは1回。Account×状態の既存の検索インデックスを使える形にする。
- 契約上、件数の取得中・取得失敗・真の0件は異なる状態。Webは取得失敗時にキャッシュ済みの数を現在の数として表示しない。

## 既存：GET /api/me

アカウント一覧の基準。所有Accountの表示名・@ユーザー名・接続状態・最後に使った順、`landingAccountId`、アカウント追加上限を返す。応答の形は変えない。メニューを開くたびに読み直しに成功した一覧を使い、削除済みAccountを表示しない。件数の取得失敗時にも一覧と行選択は使える。

## 既存：GET /api/accounts/:accountId/post-drafts/counts

表示中のAccountのサイドバーと投稿ストックが使う件数API。応答と認可を変えない。007の横断件数と同じ `needsReview` の定義を保つ。
