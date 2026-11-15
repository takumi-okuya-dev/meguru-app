// テスト用のグループの入力のスキーマ（specs/016-test-groups contracts/api.md「運営者のAPI」）
import { describe, expect, it } from "vitest";
import { errorMessage } from "../src/errors";
import { testGroupCreateRequestSchema, testGroupUpdateRequestSchema } from "../src/schemas";

describe("グループを作る入力", () => {
  it("名前は前後の空白を除いて1〜50文字", () => {
    expect(testGroupCreateRequestSchema.parse({ name: "  飲食の会  ", capacity: 10 }).name).toBe("飲食の会");
    expect(testGroupCreateRequestSchema.safeParse({ name: "   ", capacity: 10 }).success).toBe(false);
    expect(testGroupCreateRequestSchema.safeParse({ name: "あ".repeat(50), capacity: 10 }).success).toBe(true);
    expect(testGroupCreateRequestSchema.safeParse({ name: "あ".repeat(51), capacity: 10 }).success).toBe(false);
  });

  it("上限は整数の1〜1000", () => {
    for (const ok of [1, 1000]) expect(testGroupCreateRequestSchema.safeParse({ name: "a", capacity: ok }).success).toBe(true);
    for (const ng of [0, 1001, 1.5]) expect(testGroupCreateRequestSchema.safeParse({ name: "a", capacity: ng }).success).toBe(false);
  });
});

describe("グループを変える入力", () => {
  it("名前か上限の少なくとも1つが要る", () => {
    expect(testGroupUpdateRequestSchema.safeParse({}).success).toBe(false);
    expect(testGroupUpdateRequestSchema.safeParse({ capacity: 3 }).success).toBe(true);
    expect(testGroupUpdateRequestSchema.safeParse({ name: "新しい名前" }).success).toBe(true);
  });
});

describe("文言", () => {
  it("すでに入っているグループの名前を入れる", () => {
    expect(errorMessage("TEST_GROUP_ALREADY_MEMBER", { details: ["飲食の会"] }).message).toBe("すでに飲食の会に入っています。");
  });

  it("テスト版に入れないオーナーの読むだけの理由", () => {
    expect(errorMessage("BILLING_REQUIRED", { details: ["test_access"] }).message).toBe("テスト版を使えなくなったため、今は読むだけです。");
  });
});
