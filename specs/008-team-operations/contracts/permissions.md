# 権限の表と、APIごとの必要な権限

spec FR-001〜FR-003・FR-002a・FR-030〜FR-032 の実装の契約。表は`packages/shared/src/permissions.ts`に定数として置き、APIの判定（`authorizeAccount`、research.md R2）と画面の出し分けの両方で使う。

## 権限（Permission）

| 権限 | 意味 |
|---|---|
| `view` | Accountを開く。ホーム・投稿ストック・戦略・パフォーマンス・設定（読むだけ）・手伝っている人の一覧を見る。CSVの書き出し |
| `content` | 投稿の案の登録・編集・要確認の案の削除と取り消し、戦略（課題・宣伝内容・リサーチ・宣伝の割合）、プロンプトの件数、改善メモ・「プロンプトに入れる」 |
| `review` | 承認の操作（承認・却下・まとめて・`reopen`・`requeue`・「次に投稿する」）、要確認以外の案の削除、投稿直前に戻した知らせを閉じる |
| `settings` | 設定の操作（自動投稿・時刻、「接続を確かめる」、NGワード、投稿のルール） |
| `activity` | 操作の記録を見る |
| `owner` | Threadsとの接続・再接続、Accountの削除、パートナーの招待・外す・任せる範囲、パートナー参加の知らせを閉じる |

## 役割ごとの権限

| 権限 | owner | partner | editor |
|---|---|---|---|
| `view` | ○ | ○ | ○ |
| `content` | ○ | ○ | ○ |
| `review` | ○ | `delegate_review`のとき | × |
| `settings` | ○ | `delegate_settings`のとき | × |
| `activity` | ○ | ○ | × |
| `owner` | ○ | × | × |

- 編集者を招待する・外す・担当を決めるのは、Accountの権限ではなくチームの権限（チームのパートナー本人だけ）。この判定も`apps/api/src/services/access.ts`に置き、`/api/team/*`はすべてそこを通す（下の「チームの判定」。Constitution原則V）。
- 判定の結果（`AccountAccess`）：`account`、`role`、`permissions`（上の表で許された権限の集合）、`owner`（`{ id, name, createdAt }`）、`delegation`（`{ review, settings } | null`）、`hasTeam`、`teamName`。
- 403 `ROLE_FORBIDDEN`の`details`には足りない権限（例：`["review"]`）を入れる。Webはこれを見て、任せる範囲がオフになった（FR-041 US3-4）と案内し、権限を読み直す。

## チームの判定（`access.ts`）

Accountの判定（`authorizeAccount`）と同じファイルに、次の3つを置く。`team-service.ts`・`partner-summary.ts`・`/api/team/*`のルートは、チームやAccountの読み取り・書き込みの前に必ずこれらを通し、`teams`・`account_partners`・`memberships`を自分で読んで権限を決めない。

| 関数 | 何を判定するか | 拒否のとき |
|---|---|---|
| `authorizeTeam(db, user)` | ログインした人がチームのパートナーか。`TeamAccess`（チーム・パートナー）を返す | 404 `TEAM_NOT_FOUND` |
| `listTeamAccounts(db, teamAccess)` | チームが関われるAccountの一覧（手伝う先＋パートナー自身がオーナーのAccount、`own`の印つき）。まとめの画面と担当の表の列はこの一覧だけを使う | — |
| `authorizeAssignment(db, teamAccess, editorUserId, accountId)` | 相手がチームの編集者で、Accountが`listTeamAccounts`に含まれるか | 404 `TEAM_NOT_FOUND`（編集者でない）、409 `ASSIGNMENT_NOT_ALLOWED`（Accountが対象外） |

- 009（決済）で、オーナーが未払いのAccountを読むだけにするときは、`authorizeAccount`と`listTeamAccounts`（まとめの画面での表示と、担当の付け外しの可否）の両方にこの1か所で足す。
- 招待の確認（`GET /api/invites/:token`）と参加（`POST .../accept`）は、Accountやチームの権限ではなく「リンクを持っているか」で判定する（research.md R4・R7）。

