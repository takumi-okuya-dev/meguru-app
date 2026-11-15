# 031：並行開発でぶつからない組み立て

**作成**：2026-11-13 | **種類**：共通（外枠・組み立て・テストの部品・文書）。利用者に見える動きは変えない。

## 1. なぜ

2026-11-13に、人物メモ（PR #111）と集金管理（PR #113・#114）を続けて develop に取り込んだとき、2回の merge で19か所がぶつかった。

| 種類 | 場所 |
|---|---|
| アプリの登録 | `app.ts`・`index.ts`・`jobs/daily-jobs.ts`・`db/schema.ts`・Web の `app-registry.ts`・`@meguru/shared` の `catalog.ts` |
| 共通の一覧 | `errors.ts`・テストのDBの片づけ（TRUNCATE）・`routes.snapshot.txt`・`docs/module-map.md`・境界のルールのテスト |
| 数を書いたテスト | 「アプリは2つ」「届け先は2つ」と書いたテスト5つ |
| マイグレーションの番号 | 0033 の取り合い |

どれも「アプリを足すたびに、共通の場所へ1行足す所」で、2つのセッションが同じ行のとなりに足すので git が自動でまとめられない。git が自動でまとめた結果が間違っていたテストも1件あった（集金管理の行が Threads の期待の中に入った）。各アプリのフォルダの中身は1つもぶつからなかった。

## 2. 何をするか

1. **アプリの登録を1つの一覧にまとめる**：各アプリの `index.ts` が `ApiAppModule`（`id`・`register`・`routes`・`dailyJobs`）を出し、`apps/api/src/app-modules.ts` の `API_APPS` に1行に1つ並べる。`app.ts`・`index.ts`・`jobs/daily-jobs.ts` は一覧を回すだけにする。Threads は道筋と毎日の処理が多く順番もあるので、登録だけを一覧に入れ、道筋と毎日の処理は今のまま。
2. **アプリごとの中身をアプリのフォルダへ**：アプリの一覧の行（`packages/shared/src/apps/<アプリ>/catalog-entry.ts`）、エラーコードと文言（`.../<アプリ>/errors.ts`）、アプリの地図（`docs/apps/<アプリ>.md`）、境界のルールの例（`eslint-rules/*.<アプリ>.test.js`）。
3. **一覧は「1行に1つ」のファイルに分け、`.gitattributes` で `merge=union`**：`app-modules.ts`・`db/schema.ts`・Web の `app-list.ts`・shared の `app-list.ts`・`app-errors.ts`・`apps/index.ts`・`routes.snapshot.txt`。2つのブランチが同時に1行ずつ足しても、両方の行が残る。
4. **手で書いていた一覧を、読んで作る**：結合テストのDBの片づけは、アプリのスキーマ（`public`・`drizzle` のほか）の表をすべて読んで空にする。E2Eも、すべてのスキーマの表を空にする（集金管理の表が漏れていた）。
5. **アプリの数を書いたテストをやめる**：登録された数（`releasedApps()`・`APP_CATALOG`・DBの行の数）と比べる。
6. **決まりを文書にする**：`docs/parallel-development.md` 11章と、どのセッションも読むルートの `CLAUDE.md`。

## 3. 決めたこと

- 動きは変えない：API の道筋の一覧（`routes.snapshot.txt`）・エラーの文言・アプリの一覧の中身と並び・毎日の処理の順（アプリの毎日の処理は、今と同じく料金の合わせ直しの前）は、前と同じ。
- union の弱み：同じ行を両方が書き換えると、両方の行が残って壊れた形になる。そのため一覧のファイルは「1行に1つ」だけにし、ほかの中身を置かない。取り込んだあとは型チェックとテストで確かめる。GitHub の画面の「ぶつかり」の判定は union を使わないことがあるので、取り込みは手元の `git merge origin/develop` で行う（今までどおり）。
- マイグレーションの番号の取り合いは、drizzle の連番の作りのまま残る。決まり（小さく切って先に入れる・6章で作り直す）で扱う。

## 4. 確かめ

- API の全テスト・共通とWebのテスト・境界のルールのテスト・lint・型チェックが通る。
- `routes.snapshot.txt` が変わらない（道筋が同じ）。
- union の動き：同じ一覧に2つのブランチが1行ずつ足して merge すると、ぶつからずに両方の行が残る（手元で確かめた）。
