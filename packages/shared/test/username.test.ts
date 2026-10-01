import { describe, expect, it } from "vitest";
import { normalizeUsername } from "../src/username";

describe("normalizeUsername", () => {
  it.each(["@takumi", "takumi", " @Takumi ", "TAKUMI"])("%j を takumi に正規化する", (input) => {
    expect(normalizeUsername(input)).toBe("takumi");
  });

  it("先頭の @ は1つだけ除く", () => {
    expect(normalizeUsername("@@takumi")).toBe("@takumi");
  });

  it("空白だけなら空文字になる", () => {
    expect(normalizeUsername("   ")).toBe("");
  });
});
