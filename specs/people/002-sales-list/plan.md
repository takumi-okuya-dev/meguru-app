# Implementation Plan：人物メモを「声かけリスト」として使う

**Spec**：[spec.md](./spec.md) | **Created**：2026-11-13 | **前提**：specs/people/001-people-memo がすべて develop に入っている

## 1. 決めたこと

| 何 | 決めたこと | 理由 |
|---|---|---|
| 置き場所 | すべて人物メモのフォルダの中（`apps/api/src/apps/people/`・`apps/web/src/apps/people/`・`packages/shared/src/apps/people/`）。共通のファイルは、マイグレーションの journal と routes.snapshot（`merge=union`）だけ | docs/parallel-development.md 11 |
| 表 | 001 の `people` スキーマに足す（下の2章）。人に関わる表は `person_id` を `ON DELETE CASCADE` にして、人を消す・退会で一緒に消す | 001 R13・R19 |
| 次にやること | 人の列（`next_action_on`・`next_action_note`）で1つだけ持つ。終わったら、その内容を連絡の記録に「やったこと」として写せる | 人ごとに1つで足りる。ホームの問い合わせが簡単 |
| 誕生日 | 月日だけ（`birthday_md` `MM-DD`）。年は持たない | 持つ個人の情報を増やさない |
| 並べ方の覚え方 | `owner_settings.person_view`（`{ sort, group }` の JSON）。ブラウザには置かない | どの端末でも同じ（Constitution のモバイル化の考え） |
| 探す | 001 の `q` に、連絡の記録・自由な項目の値（NFKC の部分一致）を足す | 001 R22 |
| 書き出し | `POST /api/people/persons/export`（本文に絞り込み）→ CSV（UTF-8・BOM）。ファイルは残さない。式として読まれる頭の文字（`=`・`+`・`-`・`@`）は `'` を付ける | 名前を URL に載せない（R18）。Excel で開ける |
| SNS のリンク | `person_links`（`kind`：`instagram`・`x`・`facebook`、`url`）。`https://` で、ホストが `instagram.com`・`x.com`・`twitter.com`・`facebook.com`（と `www.`）のものだけ | 開くボタンが別のサイトへ飛ばないように |
| まとめる・分ける | 001 R15 に足す：タグは合わせ、連絡の記録は移す。次にやること・来てくれそう度・誕生日・自由な項目・リンクは、残す人にあればそれ、なければ相手のもの。分けるときは元の人に残す | spec Edge Cases |

## 2. 表（マイグレーション 1つ。番号は作るときの develop の次）

- `people.tags`：`id`・`user_id`・`name`（1〜30文字）・`name_key`・`created_at`。一意 `(user_id, name_key)`。
- `people.person_tags`：`person_id`（→ persons CASCADE）・`tag_id`（→ tags CASCADE）・`user_id`。主キー `(person_id, tag_id)`。
- `people.contact_logs`：`id`・`user_id`・`person_id`（→ persons CASCADE）・`contacted_on`（date）・`channel`（`line`・`venue`・`other`・`done`〔次にやることを終えた〕）・`note`（1〜1,000文字）・`created_at`・`updated_at`。索引 `(person_id, contacted_on)`。
- `people.custom_fields`：`id`・`user_id`・`label`（1〜30文字）・`label_key`・`position`・`created_at`。一意 `(user_id, label_key)`。
- `people.person_field_values`：`person_id`（→ persons CASCADE）・`field_id`（→ custom_fields CASCADE）・`user_id`・`value`（1〜500文字）。主キー `(person_id, field_id)`。
- `people.person_links`：`person_id`（→ persons CASCADE）・`kind`（`instagram`・`x`・`facebook`）・`user_id`・`url`（1〜500文字）。主キー `(person_id, kind)`。
- `people.persons` に列を足す：`next_action_on`（date null）・`next_action_note`（text null、1〜200文字、`next_action_on` と一緒にある・ない）・`birthday_md`（text null、`^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$`）・`likelihood`（smallint null、1〜3。3＝高）。
- `people.owner_settings` に列を足す：`person_view`（jsonb null）。
- 退会（`inbox/withdrawal.ts`）：`tags`・`custom_fields` を `user_id` で消す（ほかは人・イベントの CASCADE で消える）。

## 3. API（`/api/people` の下。関所は 001 と同じ）

| 道筋 | 説明 |
|---|---|
| `GET/POST /tags`・`PATCH/DELETE /tags/:tagId` | タグの一覧（人数つき）・作る・名前を直す・消す。同じ名前（nameKey）は409 `PEOPLE_NAME_TAKEN`（人物メモの `errors.ts` に足す） |
| `PUT /persons/:personId/tags` | `{ tagIds }` でその人のタグを置き換える（新しい名前は `{ newTagNames }` で作って付ける） |
| `PATCH /persons/:personId` | 001 に足す：`nextActionOn`・`nextActionNote`（両方か両方 null）・`birthdayMd`・`likelihood` |
| `POST /persons/:personId/next-action/done` | `{ log: boolean }`。次にやることを消し、`log` なら連絡の記録に `channel: done` で写す |
| `GET/POST /persons/:personId/contact-logs`・`PATCH/DELETE /contact-logs/:logId` | 連絡の記録 |
| `GET/POST /fields`・`PATCH/DELETE /fields/:fieldId`・`PUT /fields/order` | 自由な項目 |
| `PUT /persons/:personId/fields` | `{ values: { fieldId, value \| null }[] }` |
| `PUT /persons/:personId/links` | `{ instagram?, x?, facebook? }`（null で外す） |
| `GET /persons`・`GET /candidates` | 001 に足す：`tag`（くり返し）・`likelihood`（くり返し）・`sort`（まとめた表示は画面がそのページの中でまとめるので、API は受けない）。返りの行に `tags`・`likelihood`・`nextAction`・`firstMetOn`（並べ方のため） |
| `GET /home` | `{ today: Item[], overdue: Item[], birthdays: Item[] }`（`Item` は人の一覧の行＋`nextAction`／`birthdayMd`） |
| `GET /events/:eventId/outreach-board` | 誘いの声かけを進み具合ごとに：`{ stages: { asked: Row[], link_sent: Row[], attended: Row[] } }`（`Row` は人＋声かけ） |
| `POST /persons/export` | 本文に人の一覧と同じ絞り込み → `text/csv`（BOM つき）。`Content-Disposition` のファイル名は日付だけ。1万人で切ったかは `X-Export-Truncated: true / false`。この2つの見出しは CORS で画面から読める（`apps/api/src/app.ts` の `exposeHeaders`）。画面は共通の `requestFile` で受け取り、ファイル名は見出しのもの（読めなければ同じ形で作る）、切ったかは見出しで決める |
| `GET/PUT /settings` | 001 に足す：`personView: { sort, group }` |

人のページ（`GET /persons/:personId`）に、`tags`・`nextAction`・`birthdayMd`・`likelihood`・`contactLogs`（新しい順）・`fields`（項目の順に、値つき）・`links` を足す。

## 4. PR の分け方（docs/parallel-development.md 11-4）

1. **PR-A：表とマイグレーションだけ**（2章）。先に入れて番号を確保する。
2. **PR-B：API**（3章）。テストを先に書く。
3. **PR-C：画面**（ホーム・タグ・並べ方・人のページ・会ごとの声かけの一覧・自由な項目の設定・書き出し）と E2E。

どれも手元の全テストとセルフレビューのあと `--admin` でマージする（CI は節約。ユーザーの決定）。
