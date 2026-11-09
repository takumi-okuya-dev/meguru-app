---

description: "Task list for feature 027 modular monolith"
---

# Tasks：Threadsアプリをモジュラーモノリスに整理する

**Input**：[spec.md](./spec.md)、[plan.md](./plan.md)、[research.md](./research.md)、[data-model.md](./data-model.md)、[contracts/module-boundaries.md](./contracts/module-boundaries.md)、[quickstart.md](./quickstart.md)

**Tests**：動きを変えないリファクタリングなので、今あるテスト（共有512件・Web 751件・API 1,266件）が主な確かめ。足すのは次の3つだけで、先に書いて失敗を確かめる。
- ESLintの規則`module-boundaries`のテスト（SC-003：4つの違反の型、新しいアプリにも当たる）
- 知らせ（`platform/hooks.ts`）のテスト
- APIの入口の一覧のテスト（SC-004）

**Organization**：spec.mdのUser Storyの順。PRは2つ（research.md R8）：**PR1＝Phase 1〜3（地図・決まり・規則）**、**PR2＝Phase 4〜7（並べ替え・確かめ・受け皿）**。規則はPR1で入れ、モジュールのフォルダーができた順に効き始める。

## Format：`[ID] [P?] [Story] Description`

- **[P]**：別ファイルで、未完了のタスクに依存せず並行できる。
- **[Story]**：[US1]〜[US4]はspec.mdのUser Storyに対応する。
- **移動のしかた**：ファイルの移動は`git mv`で行い、読みこみ先の相対パスはスクリプトで機械的に直す（中身は変えない）。中身を変えるのは、T015（接続の処理の切り出し）・T016（知らせ）・T017（`readOperatorSettings`の移動）だけ。

---

# PR1：地図と決まり

## Phase 1：Setup（並べ替えの前の基準）

- [X] T001 APIの入口の一覧を書き出す仕組みを作り、基準を残す（research.md R7）。
  - `apps/api/scripts/dump-routes.ts`：`makeApp()`の`app.routes`から「メソッド パス」を1行ずつ、並べて書き出す（重複を除く）。
  - 出力を`apps/api/test/repo/routes.snapshot.txt`に残す（`pnpm --filter api routes:snapshot`で書き直す。入口ごとの処理の数と、すべての入口にかかる関所の順番を含む）。
- [X] T002 `apps/api/test/repo/routes-snapshot.test.ts`を作る：今のアプリの入口の一覧が`apps/api/test/repo/routes.snapshot.txt`と同じであること。並べ替えの前に通ることを確かめる。

## Phase 2：Foundational（境界の規則）

**⚠️ US2・US4はこの規則に頼る。**

- [X] T003 [P] `eslint-rules/module-boundaries.test.js`を作る（ESLintの`RuleTester`。contracts/module-boundaries.md 4）。先に書いて失敗を確かめる。
  - `node --test`で動かすため、ファイルの初めで`RuleTester.describe`・`RuleTester.it`・`RuleTester.itOnly`を`node:test`の`describe`・`it`・`it.only`につなぐ。
  - `eslint-rules/`のファイルもESLint（jsdocの規則を含む）の対象になるので、関数にjsdocを書く。
  - 通る：`apps/threads`→`../../platform`（入口）、`apps/threads`→`../../kernel/errors`、`platform/billing`→`../teams/team-service`（共通の中）、`apps/threads/drafts`→`../publish/x`（Threadsの中）、`app.ts`→`./apps/threads`（組み立て）、`apps/threads`→`../../adapters/stripe`
  - 入口の外：`apps/threads`→`../../platform/billing/billing-service`、`apps/threads`→`../../adapters/stripe/stripe-client`
  - 共通 → アプリ：`platform/x`→`../apps/threads`
  - アプリ同士：`apps/sample`→`../threads`（`sample`は設定にない名前。FR-016）
  - 窓口・土台 → 上：`adapters/stripe`→`../../platform`、`kernel/config`→`../adapters/stripe`、`kernel/config`→`../platform`
  - `import type`・`export … from`も同じに判定する
