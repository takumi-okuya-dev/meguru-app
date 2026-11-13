# めぐる（meguru-app）で作業する Claude Code へ

このリポジトリでは、アプリごとに作業場所（git worktree）とセッションを分けて、同時に開発する。どのセッションも、作業を始める前に次を読み、必ず守る。

- 並行開発の手順と、ぶつからないための決まり：[docs/parallel-development.md](docs/parallel-development.md)（特に **11章**）
- モジュールの決まり：[docs/module-map.md](docs/module-map.md)。アプリごとの地図は `docs/apps/<アプリ>.md`
- PRの流れ：[docs/release-runbook.md](docs/release-runbook.md) 2章

## いちばん大事な決まり（docs/parallel-development.md 11章の要約）

1. **自分のアプリのフォルダの中で作る**。`apps/api/src/apps/<アプリ>/`・`apps/web/src/apps/<アプリ>/`・`packages/shared/src/apps/<アプリ>/`・`specs/<アプリ>/`・`docs/apps/<アプリ>.md`。ほかのアプリのフォルダには触らない。
2. **共通のファイルで触ってよいのは、11-1章の「1行に1つ」の一覧だけ**（`app-modules.ts`・`db/schema.ts`・`app-list.ts`・`app-errors.ts` など。`merge=union`）。1行に1つだけ書き、ほかの中身を足さない。`app.ts`・`index.ts`・`jobs/daily-jobs.ts`・`errors.ts`・`catalog.ts`・`app-registry.ts`・テストのDBの片づけは、アプリのために直さない。
3. **テストにアプリの数や並びを書かない**（「アプリは2つ」「`["threads", "collect"]`と同じ」など）。登録された数と比べる。
4. **それ以外の共通を直すときは、アプリのPRに混ぜず、小さな共通のPRに分けて先に入れる**。作る前にユーザーに伝える。
5. **マイグレーションのあるPRは小さく切り、先に入れる**。番号がぶつかったら6章の手順で作り直す（番号を手で直さない）。
6. **develop を少なくとも1日1回、PRを出す前とマージの前に取り込む**。共通のファイルがぶつかって、どちらを取るか迷ったら、自分で決めずにユーザーに相談する。

## そのほか

- ユーザーへの返事・報告は日本語で書く。
- コミット・push・PRのマージは、ユーザーに頼まれたときだけ行う。
