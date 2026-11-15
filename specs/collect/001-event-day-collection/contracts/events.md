# 出来事の取り決め：集金管理が受け取るもの

**対象**：spec FR-060〜064・Edge Cases（退会） | **決めた理由**：[research.md](../research.md) R12・R15 | **仕組み**：029の出来事（送り出しの表と5分ごとの定期処理。10分以内に届く。2回届くことがある）

出来事の名前・共通の形（番号・起きた時刻・中身）は、029のplanで決まる形に合わせる。ここでは中身だけを決める。

## 1. 共通 → 集金管理

| 出来事 | 中身 | 集金管理がすること |
|---|---|---|
| 退会（029の名前に合わせる） | `{ userId }` | `owner_user_id = userId`のイベント（名簿・記録・リンク・手伝う人・精算もまとめて）・まとめ・既定値・Threadsのイベントの候補を消す |

## 2. Threads → 集金管理（User Story 6。PR4）

Threadsは、宣伝内容のイベントの情報を変えるのと同じトランザクションで、送り出しの表に書く。Threads側の変更は、Threadsのフォルダーの作業として別のPRにする。

| 出来事 | 中身 | 集金管理がすること |
|---|---|---|
| `threads.promotion_event.saved` | `{ promotionId, threadsAccountId, ownerUserId, name, startsAt, endsAt?, venue?, capacity?, feeAmount?, feeNote?, occurredAt }` | 候補に書く（あれば上書き）。そこから作ったイベントがあれば`source_changed_at`を付ける（イベントの中身は変えない） |
| `threads.promotion_event.deleted` | `{ promotionId, occurredAt }` | 候補に消された印を付ける。そこから作ったイベントに`source_deleted_at`を付ける |
| `threads.listing_status.changed` | `{ promotionId, postedMedia: string[], occurredAt }` | 候補の掲載済みの媒体を書き換える |

- `ownerUserId`は、そのThreadsのアカウントの持ち主（候補を見せる人。R15）。
- `postedMedia`は、021の媒体（こくちーずプロ・Peatix・つなげーと・ジモティー・YOUTRUST）を、集金管理の媒体の値（`kokuchpro`・`peatix`・`tunagate`・`jimoty`・`youtrust`）に直したもの。対応表は`@meguru/shared`に置く。
- `occurredAt`が、持っている`last_occurred_at`より古い出来事は捨てる（順番が入れ替わって届くため）。
- イベントの情報に開催日時がない宣伝内容は、`saved`を出さない（出していたら`deleted`を出す）。

## 3. 受け取りの決まり

- 出来事の番号を`processed_events`に書いてから処理し、同じ番号は何もしない（2回届いても同じ結果）。
- 失敗したら、次の定期処理でやり直す（029の決まり）。
