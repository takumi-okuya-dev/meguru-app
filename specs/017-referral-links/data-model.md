# データモデル：紹介リンク

**日付**：2026-11-01 | **計画**：[plan.md](./plan.md) | **調査**：[research.md](./research.md)

マイグレーション`0017_referral_links`の1本。`users`に列を3つと索引を足すだけ（足すだけなので、古いAPIのままでも壊れない）。

## users（足す列）

| 列 | 型 | 制約 | 意味 |
|---|---|---|---|
| `referral_code` | text | NULL可、UNIQUE | 本人の紹介リンクの文字列（`r_`＋base64url 22文字）。本人が設定の「紹介」を初めて開いたときに入れる。一度入れたら変えない（research.md R2） |
| `referred_by_user_id` | uuid | NULL可、`users.id`、削除でNULL | この人を紹介した人。新しく行を作るとき（JIT作成）だけ入れ、あとから変えない（research.md R4） |
| `referred_at` | timestamptz | NULL可 | 紹介を記録した日時（＝行を作った日時）。紹介した人が退会しても残す |

- 索引：`referred_by_user_id`（紹介した人数を数える。research.md R6）。`referral_code`はUNIQUEの索引で引く。
- CHECK：`referred_by_user_id <> id`（自分を紹介した人にしない。行を作るときに起きないが、DBでも守る）。
- この機能の前からいる人は、3列ともNULL（紹介の記録はない。仕様のAssumptions）。

## ブラウザに覚えるもの

| 置き場所 | キー | 値 | 意味 |
|---|---|---|---|
| `localStorage` | `tg.referral` | `{ "code": "r_…", "at": "ISO 8601" }` | 紹介リンクを開いたこと。あとから開いた方で上書き。`at`から30日を過ぎたら読まずに消す。`GET /api/me`が成功したら消す（research.md R3） |

## 状態の移り変わり

```text
（紹介リンクを開いた・まだ登録していない）
   ──同じブラウザで30日以内に登録──▶ 紹介された人（referred_by_user_id＝持ち主）
   ──30日を過ぎた／別のブラウザで登録──▶ ふつうの利用者（記録なし）

紹介した人が退会 ──▶ 紹介された人の referred_by_user_id は NULL（referred_at は残る）
紹介された人が退会 ──▶ 行ごと消える（紹介した人の人数から外れる）
```
