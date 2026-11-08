# API契約：Threadsで許可するときのアカウントの取り違えを減らす案内

**日付**：2026-11-08 | **計画**：[../plan.md](../plan.md)

001〜024のAPIの書き方に従う。新しいエラーコードはない。つなぐ・接続し直すAPIは変えない。

## GET /api/accounts/:accountId/connection-notice（新規）

- オーナーだけ（`authorizeAccount`、`owner`）。関わりがなければ`404 ACCOUNT_NOT_FOUND`、オーナーでなければ`403 ROLE_FORBIDDEN`。
- 招待の管理がOFFでも使える（research.md R6）。

```ts
// 200
{
  otherAccount: null | {
    appliedUsername: string;    // 申し込んだユーザー名
    connectedUsername: string;  // 実際につながったユーザー名
  };
}
```

`otherAccount`は、data-model.md 2の条件を満たす行があるときだけ値を持つ。

## POST /api/accounts/:accountId/connection-notice/dismiss（新規）

- オーナーだけ。
- 条件を満たす行の`mismatch_notice_dismissed_at`を今にする。
- 行がなくても`204`（何もしない）。
- 応答：`204`。

## 権限の表（`test/helpers/routes.ts`）

| メソッド | パス | 要る権限 |
|---|---|---|
| GET | `/api/accounts/:accountId/connection-notice` | owner |
| POST | `/api/accounts/:accountId/connection-notice/dismiss` | owner |
