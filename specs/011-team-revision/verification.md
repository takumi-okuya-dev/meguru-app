# 検証の記録：チームの見直し

**日付**：2026-10-13 | **タスク**：[tasks.md](./tasks.md) T041 | **手順**：[quickstart.md](./quickstart.md)

## 1. 自動の確認

| コマンド | 結果 |
|---|---|
| `pnpm --filter api db:migrate` | 0012_team_revision をローカルのDBに当てた |
| `pnpm lint` | エラーなし |
| `pnpm typecheck` | shared・api・web・e2e とも通る |
| `pnpm build` | 通る |
| `pnpm test` | shared 21ファイル・197件、web 34ファイル・320件、api 55ファイル・555件（マイグレーションの2件を含む）がすべて通る |
| `pnpm e2e -- team` | 5件すべて通る（SC-007） |
| `pnpm e2e -- token` | 4件すべて通る（010の流れは変わらない） |
| `pnpm team:open --setup --headless --wait` | `pnpm dev:fake`に対して、3人の接続 → チームの作成 → 2人の参加 → 編集者と担当まで通る |

成功の基準ごとのテスト：

| 基準 | テスト |
|---|---|
| SC-002（関わり×権限の表、チームのAPIの判定） | `apps/api/test/integration/permissions-matrix.test.ts`、`access.test.ts` |
| SC-003（見せる設定・別のチーム） | `team-share.test.ts`、`access.test.ts` |
| SC-004（管理者のいないチームを作らない） | `team-leave.test.ts`（同時の引き継ぎ・順番の組み合わせ・アカウントの削除） |
| SC-005（個人運用の画面が変わらない） | `apps/web/test/solo-owner-unchanged.test.tsx`、`team-section.test.tsx`、`sidebar-teams.test.tsx` |
| SC-006（008のデータを消した後の件数） | `apps/api/test/migration/migration-0012.test.ts` |
| SC-007（3人のブラウザ） | `e2e/tests/team.spec.ts` |
| FR-005（担当の人の案もNGワードと承認を通る） | `team-roles.test.ts` |

## 2. 気づいたこと

- **全体のE2E**：`pnpm e2e`の`onboarding`・`reconnect-delete`・`strategy`は、`E2E_CLERK_USER_EMAIL`が未設定のため最初は流れなかった（008より前からの未設定）。オーナー役のテスト用ユーザーを渡して流すと、`onboarding`2件・`strategy`1件は通る。`reconnect-delete`の1件は、このアカウントの設定に「再接続」のボタンが2つ（005の自動投稿の案内と、再接続のボタン）あり、テストのロケーターが1つに決まらずに失敗する。001のテストが005の画面の変更に追いついていないもので、011の変更によるものではない。011とは別に直す。
- **同時の引き継ぎ**：チームの行を`FOR UPDATE`で取る問い合わせに`team_members`を結合したまま待つと、待った後も前のロールで判定され、2つ目の引き継ぎが一意索引の違反（500）になった。先にチームの行だけに鍵をかけ、次の文で最新のロールを読むように直した（`access.ts`の`authorizeTeamMember`）。`team-leave.test.ts`で、同時の2つの引き継ぎが204と403になることを確かめている。
- **見せてもらっている人と設定**：`GET /post-drafts`はNGワード（設定）も返していたので、見せてもらっている人には空で返す（FR-031）。

## 3. 計画からの変更

- **マイグレーションのテストの置き場所**：tasks.md T004 は`test/integration/`だが、使い捨てのDBに`pg`で直接つなぐため、Workersの外（Node）で動く別のテストのまとまり`test/migration/`に置いた（`apps/api/vitest.config.ts`の`migration`）。
- **Threadsのデータ削除の依頼**：アカウントの削除（FR-046）と同じく、データ削除の依頼でアカウントが消えるときも、チームの最後のアカウントなら抜けたものとする（`data-deletion.ts`）。管理者のいないチームを作らないため。
- **APIの応答に足したもの**（contracts/api.md に追記）：`GET /api/accounts/:id`の`role`の`viewer`、`/access`の`assignedNotice`、チームの詳細の`relation`、`/team`の`team.shared`、招待の確認の`teamId`と`inOtherTeam`（チーム名）。
- **招待リンクから追加に進んだ人の戻り先**：このアプリで許可する方法はAPIの callback を通るので、戻り先（`/invite/t_…`）をタブの間だけ`sessionStorage`に覚え、追加の後に戻す（`apps/web/src/lib/invite-return.ts`）。覚えられない環境では戻さない（リンクを開き直せば続きから参加できる）。
- **見せてもらっているアカウントで`open`を呼ばない**：`/api/me`の一覧にないアカウントでは、開く記録（`POST /open`）を止める。`open`は403で再試行しないようにした。
- **E2Eの環境変数**：名前は008のまま（管理者は`E2E_PARTNER_EMAIL`の人）。README・`e2e/.env.example`に書いた。
- **PR #14 のCodexレビュー**：宣伝の割合・作る件数を`settings`の権限に上げた（担当の人は読むだけ、件数は保存しない）。見せてもらっている人には、作る件数・自動投稿の状態・投稿の予定を返さず、`canEdit`をfalseにした。引き継ぎで、編集者の上限（10人）と管理者のチームの上限（20）を守る（アカウントの削除での引き継ぎは、20チームの管理者を飛ばす）。アカウントの削除で、チームの行の鍵の後にアカウントの行を読み直す。管理者のチームの数は、行ロックの後に取るアドバイザリーロック（`lockAdminTeams`）で数える。
- **テストの順番**：API・Webのテストの多くは、サービスと画面を書いた後に書いて、通ることを確かめた（tasks.md の「テストを先に書く」の順を守れていないものがある）。

## 4. 手動の確認（予定）

quickstart.md 2 の1〜7を、`pnpm team:demo`で3人のブラウザを開いて行う。

- [ ] 1〜6（サイドバー・見せる・案の登録・引き継いで抜ける・個人運用の1行・375px）
- [ ] 7：招待リンクを開いてから参加が終わるまでの時間（1分以内。SC-001）
- [ ] 本物のThreads：3人とも自分のアカウントを接続するので、Metaのテスターの招待が3人とも要る
