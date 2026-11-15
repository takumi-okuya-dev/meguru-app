// 紹介リンクの応答のスキーマと文字列の形（specs/017-referral-links contracts/api.md）
import { describe, expect, it } from "vitest";
import { REFERRAL_CODE_PATTERN } from "../src/limits";
import { referralPageSchema, referralResponseSchema } from "../src/schemas";

describe("紹介リンクと人数", () => {
  it("人数は0以上の整数", () => {
    expect(referralResponseSchema.safeParse({ url: "u", referredCount: 0 }).success).toBe(true);
    for (const ng of [-1, 1.5]) expect(referralResponseSchema.safeParse({ url: "u", referredCount: ng }).success).toBe(false);
  });

  it("紹介された人の名前などは、応答に残さない", () => {
    expect(referralResponseSchema.parse({ url: "u", referredCount: 1, names: ["鈴木"] })).toEqual({ url: "u", referredCount: 1 });
  });

  it("紹介リンクの画面の情報", () => {
    expect(referralPageSchema.parse({ testGroups: true })).toEqual({ testGroups: true });
  });
});

describe("紹介の文字列の形", () => {
  it("「r_」＋22文字の base64url だけ", () => {
    expect(REFERRAL_CODE_PATTERN.test(`r_${"a".repeat(22)}`)).toBe(true);
    for (const ng of [`r_${"a".repeat(21)}`, `r_${"a".repeat(23)}`, `t_${"a".repeat(22)}`, `r_${"a".repeat(21)}/`]) {
      expect(REFERRAL_CODE_PATTERN.test(ng)).toBe(false);
    }
  });
});
