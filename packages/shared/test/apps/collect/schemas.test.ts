// 集金管理の入力の形（specs/collect/001-event-day-collection data-model.md 2、tasks.md T011）。
import { describe, expect, it } from "vitest";
import {
  addRosterPersonRequestSchema,
  bulkAddRosterRequestSchema,
  createCollectEventRequestSchema,
  pastAttendeesQuerySchema,
  putCollectSettingsRequestSchema,
  updateCollectEventRequestSchema,
} from "../../../src";

const TIER_ID = "3f8b7c1e-2d4a-4b6f-9a1c-5e7d8f9a0b1c";
const base = {
  name: "IT交流会",
  startsAt: "2026-11-20T10:00:00.000Z",
  methods: ["cash", "paypay", "transfer"],
  tiers: [{ name: "通常", amount: 3000 }],
};

describe("イベントの入力", () => {
  it("名前を整え、任意の項目は null にし、払い方は決まった順にそろえる", () => {
    const v = createCollectEventRequestSchema.parse({ ...base, name: "  IT交流会 ", venue: " ", methods: ["transfer", "cash"] });
    expect(v.name).toBe("IT交流会");
    expect(v.venue).toBeNull();
    expect(v.endsAt).toBeNull();
    expect(v.capacity).toBeNull();
    expect(v.methods).toEqual(["cash", "transfer"]);
  });

  it("区分・払い方は1つ以上、金額は0〜999,999、名前は100文字まで", () => {
    expect(createCollectEventRequestSchema.safeParse({ ...base, tiers: [] }).success).toBe(false);
    expect(createCollectEventRequestSchema.safeParse({ ...base, methods: [] }).success).toBe(false);
    expect(createCollectEventRequestSchema.safeParse({ ...base, tiers: [{ name: "通常", amount: 1_000_000 }] }).success).toBe(false);
    expect(createCollectEventRequestSchema.safeParse({ ...base, tiers: [{ name: "招待", amount: 0 }] }).success).toBe(true);
    expect(createCollectEventRequestSchema.safeParse({ ...base, name: "あ".repeat(101) }).success).toBe(false);
    expect(createCollectEventRequestSchema.safeParse({ ...base, name: "   " }).success).toBe(false);
    expect(createCollectEventRequestSchema.safeParse({ ...base, capacity: 0 }).success).toBe(false);
    expect(createCollectEventRequestSchema.safeParse({ ...base, capacity: 10_001 }).success).toBe(false);
  });

  it("終わりは始まりより後", () => {
    expect(createCollectEventRequestSchema.safeParse({ ...base, endsAt: "2026-11-20T09:00:00.000Z" }).success).toBe(false);
    expect(createCollectEventRequestSchema.safeParse({ ...base, endsAt: "2026-11-20T12:00:00+09:00" }).success).toBe(false);
    expect(createCollectEventRequestSchema.safeParse({ ...base, endsAt: "2026-11-20T21:00:00+09:00" }).success).toBe(true);
  });

  it("直すときは、同じ区分の id を2回渡せない", () => {
    const tiers = [
      { id: TIER_ID, name: "通常", amount: 3000 },
      { id: TIER_ID, name: "早割", amount: 2500 },
    ];
    expect(updateCollectEventRequestSchema.safeParse({ tiers }).success).toBe(false);
    expect(updateCollectEventRequestSchema.safeParse({}).success).toBe(true);
  });
});

describe("名簿の入力", () => {
  it("名前は1〜50文字、ふりがな50文字・メモ200文字まで、媒体は決まった値", () => {
    const ok = { name: "松本 れい", media: "peatix", priceTierId: TIER_ID };
    expect(addRosterPersonRequestSchema.parse(ok).kana).toBeNull();
    expect(addRosterPersonRequestSchema.safeParse({ ...ok, name: "あ".repeat(51) }).success).toBe(false);
    expect(addRosterPersonRequestSchema.safeParse({ ...ok, kana: "あ".repeat(51) }).success).toBe(false);
    expect(addRosterPersonRequestSchema.safeParse({ ...ok, memo: "あ".repeat(201) }).success).toBe(false);
    expect(addRosterPersonRequestSchema.safeParse({ ...ok, media: "line" }).success).toBe(false);
  });

  it("まとめて足すのは1〜300行", () => {
    const ok = { media: "kokuchpro", priceTierId: TIER_ID };
    expect(bulkAddRosterRequestSchema.safeParse({ ...ok, names: [] }).success).toBe(false);
    expect(bulkAddRosterRequestSchema.safeParse({ ...ok, names: Array(301).fill("a") }).success).toBe(false);
    expect(bulkAddRosterRequestSchema.safeParse({ ...ok, names: ["a"] }).success).toBe(true);
  });

  it("前回の参加者の q は空にできない", () => {
    expect(pastAttendeesQuerySchema.safeParse({ eventId: TIER_ID, q: " " }).success).toBe(false);
    expect(pastAttendeesQuerySchema.safeParse({ eventId: TIER_ID, q: "まつ" }).success).toBe(true);
  });
});

describe("既定値の入力", () => {
  it("振込先の案内は300文字まで、空は null", () => {
    expect(putCollectSettingsRequestSchema.parse({ bankText: "" }).bankText).toBeNull();
    expect(putCollectSettingsRequestSchema.safeParse({ bankText: "あ".repeat(301) }).success).toBe(false);
  });
});