- [X] T004 `eslint-rules/module-boundaries.js`を作り（T003を通す）、`eslint.config.js`で`apps/api/src/**/*.ts`にかける（`error`）。
  - 判定：読みこむファイルと読みこみ先を`apps/api/src`からの相対で解き、`kernel`・`adapters/<名前>`・`platform`・`apps/<名前>`・組み立て（それ以外）に分ける。
  - 並べ替えの前は、どのファイルもどの種類にも当たらない（組み立てとみなされる）ので、違反は0件のまま。
  - テストの実行：`pnpm lint`の前に`node --test eslint-rules/`を流すよう、ルートの`package.json`の`lint`を`node --test eslint-rules/ && eslint .`にする。

## Phase 3：User Story 1 - どのコード・どの表が、どのモジュールのものかがわかる（P1）🎯 MVP

**Goal**：モジュール地図と、決まりの記録。

**Independent Test**：地図の表の一覧と`schema.ts`の42表、地図の処理の一覧と`apps/api/src`のファイルを突き合わせ、漏れも重なりもない（SC-001）。

- [X] T005 [US1] `docs/module-map.md`を作る（data-model.mdの下書きを正本にする）。
  - 種類と依存の向き（research.md R1）、入口（R2）、知らせ（data-model.md 3）
  - 表の持ち主42表（1-1・1-2）。`apps/api/src/db/schema.ts`の`pgTable`の数と一致することを確かめる
  - 例外の列（1-3）：`schema.ts`の`accounts`・`operator_settings`の列をすべて当て、共通が書き換える列（`id`・`name`・`created_at`・`updated_at`・`last_used_at`）以外をThreadsの例外として漏れなく書く
  - 処理とAPIの入口の行き先（2-1〜2-5）。`apps/api/src`の`.ts`のすべてが、どれか1つに載っていることを確かめる
  - 境界の例外（4）
  - 構想ノートの場所（personal-knowledge-base の`Wiki/仕事/システム開発/アイデア/個人開発版Google Workspace構想（スイート型SaaS）.md`）を書く（中身は写さない）
- [X] T006 [P] [US1] `docs/architecture.md`の「設計の意図」に、モジュラーモノリスの決まり（5つの種類・依存の向き・入口・データの持ち主・知らせ）を短く足し、`docs/module-map.md`と`docs/product-structure.md`（これからのプロダクトの構造。2026-11-10に作成済み）へつなぐ（FR-017）。
- [X] T007 [US1] `/speckit-constitution`の手順で、`.specify/memory/constitution.md`の「技術スタック制約」にモジュールの決まりを1項目足す（FR-017。版はMINOR：4.5.0）。
  - APIは土台・窓口・共通・アプリ・組み立てに分け、依存は一方向。ほかのモジュールは入口から使う。表には持ち主のモジュールが1つある。共通からアプリを呼ぶときは知らせを使う。ESLintの規則で守る。
  - 2作目はアプリのモジュールとして同じリポジトリに足す。

**Checkpoint（PR1）**：`pnpm -r typecheck`・`pnpm lint`・`pnpm test`が通る（規則のテストを含む）。地図をレビューできる。

---

# PR2：並べ替え

## Phase 4：User Story 2 - コードがモジュールごとに分かれ、境界が自動で守られる（P1）

**Goal**：data-model.md 2のとおりに移動し、違反0件で規則を効かせる。

**Independent Test**：quickstart.md 2のとおり、わざと境界を越えた行を足すと`pnpm lint`が失敗する。

**段階の決まり**：規則はPR1から効いているので、フォルダーを作った時点でその中のファイルに当たる。共通へ移すファイルが、まだ古い場所（組み立てとみなされる）にあるThreadsの処理を読むと違反になる。そこで、逆向きの依存（research.md R4）は、共通へ移す前の段階2の初めに解消する。

### 段階1：土台と窓口（コミット1）

