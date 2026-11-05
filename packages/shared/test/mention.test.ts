// 時間差のメンションの共通の決まり（specs/023-delayed-mention data-model.md、tasks.md T002・T003）
import { describe, expect, it } from "vitest";
import {
  buildMentionText,
  mentionAttachRequestSchema,
  mentionDueAt,
  mentionSettingsRequestSchema,
  mentionUsernamesIn,
  normalizeMentionUsername,
  toggleMentionInText,
} from "../src";

describe("normalizeMentionUsername", () => {
  it("@・空白・大文字をそろえ、形が違えば null", () => {
    expect(normalizeMentionUsername(" @Minato_Place ")).toBe("minato_place");
    expect(normalizeMentionUsername("＠taro.events")).toBe("taro.events");
    expect(normalizeMentionUsername("あいう")).toBeNull();
    expect(normalizeMentionUsername("a".repeat(31))).toBeNull();
    expect(normalizeMentionUsername("")).toBeNull();
    expect(normalizeMentionUsername("a b")).toBeNull();
  });
});

describe("buildMentionText", () => {
  it("ひとこと＋改行＋@a @b、ひとことが空なら @ だけ", () => {
    expect(buildMentionText("よければシェアお願いします", ["a", "b.c"])).toBe("よければシェアお願いします\n@a @b.c");
    expect(buildMentionText("  ", ["a"])).toBe("@a");
  });
});

describe("mentionUsernamesIn", () => {
  it("一覧にある人だけを、重なりなく文の順に", () => {
    expect(mentionUsernamesIn("ぜひ @Taro.events と @minato_place、@other @taro.events", ["minato_place", "taro.events"])).toEqual([
      "taro.events",
      "minato_place",
    ]);
    expect(mentionUsernamesIn("メンションなし", ["a"])).toEqual([]);
  });
});

describe("toggleMentionInText", () => {
  it("なければ最後の行に足し、あれば消す", () => {
    expect(toggleMentionInText("シェアお願いします\n@a", "b")).toBe("シェアお願いします\n@a @b");
    expect(toggleMentionInText("シェアお願いします", "b")).toBe("シェアお願いします\n@b");
    expect(toggleMentionInText("", "b")).toBe("@b");
    expect(toggleMentionInText("シェアお願いします\n@a @b", "a")).toBe("シェアお願いします\n@b");
    expect(toggleMentionInText("シェアお願いします\n@a", "a")).toBe("シェアお願いします");
    // 名前の一部だけには当てない
    expect(toggleMentionInText("@ab @a", "a")).toBe("@ab");
    expect(toggleMentionInText("@a.b", "a")).toBe("@a.b @a");
  });
});

describe("mentionDueAt", () => {
  it("押した時刻、なければ投稿＋時間差、投稿の前は null", () => {
    expect(mentionDueAt({ delayMinutes: null, sendAfter: "2026-11-05T03:00:00.000Z" }, null)?.toISOString()).toBe("2026-11-05T03:00:00.000Z");
    expect(mentionDueAt({ delayMinutes: 30, sendAfter: null }, "2026-11-05T03:00:00.000Z")?.toISOString()).toBe("2026-11-05T03:30:00.000Z");
    expect(mentionDueAt({ delayMinutes: 30, sendAfter: null }, null)).toBeNull();
  });
});

describe("スキーマ", () => {
  it("設定：時間差は決まった値、ひとことは100文字まで", () => {
    expect(mentionSettingsRequestSchema.safeParse({ expectedVersion: null, message: "a", delayMinutes: 30 }).success).toBe(true);
    expect(mentionSettingsRequestSchema.safeParse({ expectedVersion: null, message: "a", delayMinutes: 45 }).success).toBe(false);
    expect(mentionSettingsRequestSchema.safeParse({ expectedVersion: null, message: "あ".repeat(101), delayMinutes: 30 }).success).toBe(false);
  });
  it("付ける：1〜5人、文は500文字まで", () => {
    const ok = { expectedVersion: 1, usernames: ["a"] };
    expect(mentionAttachRequestSchema.safeParse(ok).success).toBe(true);
    expect(mentionAttachRequestSchema.safeParse({ ...ok, usernames: [] }).success).toBe(false);
    expect(mentionAttachRequestSchema.safeParse({ ...ok, usernames: ["a", "b", "c", "d", "e", "f"] }).success).toBe(false);
    expect(mentionAttachRequestSchema.safeParse({ ...ok, text: "あ".repeat(501) }).success).toBe(false);
  });
});
