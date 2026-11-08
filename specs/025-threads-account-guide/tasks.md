---

description: "Task list for feature 025 threads account guide"
---

# Tasks：Threadsで許可するときのアカウントの取り違えを減らす案内

**Input**：[spec.md](./spec.md)、[plan.md](./plan.md)、[research.md](./research.md)、[data-model.md](./data-model.md)、[contracts/api.md](./contracts/api.md)、[contracts/ui-routes.md](./contracts/ui-routes.md)、[quickstart.md](./quickstart.md)

**Tests**：001〜024と同じく、テストを先に書いて失敗を確かめてから実装する（TDD）。特に次を自動テストで確かめる。
- SC-001：「Threadsで許可する」を出す3か所すべてに、押す前の案内が出る
- SC-003：違うアカウントでつながった知らせが、閉じるまで出る
- SC-004：トークンの貼り付けと、つなぐ・接続し直すの判定が変わらない（今のテストがそのまま通る）

**Organization**：spec.mdのUser Storyの優先度の順。MVPはP1のUS1・US2。

## Format：`[ID] [P?] [Story] Description`

- **[P]**：別ファイルで、未完了のタスクに依存せず並行できる。
- **[Story]**：[US1]〜[US3]はspec.mdのUser Storyに対応する。
- **画面**：モック（https://claude.ai/artifact/9hc14FMaeTytHEAkuNiaLH ）のとおり。ボタンと枠は今の部品にそろえる。

## Phase 1：Setup（共有の文言）

- [X] T001 `packages/shared/src/threads-account-guide.ts`と`packages/shared/test/threads-account-guide.test.ts`を作り、`packages/shared/src/index.ts`から出す（data-model.md 3）。
  - `THREADS_WEB_URL = "https://www.threads.com/"`
  - `ACCOUNT_SWITCH_ERRORS = ["RECONNECT_ACCOUNT_MISMATCH", "THREADS_ACCOUNT_TAKEN", "ACCOUNT_ALREADY_REGISTERED"]`と、判定の`isAccountSwitchError(code)`
  - `accountGuideLead(expected)`：`expected`があれば「threads.comでログインしているアカウントで許可されます。@〇〇 でログインしているか確かめてください。」、なければ前半だけ
  - `accountSwitchSteps(expected, again)`：3行
    1. 「threads.com（またはThreadsのアプリ）で、今のアカウントからログアウトする」
    2. 「@〇〇 でログインし直す」（なければ「つなぎたいアカウントでログインし直す」）
    3. 「このページに戻って、もう一度「{again}」を押す」

## Phase 2：Foundational

- なし（US1・US2は画面だけ。US3のデータはUS3の中で足す）。

## Phase 3：User Story 1 - 押す前に、どのアカウントで許可されるかがわかる（P1）🎯 MVP

**Goal**：「Threadsで許可する」の下に、使うべきアカウントと閉じたトグルの手順を出す。

**Independent Test**：接続し直す・招待済み・つなぐ前（招待の管理がOFF）の3か所で案内が出て、トグルを開くと手順とリンクが出る。トークンの画面には出ない。

### Tests（先に書いて失敗を確かめる）

- [X] T002 [P] [US1] `apps/web/test/threads-account-guide.test.tsx`を作る。
  - 使うべき名前があるとき・ないときの文
  - トグルは初めは閉じていて、開くと3行と「threads.comを開く」（`href`が`https://www.threads.com/`、`target="_blank"`、`rel`に`noreferrer`）が出る
- [X] T003 [P] [US1] `apps/web/test/reconnect-dialog.test.tsx`に足す。
  - 「Threadsで許可する」を出すとき、`@{account.username}`の案内が出る
  - 「トークンを貼り付ける」を選んだ画面には出ない
  - `app`を出さない環境では出ない
- [X] T004 [P] [US1] `apps/web/test/tester-application-panel.test.tsx`に足す。
  - 招待済みで、申し込んだ名前の案内が出る
  - 招待の管理がOFFのつなぐ画面では、名前のない案内が出る
  - トークンの手順を開いても、案内はトークンの側に出ない

### Implementation

- [X] T005 [US1] `apps/web/src/components/connect/ThreadsAccountGuide.tsx`を作る（T002を通す）。
  - 枠は`Alert`の通常の形。@ユーザー名は太字。
  - トグルは今の開閉の作り（`aria-expanded`）にそろえる。
