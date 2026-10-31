# API契約：テスト用のグループ

**日付**：2026-10-31 | **計画**：[../plan.md](../plan.md)

001〜015のAPIの書き方（エラーは`{ error: { code, message, details? } }`、日時はISO 8601）に従う。

## 環境変数

| 変数 | 必須 | 値 | 意味 |
|---|---|---|---|
| `TEST_GROUPS_ENABLED` | ○ | `"true"`／`"false"` | テスト用のグループの仕組みのON/OFF。列挙外・未設定は`CONFIG_ERROR`（research.md R1）。テスト環境`"true"`、本番`"false"`、手元`"false"` |
| `OPERATOR_CLERK_USER_IDS` | — | ClerkのユーザーIDのカンマ区切り | 運営者。空なら運営者はいない。Secretで入れる |

## 新しいエラーコード

| code | HTTP | いつ | 画面の文言 |
|---|---|---|---|
| `TEST_ACCESS_REQUIRED` | 403 | ONの環境で、入れる人でない人が、許す経路のほかのAPIを呼んだ（research.md R5） | 「テスト版は招待された方だけが使えます」（画面ごと替える） |
| `TEST_INVITE_INVALID` | 404 | 招待の文字列が見つからない・作り直された・グループが閉じた・仕組みがOFF | 「このリンクは使えません。招待してくれた方に、新しいリンクをもらってください」 |
| `TEST_GROUP_FULL` | 409 | 定員のグループで「参加する」を押した | 「このグループは定員に達しています。招待してくれた方に連絡してください」 |
| `TEST_GROUP_ALREADY_MEMBER` | 409 | すでにグループに入っている人が、別のグループ（か同じグループ）で「参加する」を押した。`details: [入っているグループ名]` | 「すでに〇〇に入っています」 |
| `OPERATOR_ONLY` | 403 | 運営者でない人が運営者のAPIを呼んだ（ONの環境）。OFFの環境では運営者のAPIは`404 NOT_FOUND` | 「この操作は運営者だけができます」 |
| `TEST_GROUP_CAPACITY_INVALID` | 400 | 上限が1〜1000の範囲の外 | 「上限は1〜1000人で決めてください」 |

## 入れない人に許す経路（ONの環境）

`GET /api/me`、`GET /api/me/withdrawal-preview`、`POST /api/me/withdraw`、`GET /api/test-invites/:token`、`POST /api/test-invites/:token/join`。ほかはすべて`403 TEST_ACCESS_REQUIRED`（認証のミドルウェアで判定）。

## GET /api/me（足すもの）

```ts
testGroups: {
  enabled: boolean;   // 仕組みがONか
  admitted: boolean;  // 入れる人か（OFFなら常に true）
  operator: boolean;  // 運営者か（OFFなら常に false）
}
```

## 招待の確認と参加

| API | 判定 | 説明 |
|---|---|---|
| `GET /api/test-invites/:token` | ログイン任意 | 招待の確認。`Cache-Control: no-store`。応答は下の`TestInvitePreview`。使えないリンク・OFFは`404 TEST_INVITE_INVALID` |
| `POST /api/test-invites/:token/join` | ログイン済み | 参加する（research.md R3）。応答`{ groupId }`。エラー：`TEST_INVITE_INVALID`・`TEST_GROUP_FULL`・`TEST_GROUP_ALREADY_MEMBER` |

```ts
type TestInvitePreview = {
  group: { name: string };
  full: boolean;                      // 定員に達しているか
  viewer:
    | null                            // ログインしていない
    | { state: "can_join" }           // 参加できる（「参加する」を出す）
    | { state: "full" }               // 定員
    | { state: "already_member"; groupName: string }; // すでにどこかのグループに入っている
};
```

参加したときの順：グループの行に鍵 → 閉じていないか → すでに入っていないか → 人数 < 上限 → `test_group_members`に1行（料金なしの印、research.md R7）→ `test_group_events`に`member_joined`。

## 運営者のAPI

すべて`authed`＋運営者の判定。OFFの環境では`404 NOT_FOUND`、運営者でなければ`403 OPERATOR_ONLY`。

| API | 説明 |
|---|---|
| `GET /api/operator/test-groups` | 一覧。`{ groups: TestGroupSummary[] }`（作った順の新しい順。閉じたものは後ろ） |
| `POST /api/operator/test-groups` | 作る。入力`{ name: string(1〜50), capacity: number(1〜1000) }`。応答`TestGroupSummary` |
| `GET /api/operator/test-groups/:groupId` | 詳しく。`TestGroupDetail` |
| `PATCH /api/operator/test-groups/:groupId` | 名前・上限を変える。入力`{ name?, capacity? }`。閉じたグループは`409 TEST_GROUP_CLOSED`。応答`TestGroupDetail` |
| `POST /api/operator/test-groups/:groupId/rotate-invite` | 招待リンクを作り直す。閉じたグループは`409 TEST_GROUP_CLOSED`。応答`TestGroupDetail` |
| `POST /api/operator/test-groups/:groupId/close` | 閉じる。入っている人を全員外す（料金なしの印を戻す）。応答`TestGroupDetail` |
| `DELETE /api/operator/test-groups/:groupId/members/:userId` | 人を外す。入っていなければ`404 NOT_FOUND`。応答`TestGroupDetail` |

```ts
type TestGroupSummary = {
  id: string;
  name: string;
  capacity: number;
  memberCount: number;
  inviteUrl: string | null;  // 閉じていれば null
  closedAt: string | null;
  createdAt: string;
};
type TestGroupDetail = TestGroupSummary & {
  members: { userId: string; name: string; email: string; joinedAt: string }[]; // 入った順
  events: { action: TestGroupEventAction; actorName: string; subjectName: string | null; details: unknown; createdAt: string }[]; // 新しい順に50件
};
```

`TEST_GROUP_CLOSED`（409）：閉じたグループを変えようとした。文言「このグループは閉じています」。

## 読むだけの理由（013への追加）

`ReadOnlyReason`に`test_access`を足す（research.md R4）。オーナーがテスト版に入れない人のとき、そのアカウントは読むだけになり、自動投稿・反応の取り込みが止まる（013の`billing_inactive`の仕組みのまま）。オーナー以外には、013と同じく`owner_inactive`だけを返す。
