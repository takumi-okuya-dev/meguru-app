// 解析のAPIの入出力の形（specs/022-algorithm-analysis contracts/api.md、T003）。
import { describe, expect, it } from "vitest";
import {
  analysisQuerySchema,
  analysisSettingsRequestSchema,
  analysisThemesSchema,
  classificationsQuerySchema,
  classificationsRequestSchema,
} from "../../src";

const uuid = "11111111-1111-4111-8111-111111111111";

describe("解析のスキーマ", () => {
  it("scope の既定は all、ほかの値は不可", () => {
    expect(analysisQuerySchema.parse({}).scope).toBe("all");
    expect(analysisQuerySchema.parse({ scope: "regular" }).scope).toBe("regular");
    expect(analysisQuerySchema.safeParse({ scope: "promo" }).success).toBe(false);
  });

  it("テーマは10個まで・名前は前後の空白を除いて1〜20文字・重ならない", () => {
    expect(analysisThemesSchema.parse([{ name: "  転職 " }])).toEqual([{ name: "転職" }]);
    expect(analysisThemesSchema.safeParse([{ name: " " }]).success).toBe(false);
    expect(analysisThemesSchema.safeParse([{ name: "あ".repeat(21) }]).success).toBe(false);
    expect(analysisThemesSchema.safeParse([{ name: "転職" }, { name: "転職 " }]).success).toBe(false);
    expect(analysisThemesSchema.safeParse(Array.from({ length: 11 }, (_, i) => ({ name: `t${i}` }))).success).toBe(false);
    expect(analysisThemesSchema.safeParse([{ id: "x1", name: "転職" }]).success).toBe(false);
    expect(analysisThemesSchema.safeParse([{ id: "t1a", name: "転職" }]).success).toBe(true);
  });

  it("設定の保存は、切り替えかテーマのどちらかが要る", () => {
    expect(analysisSettingsRequestSchema.safeParse({ expectedVersion: null }).success).toBe(false);
    expect(analysisSettingsRequestSchema.safeParse({ expectedVersion: null, trendsInPrompt: false }).success).toBe(true);
    expect(analysisSettingsRequestSchema.safeParse({ expectedVersion: 0, trendsInPrompt: false }).success).toBe(false);
  });

  it("分類の保存は1〜50件で、型は7つのどれか", () => {
    expect(classificationsQuerySchema.parse({}).mode).toBe("unclassified");
    const item = { draftId: uuid, openingType: "aruaru", themeId: null };
    expect(classificationsRequestSchema.safeParse({ source: "ai", items: [item] }).success).toBe(true);
    expect(classificationsRequestSchema.safeParse({ source: "ai", items: [] }).success).toBe(false);
    expect(classificationsRequestSchema.safeParse({ source: "ai", items: Array(51).fill(item) }).success).toBe(false);
    expect(classificationsRequestSchema.safeParse({ source: "ai", items: [{ ...item, openingType: "joke" }] }).success).toBe(false);
    expect(classificationsRequestSchema.safeParse({ source: "other", items: [item] }).success).toBe(false);
    expect(classificationsRequestSchema.safeParse({ source: "manual", items: [{ ...item, themeId: "t1" }] }).success).toBe(true);
  });
});
