# 実装計画（Implementation Plan）：名簿なしで受付する（セルフ受付で名簿を作る）

**ブランチ**：`feature/collect-004-rosterless-check-in` | **日付**：2026-11-15 | **仕様**：[spec.md](./spec.md)

**入力**：spec.md、[001](../001-event-day-collection/plan.md)・[002](../002-self-check-in/plan.md)・[003](../003-revenue-sharing/plan.md) の plan・research・data-model・contracts、Constitution、[docs/parallel-development.md](../../../docs/parallel-development.md) 11章、[docs/apps/collect.md](../../../docs/apps/collect.md)

## 概要（Summary）

イベントに受付のしかた（名簿なし・名簿あり）を足す。名簿なしでは、参加者がセルフ受付で名前・ふりがな・媒体・紹介してくれた人を入れると、確かめなしで名簿に入り、002 と同じく払い方を選ぶ。お金は受付をする人が確かめ、区分が2つ以上なら「受け取った」（振込は「入金を確かめた」）のときに区分を決める。

- **受付のしかた**：`events.check_in_mode`（既定 `roster`）。新しいイベントの既定を名簿なしにするのは、作る画面の初めの値（R1）。
- **入口**：`POST /s/:token/entries`。名簿の人と、すぐ `accepted` の申し出を作り、002 の `me` → 払い方の選択をそのまま使う（R2）。
- **区分**：仮の区分（0円を除いた最も安い区分）と `tier_undecided`。確かめるときに区分が要る（R3）。
- **二重**：同じ端末は 002 の `me` で防ぐ。別の端末の同じ名前は受付の画面で知らせ、受付をする人が名簿から外せる（R4・R7）。主催者が先に入れた人とは名前で当てる（R5）。
- **守り**：端末ごと・リンクごとの上限（R6）。
- **PRは2つ**：PR1（共通の形・API・マイグレーション）→ PR2（画面・E2E・使い方）（R11）。

## 技術コンテキスト（Technical Context）

001〜003 と同じ（TypeScript・Hono・Drizzle・zod・React・TanStack Query・Cloudflare Workers・Durable Object・Neon）。新しい依存は足さない。

- **ストレージ**：`collect` スキーマの3つの表に列を足す（[data-model.md](./data-model.md)）。マイグレーション1つ（0042 の次）。
- **テスト**：
  - 共通：仮の区分の決め方・入力の形・上限の値。
  - API の結合テスト：
    - 受付のしかた（作る・直す・前からのイベント）
    - 名簿なしの入口（区分1つ・2つ以上・送り直し・名簿ありでは 409・止めたリンク・上限）
    - 主催者が先に入れた人に当てる
    - 参加者からほかの人が見えない
    - 区分を確かめる（受付・手伝う人・振込待ち、`TIER_REQUIRED`）
    - 同じ名前の知らせと外す（主催者・手伝う人、記録があれば 409）
    - 締め（来なかった人を出さない・受付の記録がない人の数）・CSV の「未定」
    - 会場の共有の知らせ
  - Web のテスト：参加者の入れる画面・区分ごとの金額・区分を選ぶ段・同じ名前・外す・作る画面の既定・締め。
  - E2E：名簿なしで作る → 参加者が入れる → 主催者が区分を決めて受け取る（390px）。
- **性能の目標**：参加者が45秒以内に払い方を選び終える（SC-002）。受付の画面と名簿の画面へ5秒以内（SC-004）。
- **制約**：パターン①。共通のファイルは変えない見込み（`routes.snapshot.txt` に道筋が2つ増えるだけ）。お金を預からない。

## Constitution Check

| 原則 | 確かめたこと | 結果 |
|---|---|---|
| アプリのデータの分け方（パターン①） | 列はすべて `collect` スキーマの表に足す。共通の表を読まない。共通の変更は `routes.snapshot.txt` だけ | 通る |
| 運用コスト（V. シンプルさ） | 新しい表を作らず、002 の申し出・端末の印・`me` の読み直しを使い回す。会場の共有も 002 と同じ知らせ | 通る |
| 安全 | 参加者は自分の情報だけを見る（同じ名前の人がいることも見せない）。名簿なしで入った人どうしは当てない。上限・止める・外す | 通る |
| 人間承認ゲート（II） | お金の受け取りと区分は、受付をする人が確かめて決める（本人の申告だけでは支払い済みにしない） | 通る |
| モバイル化を見込む | 判断（仮の区分・上限・当て方・区分が要るか）は API と共通のパッケージに置く。既定の受付のしかたも共通の値 | 通る |

設計のあとに見直しても、違反はない。

## Project Structure

```text
specs/collect/004-rosterless-check-in/
├── spec.md・plan.md・research.md・data-model.md・quickstart.md
├── contracts/api.md
└── tasks.md                     # /speckit-tasks で作る

apps/api/
├── drizzle/0043_collect_rosterless_check_in.sql
└── src/apps/collect/
    ├── schema.ts                       # 列を足す
    ├── events/                         # checkInMode を作る・直す・返す
    ├── self-check-in/entry-service.ts  # 新しい：名簿なしの入口（作る・当てる・上限）
    ├── self-check-in/self-routes.ts    # POST /s/:token/entries・DELETE …/reception/:personId/entry
    ├── self-check-in/self-service.ts   # info に checkInMode・media・tiers、本人の情報に tierUndecided
    ├── reception/                      # 確かめるときの区分・tierUndecided・sameName・selfEntered
    ├── transfers/                      # 入金を確かめるときの区分
    ├── closing/                        # 名簿なしの来なかった人・受付の記録がない人の数・CSV の未定
    └── roster/                         # 区分を直したら tierUndecided を戻す
apps/web/src/apps/collect/
├── pages/SelfCheckInPublicPage.tsx     # 名簿なしの入れる画面・区分ごとの金額
├── pages/EventNewPage.tsx・EventEditPage.tsx・イベントの入力欄（受付のしかた）
├── components/reception/               # 区分を選ぶ段・同じ名前・名簿から外す
├── pages/TransfersPage.tsx             # 入金を確かめるときの区分
└── pages/RosterPage.tsx・ClosingPage.tsx
packages/shared/src/apps/collect/       # 形・上限・NEW_EVENT_CHECK_IN_MODE・仮の区分の決め方・エラーのコード
```

## Complexity Tracking

なし（002 の仕組みを使い回す）。
