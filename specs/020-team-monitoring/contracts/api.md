# API契約：チームの運用状況を見る

**日付**：2026-11-04 | **計画**：[../plan.md](../plan.md)

001〜019のAPIの書き方（エラーは`{ error: { code, message, details? } }`、日時はISO 8601）に従う。新しいエラーコード・環境変数は足さない。

## GET /api/teams/:teamId/status（新規）

運用状況の一覧。`authed`・`teamOn`（019）を通し、`authorizeTeamStatus`（research.md R5）で範囲を決める。

| 見る人 | 結果 |
|---|---|
| 管理者 | 200。チームのすべての人とAccount |
| 担当のある編集者 | 200。担当のAccount（オーナーのチームが使えるもの）と、そのオーナー |
| 担当のない編集者・メンバー | `403 ROLE_FORBIDDEN` |
| チームの人でない・チームがない・IDの形が違う | `404 TEAM_NOT_FOUND` |
| 見る人のチームのまとまりが使えない | `403 FEATURE_DISABLED`（details `["team"]`） |

応答（`teamStatusSchema`、packages/shared/src/schemas.ts）：

```ts
{
  scope: "all" | "assigned";
  generatedAt: string;               // 数えた時刻
  stoppedCount: number;              // 止まっている人とAccountの数（チームの画面のボタンの印）
  people: Array<{
    userId: string;
    name: string;
    role: "admin" | "editor" | "member";
    isMe: boolean;
    joinedAt: string;
    lastActiveAt: string | null;
    activeCount7d: number;
    stopped: boolean;
    retentionLimited: boolean;       // 記録がなく、入って90日を過ぎている（「90日以内にありません」）
  }>;
  accounts: Array<{
    accountId: string;
    name: string;
    username: string | null;
    displayName: string | null;
    profilePictureUrl: string | null;
    owner: { userId: string; name: string; isMe: boolean };
    connection: "connected" | "disconnected";
    addedAt: string;
    lastPostedAt: string | null;
    postCount7d: number;
    approvedCount: number;
    needsReviewCount: number;
    stopped: boolean;
    growth:
      | { state: "metrics_off" | "insufficient" }
      | { state: "ok" | "poor"; ratio: number; recentMedian: number; previousMedian: number };
  }>;
}
```

- 並びは data-model.md「並び」のとおり、APIで並べて返す。
- 投稿の本文・戦略・設定・操作の記録の中身は返さない（FR-003・SC-004）。
- 範囲の外の人とAccountは、行も件数（`stoppedCount` を含む）も返さない（FR-002a・SC-003）。
- 書き込みはしない。操作の記録にも残さない。

## GET /api/teams/:teamId（足すもの）

```ts
statusVisible: boolean; // 運用状況を開けるか（管理者、または同じチーム経由の担当が1つ以上ある編集者）
```

範囲の判定は `authorizeTeamStatus` と同じ条件で決める（2か所に書かない。research.md R5）。
