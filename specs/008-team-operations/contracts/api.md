# API：チーム運用（008）

既存の約束（JSON、`/api`の下、Clerkのセッションで認証、エラーは`{ error: { code, message, details? }, latest? }`）は001〜007と同じ。権限は[permissions.md](./permissions.md)。型は`packages/shared/src/schemas.ts`にzodで置く。

## 新しいエラーコード

| コード | HTTP | いつ |
|---|---|---|
| `ROLE_FORBIDDEN` | 403 | Accountには関わっているが、その操作の権限がない。`details`は足りない権限 |
| `INVITE_INVALID` | 404 | 招待リンクが見つからない（作り直された・取り消された・参加済み・Accountが削除された） |
| `INVITE_SELF` | 409 | 自分がオーナー（またはチームのパートナー）の招待に参加しようとした |
| `INVITE_ALREADY_MEMBER` | 409 | すでにそのAccount（チーム）に関わっている。`details`に`accountId`（ある場合） |
| `PARTNER_ALREADY_EXISTS` | 409 | そのAccountにはすでにパートナーがいる（招待リンクを作る・参加の競合） |
| `TEAM_EDITOR_LIMIT` | 409 | 編集者が上限（10人） |
| `ASSIGNMENT_NOT_ALLOWED` | 409 | 担当にできないAccount（手伝う先でも、パートナー自身のAccountでもない） |

`STALE_UPDATE`（409、既存）の応答に`updatedBy: { name: string } | null`を足す（research.md R8）。

## 権限

### `GET /api/accounts/:accountId/access`

権限：`view`。画面の出し分けに使う。

```json
{
  "role": "owner | partner | editor",
  "permissions": ["view", "content", "review", "settings", "activity", "owner"],
  "owner": { "name": "鈴木 花子" },
  "hasTeam": true,
  "team": { "name": "A社", "partnerName": "田中 健" },
  "delegation": { "review": true, "settings": false }
}
```

- `team`・`delegation`は、パートナーがいないときNULL。
- `Cache-Control: no-store`。

## パートナーの招待（オーナー）

| API | 権限 | 説明 |
|---|---|---|
| `GET /api/accounts/:accountId/partner-invite` | `owner` | `{ invite: { url, createdAt } \| null }` |
| `POST /api/accounts/:accountId/partner-invite` | `owner` | なければ作る、あればそのまま返す（同じ要求を繰り返しても1本）。パートナーがいれば`PARTNER_ALREADY_EXISTS`。記録`partner_invite_created` |
| `POST /api/accounts/:accountId/partner-invite/rotate` | `owner` | 文字列を差し替えて返す。前のリンクはすぐ使えない。記録`partner_invite_rotated` |
| `DELETE /api/accounts/:accountId/partner-invite` | `owner` | 消す。記録`partner_invite_canceled` |

`url`は`{WEB_ORIGIN}/invite/{token}`（research.md R4）。

## チーム（このAccountを手伝っている人）

### `GET /api/accounts/:accountId/team`

権限：`view`（編集者も見られる。FR-042）。

```json
{
  "partner": { "userId": "…", "name": "田中 健", "teamName": "A社", "joinedAt": "…" } ,
  "delegation": { "review": false, "settings": false },
  "editors": [{ "userId": "…", "name": "佐藤 美咲" }],
  "joinedNotice": { "show": true }
}
```

- パートナーがいなければ`partner`・`delegation`はNULL、`editors`は空（パートナー自身のAccountで自社の編集者が担当している場合は、`editors`だけ入る）。
- `joinedNotice.show`は、オーナーで、パートナーの参加の知らせを閉じていないときだけtrue（FR-047(1)）。

| API | 権限 | 説明 |
|---|---|---|
| `PATCH /api/accounts/:accountId/partner` | `owner` | `{ delegation: { review?: boolean, settings?: boolean } }`。記録`delegation_changed`（前後の値） |
| `DELETE /api/accounts/:accountId/partner` | `owner` | パートナーを外す。`account_partners`と、そのチーム経由の`memberships`（partner・editor）を消す。記録`partner_removed`（名前と、担当が外れた編集者の名前） |
| `POST /api/accounts/:accountId/partner/joined-notice/dismiss` | `owner` | 参加の知らせを閉じる |