- [X] T008 [US2] 移動のスクリプト`apps/api/scripts/move-modules.ts`を作る：「元のパス → 新しいパス」の一覧を受け取り、`git mv`し、`apps/api/src`・`apps/api/test`・`apps/api/scripts`のすべての相対の読みこみ先を新しいパスに直す（拡張子なしの読みこみ・`../`の数を正しく計算する）。
- [X] T009 [US2] 土台へ移す（data-model.md 2-1）：`env.ts`→`kernel/env.ts`、`lib/config.ts`・`errors.ts`・`logger.ts`・`validate.ts`・`crypto.ts`・`identifier-hash.ts`→`kernel/`、`db/client.ts`・`db/locks.ts`→`kernel/db/`。`wrangler.toml`・`vitest`の設定・`drizzle.config.ts`で、移したファイルを指している場所があれば直す。
- [X] T010 [US2] 窓口へ移す（2-2）：`lib/stripe-client.ts`→`adapters/stripe/stripe-client.ts`、`lib/threads-client.ts`・`lib/signed-request.ts`→`adapters/threads-api/`。それぞれに`index.ts`（外で使っているものを出す）を置き、`src`の中の読みこみを入口に直す。
- [X] T011 [US2] 段階1の確かめ：型の確認・ESLint（`module-boundaries`を含む）・APIのテストが通ること。ここで1つコミットする。

### 段階2：逆向きの依存の解消と共通（コミット2）

- [X] T012 [P] [US2] `apps/api/test/unit/platform-hooks.test.ts`を作る（contracts/module-boundaries.md 3）。先に書いて失敗を確かめる：登録した順に`await`する・例外は呼んだ側に返る・登録がなければ何もしない・`resetHooks()`で消せる（テスト用）。
- [X] T013 [US2] `apps/api/src/platform/hooks.ts`を作る（T012を通す）。知らせの名前は`accountDeleting`・`userWithdrawing`・`limitsChanged`（data-model.md 3）で、それぞれの受け取る値の型を決める。
- [X] T014 [US2] 共通の表の定義を分ける：`apps/api/src/platform/schema.ts`に共通の17表（data-model.md 1-1）と、列挙型・`timestamps`などの共通の定義を移す。`db/schema.ts`は、当面`platform/schema.ts`を読み直して出し、残りの表をそのまま持つ。
- [X] T015 [US2] 接続の処理を切り出す（research.md R4-1）：`services/account-service.ts`の`ConnectionRequest`・`requestFromState`・`completeConnection`・`verifyConnection`とその内部の関数（`openAccount`は最後に開いたアカウントの記録なので共通に残す）を、古い場所の新しいファイル`services/connection-service.ts`へ移す（中身は変えない。段階3でThreadsへ移す）。`routes/accounts.ts`の接続の確かめの入口も、`routes/account-connection.ts`へ分ける（URLは変えない）。テストの読みこみ先も直す。
- [X] T016 [US2] 3つの知らせに置き換え、確かめ待ちの件数の入口を分ける（research.md R4-2〜5。同じ場所・同じ順番・同じ`tx`で`await`する）。
  - `accountDeleting`：`deleteAccount`の`withdrawForAccountDeletion`
  - `userWithdrawing`：`withdrawal-service.ts`の`purgeForWithdrawal`と`threads_deletion_requests`の更新
  - `limitsChanged`：`limit-service.ts`の`notifyWake`の2か所
  - `GET /api/me/needs-review-counts`（Threads専用。`countOwnedAccountNeedsReview`）は、知らせにせず`routes/me.ts`から古い場所の新しいファイル`routes/needs-review-counts.ts`へ分ける（段階3でThreadsへ移す。URLと応答は変えない。`app.ts`での登録の位置も、今の`routes/me.ts`のすぐ後にする）
  - 受け取る側は、古い場所の新しいファイル`services/threads-hooks.ts`の`registerThreads()`で登録する（2回呼んでも二重に登録しない）。`app.ts`の初めと`index.ts`の定期処理の初めで1回呼ぶ。
  - **直接呼ぶテスト**：アカウントの削除・退会・上限の保存・`/api/me`の一覧づくりを、アプリ（`makeApp()`）を通さず直接呼ぶテストを洗い出す。あれば、テストの共通の準備（`test/global-setup.ts`ではなく、各テストのプロセスで読む`setupFiles`か、ヘルパー）で`registerThreads()`を呼び、結果が変わらないようにする。
