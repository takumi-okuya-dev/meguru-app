# データモデル：売上・経費・紹介と、運営メンバーへの分配

**対象**：[spec.md](./spec.md)・[research.md](./research.md) | すべて `collect` スキーマ（パターン①）。マイグレーションは1つ。

## 1. 新しい表

### 1-1. `expenses`（経費。spec FR-001）

| 列 | 型 | 決まり |
|---|---|---|
| id | uuid | 主キー |
| event_id | uuid | `events.id`、CASCADE |
| name | text | 1〜40文字 |
| amount | integer | 1〜999,999 |
| payer_member_id | uuid null | `team_members.id`、SET NULL（立て替えた運営メンバー） |
| payer_name | text null | 運営メンバーでない人の名前（40文字まで）。`payer_member_id` と両方は入らない（check） |
| created_at | timestamptz | |

- 索引：`(event_id, created_at)`。1イベント100件まで（API で確かめる）。

### 1-2. `team_members`（運営メンバー。spec FR-010・FR-011・FR-052）

| 列 | 型 | 決まり |
|---|---|---|
| id | uuid | 主キー |
| event_id | uuid | `events.id`、CASCADE |
| name | text | 1〜40文字 |
| role | text | `leader`・`member`（check） |
| ratio_tenths | integer null | リーダーのとき 10〜50（1.0〜5.0倍）、メンバーのとき null（check） |
| position | integer | 足した順 |
| is_owner | boolean | 主催者の行（1イベントに1行まで：部分一意索引） |
| user_id | uuid null | つながった利用者（共通の表は参照しない。パターン①） |
| linked_at | timestamptz null | `user_id` と一緒に入る（check） |
| created_at | timestamptz | |

- 一意：`(event_id, user_id) WHERE user_id IS NOT NULL`（1人が1つのイベントで2つの運営メンバーにならない）。`(event_id) WHERE is_owner`。
- 索引：`(user_id) WHERE user_id IS NOT NULL`（つながったイベントの一覧）。
- 1イベント20人まで。リーダーの Σratio_tenths ≤ 人数×10（メンバーがいるとき。API で確かめる。research R2）。

### 1-3. `team_invites`（招待。spec FR-050・FR-051）

| 列 | 型 | 決まり |
|---|---|---|
| id | uuid | 主キー |
| member_id | uuid | `team_members.id`、CASCADE。一意（1人に1つ） |
| token_hash | text | SHA-256（16進）。一意 |
| expires_at | timestamptz | 作ってから7日 |
| created_at | timestamptz | |

- 受けた・止めた・出し直した → 行を消す（出し直しは消してから作る）。

## 2. 列を足す表

### 2-1. `roster_people`（spec FR-020・FR-022）

| 列 | 型 | 決まり |
|---|---|---|
| referrer | text null | 紹介した人（40文字まで） |
| referrer_key | text null | `referrerKey(referrer)`（敬称を除いて `nameKey`）。`referrer` と一緒に入る |

- 索引：`(event_id, referrer_key)`。

### 2-2. `event_summaries`（spec FR-003・FR-023）

| 列 | 型 | 決まり |
|---|---|---|
| expense_total | integer | 既定0 |
| referred | jsonb | `{ count, paid, awaiting }`。既定 `{"count":0,"paid":0,"awaiting":0}`。名前は持たない |

## 3. 毎回計算するもの（持たない）

- **分配**（`computeDistribution`、research R1）：A・N・M・リーダーごとの分・メンバーの分・端数と足した人・赤字か。
- **立て替えの戻し**：運営メンバーごとの `expenses.amount` の合計（`payer_member_id`）。運営メンバーでない人の分は名前ごとに。
- **受け取る合計**：分配額＋立て替えの戻し。
- **紹介経由の売上**：`referrer_key` ごとの人数・来場・支払い済み・振込待ち（tally と同じ数え方。確かめ待ちは来場に数え、売上に入れない）。

## 4. 版と会場の共有

- 経費・運営メンバーを変えても、イベントの版（`events.version`）は上げない（受付の画面に関係しない）。分配の画面は開いたとき・変えたあとに読み直す。
- 名簿の紹介した人を変えたときは、001 の名簿の変更と同じく版を上げ、`roster.changed` を送る。
