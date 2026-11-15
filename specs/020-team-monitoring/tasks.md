---

description: "Task list for feature 020 team monitoring"
---

# Tasks:チームの運用状況を見る

**Input**: [spec.md](./spec.md)、[plan.md](./plan.md)、[research.md](./research.md)、[data-model.md](./data-model.md)、[contracts/api.md](./contracts/api.md)、[contracts/ui-routes.md](./contracts/ui-routes.md)、[quickstart.md](./quickstart.md)

**Tests**: 001〜019と同じく、テストを先に書いて失敗を確かめてから実装する（TDD）。特に次を自動テストで確かめる。
- SC-003：メンバー・関わりのない人には数が1つも返らない。編集者には、担当の外の人とAccountの数が1つも返らない
- SC-004：応答に、投稿の本文・戦略の文字が入らない
- SC-005：個人運用の人の画面が変わらない

**Organization**: spec.md の User Story ごと。MVPはUS1・US2（P1）。マイグレーションはない（data-model.md）。

## Format: `[ID] [P?] [Story] Description`

- **[P]**：別ファイルで、未完了のタスクに依存せず並行できる。
- **[Story]**：[US1]〜[US5]はspec.mdのUser Storyに対応する。
- APIのテストは `apps/api/test/integration/team-status.test.ts` に書く。チームの作り方は `apps/api/test/helpers/team.ts`、機能のOFFは `apps/api/test/helpers/features.ts` を使う。日時は行の `created_at`・`published_at`・`joined_at`・`added_at` を過去にずらして作る。
- Webのテストは `apps/web/test/team-status.test.tsx`（新規）・`team-page.test.tsx`・`invite-page.test.tsx` に書く。
- 画面はモック（https://claude.ai/artifact/ESSqiqhGna9qZ56YFBUKg1 ）のとおり。文字は短く、説明は閉じたトグルの箇条書き。印の色は今の色（`bg-warning-bg text-warning`、パフォーマンスの低調の `perf-poor`）だけを使う（docs/ui-design.md）。

## Phase 1: Setup

- [X] T001 `packages/shared/src/limits.ts` に定数を足す：`TEAM_STATUS_STOPPED_DAYS = 7`、`TEAM_STATUS_GROWTH_WINDOW_DAYS = 30`、`TEAM_STATUS_GROWTH_MIN_POSTS = 5`、`TEAM_STATUS_GROWTH_POOR_RATIO = 0.8`、`TEAM_STATUS_ACTIVITY_ACTIONS = ["drafts_registered", "draft_edited", "drafts_approved", "drafts_rejected"] as const`（data-model.md「定数」）。
- [X] T002 `packages/shared/src/schemas.ts` に `teamStatusSchema`（contracts/api.md の応答。`role` は `"admin" | "editor" | "member"`、`connection` は `"connected" | "disconnected"`、`growth` は `state` が `"metrics_off" | "insufficient"` のものと、`"ok" | "poor"` で `ratio`・`recentMedian`・`previousMedian` を持つものの判別共用体）と型 `TeamStatus` を足し、`teamDetailSchema` に `statusVisible: z.boolean()` を足す。`packages/shared/test/` に形のテストを足す。

## Phase 2: Foundational

### Tests（先に書いて失敗を確かめる）

- [X] T003 [P] `apps/api/test/integration/team-status.test.ts` を作り、見られる人を確かめる（contracts/api.md の表、research.md R5）：管理者は200で `scope: "all"`、担当のある編集者は200で `scope: "assigned"`、担当のない編集者とメンバーは `403 ROLE_FORBIDDEN`、チームの人でない・チームがない・IDの形が違うは `404 TEAM_NOT_FOUND`、見る人のチームのまとまりがOFFは `403 FEATURE_DISABLED`。
- [X] T004 [P] 同じファイルに、`GET /api/teams/:teamId` の `statusVisible` を足す：管理者は真、担当のある編集者は真、担当のない編集者とメンバーは偽。

### Implementation

- [X] T005 `apps/api/src/services/access.ts` に `authorizeTeamStatus(db, user, teamId)` を足す。`authorizeTeamMember` を通したあと、管理者は `{ team, member, scope: "all" }`、編集者は同じチーム経由の担当（`memberships.role = 'editor'` かつ `team_id` がこのチーム）のうちオーナーの `team` が使える（`featureOnSql(owner, "team")`）Accountを `{ scope: "assigned", accountIds }` で返す。1つもなければ・メンバーなら `403 ROLE_FORBIDDEN`。同じ条件を `statusScopeOf(db, teamAccess)` として分け、`getTeamDetail` からも使う（判定を2か所に書かない。research.md R5）。
- [X] T006 `apps/api/src/services/team-service.ts` の `getTeamDetail` に `statusVisible` を足す（T005の `statusScopeOf` を使う）（T004を通す）。
- [X] T007 `apps/api/src/services/team-status.ts` を作り、`getTeamStatus(db, scope)` の枠を置く（人・Accountとも空、`stoppedCount: 0`、`generatedAt`）。`apps/api/src/routes/teams.ts` に `GET /teams/:teamId/status`（`authed`・`teamOn`・`authorizeTeamStatus`）を足し、`teamStatusSchema` で返す（T003を通す）。