- [X] T017 [US2] `readOperatorSettings`を`tester-application-service.ts`から共通の運営の処理（`services/operator-settings.ts`。段階2の後半で`platform/operator/`へ移す）へ移し、テスター招待のサービスはそこから読む（research.md R4-4）。
- [X] T018 [US2] 共通へ移す（data-model.md 2-3）：`middleware/auth.ts`・`operator-only.ts`、`services/access.ts`・`account-service.ts`・`team-service.ts`・`team-status.ts`・`invite-service.ts`・`billing-service.ts`・`feature-service.ts`・`feature-sql.ts`・`test-group-service.ts`・`limit-service.ts`・`operator-events.ts`・`operator-settings.ts`・`referral-service.ts`・`activity-log.ts`・`withdrawal-service.ts`と、対応する`routes/*.ts`を`platform/<小分け>/`へ。共通のファイルは`db/schema`ではなく`platform/schema.ts`から表を読む。Honoの型`AppEnv`（`app.ts`）と`AuthVariables`（`middleware/auth.ts`）は共通（`platform/http.ts`）に置き、`app.ts`はそれを読み直して使う（docs/module-map.md 5）。
- [X] T019 [US2] `apps/api/src/platform/index.ts`を作る：アプリと組み立てが使っているもの（権限の確かめ・活動の記録・契約の状態・機能のON/OFF・上限・運営の設定・表の定義・知らせの登録・APIの入口を作る関数など）を出す。古い場所のThreadsのファイルからの読みこみは、まだ中身を直接指していてよい（古い場所は組み立てとみなされるので、規則に当たらない）。
- [X] T020 [US2] 段階2の確かめ：型の確認・ESLint（`module-boundaries`を含む。共通からThreadsへの読みこみが0件）・APIのテストが通ること。ここで1つコミットする。

### 段階3：Threads（コミット3）

- [ ] T021 [US2] Threadsへ移す（data-model.md 2-4）：残りの`services/*.ts`（`connection-service.ts`・`threads-hooks.ts`を含む）と`routes/*.ts`を`apps/threads/<小分け>/`へ。`services/daily-jobs.ts`は`jobs/daily-jobs.ts`（組み立て）へ。
- [ ] T022 [US2] `apps/api/src/apps/threads/index.ts`を作る：APIの入口を作る関数と`registerThreads()`を出す。`app.ts`・`index.ts`・テストの準備は、この入口の`registerThreads()`を呼ぶ。
- [ ] T023 [US2] Threadsの表の定義を`apps/api/src/apps/threads/schema.ts`へ分ける（data-model.md 1-2の25表）。`db/schema.ts`は共通とThreadsの`schema.ts`を読み直して出すだけにする（research.md R6）。Threadsのファイルは自分の`schema.ts`と共通の入口から表を読む。
- [ ] T024 [US2] Threadsのファイルの、共通・窓口への読みこみを入口に直す（`../../platform`・`../../adapters/<名前>`）。`app.ts`・`index.ts`・`jobs/`は各モジュールの入口から読む。
- [ ] T025 [US2] `eslint.config.js`で規則に`{ strictPlacement: true }`を渡し（組み立ての場所のほかに残ったファイルを知らせる）、`pnpm lint`で`module-boundaries`の違反が0件になるまで直す。直せないものがあれば、理由を`docs/module-map.md`の「境界の例外」に書く（5件以下）。
- [ ] T026 [US2] 段階3の確かめ：型の確認・ESLint・すべてのテストが通ること。ここで1つコミットする。

**Checkpoint**：違反0件で、境界が規則で守られている。

## Phase 5：User Story 3 - 利用者から見える動きは何も変わらない（P1）

**Goal**：動きが同じであることを、機械で確かめる。

**Independent Test**：quickstart.md 1。

