// 外部媒体展開の入出力の形（specs/021-external-media data-model.md、contracts/api.md、tasks.md T002）
import { describe, expect, it } from "vitest";
import {
  listingUpdateRequestSchema,
  promotionEventSchema,
  promotionInputSchema,
} from "../src/schemas";

const ok = { startAt: "2026-11-25T20:00", format: "venue" };

describe("イベントの情報", () => {
  it("開始と会場かオンラインだけで通り、ほかは null になる", () => {
    const e = promotionEventSchema.parse(ok);
    expect([e.endAt, e.venueName, e.capacity, e.feeYen]).toEqual([null, null, null, null]);
  });

  it("終了が開始より前・都道府県が違う・定員が0・空白だけの文は通らない／null になる", () => {
    expect(promotionEventSchema.safeParse({ ...ok, endAt: "2026-11-25T19:00" }).success).toBe(
      false,
    );
    expect(promotionEventSchema.safeParse({ ...ok, prefecture: "東京" }).success).toBe(false);
    expect(promotionEventSchema.safeParse({ ...ok, capacity: 0 }).success).toBe(false);
    expect(promotionEventSchema.parse({ ...ok, venueName: "  " }).venueName).toBeNull();
    expect(promotionEventSchema.safeParse({ ...ok, venueName: "あ".repeat(101) }).success).toBe(
      false,
    );
  });

  it("宣伝内容の入力では、省けば undefined、null で消す", () => {
    const base = { title: "t", content: "c" };
    expect(promotionInputSchema.parse(base).event).toBeUndefined();
    expect(promotionInputSchema.parse({ ...base, event: null }).event).toBeNull();
  });
});

describe("掲載内容の保存", () => {
  it("掲載URLは http(s) だけ。空と null は通る", () => {
    expect(
      listingUpdateRequestSchema.safeParse({
        expectedVersion: null,
        postedUrl: "https://peatix.com/x",
      }).success,
    ).toBe(true);
    expect(
      listingUpdateRequestSchema.safeParse({ expectedVersion: null, postedUrl: "ftp://x" }).success,
    ).toBe(false);
    expect(
      listingUpdateRequestSchema.safeParse({ expectedVersion: null, postedUrl: null }).success,
    ).toBe(true);
  });
});