**Checkpoint**: 見られる人の判定が1か所で決まり、範囲が `team-status.ts` に渡る。

## Phase 3: User Story 1 - 管理者が、手が止まっている人とアカウントを見つける（P1）🎯 MVP

### Tests（先に書いて失敗を確かめる）

- [X] T008 [P] [US1] `team-status.test.ts` に人の項目を足す（data-model.md「人の運用状況」、research.md R1〜R3）：
  - 動きは、チームのAccountでの `drafts_registered`・`draft_edited`・`drafts_approved`・`drafts_rejected` だけを数える（ほかの `action`、チームの外のAccountの記録は数えない）
  - `lastActiveAt`・`activeCount7d`（7日より前の行は数えない、まとめての操作も1件）
  - `stopped`：入って8日・記録なし→真、入って3日・記録なし→偽、8日前に承認→真、今日案を作った→偽
  - `retentionLimited`：記録がなく入って100日→真、記録がなく入って30日→偽
  - 担当を外される前に、そのアカウントで承認した動きも数える（FR-010）
  - チームを抜けた・外された人は `people` に出ず、その人が入れていたAccountも `accounts` に出ない（spec Edge Cases）
- [X] T009 [P] [US1] `team-status.test.ts` にAccountの項目を足す（data-model.md「Accountの運用状況」）：`lastPostedAt`・`postCount7d`（`status = 'published'` の `published_at`）、`approvedCount`（`approved`・`publishing`）、`needsReviewCount`（`needs_review`）、`stopped`（`max(lastPostedAt, addedAt)` から7日より長い）、`connection`（`needs_reconnect`・`not_connected` は `disconnected`）、`owner`、`stoppedCount`（止まっている人とAccountの和）。
- [X] T010 [P] [US1] `team-status.test.ts` に並び（data-model.md「並び」：止まっているものが先、その中は起点の古い順、印のない人は名前の順、Accountはチームに入った順）と、中身を返さないこと（下書きの本文・戦略の文字を入れておき、応答の文字列に出ないこと。SC-004）を足す。

### Implementation（API）

- [X] T011 [US1] `apps/api/src/services/team-status.ts` に人の運用状況を数える問い合わせを足す（`team_members`・`users`・`activity_logs` を、範囲のAccountと `TEAM_STATUS_ACTIVITY_ACTIONS` で絞り、`max(created_at)` と7日の件数を1回で読む）（T008を通す）。
- [X] T012 [US1] 同じファイルに、Accountの運用状況を数える問い合わせを足す（`team_accounts`・`accounts`・オーナーの `memberships`・`post_drafts` の状態ごとの件数と `max(published_at)` を1回で読む）。`stoppedCount` と並びを入れる（T009・T010を通す）。

### Tests（Web。先に書いて失敗を確かめる）

- [X] T013 [P] [US1] `apps/web/test/team-status.test.tsx` を作る（contracts/ui-routes.md 2）：「人」と「アカウント」の一覧、最後に動いた日の出し方（「今日」「昨日」「10/26（9日前）」「まだありません」「90日以内にありません」）、「7日で14回」、「止まっている」の印、Accountの「最後の投稿」「7日で7件」「承認済み 12件」「要確認 0件」、「接続が切れています」、閉じたトグル「見方」、管理者の一行の説明「チーム名 · 見えるのは管理者と担当の編集者だけ」。スマートフォンの幅で横にスクロールしないこと（FR-032）は、人とAccountの一覧が `md` より狭いときに表（`table`・横に並ぶ列）を使わず、行を縦に積む部品で描かれることで確かめる（テストの中では幅を測れないため。見た目はテスト版で確かめる。T036）。
- [X] T014 [P] [US1] `apps/web/test/team-page.test.tsx` に足す：`statusVisible` が真なら「担当を決める」の左に「運用状況」が出て `/teams/:teamId/status` へ移る。`stoppedCount` が1以上なら件数の印、0なら印なし。`statusVisible` が偽なら、ボタンも運用状況の読み込みも出ない。

### Implementation（Web）

