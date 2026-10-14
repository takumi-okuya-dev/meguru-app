# 検証の記録：アカウントを先に作る

**日付**：2026-10-14 | **タスク**：[tasks.md](./tasks.md) T048 | **手順**：[quickstart.md](./quickstart.md)

## 1. 自動の確認

| コマンド | 結果 |
|---|---|
| `pnpm --filter api db:migrate` | 0013_accounts_before_connect をローカルのDBに当てた |
| `pnpm lint` | エラーなし |
| `pnpm typecheck` | shared・api・web・e2e とも通る |
| `pnpm build` | 通る |
| `pnpm test` | shared 22ファイル・205件、web 36ファイル・352件、api 63ファイル・607件（マイグレーションの3件を含む）がすべて通る |
| `pnpm e2e -- onboarding` | 2件すべて通る（名前で作る → 課題 → 案の登録 → 承認 → ホームの「次にやること」→ トークンでつなぐ → 「自動投稿を始める」、許可の画面でのキャンセル） |
| `pnpm e2e -- token reconnect-delete strategy team` | 11件すべて通る |
| `pnpm team:open --setup --headless --wait` | `pnpm dev:fake`に対して、3人が作ってつなぐ → チームの作成 → 参加 → 編集者と担当まで通る |

E2E は、`e2e/.env.local`の3人に加えて、`E2E_CLERK_USER_EMAIL`にオーナー役（`E2E_OWNER_EMAIL`）を渡して流した。

成功の基準ごとのテスト：

| 基準 | テスト |
|---|---|
| SC-001（ログインから1分以内に名前だけで作る） | `e2e/tests/onboarding.spec.ts`（作るまでの時間を測る） |
| SC-002（つながずに戦略〜承認まで） | `apps/api/test/integration/unconnected-features.test.ts`、`e2e/tests/onboarding.spec.ts` |
| SC-003（つないだ前後で件数が同じ） | `apps/api/test/integration/connect-keeps-data.test.ts`、`e2e/tests/onboarding.spec.ts` |
| SC-004（同じThreadsアカウントに2つつながらない） | `token-duplicate.test.ts`（トークンの3通り・他の利用者・ユーザー名だけ）、`threads-callback-guards.test.ts`（このアプリの接続）、`connect-keeps-data.test.ts`（同時のつなぐ操作）、`e2e/tests/token.spec.ts` |
| SC-005（未接続からThreadsへの問い合わせが0回） | `apps/api/test/integration/unconnected-threads-calls.test.ts`（偽のThreadsへの要求の数で確かめる） |
| SC-006（`@null`などが出ない） | `apps/web/test/account-label-usage.test.tsx`、`account-home.test.tsx`、`settings-connect.test.tsx`、`invite-page.test.tsx`、`team-page.test.tsx` |
| SC-007（つないだアカウントだけの人の画面） | `apps/web/test/solo-owner-unchanged.test.tsx` |
| マイグレーション（FR-044） | `apps/api/test/migration/migration-0013.test.ts` |

## 2. 手で確かめること（まだ）

自動の確認では、偽のThreadsを使っている。次は、公開の前に手で確かめる。

- quickstart.md 2 の3：**本物のMetaの許可の画面**（テスターのアカウント）で「Threadsで許可する」でつなぎ、設定の画面に「つながりました」が出ること。
- quickstart.md 2 の全体を、**スマートフォンの幅**で見て、ホームの帯・設定の「Threadsとの接続」・招待の画面の表示が崩れないこと。
- 011 から残っている手での確認（011 quickstart.md 2、SC-001 の参加までの時間）は、012 の流れ（作ってからつなぐ）で行う。

## 3. 気づいたこと

- **reconnect-delete の E2E**：011 の記録に書いた「再接続のボタンが2つあって失敗する」は、E2E を書き直すときに、設定の「Threadsとの接続」の区分（`#threads`）の中のボタンを押すようにして直した。
- **0013 の作り直し**：実装の途中で、`oauth_states`の外部キーとCHECK制約も変える必要が分かり、0013 を作り直した。手元のDBには前の0013が当たっていたので、列挙型の値の追加を`ADD VALUE IF NOT EXISTS`にし、前の0013の変更を手で戻してから当て直した（結合テストはこのDBを毎回空にするので、消えたデータはない）。
- **OrbStack**：途中で止まり、結合テストがDBにつながらなくなった。`orb start`と`docker compose up -d --wait`で戻した。

## 4. 計画からの変更

- **`oauth_states`**（data-model.md に追記）：対象のアカウントの外部キーを`ON DELETE SET NULL`にし、CHECK制約を`oauth_states_no_target_for_new`に置き換えた。許可の画面にいる間にアカウントが消されたとき、callback で`ACCOUNT_NOT_FOUND`と分かり、`/`へ戻せるようにするため。
- **`ACCOUNT_ALREADY_REGISTERED`の`details`**：`[ID, 名前, ユーザー名]`にした（画面が「@ユーザー名は、あなたのアカウント『名前』に…」を出すため）。このアプリの接続の callback では、`?account=<ID>`を添え、画面が自分のアカウントの一覧から名前を引く（contracts/api.md に追記）。
- **自動投稿の処理**：オンの行があっても、未接続のアカウントは見ない（試み（飛ばした記録）も作らない）ようにした。API ではオンにできないが、念のため。
- **偽のThreads**：制御用以外の要求の数（`callCounts().total`）を足した（SC-005 の確かめのため）。
- **画面**：設定の「アカウントの名前」の区分は`AccountNameSection.tsx`に分け、入力欄のラベルを「名前」にした（見出しの「アカウントの名前」とぶつかるため）。切り替えメニューの「未接続」は、`ConnectionBadge`ではなく@ユーザー名の位置の文字で出す。チームの画面の「アカウントを足す」でも、未接続のアカウントを選べなくした。
- **テストの置き場所**：tasks.md にある一部のテスト（T026・T030・T041）は、既存のファイルに散らさず、新しいファイルにまとめた（tasks.md の各タスクの実装メモ）。
- **決済への持ち越し**：未接続のアカウントの数え方と、つながないまま置かれたアカウントの扱いは、`specs/013-billing/notes.md`に移した。