## 削除の扱い（FR-002a）

`POST /accounts/:id/post-drafts/delete`は、対象の案の状態で必要な権限を変える。

| 案の状態 | 必要な権限 |
|---|---|
| `needs_review` | `content` |
| それ以外 | `review` |

1回の要求に両方が混ざり、`review`がないときは、要確認のものだけを消し、残りは`skipped`（理由`ROLE_FORBIDDEN`）として返す。登録の取り消し（`DELETE /draft-batches/:batchId`）は、まとまりの中がすべて要確認のときだけ`content`で許す（今の取り消しの条件と同じ）。

## APIごとの必要な権限

既存の59か所の`findOwnedAccount`を、次の権限の`authorizeAccount`に置き換える。

| API | 権限 |
|---|---|
| `GET /accounts/:id` | `view` |
| `POST /accounts/:id/open` | `view`（手伝う人は`users.last_account_id`だけ記録。research.md R11） |
| `DELETE /accounts/:id` | `owner` |
| `GET /accounts/:id/auto-post` | `view` |
| `POST /accounts/:id/auto-post/notices/blocked/dismiss` | `review` |
| `GET /accounts/:id/performance`、`GET .../performance/export` | `view` |
| `PATCH /accounts/:id/performance/:draftId/feedback` | `content` |
| `GET /accounts/:id/posting-schedule` | `view` |
| `PUT /accounts/:id/posting-schedule` | `settings` |
| `GET /accounts/:id/promotion-settings`、`GET .../promotions` | `view` |
| `PUT /accounts/:id/promotion-settings`、`POST`・`PUT`・`DELETE .../promotions` | `content` |
| `GET /accounts/:id/posting-rules` | `view` |
| `POST`・`DELETE /accounts/:id/ng-words`、`PUT .../core-rules` | `settings` |
| `POST /accounts/:id/threads-check` | `settings` |
| `GET /accounts/:id/profile-status`、`GET .../strategy` | `view` |
| `PUT /accounts/:id/strategy` | `content` |
| `GET .../reference-posts`、`GET .../research-keywords` | `view` |
| `POST`・`PUT`・`DELETE .../reference-posts`・`.../research-keywords` | `content` |
| `GET /accounts/:id/prompt` | `view`（プロンプトを作れるかはgrower機能。オーナーの状態で判定。research.md R3） |
| `PUT /accounts/:id/prompt-settings` | `content` |
| `GET /accounts/:id/post-drafts`、`.../published`、`.../counts` | `view` |
| `POST /accounts/:id/draft-batches`、`PUT .../post-drafts/:draftId` | `content` |
| `DELETE /accounts/:id/draft-batches/:batchId` | `content`（上の「削除の扱い」） |
| `POST /accounts/:id/post-drafts/delete` | 上の「削除の扱い」 |
| `POST /accounts/:id/post-drafts/:draftId/prioritize`、`POST .../post-drafts/review` | `review` |
| `POST /threads/connect`（再接続のとき） | 対象Accountの`owner` |
| 本featureの新しいAPI | [api.md](./api.md)の各行 |

## 画面での出し分け

- Webは`GET /api/accounts/:id/access`（[api.md](./api.md)）の`permissions`で、操作のボタン・入力の出し分けをする（FR-041）。
- 出し分けは見た目のためだけで、守りはAPIの判定にある（FR-003）。
- `permissions`は、403 `ROLE_FORBIDDEN`を受けたとき、Accountを開き直したとき、切り替えメニューを開いたときに読み直す。

## テスト（SC-002）

- `packages/shared`：役割×任せる範囲（4通り）×権限の表のテスト。
- `apps/api`：上の表のすべてのAPIを、owner・partner（任せる範囲の4通り）・editor・関係のない人で呼び、許される／403／404を確かめる表のテスト。`/api/team/*`も、チームのパートナー・そのチームの編集者・別のチームのパートナー・関係のない人で呼ぶ。ルートの一覧（Honoのルート）から、`/accounts/:accountId`または`/team`を含むルートで表にないものがあれば失敗させる（置き換えの漏れを見つける）。
