---

description: "Task list for feature 026 operator accounts"
---

# Tasks：運営者がすべてのアカウントを接続方法ごとに確かめられる一覧

**Input**：[spec.md](./spec.md)、[plan.md](./plan.md)、[research.md](./research.md)、[data-model.md](./data-model.md)、[contracts/api.md](./contracts/api.md)、[contracts/ui-routes.md](./contracts/ui-routes.md)、[quickstart.md](./quickstart.md)

**Tests**：001〜025と同じく、テストを先に書いて失敗を確かめてから実装する（TDD）。特に次を自動テストで確かめる。
- SC-002：接続方法ごとの件数が、用意した数と一致する
- SC-004：運営者でない人は、一覧の中身を1件も読めない（`403 OPERATOR_ONLY`）
- SC-005：書き込むAPIがない（見るだけ）

**Organization**：spec.mdのUser Storyの優先度の順。MVPはP1のUS1・US2。

## Format：`[ID] [P?] [Story] Description`

- **[P]**：別ファイルで、未完了のタスクに依存せず並行できる。
- **[Story]**：[US1]〜[US3]はspec.mdのUser Storyに対応する。
- **画面**：モック（https://claude.ai/artifact/BgQqyj6fDtY6KeNYYFQm4W ）のとおり。タブと行の枠は「テスター招待」にそろえる。

## Phase 1：Setup（共有の定数とスキーマ）

- [X] T001 `packages/shared/src/operator-accounts.ts`を作り、`packages/shared/src/index.ts`から出す（data-model.md 4）。
  - `OPERATOR_ACCOUNT_METHODS = ["all", "app", "token", "none"]`と、表示名`OPERATOR_ACCOUNT_METHOD_LABELS`（すべて・Threadsで許可する・トークン・つなぐ前）
  - `CONNECTION_STATUS_LABELS`（`connected`＝接続中、`needs_reconnect`＝要再接続、`not_connected`＝つなぐ前）
  - `OPERATOR_ACCOUNT_TESTER_STATES = ["pending", "invited", "connected", "removable"]`と`OPERATOR_ACCOUNT_TESTER_LABELS`（申し込み中・招待済み・接続済み・外してよい）
  - `OPERATOR_ACCOUNTS_PAGE_SIZE = 50`、`OPERATOR_ACCOUNTS_QUERY_MAX = 100`
- [X] T002 `packages/shared/src/schemas.ts`に足す（contracts/api.md）。テストは`packages/shared/test/operator-accounts.test.ts`。
  - `operatorAccountsQuerySchema`：`method`（既定`all`）、`q`（前後の空白を除いて0〜100文字、空は無し扱い）、`cursor`（uuid、任意）
  - `operatorAccountSchema`：`id`・`name`・`username`（nullable）・`method`（`app`・`token`・`none`）・`status`・`owner`（`{ name: string | null; email: string; accountCount: number }`、nullable）・`tester`（nullable）・`createdAt`
  - `operatorAccountsSchema`：`counts`（`all`・`app`・`token`・`none`）・`items`・`nextCursor`（nullable）

## Phase 2：Foundational

- なし（表・列は足さない。data-model.md）。

## Phase 3：User Story 1 - すべてのアカウントを1つの一覧で見る（P1）🎯 MVP

**Goal**：運営者が、すべてのアカウントを接続方法・接続の状態・オーナー・テスター招待の状態とともに見られる。

**Independent Test**：「Threadsで許可する」・トークン・つなぐ前のアカウントを1件ずつ用意し、一覧に3件とも正しい値で出る。運営者でなければ読めない。

### Tests（先に書いて失敗を確かめる）

- [X] T003 [P] [US1] `apps/api/test/integration/operator-accounts.test.ts`を作る（contracts/api.md）。
  - 「Threadsで許可する」（接続済みの申し込みあり）・トークンで要再接続（申し込みなし）・つなぐ前（申し込み中）の3件で、各行の`method`・`status`・`username`（つなぐ前はnull）・`owner`・`tester`が合う
  - 枠を使ったまま残った行（`holds_slot = true`・`removal_reason`あり）だけのアカウントは`tester = "removable"`、見送り・取り下げだけなら`null`
  - オーナーが2件持つとき、どちらの行も`owner.accountCount = 2`（つなぐ前を含む。絞り込み・検索で変わらない）
  - 作った日の新しい順。51件で`nextCursor`が出て、それで残り1件が読める。消えたアカウントの`cursor`なら先頭から
  - 運営者でなければ`403 OPERATOR_ONLY`、応答は`Cache-Control: no-store`
  - 書き込みのメソッド（POST・PUT・PATCH・DELETE）は`404`
  - 行の項目は契約の8つだけ（投稿・戦略などの中身を返さない。FR-006）
- [X] T004 [P] [US1] `apps/web/test/settings-operator-accounts.test.tsx`を作る（contracts/ui-routes.md 1〜3）。
  - 「運営」に「アカウント一覧」が「テスター招待」の次に出る（運営者だけ）
  - 運営者でない人が直接開くと、区分は出ず「この画面は運営者だけが使えます。」（今の運営の区分と同じ）
  - 行に、名前・@ユーザー名（つなぐ前は「未接続」）・接続方法・状態・オーナーの名前（なければ「名前なし」）と「（2件）」・メールアドレス・テスター招待（なければ「—」）が出る
  - 読み込み中・エラー・「ありません」
  - 「もっと見る」で次のページが下に足される。失敗したら一覧は残り、エラーの文が出る

### Implementation

