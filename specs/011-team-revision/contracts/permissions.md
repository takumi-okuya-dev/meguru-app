# 関わりと権限：チームの見直し

**日付**：2026-10-13 | **計画**：[../plan.md](../plan.md) | 008の[permissions.md](../../008-team-operations/contracts/permissions.md)を置き換える

## 関わり（Relation）

`authorizeAccount(db, user, accountId, permission)`が、1回の問い合わせで次のどれかに決める。

| 関わり | 条件 |
|---|---|
| `owner` | `memberships`の`owner`の行がある |
| `assigned` | `memberships`の`editor`の行がある（編集者、または自分を担当にした管理者） |
| `shared_viewer` | そのアカウントの`team_accounts.shared = true`で、その人が同じチームの`team_members`にいる |
| （なし） | どれでもない → `ACCOUNT_NOT_FOUND`（404。存在を明かさない） |

上から順に見て、最初に当てはまったものにする（オーナーで担当、などは起きない）。

## 権限

| 権限 | 意味 | owner | assigned | shared_viewer |
|---|---|---|---|---|
| `read` | 投稿ストック・戦略（課題・宣伝内容・リサーチ）を読む | ○ | ○ | ○ |
| `view` | パフォーマンス・CSV・設定（読むだけ）・プロンプト・自動投稿の状態・ホームの入力状況を見る、最後に使ったAccountの記録 | ○ | ○ | ✕ |
| `content` | 投稿の案・戦略・改善メモを作る・直す、要確認の案を消す、貼り付けの一括登録 | ○ | ○ | ✕ |
| `review` | 承認・却下、承認済み・却下の案を消す | ○ | ✕ | ✕ |
| `settings` | 自動投稿・NGワード・投稿のルール・宣伝の割合・作る件数・接続を確かめる | ○ | ✕ | ✕ |
| `activity` | 操作の記録を見る | ○ | 管理者だけ○ | ✕ |
| `owner` | Threadsとの接続・アカウントの削除・チームに見せる | ○ | ✕ | ✕ |

- 008の任せる範囲（`Delegation`）はなくす。`permissionsFor(relation, { isTeamAdmin })`の形にする。
- 権限が足りないときは`ROLE_FORBIDDEN`（403）。

## ルートの権限の表（変わるもの）

`read`に下げるGET：

| ルート | 008 | 011 |
|---|---|---|
| `GET /api/accounts/:accountId` | view | read |
| `GET /api/accounts/:accountId/access` | view | read |
| `GET /api/accounts/:accountId/strategy` | view | read |
| `GET /api/accounts/:accountId/promotions` | view | read |
| `GET /api/accounts/:accountId/reference-posts` | view | read |
| `GET /api/accounts/:accountId/research-keywords` | view | read |
| `GET /api/accounts/:accountId/post-drafts` | view | read |
| `GET /api/accounts/:accountId/post-drafts/published` | view | read |
| `GET /api/accounts/:accountId/post-drafts/counts` | view | read |
| `GET /api/accounts/:accountId/team` | view | read |

消すルート：`/api/accounts/:accountId/partner-invite*`、`PATCH・DELETE /api/accounts/:accountId/partner`、`POST /api/accounts/:accountId/partner/joined-notice/dismiss`、`/api/team/*`。

ほかのAccountのルートは、008の表の権限のまま（`review`・`settings`はオーナーだけになる）。

## チームのAPIの判定

| 関数 | 許す人 | 違うとき |
|---|---|---|
| `authorizeTeamMember(db, user, teamId)` | そのチームの`team_members` | `TEAM_NOT_FOUND`（404） |
| `authorizeTeamAdmin(db, user, teamId)` | そのチームの管理者 | チームの人なら`ROLE_FORBIDDEN`（403）、でなければ`TEAM_NOT_FOUND` |

`/api/teams/:teamId/*`のすべてが、どちらかを通る（contracts/api.mdの表）。表にないチームのルートがあれば、ルートの一覧のテストが失敗する。

## 画面での出し分け

- `GET /api/accounts/:id/access`の応答に`relation`（`owner`・`assigned`・`shared_viewer`）、`permissions`、`team`（入っているチームの`id`・`name`・見ている人のロール）を返す。
- 見せてもらっているアカウントは専用の画面（`/teams/:teamId/accounts/:accountId`）で開く。Accountの画面（`/accounts/:id`）に`shared_viewer`で来たら、その画面へ移す。
