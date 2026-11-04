// チームの運用状況の応答の形と定数（specs/020-team-monitoring contracts/api.md、data-model.md「定数」）
import { describe, expect, it } from "vitest";
import {
  TEAM_STATUS_ACTIVITY_ACTIONS,
  TEAM_STATUS_GROWTH_MIN_POSTS,
  TEAM_STATUS_GROWTH_POOR_RATIO,
  TEAM_STATUS_GROWTH_WINDOW_DAYS,
  TEAM_STATUS_STOPPED_DAYS,
} from "../src/limits";
import { teamStatusSchema } from "../src/schemas";

const account = {
  accountId: "a",
  name: "店",
  username: "shop",
  displayName: null,
  profilePictureUrl: null,
  owner: { userId: "u", name: "田中", isMe: false },
  connection: "connected",
  addedAt: "2026-11-01T00:00:00.000Z",
  lastPostedAt: null,
  postCount7d: 0,
  approvedCount: 0,
  needsReviewCount: 0,
  stopped: false,
};

describe("運用状況の定数", () => {
  it("7日・30日・5件・0.8・数える操作の4つ", () => {
    expect([
      TEAM_STATUS_STOPPED_DAYS,
      TEAM_STATUS_GROWTH_WINDOW_DAYS,
      TEAM_STATUS_GROWTH_MIN_POSTS,
      TEAM_STATUS_GROWTH_POOR_RATIO,
    ]).toEqual([7, 30, 5, 0.8]);
    expect(TEAM_STATUS_ACTIVITY_ACTIONS).toEqual([
      "drafts_registered",
      "draft_edited",
      "drafts_approved",
      "drafts_rejected",
    ]);
  });
});

describe("運用状況の応答", () => {
  const base = {
    scope: "all",
    generatedAt: "2026-11-04T00:00:00.000Z",
    stoppedCount: 0,
    people: [],
  };

  it("伸びは、判定できないときは比を持たず、ok・poor のときは比と中央値を持つ", () => {
    for (const growth of [{ state: "metrics_off" }, { state: "insufficient" }]) {
      expect(
        teamStatusSchema.safeParse({ ...base, accounts: [{ ...account, growth }] }).success,
      ).toBe(true);
    }
    const poor = { state: "poor", ratio: 0.6, recentMedian: 60, previousMedian: 100 };
    expect(
      teamStatusSchema.safeParse({ ...base, accounts: [{ ...account, growth: poor }] }).success,
    ).toBe(true);
    expect(
      teamStatusSchema.safeParse({ ...base, accounts: [{ ...account, growth: { state: "poor" } }] })
        .success,
    ).toBe(false);
  });

  it("範囲は all か assigned、接続は connected か disconnected", () => {
    const growth = { state: "insufficient" };
    expect(
      teamStatusSchema.safeParse({ ...base, scope: "assigned", accounts: [{ ...account, growth }] })
        .success,
    ).toBe(true);
    expect(teamStatusSchema.safeParse({ ...base, scope: "mine", accounts: [] }).success).toBe(
      false,
    );
    expect(
      teamStatusSchema.safeParse({
        ...base,
        accounts: [{ ...account, connection: "needs_reconnect", growth }],
      }).success,
    ).toBe(false);
  });
});
