# API契約：チームの見直し

**日付**：2026-10-13 | **計画**：[../plan.md](../plan.md)

001〜010のAPIの書き方（エラーは`{ error: { code, message, details? } }`、日時はISO 8601）に従う。権限は[permissions.md](./permissions.md)。

## 新しいエラーコード

| code | HTTP | いつ |
|---|---|---|
| `TEAM_NOT_FOUND` | 404 | チームがない・チームの人でない（008のまま） |
| `TEAM_LIMIT_REACHED` | 409 | 管理者のチームが20に達した |
| `TEAM_FULL` | 409 | チームが50人、または編集者が10人に達した（`details: ["members"]`／`["editors"]`） |
| `TEAM_NEEDS_ACCOUNT` | 409 | 自分のアカウントを1つも選んでいない・持っていない |
| `ACCOUNT_IN_OTHER_TEAM` | 409 | 選んだアカウントがほかのチームに入っている（`details: [accountId]`） |
| `TEAM_LAST_ACCOUNT` | 409 | 最後のアカウントを外そうとした |
| `TEAM_ADMIN_MUST_TRANSFER` | 409 | 管理者が引き継ぎ先なしで抜けようとした |
| `TEAM_ADMIN_ALONE` | 409 | 管理者しかいないチームで抜けようとした（チームの削除を案内） |
| `INVITE_INVALID` | 404 | 使えない招待リンク（008のまま） |
| `INVITE_ALREADY_MEMBER` | 409 | すでにチームの人（008のまま） |

008のcodeのうち、`INVITE_SELF`と`PARTNER_ALREADY_EXISTS`は消す。`TEAM_EDITOR_LIMIT`は`TEAM_FULL`に置き換える。`ASSIGNMENT_NOT_ALLOWED`はそのまま使う。

## `/api/me`（変わる）

`partnerTeam`・`editorWaiting`を消し、`teams`を足す。

```json
{ "teams": [{ "id": "…", "name": "飲食チーム", "memberCount": 5, "role": "admin" }] }
```

- 入っているチームを`joined_at`の順に。チームに入っていなければ空（サイドバーに出さない）。
- `accounts`の`role`は`owner`か`editor`（担当）。担当のアカウントには`ownerName`を付ける（008のまま）。見せてもらっているアカウントは入れない。
- `GET /api/accounts/:accountId`の`role`は、見せてもらっている人には`viewer`（実装で足した。画面はこれを見て読むだけの画面へ移す）。

## チーム

| API | 判定 | 説明 |
|---|---|---|
| `POST /api/teams` | ログイン済み | `{ name, accountIds: string[] }`。自分がオーナーのアカウントを1つ以上。作った人が管理者。記録`team_created`（入れたアカウントに） |
| `GET /api/teams/:teamId` | member | チームの詳細（下） |
| `PATCH /api/teams/:teamId` | admin | `{ name }`。記録`team_renamed` |
| `DELETE /api/teams/:teamId` | admin | チームを消す。チームの人・アカウント・担当を外す。記録`team_deleted` |
| `GET /api/teams/:teamId/invite` | admin | `{ url, rotatedAt }` |
| `POST /api/teams/:teamId/invite/rotate` | admin | 文字列を差し替える。前のリンクはすぐ使えない |
| `PATCH /api/teams/:teamId/members/:userId` | admin | `{ role: "member" \| "editor" }`。管理者自身は不可。editor→memberで担当を消す。記録`team_role_changed` |
| `DELETE /api/teams/:teamId/members/:userId` | admin | 外す（自分は不可）。記録`team_member_removed` |
| `POST /api/teams/:teamId/leave` | member | `{ newAdminUserId?: string }`。管理者は`newAdminUserId`が必須（なければ`TEAM_ADMIN_MUST_TRANSFER`、ほかに誰もいなければ`TEAM_ADMIN_ALONE`）。記録`team_member_left`（と`team_admin_transferred`） |
| `POST /api/teams/:teamId/admin` | admin | `{ userId }`。抜けずに引き継ぐ。前の管理者は担当があれば編集者、なければメンバー。記録`team_admin_transferred` |
| `POST /api/teams/:teamId/accounts` | member | `{ accountId, shared?: boolean }`。自分がオーナーのアカウントを足す。記録`team_account_added` |
| `DELETE /api/teams/:teamId/accounts/:accountId` | member（そのアカウントのオーナー）／admin | チームから外す。最後の1つは`TEAM_LAST_ACCOUNT`。担当を消す。記録`team_account_removed` |
| `PATCH /api/teams/:teamId/accounts/:accountId` | member（そのアカウントのオーナーだけ） | `{ shared: boolean }`。記録`team_share_changed` |
| `GET /api/teams/:teamId/assignments` | admin | 担当の表：列＝チームのアカウント、行＝編集者と管理者、セル＝担当か |
| `PUT /api/teams/:teamId/assignments/:userId/accounts/:accountId` | admin | 担当にする（編集者か管理者、自分のアカウントは不可）。記録`assignment_added` |
| `DELETE /api/teams/:teamId/assignments/:userId/accounts/:accountId` | admin | 担当を外す。記録`assignment_removed` |
| `POST /api/teams/:teamId/members/:userId/joined-notice/dismiss` | admin | 参加の知らせを閉じる |

