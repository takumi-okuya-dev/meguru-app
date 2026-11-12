# データの形（Data Model）：029 Threadsをパターン①にそろえる

**日付**：2026-11-12 | **仕様**：[spec.md](./spec.md) | **判断**：[research.md](./research.md)

## 1. 表の持ち主と置き場所（あと）

### 1-1. 共通（`public`スキーマのまま）

| 表 | 変わること |
|---|---|
| `users` | `account_limit`・`daily_post_limit`は、`user_app_limits`へ写したあと、PR5で消す（R7） |
| `withdrawn_users` | なし |
| `subscriptions` | なし（料金の数の元が`memberships`から`app_usage`に変わる。R6） |
| `test_groups`・`test_group_members`・`test_group_events` | なし |
| `feature_disables`・`group_feature_disables`・`feature_setting_events` | `app`の列を足し、主キーに入れる。`feature`の値の`CHECK`を形の`CHECK`に替える（R7） |
| `operator_settings` | `default_account_limit`・`default_daily_post_limit`は`app_limit_defaults`へ写したあとPR5で消す。`tester_slot_capacity`は`threads.settings`へ移したあとPR5で消す |
| `operator_events` | `application_id`からThreadsへの外部キーを外す（値は残す。R3） |
| **新** `platform_events` | 出来事（R5） |
| **新** `platform_event_deliveries` | 出来事の届け先ごとの状態（R5） |
| **新** `app_usage` | 利用の数・利用の状態（R6） |
| **新** `user_app_limits` | 利用者ごとの上限（R7） |
| **新** `app_limit_defaults` | 上限の既定の値（R7） |

共通は11表＋新しい5表＝16表。

### 1-2. Threads（スキーマ`threads`へ移す）

| 表 | 元の持ち主 | 変わること |
|---|---|---|
| `accounts` | 共通 | 置き場所。中身は変えない |
| `memberships` | 共通 | 置き場所。`user_id`の`users`への外部キーを外す |
| `teams`・`team_members`・`team_accounts` | 共通 | 置き場所。`users`への外部キーを外す |
| `activity_logs` | 共通 | 置き場所。`users`への外部キーを外す |
| 今のThreadsの25表（`threads_connections`・`post_drafts`・`publish_attempts`・`tester_applications` など。[module-map.md](../../../docs/module-map.md) 2-2） | Threads | 置き場所。`users`への外部キーを外す（`accounts`への外部キーは、同じスキーマの中なので残す） |
| **新** `settings` | — | Threadsの運営の設定（1行）。`tester_slot_capacity`を`operator_settings`から移す |
| **新** `received_events` | — | 受け取った出来事の番号（2回届いても同じ結果にする。R5） |

Threadsは31表＋新しい2表＝33表。

### 1-3. 外部キー（あと）

- 共通の表 ⇄ Threadsの表：**0本**（spec SC-001）。
- Threadsの中：今の`accounts`への外部キー（アカウントを消したら投稿ストックなども消す）は、そのまま残す。チームの表どうし・メンバーと`accounts`の外部キーも残す。
- 共通の中：今のまま（`subscriptions`・`test_group_members`などから`users`）。

## 2. 新しい表（共通）

### `platform_events`（出来事）

| 列 | 型 | 説明 |
|---|---|---|
| `id` | uuid（主キー） | 出来事の番号。受け取りが重ねて処理しないための鍵 |
| `type` | text | 種類（`user.withdrawn`・`limits.changed`）。`CHECK`で形だけ確かめる |
| `payload` | jsonb | 中身（`{ userId }`など）。個人を特定する値は番号だけにする |
| `created_at` | timestamptz | 書いた日時 |

- 共通は、自分の表の変更と同じトランザクションで書く。
- 消すのは、すべての届け先が「済み」になって30日たったもの（毎日のまとめ処理）。

### `platform_event_deliveries`（届け先ごとの状態）

| 列 | 型 | 説明 |
|---|---|---|
| `event_id` | uuid（`platform_events`への外部キー、消したら一緒に消す） | |
| `consumer` | text | 届け先（`threads`） |
| `status` | text | `pending`・`done`・`failed` |
| `attempts` | integer | 試した回数 |
| `next_attempt_at` | timestamptz | 次に試す時刻（失敗したら5分・10分・…・最大1時間あける） |
| `last_error` | text（null可） | 最後の失敗の要約（秘密の値や本文を入れない） |
| `delivered_at` | timestamptz（null可） | 済んだ日時 |

- 主キーは（`event_id`・`consumer`）。出来事を書くときに、登録している届け先の数だけ`pending`の行を作る。
- 10回失敗したら`failed`にして止め、ログに出す（運営者が表とログで調べる）。

### `app_usage`（利用の数・利用の状態）

| 列 | 型 | 説明 |
|---|---|---|
| `user_id` | uuid（`users`への外部キー、消したら一緒に消す） | |
| `app` | text | アプリの番号（`threads`） |
| `quantity` | integer（0以上） | 料金の数（Threadsでは、持ち主としてのアカウントの数） |
| `using` | boolean | 使っているか（Threadsでは、自分のアカウントがあるか、チームに入っているか） |
| `updated_at` | timestamptz | 伝えられた日時 |

- 主キーは（`user_id`・`app`）。行がなければ、数0・使っていない、とみなす。
- 料金の数（Stripeの数）は、`app = 'threads'`の`quantity`。数が変わったら、今の`subscriptions.quantity_sync_needed`に印を付ける。
- 移すとき（PR1のマイグレーション）、今の`memberships`（持ち主）の数と、チームに入っているかから、全員の行を作る。

### `user_app_limits`・`app_limit_defaults`（上限）

