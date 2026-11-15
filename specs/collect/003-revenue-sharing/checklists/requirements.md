# Specification Quality Checklist: 売上・経費・紹介と、運営メンバーへの分配

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-11-13
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- 2026-11-13 1回目の確かめ。[NEEDS CLARIFICATION] が3つ残る（ユーザーに聞いた）：①紹介経由の売上を分配に使うか（User Story 3）②運営メンバーは名前だけか、めぐるの利用者として招くか（FR-010）③分配のもとにする額は支払い済みだけか、振込待ちも含めるか（FR-016）。
- 分配の決まり（FR-012）は、ユーザーの例「リーダーは人数で割った後の1.2倍、残りはメンバーで分ける」をそのまま決まりにし、例の数（20,000円・4人・1.2倍）で、端数を足した結果（リーダー6,002円・メンバー各4,666円）を確かめた。
- 2026-11-14 2回目の確かめ。ユーザーの答え（①使わない＝合計を見せるだけ ②ログインする人として招待する ③支払い済みで計算し、見込みを並べる）を入れ、User Story 5（招待）と FR-050〜FR-056 を足した。[NEEDS CLARIFICATION] は残っていない。
