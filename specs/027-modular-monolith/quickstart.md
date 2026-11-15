# 動かして確かめる手順：Threadsアプリをモジュラーモノリスに整理する

**日付**：2026-11-10 | **計画**：[plan.md](./plan.md)

境界の約束は[contracts/module-boundaries.md](./contracts/module-boundaries.md)、表と処理の行き先は[data-model.md](./data-model.md)を見る。

## 0. 並べ替えの前の基準（PR1で残す）

- テストの数：共有512件・Web 751件・API 1,266件（2026-11-10、develop）。
- APIの入口の一覧：`apps/api/test/repo/routes.snapshot.txt`（入口ごとの処理の数と、すべての入口にかかる関所の順番を含む）。

## 1. 自動の確かめ（PR2のあと）

1. `pnpm -r typecheck`・`pnpm lint`・`pnpm test`
   - 期待：すべて通る。テストの数は0の基準以上。
   - 期待：`module-boundaries`の違反は0件。
2. `pnpm --filter api db:generate`
   - 期待：新しいマイグレーションができない（「No schema changes」）。
3. `test/repo/routes-snapshot.test.ts`
   - 期待：APIの入口の一覧が`routes.snapshot.txt`と同じ。

## 2. 境界のチェックが効くこと（SC-003）

1. `apps/api/src/platform/`のファイルに、`../apps/threads`を読む1行を足して`pnpm lint`を流す。
   - 期待：「共通はアプリを使えません」で失敗する。
2. `apps/api/src/apps/threads/`のファイルに、`../../platform/billing/billing-service`を読む1行を足す。
   - 期待：「入口から読んでください」で失敗する。
3. 仮のアプリ`apps/api/src/apps/sample/index.ts`を作り、`../threads`を読む。
   - 期待：「アプリ同士は直接使えません」で失敗する。設定を書き足していないこと（FR-016）。
4. 足した行と仮のアプリを消す。

## 3. テスト版（マージのあと）

1. ログインする。アカウントの一覧が出る。
2. アカウントを開き、投稿の案の一覧（ストック）を見る。
3. 投稿の案を1件確かめて承認する。
4. 投稿のスケジュールを開く（自動投稿の予約が出る）。
5. 設定（このアカウントの設定・運営のアカウント一覧）を開く。
   - 期待：どれも並べ替えの前と同じに動く（SC-005）。