## 招待の確認と参加

### `GET /api/invites/:token`（ログイン不要）

```json
{
  "kind": "partner | editor",
  "account": { "displayName": "カフェ B店", "username": "cafe_b_tokyo", "profilePictureUrl": "…" },
  "inviterName": "鈴木 花子",
  "team": { "name": "A社", "partnerName": "田中 健", "editorsRemaining": 7 },
  "viewer": { "status": "anonymous | can_join | already_member | self | limit_reached", "accountId": "…" }
}
```

- `kind = partner`：`account`と`inviterName`（オーナー）。すでにパートナーがいれば`INVITE_INVALID`。
- `kind = editor`：`team`と`inviterName`（パートナー）。`account`はNULL。
- `viewer`は、ログインしていれば、その人が参加できるかを返す（ボタンの出し分け）。ログインしていなければ`anonymous`。
- 見つからなければ404 `INVITE_INVALID`。

### `POST /api/invites/:token/accept`（ログイン必須）

本文：`{ teamName?: string }`（初めてパートナーになるときだけ使う。50文字まで、空ならNULL）。

- 成功：`{ kind, accountId | null }`。パートナーは手伝うAccountのID、編集者はNULL（担当なし）。
- 1つのトランザクションで行う（research.md R7）。エラー：`INVITE_INVALID`・`INVITE_SELF`・`INVITE_ALREADY_MEMBER`・`PARTNER_ALREADY_EXISTS`・`TEAM_EDITOR_LIMIT`。
- 記録：パートナーの参加は、そのAccountに`partner_joined`。編集者の参加は、Accountがないので記録しない（担当を付けたときに記録する）。

## パートナーのチーム（パートナー本人だけ）

`/api/team/*`は、すべて`access.ts`の`authorizeTeam`を通す（そうでなければ404 `TEAM_NOT_FOUND`）。Accountの一覧は`listTeamAccounts`、担当の付け外しは`authorizeAssignment`で判定する（[permissions.md](./permissions.md)「チームの判定」）。

| API | 説明 |
|---|---|
| `GET /api/team` | `{ id, name, partnerName, editorLimit, editors: [{ userId, name, joinedAt, accountIds }], accounts: [{ id, displayName, username, profilePictureUrl, ownerName, own: boolean }], unassignedEditorCount }`。`accounts`は手伝う先と、パートナー自身がオーナーのAccount（`own: true`） |
| `PATCH /api/team` | `{ name }`。チーム名を直す |
| `GET /api/team/invite` | `{ url, rotatedAt }`。なければ作る（最初に表示したとき） |
| `POST /api/team/invite/rotate` | 作り直す |
| `PUT /api/team/editors/:userId/accounts/:accountId` | 担当にする（`memberships`に editor の行を作る）。担当にできないAccountは`ASSIGNMENT_NOT_ALLOWED`。そのAccountに`assignment_added`を記録 |
| `DELETE /api/team/editors/:userId/accounts/:accountId` | 担当を外す。`assignment_removed`を記録 |
| `DELETE /api/team/editors/:userId` | 編集者を外す。`team_editors`と、そのチーム経由の editor の`memberships`を消す。担当だった各Accountに`editor_removed`を記録 |
| `GET /api/team/accounts` | まとめ（下） |

### `GET /api/team/accounts`

```json
{
  "items": [
    {
      "account": { "id": "…", "displayName": "カフェ B店", "username": "cafe_b_tokyo", "profilePictureUrl": "…", "connectionStatus": "connected" },
      "ownerName": "鈴木 花子",
      "needsReview": 5,
      "approved": { "count": 9, "days": 3 },
      "nextPost": { "at": "2026-10-10T08:00:00+09:00", "state": "scheduled | off | paused | none" },
      "judgments7d": { "good": 2, "normal": 3, "poor": 1 },
      "delegation": { "review": true, "settings": false },
      "editors": [{ "userId": "…", "name": "佐藤 美咲" }]
    }
  ],
  "truncated": false
}
```

