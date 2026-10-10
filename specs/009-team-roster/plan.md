# 実装計画（Implementation Plan）：このアカウントのチーム

**ブランチ**：`feature/008-team-roster`（PR #10） | **日付**：2026-10-10 | **仕様**：[spec.md](./spec.md)

## 概要（Summary）

008の「このアカウントを手伝っている人」の一覧を、カード「このアカウントのチーム」に置き換える。APIの応答に、カードの一番上に出すオーナーと、「あなた」の印に使う要求した人のIDを足し、画面で段に組み立てる。

## 技術コンテキスト（Technical Context）

008と同じ。依存・マイグレーション・Cronは足さない。

## Constitution Check

- 原則V（個人運用のオーナーには役割・チームを見せない）：手伝う人がいなければカードを出さない（FR-004）。008 SC-005のテストで確かめる。
- 原則V（判定を1か所に集める）：既存の `GET /api/accounts/:id/team`（`authorizeAccount(..., "view")`）をそのまま使う。新しいルートは足さない。
- 原則IV（パートナーが編集者を招く）：変更なし。

## 設計

### API（[008 contracts/api.md](../008-team-operations/contracts/api.md)「チーム」を更新）

`GET /api/accounts/:accountId/team` の応答に2つ足す。

```json
{
  "owner": { "userId": "…", "name": "鈴木 花子" },
  "viewerUserId": "…",
  "partner": { "userId": "…", "name": "田中 健", "teamName": "A社", "joinedAt": "…" },
  "delegation": { "review": false, "settings": false },
  "editors": [{ "userId": "…", "name": "佐藤 美咲" }],
  "joinedNotice": { "show": true }
}
```

- `owner` は `authorizeAccount` の結果（`access.owner`）、`viewerUserId` は `access.actor.id`。問い合わせは増えない。
- `editors` は008と同じく、そのAccountの `memberships(role=editor)` だけ（FR-003）。

### 画面（[008 contracts/ui-routes.md](../008-team-operations/contracts/ui-routes.md)「このアカウントの設定」を更新）

- `apps/web/src/components/team/TeamRoster.tsx`（新規）：`rosterTiers(team)` で段（オーナー・パートナー・編集者）を作り、縦に並べて下向きの矢印でつなぐ。`RoleDiagram` と同じ見た目（角丸の枠、自分の段は濃い枠、「あなた」の丸いラベル）。一覧は `<ol aria-label="このアカウントのチーム">`、段は `aria-label` に役割の名前。
- `TeamSection.tsx`：一覧の `SettingCard` を `TeamRoster` に置き換える。区分を出すかどうかも `rosterTiers` の結果で決める。

### 文書

008の spec.md（FR-042・US1-7・US2-6・権限表）、contracts（api・permissions・ui-routes）、quickstart.md 手順7、docs/team-roles.md を新しい内容に合わせる。
