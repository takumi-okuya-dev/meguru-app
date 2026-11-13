# 実装計画（Implementation Plan）：売上・経費・紹介と、運営メンバーへの分配

**ブランチ**：`feature/collect-003-*` | **日付**：2026-11-14 | **仕様**：[spec.md](./spec.md)

**入力**：spec.md（2026-11-14 の確かめ済み）、[001](../001-event-day-collection/plan.md)・[002](../002-self-check-in/plan.md) の plan、Constitution、[docs/parallel-development.md](../../../docs/parallel-development.md) 11章、[docs/apps/collect.md](../../../docs/apps/collect.md)

## 概要（Summary）

締めのあとに、経費を入れて残る額を出し、運営メンバーに傾斜をつけて分ける額を出す。紹介した人ごとの売上を数える（見るだけ）。運営メンバーは招待のリンクでめぐるの利用者とつながり、そのイベントの分配を読むだけで見られる。

- **計算**：共通のパッケージの純粋な関数（円の整数・傾斜は10倍の整数。R1・R2）。
- **もとの額**：001 の締めの数え方。支払い済みで「今」、振込待ちを足して「見込み」（R3）。
- **紹介した人**：名簿の人の列（R4）。分配には使わない。
- **招待**：ハッシュだけを持つ7日のリンク（R6）。つながった人の道筋は利用の許可を見ない（R7）。
- **PRは3つ**：PR1（API）→ PR2（主催者の画面）→ PR3（招待とつながった人の画面・E2E）（R9）。User Story 4 は別に。

## 技術コンテキスト（Technical Context）

001 と同じ（TypeScript・Hono・Drizzle・zod・React・TanStack Query・Cloudflare Workers・Neon）。新しい依存は足さない。

- **ストレージ**：`collect` スキーマに表を3つ（`expenses`・`team_members`・`team_invites`）、2つの表に列を足す（[data-model.md](./data-model.md)）。マイグレーション1つ（PR1）。
- **テスト**：分配の計算の単体テスト（spec の例・端数・リーダー2人・全員リーダー・1人・赤字・傾斜の上限）、API の結合テスト（経費・運営メンバー・傾斜の上限・分配のもと（確かめ待ち・振込待ち）・紹介経由の売上・招待（出す・出し直し・止める・期限・受ける・主催者・二重）・つながった人の道筋（利用の許可なしで見える・ほかのイベントは 404・名簿が出ない）・退会・まとめ・CSV）、Web のテスト、E2E（主催者と招待された人の2つのブラウザ）。
- **性能の目標**：分配の画面を開くのは締めの画面と同じ問い合わせの数＋2（経費・運営メンバー）。
- **制約**：パターン①。共通のファイルは変えない見込み（`routes.snapshot.txt` だけ）。お金を動かさない。

## Constitution Check

| 原則 | 確かめたこと | 結果 |
|---|---|---|
| アプリのデータの分け方（パターン①） | 表はすべて `collect` スキーマ。つながった利用者は `user_id` を持つだけで、共通の表を参照・結合しない | 通る |
| 運用コスト | 毎回の計算は小さい（1イベント20人・100件）。新しい定期の処理なし | 通る |
| 安全 | つながった人に名簿・参加者の名前を返さない。招待はハッシュだけ・7日・1回 | 通る |
| モバイル化を見込む | 計算は共通のパッケージ。画面は API の形だけを使う | 通る |

## Project Structure

```text
apps/api/src/apps/collect/
├── sharing/                    # 新しい：経費・運営メンバー・分配・紹介経由の売上・招待・つながった人の道筋
├── roster/                     # 紹介した人の列
├── closing/export-csv.ts       # 紹介した人の列
├── summaries/                  # 経費の合計・紹介あり
└── inbox/received-events.ts    # 退会のときにつながりを外す
apps/web/src/apps/collect/
├── pages/SharingPage.tsx       # 主催者：分配（/collect/events/:eventId/sharing）
├── pages/JoinPage.tsx          # 招待を受ける（/collect/join/:token。ログインなしで開ける）
├── pages/SharesPage.tsx        # つながった人：一覧と分配（/collect/shares・/collect/shares/:eventId）
└── components/sharing/         # 経費・運営メンバー・分配の表・紹介経由の売上
packages/shared/src/apps/collect/
├── distribution.ts             # 分配の計算
└── sharing.ts                  # 形・エラーのコード
```

## Complexity Tracking

なし。