- 手伝う先だけ（パートナー自身のAccountは含めない）。要確認の多い順、同じなら表示名の順。100件まで（research.md R12）。
- `nextPost`・`approved`は005の`auto-post-status`の計算と同じ。`judgments7d`は006の`post_metrics`で`judged_at`が7日以内のもの。

## 操作の記録

### `GET /api/accounts/:accountId/activity`

権限：`activity`。クエリ：`kind`（`review`・`draft`・`content`・`settings`・`member`、省略ですべて）、`actor`（userId）、`cursor`、`limit`（既定50、最大100）。

```json
{
  "items": [
    {
      "id": "…",
      "at": "2026-10-09T18:20:00+09:00",
      "actor": { "userId": "…", "name": "鈴木 花子", "role": "owner" },
      "kind": "review",
      "action": "drafts_approved",
      "itemCount": 3,
      "summary": "雨の日は、窓ぎわの席が…",
      "details": { "excerpts": ["…", "…", "…"] }
    }
  ],
  "actors": [{ "userId": "…", "name": "佐藤 美咲", "role": "editor" }],
  "nextCursor": "…"
}
```

- 90日以内だけ（research.md R9）。`actors`は絞り込みの選択肢（90日以内に記録がある人）。

### 操作の記録のコード

| `action` | `kind` | いつ書くか |
|---|---|---|
| `drafts_registered` | draft | 貼り付けでの登録（件数） |
| `batch_undone` | draft | 登録の取り消し（件数） |
| `draft_edited` | draft | 本文を直した（承認済みを直して要確認に戻ったときは`details.reopened = true`） |
| `drafts_deleted` | draft | 削除の確定（件数） |
| `drafts_approved`・`drafts_rejected` | review | 承認・却下（1件・まとめて。却下は理由） |
| `drafts_reopened`・`drafts_requeued`・`draft_prioritized` | review | 要確認に戻す・もう一度投稿の順に入れる・次に投稿する |
| `strategy_saved`・`promotion_*`・`reference_post_*`・`research_keyword_*`・`promotion_ratio_saved`・`prompt_count_saved`・`feedback_saved` | content | 戦略・材料・改善メモの保存・追加・削除（`*`は`added`・`updated`・`deleted`） |
| `schedule_saved`・`threads_checked`・`ng_word_added`・`ng_word_deleted`・`core_rules_saved` | settings | 設定の操作 |
| `partner_invite_created`・`partner_invite_rotated`・`partner_invite_canceled`・`partner_joined`・`partner_removed`・`delegation_changed`・`assignment_added`・`assignment_removed`・`editor_removed` | member | メンバーの出入り・担当・任せる範囲 |

- 書くのは`AccountAccess.hasTeam`のときだけ。ただし`partner_removed`は、外したことで`hasTeam`がfalseになっても書く。
- 同じ`requestId`の再試行（004）では書かない。

## `/api/me`の変更（research.md R11）

```json
{
  "accounts": [
    { "id": "…", "role": "owner", "ownerName": null, "…": "001〜007の項目" },
    { "id": "…", "role": "partner", "ownerName": "鈴木 花子" }
  ],
  "landingAccountId": "…",
  "accountLimit": { "max": 5, "used": 1 },
  "partnerTeam": { "name": "A社", "unassignedEditorCount": 1 },
  "editorWaiting": { "partnerName": "田中 健" }
}
```

- `accounts`はオーナーのAccount → 手伝っているAccountの順。`partnerTeam`はチームのパートナーのときだけ、`editorWaiting`は担当がなく自分のAccountも手伝い先もない編集者のときだけ（それ以外はNULL）。
- `accountLimit.used`はオーナーのAccountだけを数える。
- `/api/me/needs-review-counts`は、`accounts`のすべてのAccountを数える。

## 日次の処理

`runDailyJobs`に「activity logs cleanup」（`created_at`が90日より前の`activity_logs`を消す）を足す。1回で消す件数に上限は置かない（行は小さい）。