- [X] T006 [US1] `ThreadsAccountGuide`を3か所に置く（T003・T004を通す。contracts/ui-routes.md 1）。
  - `apps/web/src/components/connect/ReconnectDialog.tsx`：選択肢の一覧の下。「Threadsで許可する」を出すときだけ、`account.username`
  - `apps/web/src/components/connect/TesterApplicationPanel.tsx`：招待済みの「Threadsで許可する」の下。申し込んだ名前
  - `apps/web/src/components/connect/ConnectMethods.tsx`：招待の管理がOFFのときの「Threadsで許可する」の下。名前なし

**Checkpoint**：3か所で、押す前に使うべきアカウントがわかる。

## Phase 4：User Story 2 - 接続し直しで違うアカウントだったとき、すぐ切り替えられる（P1）🎯 MVP

**Goal**：違うアカウントで戻ったとき、エラーの文に続けて手順と「threads.comを開く」を出す。つながっているアカウントでは、戻りのエラーをトーストの代わりに区分の中に出す（research.md R2）。

**Independent Test**：つながっているアカウントの設定を`?error=RECONNECT_ACCOUNT_MISMATCH`で開くと、エラーの文・3つの手順・「threads.comを開く」が出る。

### Tests（先に書いて失敗を確かめる）

- [X] T007 [P] [US2] `apps/web/test/account-switch-steps.test.tsx`を作る。
  - 3つのエラーで手順（番号つき、閉じずに出す）と、枠線の「threads.comを開く」（新しいタブ）が出る
  - `again`の文が入る
- [X] T008 [P] [US2] `apps/web/test/account-settings.test.tsx`に足す（research.md R2）。
  - **手順も出す場合**：つながっているアカウントを`?error=RECONNECT_ACCOUNT_MISMATCH`で開くと、「再接続には、元の@{username}で認可してください…」の文と、`@{username}`と「接続し直す」を使った手順が出る
  - **文だけ出す場合**：`?error=THREADS_AUTH_CANCELLED`では、エラーの文だけが出る（手順は出ない）
  - 「接続し直す」のボタンは残る
- [X] T009 [P] [US2] `apps/web/test/connect-methods.test.tsx`・`tester-application-panel.test.tsx`に足す。
  - つなぐ前の画面で`THREADS_ACCOUNT_TAKEN`・`ACCOUNT_ALREADY_REGISTERED`のとき、エラーの文に続けて手順が出る（招待済みなら申し込んだ名前、そうでなければ「つなぎたいアカウント」）
  - `ACCOUNT_ALREADY_REGISTERED`の「そのアカウントを開く」のリンクは残る
  - `THREADS_AUTH_CANCELLED`では手順は出ない

### Implementation

- [X] T010 [US2] `apps/web/src/components/connect/AccountSwitchSteps.tsx`を作る（T007を通す）。中身は手順（`ol`）と「threads.comを開く」（`Button variant="outline" asChild`の`a`）。
- [X] T011 [US2] つながっているアカウントの「Threadsとの接続」で、戻りのエラーを出す（T008を通す）。
  - `apps/web/src/pages/account-settings.tsx`の、つながっているアカウントの区分で、`callback.error`があれば`Alert variant="destructive"`に`errorMessage(code, { username: account.username })`を出す。
  - `isAccountSwitchError`なら、続けて`AccountSwitchSteps`（`expected = account.username`、`again = "接続し直す"`）を出す。
- [X] T012 [US2] つなぐ前の画面のエラーに手順を足す（T009を通す）。
  - `apps/web/src/components/connect/ConnectMethods.tsx`の`returned`（`RegisteredAlert`とふつうのエラー）
  - `TesterApplicationPanel`の`fallbackError`
  - 上の2つで、`isAccountSwitchError`なら`AccountSwitchSteps`を足す（`again = "Threadsで許可する"`、`expected`は招待済みなら申し込んだ名前）

**Checkpoint**：違うアカウントで戻っても、その画面の案内だけでやり直せる。

## Phase 5：User Story 3 - 招待済みで違うアカウントでつながったとき、何が起きたかわかる（P2）

**Goal**：024の記録をもとに「@〇〇でつながりました。申し込んだ@△△とは違うアカウントです」を、閉じるまで出す。

**Independent Test**：招待済み（@shop_tokyo）のアカウントを別のアカウントでつなぐと知らせが出て、「閉じる」で消え、再読み込みしても出ない。

### Tests（先に書いて失敗を確かめる）

