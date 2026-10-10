---

description: "Task list for feature 009 team roster"
---

# Tasks: このアカウントのチーム

**Input**: [spec.md](./spec.md)、[plan.md](./plan.md)

**Tests**: 001〜008と同じく、テストを先に書いて失敗を確かめてから実装する（TDD）。

## Phase 1: 文書

- [X] T001 008の `spec.md` FR-042・US1-7・US2-6・権限表、`contracts/api.md`・`contracts/permissions.md`・`contracts/ui-routes.md`、`quickstart.md` 手順7、`docs/team-roles.md` を、カード「このアカウントのチーム」に合わせて直す。

## Phase 2: User Story 1（P1）

- [X] T002 [P] [US1] `apps/api/test/integration/team.test.ts` に、役割ごとの `viewerUserId`・`owner`、別のAccountだけを担当する編集者が出ないこと、担当外の編集者は404のテストを足す（FR-002・FR-003、SC-002）。
- [X] T003 [P] [US1] `apps/web/test/team-section.test.tsx` に、3つの役割それぞれの「あなた」の位置、段の順、オーナー → 編集者の2段、手伝う人がいなければカードを出さないことのテストを足す。`apps/web/test/helpers/access.ts` に `PARTNER_ACCESS` を足す（FR-001〜FR-004、SC-001）。
- [X] T004 [US1] `packages/shared/src/schemas.ts` の `accountTeamSchema` に `owner`・`viewerUserId` を足し、`apps/api/src/services/team-service.ts` の `getAccountTeam` で返す。
- [X] T005 [US1] `apps/web/src/components/team/TeamRoster.tsx` を作り、`apps/web/src/components/team/TeamSection.tsx` の一覧を置き換える。
- [X] T006 [US1] `e2e/tests/team.spec.ts` に、3人のブラウザでカードの3段と「あなた」の位置を確かめるテストを足す。

## Phase 3: 確認

- [X] T007 lint・typecheck・全テスト・`pnpm e2e -- team` を流し、[verification.md](./verification.md) に結果を書く。
