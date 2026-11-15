# API契約：紹介リンク

**日付**：2026-11-01 | **計画**：[../plan.md](../plan.md)

001〜016のAPIの書き方（エラーは`{ error: { code, message, details? } }`、日時はISO 8601）に従う。新しい環境変数・エラーコードはない。

## 見出し `X-Referral-Code`（すべての認証つきAPI）

- 画面は、ブラウザに紹介の文字列を覚えていれば（30日以内）、APIを呼ぶたびに`X-Referral-Code: r_…`を付ける。
- 認証のミドルウェアは、利用者の行を**新しく作るとき（JIT作成）だけ**読む。
  - 形（`^r_[A-Za-z0-9_-]{22}$`）に合い、`users.referral_code`が一致する人がいれば、`referred_by_user_id`をその人、`referred_at`を今にして行を作る。
  - 形に合わない・持ち主がいないときは、紹介なしで行を作る（エラーにしない）。
  - すでに行がある人では読まない（記録しない・変えない）。
- CORSの`allowHeaders`に`X-Referral-Code`を足す。

## GET /api/me/referral（認証が要る）

本人の紹介リンクと、紹介で登録した人数。紹介リンクの文字列がまだなければ、ここで作って保存する（一意の制約に当たったら作り直す）。

```json
{
  "url": "https://{WEB_ORIGIN}/r/r_xxxxxxxxxxxxxxxxxxxxxx",
  "referredCount": 2
}
```

- `referredCount`：`referred_by_user_id`が本人の利用者の数（退会した人は行がないので数えない）。
- 紹介された人の名前・メールアドレス・IDは返さない（FR-007）。
- テスト用のグループがONの環境で、入れない人は呼べない（016の許す経路に足さない）。

## GET /api/referral-page（認証は要らない）

紹介リンクの画面に出す注意のための情報。紹介の文字列は受け取らない（持ち主がいるかどうかを外から確かめられないようにする）。

```json
{ "testGroups": true }
```

- `testGroups`：テスト用のグループの仕組みがONか（`TEST_GROUPS_ENABLED`）。ONなら画面に「テスト版は、招待された方だけが使えます」を出す。

## 退会（変更なし・振る舞いの確認）

- 紹介した人が退会：`users`の行が消え、外部キーで紹介された人の`referred_by_user_id`がNULLになる。持ち主がいないので、その紹介リンクで新しく登録しても記録されない。
- 紹介された人が退会：行ごと消え、紹介した人の`referredCount`から外れる。