- [X] T013 [P] [US3] `apps/api/test/migration/migration-0023.test.ts`を作る。`tester_applications.mismatch_notice_dismissed_at`が「timestamptz、NULL可、既定値なし」で足され、今ある行は NULL であることを確かめる。
- [X] T014 [P] [US3] `apps/api/test/integration/connection-notice.test.ts`を作る（contracts/api.md）。
  - **出る**：招待済みで違う名前でOAuthでつながると、`otherAccount: { appliedUsername, connectedUsername }`
  - **出ない**：
    - 同じ名前でつながったとき・申し込みがないとき
    - 申し込んだアカウントでつなぎ直したとき（今の`threads_user_id`が`connected_threads_user_id`と違う）。Threadsで名前を変えただけなら出し続ける
  - **閉じる**：`POST …/dismiss`で`204`になり、そのあとは出ない。行がなくても`204`
  - **権限**：関わりがなければ`404`、オーナーでなければ`403`
  - **招待の管理がOFFの環境**：読める
- [X] T015 [P] [US3] `apps/web/test/connection-notice.test.tsx`を作る。
  - 知らせの文と2行の箇条書き
  - 「閉じる」で dismiss を送って消える
  - `otherAccount: null`なら何も出さない

### Implementation

- [X] T016 [US3] `apps/api/src/db/schema.ts`の`testerApplications`に`mismatchNoticeDismissedAt: timestamp("mismatch_notice_dismissed_at", { withTimezone: true, precision: 6 })`（NULL可）を足し、`apps/api/drizzle/0023_connection_notice.sql`と`drizzle/meta`を生成する（T013を通す）。
- [X] T017 [US3] `apps/api/src/services/tester-application-service.ts`に`connectionNotice(db, accountId)`と`dismissConnectionNotice(env, accountId)`を足す（data-model.md 2の条件）。
- [X] T018 [US3] 知らせのAPIとスキーマを足す（T014を通す）。
  - `apps/api/src/routes/tester-applications.ts`に`GET /accounts/:accountId/connection-notice`と`POST /accounts/:accountId/connection-notice/dismiss`を足す（オーナーだけ。招待の管理がOFFでも`404`にしない）。
  - `packages/shared/src/schemas.ts`に`connectionNoticeSchema`を足す。
  - `apps/api/test/helpers/routes.ts`の権限の表に2本を`owner`で足す。
- [X] T019 [US3] Webに知らせを出す（T015を通す）。
  - `apps/web/src/components/connect/ConnectionNotice.tsx`を作る。
  - `apps/web/src/lib/api-client.ts`に`connectionNotice`・`dismissConnectionNotice`、`apps/web/src/lib/query.ts`に`queryKeys.connectionNotice(accountId)`を足す。
  - `apps/web/src/pages/account-settings.tsx`のつながっているアカウントの「Threadsとの接続」の、説明の上に置く（オーナーだけ）。

**Checkpoint**：違うアカウントでつながったことに、オーナーが閉じるまで気づける。

## Phase 6：Polish & Cross-Cutting

- [X] T020 [P] `docs/user-guide.md`の「はじめかた」に、「Threadsで許可する」は threads.com でログインしているアカウントで許可されることと、違うアカウントのときの切り替え方を、箇条書きで足す。
- [X] T021 [P] `docs/ui-design.md`の024の項目の後に、025の案内（押す前の案内・戻ったときの手順・違うアカウントでつながった知らせ）を1項目で足す。
- [X] T022 `pnpm -r typecheck`・`pnpm lint`・`pnpm test`を通す。
- [ ] T023 （マージのあと）[quickstart.md](./quickstart.md)の1〜3をテスト版で行い、SC-002（2分以内にやり直せる）を測る。

## Dependencies & Execution Order

- **Setup（T001）** → すべてのUser Story。
- **US1（T002〜T006）**：T001のあと。
- **US2（T007〜T012）**：T001のあと。US1と並行できる。ただし`ConnectMethods`・`TesterApplicationPanel`はUS1（T006）と重なるので、その後にする。
- **US3（T013〜T019）**：T001のあと。APIはUS1・US2と並行できる。`account-settings.tsx`はUS2（T011）の後。
- **Polish（T020〜T023）**：すべての後。T023はマージのあと。

## Parallel Examples

```text
# Setup のあと、テストを同時に
T002 threads-account-guide.test.tsx
T003 reconnect-dialog.test.tsx
T007 account-switch-steps.test.tsx
T013 migration-0023.test.ts
T014 connection-notice.test.ts（API）
T015 connection-notice.test.tsx（Web）
```

## Implementation Strategy

1. **MVP**：Setup → US1 → US2 で、取り違えを防ぎ、起きたときにすぐやり直せるようにする。
2. **US3**：違うアカウントでつながった知らせを足す。
3. **Polish**：文書とテスト版での確認。

`feature/025-threads-account-guide`→`develop`の1つのPRにする。
