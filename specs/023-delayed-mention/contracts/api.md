# API契約：時間差のメンション

**日付**：2026-11-05 | **計画**：[../plan.md](../plan.md)

001〜022のAPIの書き方（エラーは`{ error: { code, message, details? } }`、日時はISO 8601）に従う。新しいエラーコードは足さない。すべて `authorizeAccount(..., { feature: "autopost" })` を通す（019）。

## メンションの設定

### GET /api/accounts/:accountId/mention-settings

判定：`view`。

```ts
{
  message: string;                 // ひとこと
  delayMinutes: 10 | 30 | 60 | 180 | 360 | 720 | 1440;
  version: number | null;          // null＝まだ保存していない（初めの値）
  people: Array<{
    id: string; username: string; label: string; always: boolean;
    pendingCount: number;          // この人を含む、まだ出していない時間差のメンションの数（消すときの確認。FR-004）
  }>;
  repliesDenied: boolean;          // 返信の権限がない（research.md R1）
  canEdit: boolean;                // settings があるか
}
```

### PUT /api/accounts/:accountId/mention-settings

判定：`settings`。`{ expectedVersion: number | null; message: string; delayMinutes: number }`

- `message` は前後の空白を除いて100文字まで。NGワードを含むと `VALIDATION_FAILED`（`details: ["message"]`）。
- `delayMinutes` が選べる値でなければ `VALIDATION_FAILED`。版が合わなければ `STALE_UPDATE`。
- 応答は GET と同じ形。操作の記録は `mention_settings_updated`（`kind: "settings"`）。

### POST /api/accounts/:accountId/mention-people

判定：`settings`。`{ username: string; label: string; always?: boolean }`

- `username` は `normalizeMentionUsername` を通す。形が違う・20人を超える・同じ人がいる・そのAccountのユーザー名と同じ場合は `VALIDATION_FAILED`（`details` は `username` か `limit`）。
- 応答は `201` で GET と同じ形。

### PATCH /api/accounts/:accountId/mention-people/:personId

判定：`settings`。`{ label?: string; always?: boolean }` → GET と同じ形。

### DELETE /api/accounts/:accountId/mention-people/:personId

判定：`settings`。その人を消し、まだ出していない時間差のメンションの `usernames` から外す。外した結果だれも残らなければ、その時間差のメンションも外す（要確認・承認済みは行を消す、投稿済みは `canceled`）。文の @ユーザー名 も消す。応答は GET と同じ形。

## 下書きの応答（004・005を変える）

`PostDraft` に `mention` を足す。

```ts
mention: {
  usernames: string[];
  text: string;
  delayMinutes: number | null;
  state: "pending" | "sent" | "canceled" | "failed";
  dueAt: string | null;           // 返信の予定の時刻。投稿の前は null
  sentAt: string | null;
  failureReason: MentionFailureReason | null;
  replyPermalink: string | null;   // 出した返信のURL（分かれば）
} | null
```

見せてもらっている人（`view` がない）には、いつも `null` を返す（research.md R9）。

## 付ける・直す・外す

### PUT /api/accounts/:accountId/post-drafts/:draftId/mention

判定：`review`。`{ expectedVersion: number; usernames: string[]; text?: string }`

- `usernames` は1〜5人で、そのAccountのメンションする人であること。選べない人（research.md R6）がいれば `VALIDATION_FAILED`（`details` にその人のユーザー名）。
- `text` を省くと `buildMentionText(ひとこと, usernames)`。500文字まで。
- 下書きの状態ごとの扱い：
  - **要確認・承認済み**：行を作るか、入れ替える（`delay_minutes` は今の設定の値）。下書きの `version` を1つ上げ、承認済みなら要確認に戻す。
  - **投稿済み**：次のときだけ作る（`send_after = now`）。
    - アプリから投稿した（`threads_media_id` がある）
    - 投稿から7日以内
    - 時間差のメンションがまだない
    - NGワードと500文字の確かめを通る
    - 返信の権限がない（`replies_denied_at` がある）ときは作らない
    - 作れないときは `VALIDATION_FAILED`。作ったら `notifyWake` で関所を起こす
  - **処理中**：`DRAFT_PUBLISHING`。却下・投稿に失敗：`VALIDATION_FAILED`。
- 応答：`{ draft: PostDraft; blocked: { username: string; reason: "pending" | "recent" }[] }`（`blocked` は、今は選べない人。丸いボタンを点線にするため）。
- 操作の記録は `mention_attached`（`kind: "review"`、本文の抜き出しつき）。

### POST /api/accounts/:accountId/post-drafts/mentions

判定：`review`。`{ items: { id: string; expectedVersion: number }[] }`（1〜50件。要確認の下書きだけ）

- それぞれに「いつも付ける」の人（選べない人を除く、5人まで）で付ける。付けられなかった下書きは `skipped`（理由：`NO_PEOPLE`・`STALE`・`NOT_FOUND`）。
- 応答：`{ updated: PostDraft[]; skipped: { id: string; reason: string }[] }`

### DELETE /api/accounts/:accountId/post-drafts/:draftId/mention

判定：`review`。`{ expectedVersion: number }`

- 要確認・承認済み：行を消す（下書きの `version` を1つ上げる。承認済みのまま）。
- 投稿済みで `pending`：`canceled` にする（`expectedVersion` は見ない）。済み・出せなかったものは変えない（`VALIDATION_FAILED`）。

## 承認（004を変える）

`POST /api/accounts/:accountId/post-drafts/review` の `approve` で、時間差のメンションがある下書きは、返信の文も `checkPublishable` に通す（NGワード・500文字・規約に注意。research.md R5）。

- 当たれば、下書きと同じ理由で `skipped` にする（`NG_WORD`・`OVER_THREADS_LIMIT`・`POLICY_CONFIRM_REQUIRED`）。
- 承認できたら、時間差のメンションがあれば `notifyWake`。
- `reject` では、時間差のメンションの行を消す。

## つなぐ・トークンを確かめる（010を変える）

`debug_token` の権限の一覧に `threads_manage_replies` がないと分かったとき：
- `accounts.replies_denied_at` を入れる。
- トークンの結果の `warnings` に `no_replies_permission` を足す。

あると分かったとき・つなぎ直したときは、`replies_denied_at` をNULLにする。
