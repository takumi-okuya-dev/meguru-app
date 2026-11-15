# Quickstart：テスト用のグループ

**Feature**：[spec.md](./spec.md) | **計画**：[plan.md](./plan.md)

## 1. 自動のテスト

```bash
pnpm --filter api test -- test-groups     # API：参加・止め方・運営者・定期処理
pnpm --filter api test -- billing-sql-parity migration-0016
pnpm --filter web test -- test-invite test-groups test-access
pnpm test && pnpm typecheck && pnpm lint  # 全体（OFFの既存のテストが変わらないこと）
```

## 2. 手元で試す（ON）

1. `apps/api/.dev.vars`の`TEST_GROUPS_ENABLED`を`"true"`にし、`OPERATOR_CLERK_USER_IDS`に自分のClerkのユーザーID（Clerkのダッシュボードの「Users」で`user_…`）を入れる。`pnpm dev`を起動し直す。
2. 自分（前からいる人・運営者）でログインし、「設定」に「運営 › テスト用のグループ」が出ることを確かめる。
3. 上限2人のグループを作り、招待リンクをコピーする。
4. 別のGoogleアカウント（Chromeの別のプロファイル）でリンクを開く。注意の3行と「Googleで始める」が出る → ログイン → 「参加する」 → ホームが開く。
5. 3人目のアカウントで同じリンクを開くと、2人入るまでは参加でき、3人目は「定員に達しています」。
6. リンクを使わずにログインした人は「テスト版は招待された方だけが使えます」になる。
7. 運営者の画面で1人を外す → その人は次の操作で「招待された方だけ」の画面になる。記録に「外しました」が出る。
8. `TEST_GROUPS_ENABLED`を`"false"`に戻すと、誰でも使え、招待リンクは「このリンクは使えません」、「運営」の区分は出ない。

## 3. テスト環境に出すとき

1. 運営者のIDを入れる（値は画面に出さず、手元のターミナルで）：

   ```bash
   cd apps/api && npx wrangler secret put OPERATOR_CLERK_USER_IDS --env staging
   ```

2. `develop`にマージすると、`wrangler.toml`の`TEST_GROUPS_ENABLED = "true"`（staging）で出る。マイグレーションで、今いる人はそのまま使える（`signed_up_open = true`）。
3. 本番は`TEST_GROUPS_ENABLED = "false"`のまま（何も変わらない）。
4. 記録は[docs/staging-setup-record.md](../../docs/staging-setup-record.md)に足す。
