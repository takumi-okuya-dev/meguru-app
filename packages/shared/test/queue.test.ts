import { describe, expect, it } from "vitest";
import { compareQueueOrder } from "../src/queue";

const item = (id: string, opts: { carryover?: boolean; prioritizedAt?: string | null; reviewedAt: string }) => ({
  id,
  carryover: opts.carryover ?? false,
  prioritizedAt: opts.prioritizedAt ?? null,
  reviewedAt: opts.reviewedAt,
});

describe("投稿の順（FR-005・FR-005a、specs/005-auto-post research.md R4）", () => {
  it("持ち越し → 次に投稿する（新しい順）→ 承認した古い順 → id の順", () => {
    const items = [
      item("e", { reviewedAt: "2026-10-03T00:00:00Z" }),
      item("d", { reviewedAt: "2026-10-01T00:00:00Z" }),
      item("c", { reviewedAt: "2026-10-04T00:00:00Z", prioritizedAt: "2026-10-05T01:00:00Z" }),
      item("b", { reviewedAt: "2026-10-04T00:00:00Z", prioritizedAt: "2026-10-05T02:00:00Z" }),
      item("a", { reviewedAt: "2026-10-04T00:00:00Z", carryover: true }),
      item("f", { reviewedAt: "2026-10-01T00:00:00Z" }),
    ];
    expect([...items].sort(compareQueueOrder).map((i) => i.id)).toEqual(["a", "b", "c", "d", "f", "e"]);
  });
});
