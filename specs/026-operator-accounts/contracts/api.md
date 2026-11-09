# API契約：運営者がすべてのアカウントを接続方法ごとに確かめられる一覧

**日付**：2026-11-09 | **計画**：[../plan.md](../plan.md)

001〜025のAPIの書き方に従う。新しいエラーコードはない。書き込むAPIはない。

## GET /api/operator/accounts（新規）

- 運営者だけ（`operatorOnly`）。運営者でなければ`403 OPERATOR_ONLY`。応答は`Cache-Control: no-store`。
- 招待の管理がON・OFFにかかわらず使える。

**クエリ**（`operatorAccountsQuerySchema`）

| 名前 | 型 | 既定 | 意味 |
|---|---|---|---|
| `method` | `all` \| `app` \| `token` \| `none` | `all` | 接続方法の絞り込み |
| `q` | string（前後の空白を除いて0〜100文字） | なし | 検索語（research.md R3）。空なら検索しない |
| `cursor` | string（`YYYY-MM-DDTHH:MM:SS.ffffffZ_<uuid>`） | なし | 続きの印（前のページの`nextCursor`をそのまま渡す。research.md R2） |

- 値が合わなければ`400 VALIDATION_FAILED`（`details`に項目の名前）。
- `cursor`のアカウントが消えていても、その位置の続きを返す。

**応答 200**（`operatorAccountsSchema`）

```ts
{
  counts: { all: number; app: number; token: number; none: number }; // 検索に左右されない（data-model.md 3）
  items: Array<{
    id: string;
    name: string;
    username: string | null;
    method: "app" | "token" | "none";
    status: "connected" | "needs_reconnect" | "not_connected";
    owner: { name: string | null; email: string; accountCount: number } | null; // accountCount：そのオーナーのすべてのアカウントの数（絞り込み・検索に左右されない）
    tester: "pending" | "invited" | "connected" | "removable" | null;
    createdAt: string;
  }>; // 作った日の新しい順、最大50件
  nextCursor: string | null; // 続きがなければ null
}
```

## 権限

- 運営者の関所（`operatorOnly`）を通す。アカウントごとの権限の表（`test/helpers/routes.ts`）には入れない（今の`/api/operator/*`と同じ）。