| 表 | 列 | 説明 |
|---|---|---|
| `user_app_limits` | `user_id`（`users`への外部キー）・`app`・`key`・`value`（integer） | 利用者ごとの上限。主キー（`user_id`・`app`・`key`）。行がなければ既定の値 |
| `app_limit_defaults` | `app`・`key`・`value`（integer） | 既定の値。主キー（`app`・`key`） |

- Threadsが登録する名前：`accounts`（アカウントの数。今の`account_limit`・`default_account_limit`）、`daily_posts`（1日の投稿数。今の`daily_post_limit`・`default_daily_post_limit`）。
- 値の範囲の確かめ（アカウントの数1〜1000、1日の投稿数1〜250）は、今は`CHECK`で行っている。これからは、アプリが登録するときに範囲を渡し、共通のコードが確かめる（共通の表にThreadsの範囲を書かない）。
- 移すとき（PR1のマイグレーション）、今の列の値を写す。古い列はPR5で消すまで、両方に書く。

### 機能のON/OFFの表の変更

| 表 | 変更 |
|---|---|
| `feature_disables` | `app text NOT NULL DEFAULT 'threads'`を足す。主キーを（`user_id`・`app`・`feature`）に。`feature_disables_feature_valid`（3つの値）を、形の`CHECK`（`^[a-z_]{1,30}$`）に替える |
| `group_feature_disables` | 同じ（主キーは`group_id`・`app`・`feature`） |
| `feature_setting_events` | `app`を足す。`CHECK`を形に替える |

- `DEFAULT 'threads'`なので、今の行はすべてThreadsの設定として残り、前の版のAPI（`app`を知らない）が書いても`threads`になる。

## 3. 新しい表（Threads）

### `threads.settings`（Threadsの運営の設定）

| 列 | 型 | 説明 |
|---|---|---|
| `id` | smallint（主キー、1だけ） | 1行だけ |
| `tester_slot_capacity` | integer | テスター招待の枠の数（今の`operator_settings.tester_slot_capacity`。1〜10000） |
| `updated_at` | timestamptz | |

### `threads.received_events`（受け取った出来事）

| 列 | 型 | 説明 |
|---|---|---|
| `event_id` | uuid（主キー） | 共通の出来事の番号（外部キーは張らない） |
| `received_at` | timestamptz | |

- 受け取りの処理の中で、同じトランザクションで書く。もうあれば、何もしないで「済み」を返す。
- 消すのは、90日たったもの（毎日のまとめ処理）。共通が30日で出来事を消すので、それより長く持つ。

## 4. 状態の移り変わり

### 出来事の届け先ごとの状態

```text
pending ──届けて成功──▶ done
   │
   └──失敗──▶ pending（attempts+1、next_attempt_at を後ろへ）
                 │
                 └──10回失敗──▶ failed（止める。ログに出す）
```

### 退会

```text
共通：退会する ─┬─ 契約の解約・利用者の退会の記録（今のまま）
               └─ platform_events に user.withdrawn を書く（同じトランザクション）
                        │（すぐ、または5分ごとの定期処理）
                        ▼
Threads：user.withdrawn を受け取る（received_events に書く・同じトランザクション）
   ├─ その人が持ち主のアカウントを消す（テスター招待の片づけ・Metaのデータ削除の要求の完了を含む）
   ├─ メンバー・チームの人・担当から外す
   ├─ 作った人・直した人の欄を空にする
   └─ reportUsage(0, using=false)
```

## 5. マイグレーション（PRごと）

| PR | マイグレーション | 前の版のAPIが壊れないか |
|---|---|---|
| PR1 | `platform_events`・`platform_event_deliveries`・`app_usage`・`user_app_limits`・`app_limit_defaults`を作る。今のデータから`app_usage`・上限の表を写す。機能のON/OFFの表に`app`（既定`threads`）を足し、主キーと`CHECK`を替える | 壊れない（足すだけ。`app`は既定の値つき） |
| PR2 | `threads_settings`・`threads_received_events`（まだ`public`）を作り、`tester_slot_capacity`を写す。`app_usage`を`memberships`とチームから数え直して写し直し、上限の表も古い列から写し直す（PR1とPR2の間のずれを消す） | 壊れない（足す・写すだけ） |
| PR3 | スキーマ`threads`を作る。Threadsの31表と`threads_settings`・`received_events`を移す（`ALTER TABLE … SET SCHEMA`、`threads_settings`は`settings`に名前を変える）。共通との外部キーを外す | **壊れる**（前の版は`public`の表を見る）。テスト環境だけで受け入れる例外（spec FR-019）。デプロイの間の数分 |
| PR5 | `users.account_limit`・`users.daily_post_limit`・`operator_settings`の3列を消す | **壊れる**（前の版はこの列を読む）。テスト環境だけの例外。PR4までの版はもう新しい表を読むので、PR4に戻すなら壊れない |

- どのマイグレーションも、`drizzle-kit generate`で作り、できたSQLを読んでからコミットする。PR3の置き場所の移動は、`DROP TABLE`・`CREATE TABLE`になっていないことを必ず確かめる（R2）。
- マイグレーションのテスト（`apps/api/test/migration/`）を、PR1・PR3・PR5に足す：使い捨てのDBに前の番号まで当ててデータを入れ、当てたあとに件数と中身が残っていること・外部キーの本数を確かめる。

## 6. テスト環境で比べる件数（PR3）

マイグレーションの前と後で、次の表の件数を比べる（[quickstart.md](./quickstart.md) 3）。

- 移す31表（`accounts`・`memberships`・`teams`・`team_members`・`team_accounts`・`activity_logs`と、今のThreadsの25表）
- 共通の`users`・`subscriptions`・`app_usage`（数と、`subscriptions.quantity`との一致）
