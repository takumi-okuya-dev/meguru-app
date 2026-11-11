# 分割の前のルートと基準（T001、2026-11-12）

## テストの成功数

- Web：84ファイル・751件
- 共有：50ファイル・512件
- API：手元のDB（Docker）が動いていないため、CIの数を基準にする

## ルートの一覧（`apps/web/src/router.tsx`）

ログインのいらないルート：

- `/sign-in/*`
- `/data-deletion/:code`
- `/terms`（PlainPage）
- `/legal/commerce`（PlainPage）
- `/guide/threads-token`（PlainPage）
- `/invite/:token`
- `/test-invite/:token`
- `/r/:code`

ログインの要るルート（RequireAuth）：

- `/`
- `/accounts/new`
- `/threads/complete`
- `/settings`（index・appearance・account・billing・referral・features・test-groups・test-groups/:groupId・tester-invites・operator-accounts・limits）
- `/teams/:teamId`（index・assign・status）
- `/teams/:teamId/accounts/:accountId`
- `/accounts/:accountId`（index・settings・strategy・promotions・external-media・external-media/:promotionId/:media・research・create・stock・performance・analysis・activity）

そのほか：

- `*`（NotFound）
