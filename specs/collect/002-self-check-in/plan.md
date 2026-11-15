# 実装計画（Implementation Plan）：参加者が自分で受付する（セルフ受付）

**ブランチ**：`feature/collect-002-self-check-in` | **日付**：2026-11-13 | **仕様**：[spec.md](./spec.md)

**入力**：spec.md、[001 の plan・research・data-model・contracts](../001-event-day-collection/plan.md)（受付・受付の手伝い・会場の共有・締め）、Constitution、[docs/parallel-development.md](../../../docs/parallel-development.md) 11章、[docs/apps/collect.md](../../../docs/apps/collect.md)

## 概要（Summary）

001 の受付に、参加者が会場のQRから自分で来場を記録して払い方を選ぶ入口（セルフ受付）を足す。本人の申告は受付の記録として残すが、現金・PayPayは「確かめ待ち」にし、受付をする人が「受け取った」で確定する。

- **リンク**：001 の受付用リンクの表に種類（`helper`・`self`）を足して使い回す（R1）。
- **参加者**：ログインなし。端末の印（画面で作る乱数）で選び直し・回数の上限・申し出の上限を見る（R2）。会場の共有にはつながず、自分の状態だけを3秒ごとに読む（R5）。名前は完全に一致した人だけを返す（R6）。
- **記録**：`payment_status` に `awaiting_confirmation`、`receiver_kind` に `self` を足す。確かめ待ちは数字の合計に入れない（R3）。
- **申し出**：新しい表 `self_check_in_requests`。名簿に入れる・当てる・断る（R4）。
- **PRは2つ**：PR1a（共通の形・API・マイグレーション）→ PR1b（画面・E2E）（R7）。

## 技術コンテキスト（Technical Context）

001 と同じ（TypeScript・Hono・Drizzle・zod・React・TanStack Query・Cloudflare Workers・Durable Object・Neon）。新しい依存は足さない。

- **ストレージ**：`collect` スキーマに表を2つ足し、2つの表に列を足す（[data-model.md](./data-model.md)）。マイグレーション1つ。
- **テスト**：API の結合テスト（セルフ受付のリンク・探す（完全に一致・同じ名前・回数の上限）・申告（確かめ待ち・振込待ち・0円・二重・選び直し）・確かめる・取り消す（手伝う人も）・申し出（入れる・当てる・断る・上限）・止めたリンク・参加者の道筋からほかの人が見えない・数字と締めと書き出しの確かめ待ち・会場の共有の知らせ）、Web のテスト、E2E（参加者と主催者の2つのブラウザ・390px）。
- **性能の目標**：参加者が30秒以内に払い方を選び終える（SC-001）。受付の画面へ5秒以内（SC-003）。
- **制約**：パターン①。共通のファイルは変えない見込み（`routes.snapshot.txt` だけ）。お金を預からない。

## Constitution Check

| 原則 | 確かめたこと | 結果 |
|---|---|---|
| アプリのデータの分け方（パターン①） | 表はすべて `collect` スキーマ。共通の表を読まない。共通の変更はない見込み | 通る |
| 運用コスト | 参加者の画面は会場の共有につながず、見えている間だけ自分の行を3秒ごとに読む。会の間だけで、KV は使わない | 通る |
| 安全 | 参加者は完全に一致した本人の名前しか見えない。回数の上限。本人の申告は確かめ待ち | 通る |
| モバイル化を見込む | 判断（探し方・数え方）は API と共通のパッケージ | 通る |

## Project Structure

```text
apps/api/src/apps/collect/
├── self-check-in/            # 新しい：参加者の道筋・探す・申告・申し出・回数の上限
├── helpers/link-service.ts   # リンクの種類（helper・self）を受ける
├── reception/                # 確かめる・本人の申告の取り消し・数字の確かめ待ち
└── closing/                  # 確かめ待ちを合計から外す
apps/web/src/apps/collect/
├── pages/SelfCheckInPage.tsx         # 主催者：セルフ受付のQR
├── pages/SelfCheckInPublicPage.tsx   # 参加者（/collect/s/:token）
└── components/reception/             # 確かめ待ち・申し出の段
packages/shared/src/apps/collect/     # 形・エラーのコード・知らせの種類
```

## Complexity Tracking

なし（001 の仕組みを使い回す）。