- [X] T015 [US1] `apps/web/src/lib/api-client.ts` に `teamStatus(teamId)`、`apps/web/src/lib/query.ts` に `teamStatus: (id) => ["team", id, "status"]` を足す。
- [X] T016 [US1] `apps/web/src/pages/team-status.tsx` を作り、`apps/web/src/router.tsx` に `/teams/:teamId/status` を足す。モックのとおり、スマートフォン（`< md`）は行を縦に積み、パソコンは表。読み込み中は `LoadingSkeleton`、失敗は `ApiErrorScreen`、`ROLE_FORBIDDEN` は「この画面は、管理者と担当の編集者だけが見られます」とチームに戻るリンク（T013を通す）。
- [X] T017 [US1] `apps/web/src/pages/team.tsx` に「運用状況」のボタン（outline、`h-10 rounded-full md:h-9`、件数の印は `bg-warning-bg text-warning` の11px。FR-031の例外として、モックで決めた）を足す。件数は T015 の問い合わせを `statusVisible` のときだけ読む（T014を通す）。

**Checkpoint**: 管理者が、止まっている人とAccountを1画面で見つけられる（SC-001）。

## Phase 4: User Story 2 - 管理者が、投稿が伸びていないアカウントを見つける（P1）

### Tests（先に書いて失敗を確かめる）

- [X] T018 [P] [US2] `team-status.test.ts` に伸びを足す（research.md R4・R7、data-model.md の `growth`）：
  - 前の30日と直近30日（`published_at` で分ける）に確定した投稿を5件ずつ作り、中央値の比が0.6→`poor`、0.8→`poor`、1.3→`ok`（`ratio`・`recentMedian`・`previousMedian` が入る）
  - どちらかが4件→`insufficient`、前の中央値が0→`insufficient`
  - `updating`・`unmeasurable` の投稿は数えない
  - オーナーの `autopost` がOFF→`metrics_off`（`stopped` はそのまま数える）
  - 並び：止まっているAccountの次に `poor` のAccount
- [X] T019 [P] [US2] `apps/web/test/team-status.test.tsx` に伸びの4つの状態を足す：`poor` は右下がりの矢印と「×0.6」と「伸びていない」、`ok` は灰色の「×1.3」、`insufficient` は「まだ判定できません」、`metrics_off` は「取り込んでいません」。

### Implementation

- [X] T020 [US2] `apps/api/src/services/team-status.ts` に伸びの問い合わせを足す（`post_metrics` の `state IN ('confirmed','late_confirmed')` の `views` を、`post_drafts.published_at` で2つの30日に分け、`percentile_cont(0.5)` と件数をAccountごとに1回で読む。オーナーの `featureOnSql(owner, "autopost")` を同じSELECTで読む）。並びに `poor` を入れる（T018を通す）。
- [X] T021 [US2] `apps/web/src/pages/team-status.tsx` に伸びの出し方を足す。矢印と色はパフォーマンスの低調の印（`perf-poor`）と同じ部品を使う（T019を通す）。

**Checkpoint**: 管理者が、伸びていないAccountを見つけられる。

## Phase 5: User Story 3 - チームの人が、運用状況が見えることを知っている（P2）

### Tests（先に書いて失敗を確かめる）

- [X] T022 [P] [US3] `apps/web/test/invite-page.test.tsx` に足す：確認の画面の「メンバーとして入ります」の説明に「管理者と、あなたのアカウントの担当の編集者は、運用状況（投稿の数・伸び・最後に動いた日）を見られます。投稿の本文や戦略は見られません。」が出る。
- [X] T023 [P] [US3] `apps/web/test/team-page.test.tsx` に足す：閉じたトグル「チームで見えること」が全員に出て、開くと3つの箇条書き（contracts/ui-routes.md 1）が出る。

### Implementation

- [X] T024 [US3] `apps/web/src/pages/invite.tsx` に1文を足す（T022を通す）。
- [X] T025 [US3] `apps/web/src/pages/team.tsx` に、メンバー一覧の下に閉じたトグル「チームで見えること」を足す（T023を通す）。

## Phase 6: User Story 4 - 編集者が、担当のアカウントの運用状況を見る（P2）

### Tests（先に書いて失敗を確かめる）

- [X] T026 [P] [US4] `team-status.test.ts` に編集者の範囲を足す（FR-002a、research.md R5・R6）：
  - 4つのAccountのチームで2つを担当にすると、`accounts` はその2つだけ、`people` はそのオーナーだけ（編集者自身は出ない）
  - オーナーの行の動きは、担当のAccountでの動きだけを数える（同じオーナーの担当の外のAccountでの承認は数えない）
  - `stoppedCount` に担当の外の人とAccountが入らない
  - オーナーのチームがOFFの担当のAccountは出ない。すべてがそうなら `403 ROLE_FORBIDDEN`
  - 担当を外すと、次の読み込みから消える