### `GET /api/teams/:teamId`の応答

```json
{
  "id": "…",
  "name": "飲食チーム",
  "myRole": "member",
  "admin": { "userId": "…", "name": "田中 健" },
  "members": [
    {
      "userId": "…",
      "name": "鈴木 花子",
      "role": "member",
      "isMe": true,
      "joinedAt": "…",
      "joinedNotice": false,
      "accounts": [
        { "id": "…", "username": "cafe_b_tokyo", "displayName": "カフェ B店", "shared": true, "canOpen": true }
      ]
    }
  ],
  "limits": { "members": 50, "editors": 10 }
}
```

- `canOpen`：見ている人が、そのアカウントを開けるか（オーナー・担当・見せている）。開けないアカウントは`username`・`displayName`だけ（`profilePictureUrl`はNULL）。
- `relation`（実装で足した）：見ている人の関わり（`owner`・`assigned`・`shared_viewer`、開けなければNULL）。チップの「見る」の行き先を決める。
- `joinedNotice`は、見ている人が管理者で、閉じていない参加の知らせのときだけtrue。
- 管理者以外には、招待のリンクと担当の表は返さない。

## 招待の確認と参加

| API | 判定 | 説明 |
|---|---|---|
| `GET /api/invites/:token` | ログインなしでも可 | `{ team: { name, adminName, memberCount }, viewer: { status, teamId, accounts: [{ id, displayName, username, profilePictureUrl, inOtherTeam }] } }`。`status`：`anonymous`（ログイン前）・`needs_account`（自分のアカウントがない）・`ready`・`already_member`。`inOtherTeam`はほかのチームの名前（入っていなければNULL）。`teamId`は`already_member`のときだけ |
| `POST /api/invites/:token/accept` | ログイン済み | `{ accounts: [{ id, shared }] }`（1件以上）。メンバーとして入り、アカウントを入れる。同じ人の同時の参加でも1回。記録`team_member_joined`（入れたアカウントに）。応答`{ teamId }` |

## Account（変わる）

| API | 変更 |
|---|---|
| `GET /api/accounts/:accountId/access` | `read`。応答に`relation`・`team`（`{ id, name, myRole } \| null`）・`assignedNotice`（担当の知らせを出すか）。`role`・`delegation`を消し、`hasTeam`の意味を改める（`hasTeam`＝チームに入っている） |
| `GET /api/accounts/:accountId/team` | `read`。応答：`{ team: { id, name, admin: { userId, name }, shared } \| null, owner, viewerUserId, assignees: [{ userId, name, role }] }`（009のカードを改める。FR-055。`shared`は設定の「チームに見せる」のスイッチに使う） |
| 投稿ストック・戦略のGET | `read`（permissions.mdの表）。見せてもらっている人には、`GET /post-drafts`の`ngWords`を空、`canGeneratePrompt`をfalseで返す（設定は見せない。FR-031） |
| `POST /api/accounts/:accountId/assigned-notice/dismiss` | `assigned`。担当の知らせを閉じる（R9） |