- [X] T005 [US1] `apps/api/src/services/operator-account-service.ts`を作る（research.md R2・R4〜R6、T003を通す）。
  - `listOperatorAccounts(db, { method, q, cursor })`：行（R5の`method`、R6のオーナーと`accountCount`、R4の`tester`）、50件、`(created_at, id)`の新しい順、`cursor`のアカウントの位置より前
  - 件数（`counts`）は検索なしの全体で数える
- [X] T006 [US1] `apps/api/src/routes/operator-accounts.ts`を作り、`apps/api/src/app.ts`につなぐ（`authed`・`operatorOnly`、クエリが合わなければ`400 VALIDATION_FAILED`）。
- [X] T007 [US1] Webの一覧を作る（T004を通す）。
  - `apps/web/src/lib/api-client.ts`に`operatorAccounts({ method, q, cursor })`、`apps/web/src/lib/query.ts`に`queryKeys.operatorAccounts(method, q)`
  - `apps/web/src/pages/settings/operator-accounts.tsx`：見出し・説明・一覧（`md`以上は5列の表、狭いときは段に分ける）・「もっと見る」（`useInfiniteQuery`）・下の1行
  - `apps/web/src/pages/settings/sections.ts`の「運営」に`{ slug: "operator-accounts", label: "アカウント一覧", Icon: ListIcon }`を「テスター招待」の次に足し、`apps/web/src/router.tsx`に`/settings/operator-accounts`を足す

**Checkpoint**：運営者が、すべてのアカウントを1つの画面で確かめられる。

## Phase 4：User Story 2 - 接続方法で絞り込み、件数を知る（P1）🎯 MVP

**Goal**：接続方法の下線のタブで絞り込め、それぞれの件数がわかる。

**Independent Test**：方法の違うアカウントを数件ずつ用意し、タブの件数が合い、絞り込むとその方法だけが出る。

### Tests

- [X] T008 [P] [US2] `apps/api/test/integration/operator-accounts.test.ts`に足す。
  - 「Threadsで許可する」3件（うち要再接続1件）・トークン2件・つなぐ前1件で、`counts = { all: 6, app: 3, token: 2, none: 1 }`
  - `method=token`でトークンの2件だけ。`counts`は変わらない
  - `method`が合わなければ`400`
- [X] T009 [P] [US2] `apps/web/test/settings-operator-accounts.test.tsx`に足す。
  - タブ「すべて 6」「Threadsで許可する 3」「トークン 2」「つなぐ前 1」、初めは「すべて」
  - 「トークン」を押すと`method=token`で読み直し、先頭から出す

### Implementation

- [X] T010 [US2] サービスに`method`の絞り込みを足す（T008を通す）。
- [X] T011 [US2] 画面にタブを足す（`Tabs`の下線の形、「テスター招待」と同じ。狭い幅では折り返す。T009を通す）。

**Checkpoint**：接続方法ごとの数と、その中身がわかる。

## Phase 5：User Story 3 - 名前やメールアドレスで探す（P2）

**Goal**：検索欄で、名前・@ユーザー名・オーナーの名前・メールアドレスの一部から探せる。

**Independent Test**：@ユーザー名の一部・メールアドレスの一部で、合うものだけが出る。件数は変わらない。

### Tests

- [X] T012 [P] [US3] `apps/api/test/integration/operator-accounts.test.ts`に足す（research.md R3）。
  - アカウントの名前・@ユーザー名・オーナーの名前・メールアドレスの一部で合う（大文字・小文字を問わない）
  - `%`・`_`はその文字として探す（`a_b`で`axb`に合わない）
  - `method`と合わせて使える。`counts`は検索で変わらない
  - 101文字は`400`、空白だけは検索なし
- [X] T013 [P] [US3] `apps/web/test/settings-operator-accounts.test.tsx`に足す。
  - 入力が止まってから`q`つきで読み直す
  - 合わなければ「ありません」

### Implementation

- [X] T014 [US3] サービスに検索を足す（`ILIKE`、エスケープ。T012を通す）。
- [X] T015 [US3] 画面に検索欄を足す（ラベル「アカウント・@ユーザー名・オーナーで探す」、300ミリ秒待って読み込む。T013を通す）。

**Checkpoint**：問い合わせの1件を、すぐ見つけられる。

## Phase 6：Polish & Cross-Cutting

- [X] T016 [P] `docs/ui-design.md`の025の項目の後に、026の「アカウント一覧」（置き場所・タブ・表とスマートフォンの段・オーナーの件数）を1項目で足す。
- [X] T017 `pnpm -r typecheck`・`pnpm lint`・`pnpm test`を通す。
- [ ] T018 （マージのあと）[quickstart.md](./quickstart.md)の1〜4をテスト版で行う。

## Dependencies & Execution Order

- **Setup（T001・T002）** → すべてのUser Story。
- **US1（T003〜T007）**：Setupのあと。
- **US2（T008〜T011）**：US1のサービスと画面に足すので、US1のあと。
- **US3（T012〜T015）**：US1のあと。US2と並行できるが、同じファイルを触るので順に行う。
- **Polish（T016〜T018）**：すべての後。T018はマージのあと。`docs/user-guide.md`は利用者向けで運営者の画面を書いていないので、変えない。

## Parallel Examples

```text
# Setup のあと、テストを同時に
T003 operator-accounts.test.ts（API）
T004 settings-operator-accounts.test.tsx（Web）
```

## Implementation Strategy

1. **MVP**：Setup → US1 → US2 で、すべてのアカウントを接続方法ごとに見られるようにする。
2. **US3**：検索を足す。
3. **Polish**：文書とテスト版での確認。

`feature/026-operator-accounts`→`develop`の1つのPRにする。