- [ ] T027 [US3] `pnpm -r typecheck`・`pnpm lint`・`pnpm test`がすべて通り、テストの数が基準（共有512件・Web 751件・API 1,266件＋足したテスト）以上であることを確かめる。
- [ ] T028 [US3] `pnpm --filter api db:generate`で新しいマイグレーションができないこと（No schema changes）を確かめる。できたら、表の定義の移し間違いを直す。
- [ ] T029 [US3] `test/repo/routes-snapshot.test.ts`が通る（APIの入口の一覧が`routes.snapshot.txt`と同じ）ことを確かめる。
- [ ] T030 [US3] `apps/api/scripts/dump-routes.ts`・`rotate-token-key.ts`など`scripts/`が、新しい場所で動くことを確かめる（`pnpm --filter api exec tsx scripts/dump-routes.ts`）。

## Phase 6：User Story 4 - 2作目をThreadsと並ぶモジュールとして足せる（P2）

**Goal**：アプリを足す手順と、それに規則が当たることの確かめ。

**Independent Test**：quickstart.md 2-3。

- [ ] T031 [US4] `docs/module-map.md`に「アプリのモジュールを足す手順」を書く：`apps/<名前>/`に`index.ts`・`schema.ts`・小分けを作る、共通の入口だけを使う、表は今の`accounts`・`users`を参照する（`workspaces`は2作目で見直す）、`app.ts`で入口をつなぎ`registerXxx()`を呼ぶ、規則は設定なしで当たる。
- [ ] T032 [US4] quickstart.md 2の1〜3（共通 → アプリ・入口の外・仮のアプリ`apps/sample`からThreads）で`pnpm lint`が失敗することを確かめ、足した行と仮のアプリを消す。

## Phase 7：Polish & Cross-Cutting

- [ ] T033 [P] `docs/module-map.md`の処理の一覧と、並べ替えのあとの`apps/api/src`のファイルを突き合わせ、パスを最終の場所に直す（SC-001）。表を3つ・APIの入口を3つ選び、地図から持ち主を1分以内に答えられることを人が確かめる（SC-006）。
- [ ] T034 [P] `docs/project-report.md`に027（モジュラーモノリスへの整理）を1項目足す（共有用の文書の同期は「共有用を更新して」のときだけ）。
- [ ] T035 `pnpm -r typecheck`・`pnpm lint`・`pnpm test`を通す。
- [ ] T036 （マージのあと）quickstart.md 3のとおり、テスト版で基本の操作5つを確かめる（SC-005）。

## Dependencies & Execution Order

- **PR1**：Setup（T001・T002）→ Foundational（T003・T004）→ US1（T005〜T007）。T003とT005〜T006は並行できる。
- **PR2**：PR1のマージのあと、developから取りこみ直して始める。
  - US2は段階1（T008〜T011）→ 段階2（T012〜T020）→ 段階3（T021〜T026）の順。各段階の終わりで全部（`module-boundaries`を含む）通してコミットする。
  - 段階2では、逆向きの依存の解消（T015〜T017）を、共通への移動（T018）より先に行う。
  - US3（T027〜T030）：US2のあと。
  - US4（T031・T032）：US2のあと。US3と並行できる。
  - Polish（T033〜T036）：すべての後。T036はマージのあと。

## Parallel Examples

```text
# PR1：基準を残したあと、同時に
T003 eslint-rules/module-boundaries.test.js
T005 docs/module-map.md
T006 docs/architecture.md
```

## Implementation Strategy

1. **PR1（地図と決まり）**：設計（地図・決まり・規則）を先にレビューする。動くコードは変えない。
2. **PR2（並べ替え）**：機械的な移動を3つのコミットに分け、各段階で全部通す。中身を変えるのは接続の処理の切り出し・知らせ・`readOperatorSettings`の移動だけで、どれも共通へ移す前（段階2の初め）に行う。
3. **確かめ**：テストの数・`db:generate`・APIの入口の一覧・テスト版での5つの操作。

`feature/027-modular-monolith`→`develop`。PR1をマージしたあと、同じ名前のブランチをdevelopから作り直してPR2を出す（または`feature/027-modular-monolith-2`）。
