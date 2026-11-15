# めぐる（meguru-app）で作業する Claude Code へ

**AIが守る決まりは、この文書と、ここからリンクする`docs/rules/`だけに置く**。ほかの文書（仕様・今の形の説明・手順書）には決まりを書かない。決まりを変えたら、同じPRでここか`docs/rules/`を直す（AIのメモリーだけに書かない。ほかのセッションから読めないため）。

| 決まり | 本文 |
|---|---|
| 守る原則（NGワード・人の承認・お金は預からない・パターン①など。ほかと食い違ったらこれが正） | [Constitution](.specify/memory/constitution.md) |
| ブランチ・PR・レビュー・CI・マージ・デプロイ | [docs/rules/development-flow.md](docs/rules/development-flow.md) |
| 仕様のフォルダと番号・仕様の役目・ブランチとコミットの名前 | [docs/rules/specs.md](docs/rules/specs.md) |
| コードの書き方・設定と環境・マイグレーション・テスト | [docs/rules/coding.md](docs/rules/coding.md) |
| アプリごとにセッションを分けて同時に進める・ぶつからないための決まり（**11章**） | [docs/rules/parallel-development.md](docs/rules/parallel-development.md) |
| モジュールの境界（どこが何を持ち、どこから読んでよいか） | [docs/module-map.md](docs/module-map.md)・[docs/app-separation.md](docs/app-separation.md)。アプリごとの地図は`docs/apps/<アプリ>.md` |

どのセッションも、作業を始める前に読み、必ず守る。

## いちばん大事な決まり（要約）

### 作業の進め方

1. **ユーザーへの返事・報告・質問は日本語で書く**。
2. **最終の承認はユーザー**。確かめずにPRまで進めてよいが、コミット・push・PRのマージは、ユーザーに頼まれたときだけ行う（[development-flow.md](docs/rules/development-flow.md) 4）。
3. **CIは節約する**。`run-ci`はマイグレーションのあるPRなど慎重なものだけ。ほかは手元で全部のテストを流し、結果をPRに書く（[development-flow.md](docs/rules/development-flow.md) 3）。
4. **リポジトリはしばらく公開している**。秘密の値・本物の利用者や参加者のデータ・個人の情報をコミットしない（[coding.md](docs/rules/coding.md) 2）。
5. 見つけたバグが今のPRの目的と別なら、別のPRで直す。

### 並行開発（[parallel-development.md](docs/rules/parallel-development.md) 11章の要約）

1. **自分のアプリのフォルダの中で作る**。`apps/api/src/apps/<アプリ>/`・`apps/web/src/apps/<アプリ>/`・`packages/shared/src/apps/<アプリ>/`・`specs/<アプリ>/`・`docs/apps/<アプリ>.md`。ほかのアプリのフォルダには触らない。
2. **共通のファイルで触ってよいのは、11-1章の「1行に1つ」の一覧だけ**（`app-modules.ts`・`db/schema.ts`・`app-list.ts`・`app-errors.ts` など。`merge=union`）。1行に1つだけ書き、ほかの中身を足さない。`app.ts`・`index.ts`・`jobs/daily-jobs.ts`・`errors.ts`・`catalog.ts`・`app-registry.ts`・テストのDBの片づけは、アプリのために直さない。
3. **テストにアプリの数や並びを書かない**（「アプリは2つ」「`["threads", "collect"]`と同じ」など）。登録された数と比べる。
4. **それ以外の共通を直すときは、アプリのPRに混ぜず、小さな共通のPRに分けて先に入れる**。作る前にユーザーに伝える。
5. **マイグレーションのあるPRは小さく切り、先に入れる**。番号がぶつかったら6章の手順で作り直す（番号を手で直さない）。
6. **develop を少なくとも1日1回、PRを出す前とマージの前に取り込む**。共通のファイルがぶつかって、どちらを取るか迷ったら、自分で決めずにユーザーに相談する。
7. 共通の文書や、ほかのセッションにかかわる変更をするときは、ほかのセッションに先に知らせる。