- [X] T027 [P] [US4] `apps/web/test/team-status.test.tsx` に足す：`scope: "assigned"` なら一行の説明が「チーム名 · あなたの担当のアカウントだけ」。

### Implementation

- [X] T028 [US4] `apps/api/src/services/team-status.ts` で、範囲が `assigned` のとき、人を担当のAccountのオーナーに、動きを担当のAccountに、Accountを `accountIds` に絞る（問い合わせの条件で除く。画面で隠さない）（T026を通す）。
- [X] T029 [US4] `apps/web/src/pages/team-status.tsx` で、`scope` によって一行の説明を替える（T027を通す）。

## Phase 7: User Story 5 - メンバーと関わりのない人には、運用状況を出さない（P2）

- [X] T030 [P] [US5] `team-status.test.ts` に足す：メンバー・別のチームの人・関わりのない人の応答に、人・Accountの数が1つも入らない（エラーの `details` にも入らない）。編集者が担当の外のAccountを含むチームを開いても、そのAccountのIDが応答に出ない（SC-003）。
- [X] T031 [P] [US5] `apps/web/test/team-page.test.tsx` に足す：メンバーには「運用状況」が出ず、`/teams/:teamId/status` を開くと「この画面は、管理者と担当の編集者だけが見られます」が出る。個人運用の人のサイドバーとホームが変わらない（SC-005。今のテストが通ることで確かめる）。

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T032 [P] `docs/ui-design.md` に、運用状況の画面（チームの下の画面、スマートフォンは縦・パソコンは表、印の色）と、チームの画面の「運用状況」のボタン・トグルを書く。
- [X] T033 [P] `docs/user-guide.md`（「チームで使う」に運用状況と見える範囲）・`docs/architecture.md`・`docs/team-roles.md` を直す（共有用の文書なので、アカウントのID・テスト版のURL・秘密の値は書かない）。
- [X] T034 `.specify/memory/constitution.md` の先頭の Sync Impact Report を消す。
- [X] T035 全体のテスト・lint・型チェック・Webのビルドを通す（`pnpm --filter ./packages/shared test`、`pnpm --filter ./apps/api test`、`pnpm --filter ./apps/web test`、`pnpm lint`、`pnpm -r exec tsc --noEmit`、`pnpm --filter ./apps/web build`）。SC-002（3秒以内）は、次で確かめる：`team-status.ts` の問い合わせが、Accountの数によらず固定の回数（判定のほか、人・Account・伸びの3回）であることをテストで数える。今ある索引（`activity_logs_account_actor_idx`・`post_drafts_published_idx`）を使う条件で書く。テスト版で、20件のAccountのチームで開いて確かめる（T036）。
- [X] T036 quickstart.md の「テスト版で確かめる」を、マージのあとにユーザーとテスト版で通す。

## Dependencies & Execution Order

- Phase 1（T001・T002）が最初。
- Phase 2：T003・T004（テスト）は並行できる → T005（判定）→ T006・T007。US1〜US5の前。
- US1：APIのテスト（T008〜T010）は並行できる → T011 → T012。Webのテスト（T013・T014）→ T015 → T016 → T017。
- US2：US1 の T012・T016 のあと（同じファイルに足す）。
- US3：Phase 2 のあと、ほかと並行できる（`invite.tsx`・`team.tsx` のトグルだけ。T017 と同じファイルなので T025 は T017 のあと）。
- US4：US1 の T012 のあと。
- US5：Phase 2 のあと。T031 は T016・T017 のあと。
- Polish は最後。T032・T033 は並行できる。T036 はマージのあと。

## Parallel Example

```text
# Phase 2 のテストを一緒に書く
T003 見られる人（team-status.test.ts）
T004 statusVisible（team-status.test.ts の別の describe）

# US1 のテストを一緒に書く
T008 人 / T009 Account / T010 並びと中身（API）
T013 運用状況の画面 / T014 チームの画面（Web）
```

## Implementation Strategy

1. Phase 1・2 で、定数と形、見られる人の判定を作る。
2. US1 で、止まっている人とAccountを数え、運用状況の画面とボタンを作る（MVP）。
3. US2 で、伸びを足す。
4. US3 で、招待とチームの画面に見える範囲の説明を足す。
5. US4 で、編集者の範囲を絞る。US5 で、見せない人を確かめる。
6. Polish で文書と全体のテスト。マージの直前に最新の develop を取り込み、PR の CI を通してから、マージのOKをもらう。
