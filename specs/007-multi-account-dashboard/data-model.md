# データモデル：マルチアカウントの要確認件数

**対象**：[spec.md](./spec.md) ／ **判断**：[research.md](./research.md)

## 保存するデータ

**新規のテーブル・列・列挙型はない。マイグレーションは不要。** 件数は既存の投稿下書きから読む派生値であり、Account行には保存しない。

| 既存のエンティティ | 使用する属性 | 関係・役割 |
|---|---|---|
| `User` | `id` | 認証された利用者。所有Accountを決める起点 |
| `Membership` | `user_id`, `account_id`, `role` | `role = owner` のAccountだけを一覧と件数の対象にする。個人運用の範囲 |
| `Account` | `id`, `username`, `display_name`, `profile_picture_url`, `connection_status`, `last_used_at`, `created_at` | 既存の切り替えメニューで使う表示と順序。要再接続は既知の状態だけを示す |
| `PostDraft` | `id`, `account_id`, `status` | `status = needs_review` の行数がそのAccountの要確認件数 |

## 読み取り用の集計

`OwnedAccountNeedsReviewCount` は保存しない応答上の値。

| 項目 | 型・制約 | 意味 |
|---|---|---|
| `accountId` | Accountの識別子。一意 | ログイン中のユーザーが所有するAccount |
| `needsReview` | 0以上の整数 | 取得時点で `needs_review` の下書き数。下書きがないときは0 |

- 返す集合は所有Accountの集合と同じ。Accountが0件なら空配列を返す。
- 要再接続のAccountも、投稿下書きは残るため件数を返す。接続の検査はしない。
- 並び順は `GET /api/me` に従い、UIが `accountId` で件数を対応づける。集計応答の順序には依存しない。
- 集計は所有者の条件、Accountとの結合、要確認の下書きの左結合を1回の読み取りにする。下書きの状態の条件を左結合側に置き、0件のAccountを失わない。
- 既存のAccount単位の件数 (`DraftCounts.needsReview`) と同じ状態を数える。要確認から承認・却下・削除された下書きは減り、新しく要確認になった下書きは増える。保持する独自の状態遷移はない。
- 他人のAccountは、要求側がIDを渡さなくてもサーバーの所有者条件により常に除外する。

## 整合性の範囲

- 1回の集計応答の件数は、その読み取り時点の値。別の端末・タブで同時に状態が変わる場合、次のメニューの開閉で新しい値を読む。
- 一覧と件数を別々に読むため、間にAccountが追加・削除された場合がある。UIは現在の `/api/me` のAccountだけを表示し、集計応答にだけあるIDは無視する。逆に現在のAccountに件数の行がなければ0と推測せず取得失敗として扱う。
