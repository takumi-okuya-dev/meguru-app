# API契約：機能のまとまりごとのON/OFF

**日付**：2026-11-04 | **計画**：[../plan.md](../plan.md)

001〜018のAPIの書き方（エラーは`{ error: { code, message, details? } }`、日時はISO 8601）に従う。

## 環境変数（意味を変えるもの）

| 変数 | 変える前 | 変えた後 |
|---|---|---|
| `OPERATOR_CLERK_USER_IDS` | `TEST_GROUPS_ENABLED`がONのときだけ効く | 機能の設定・グループの管理は、いつも効く。テスト版に入れる・料金なし（016）は、今までどおり`TEST_GROUPS_ENABLED`がONのときだけ（research.md R5） |
| `TEST_GROUPS_ENABLED` | OFFならグループの招待・管理を使えない | OFFでもグループの招待・管理を使える。OFFの環境では、グループは機能の設定にだけ使う（入れる人の判定と料金なしをしない。FR-019） |

新しい変数は足さない。

## 新しいエラーコード

| code | HTTP | いつ | 画面 |
|---|---|---|---|
| `FEATURE_DISABLED` | 403 | 使えないまとまりのAPIを呼んだ。`details: [まとまり]` | 画面ごと「この機能は今は使えません」に替える（ui-routes.md 3） |
| `USER_NOT_FOUND` | 404 | 運営者が探した・変えようとした人が登録していない | 「見つかりません」 |

`OPERATOR_ONLY`（403）は016のものを使う。

## 守るAPI

| まとまり | API | 見る人 |
|---|---|---|
| `autopost` | `/api/accounts/:id/prompt`・`prompt-settings`・`post-drafts*`・`draft-batches`・`performance*`・`posting-schedule*`・`posting-rules`・`ng-words*`・`core-rules`・`auto-post*` | オーナー |
| `strategy` | `/api/accounts/:id/strategy`・`promotions*`・`promotion-settings`・`reference-posts*`・`research-keywords*`（`/profile-status` は守らない。ホームが使う数だけで中身を返さない） | オーナー |
| `team` | `/api/teams*`（作る・チームの画面・招待の作り直し・ロール・担当・抜ける・外す）、`POST /api/invites/:token/accept`、`/api/accounts/:id/activity`・`/api/accounts/:id/team` | 自分（`/api/accounts/:id/*` はオーナー） |
| `team`（チーム経由の関わり） | 担当・見せてもらうAccountのすべてのAPI | オーナーと見る人の両方。どちらかで使えなければ `404 ACCOUNT_NOT_FOUND` |

- 判定の順：Accountの関わり（なければ`404 ACCOUNT_NOT_FOUND`）→ まとまり（`403 FEATURE_DISABLED`）→ ロール（`ROLE_FORBIDDEN`）→ 決済（`BILLING_REQUIRED`）。
- 定期処理（自動投稿の時刻の処理・公開・反応の取り込み）は、オーナーの `autopost` が使えないAccountを飛ばす。公開の結果がわからない途中の投稿だけは確かめる（FR-008）。

## GET /api/me（変えるもの）

```ts
operator: boolean;   // 運営者か（TEST_GROUPS_ENABLED に関わらない。testGroups.operator はそのまま）
features: Feature[]; // 自分の使えるまとまり（人の設定とグループの設定）
// teams は、team が使えなければ空。accounts（担当しているAccount）も、team が使えなければ自分のものだけ
```

## GET /api/accounts/:accountId/access（足すもの）

```ts
features: Feature[]; // オーナーの使えるまとまり
```

## GET /api/accounts/:accountId/prompt（変えるもの）

- `strategy` が使えなければ、`prompt`・`parts`に課題・宣伝内容・参考投稿の節が入らず、`materials`は`null`。`summary`の戦略の数は0。

## グループの招待（016を変える）

- `GET /api/test-invites/:token`・`POST /api/test-invites/:token/join` は、招待制がOFFの環境でも使える。
- `GET` の応答に `testVersion: boolean`（招待制がONの環境か）を足す。OFFなら、画面はテスト版のための注意を出さない。
- OFFの環境で参加しても、料金なしの印を付けない（`granted_billing_exempt` は false）。

## 運営者のAPI

すべて：認証 → 運営者でなければ`403 OPERATOR_ONLY`。`Cache-Control: no-store`。どの環境でも使える。

### グループ（016を変える）

- `/api/operator/test-groups*` は、招待制がOFFの環境でも使える（今まではOFFなら 404）。
- `GET /api/operator/test-groups/:groupId` の応答に `disabled: Feature[]`（グループの設定でOFFのまとまり）を足す。
- `PUT /api/operator/test-groups/:groupId/features`：`{ features: { autopost: boolean; strategy: boolean; team: boolean } }`。変わったまとまりごとに記録する。閉じたグループは`409 TEST_GROUP_CLOSED`。応答は詳しい内容。

### GET /api/operator/feature-settings

```ts
{
  users: { userId, name, email, disabled: Feature[], updatedAt }[]; // 人の設定でOFFが1つ以上の人。updatedAt の新しい順
  events: {
    feature: Feature; action: "disabled" | "enabled";
    actorName: string; subjectName: string; subjectKind: "user" | "group";
    createdAt: string;
  }[]; // 新しい順に50件
}
```

### GET /api/operator/users?email=

- メールアドレスの完全一致（前後の空白を除き、大文字・小文字を区別しない）。
- 見つかれば`{ userId, name, email, disabled: Feature[], group: { id, name, disabled: Feature[] } | null }`（`disabled` は人の設定、`group.disabled` はグループの設定。閉じたグループは `null`）。見つからなければ`404 USER_NOT_FOUND`。
- `email`がない・形が違えば`400 VALIDATION_FAILED`。

### PUT /api/operator/feature-settings/:userId

```ts
{ features: { autopost: boolean; strategy: boolean; team: boolean } } // 人の設定。応答は GET /api/operator/users と同じ形
```

### DELETE /api/operator/feature-settings/:userId

- 人の設定をすべてONに戻す（グループの設定は変えない）。応答は上と同じ形。
