// 014で足したスキーマのテスト（specs/014-strategy-guidance contracts/api.md）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyStrategyValues } from "../src/strategy";
import {
  explanationsRequestSchema,
  keywordBatchRequestSchema,
  putPromptSettingsRequestSchema,
  putStrategyRequestSchema,
  referencePostBatchRequestSchema,
  referencePostInputSchema,
} from "../src/schemas";

const strategyBody = () => {
  const { purposeOrigin, purposeSelf, purposeOthers, purposeFuture, purposeStance, activityAxis, ...rest } =
    emptyStrategyValues();
  void [purposeOrigin, purposeSelf, purposeOthers, purposeFuture, purposeStance, activityAxis];
  return { ...rest, expectedVersion: 0 };
};

describe("putStrategyRequestSchema（FR-054）", () => {
  it("目的の6キーは省略でき、省略したキーは結果に出ない", () => {
    const parsed = putStrategyRequestSchema.parse(strategyBody());
    expect("purposeOrigin" in parsed).toBe(false);
    expect("activityAxis" in parsed).toBe(false);
  });

  it("目的のキーを送れば受け取り、2,000文字を超えると拒む", () => {
    expect(putStrategyRequestSchema.parse({ ...strategyBody(), purposeOrigin: "上京して" }).purposeOrigin).toBe("上京して");
    expect(putStrategyRequestSchema.safeParse({ ...strategyBody(), purposeSelf: "あ".repeat(2001) }).success).toBe(false);
  });

  it("今の19キーは今のまま必須", () => {
    const { finalAction, ...missing } = strategyBody();
    void finalAction;
    expect(putStrategyRequestSchema.safeParse(missing).success).toBe(false);
  });
});

describe("referencePostInputSchema（FR-095〜FR-097）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 2026-10-16 12:00 JST
    vi.setSystemTime(new Date("2026-10-16T03:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("新しい項目は省略でき、既定値になる（今のクライアントを壊さない）", () => {
    const p = referencePostInputSchema.parse({ body: "本文" });
    expect(p).toMatchObject({
      platform: "threads",
      postedDateMode: "unknown",
      postedDate: null,
      metrics: { likes: null, replies: null, views: null, saves: null, reposts: null, followers: null },
      author: "",
      memo: "",
    });
  });

  it("exact は日付が必須で、今日（日本時間）までなら受け取る", () => {
    expect(referencePostInputSchema.safeParse({ body: "本文", postedDateMode: "exact" }).success).toBe(false);
    expect(referencePostInputSchema.safeParse({ body: "本文", postedDateMode: "exact", postedDate: "2026-10-16" }).success).toBe(true);
    expect(referencePostInputSchema.safeParse({ body: "本文", postedDateMode: "exact", postedDate: "2026-10-17" }).success).toBe(false);
    expect(referencePostInputSchema.safeParse({ body: "本文", postedDateMode: "exact", postedDate: "2026-02-30" }).success).toBe(false);
  });

  it("exact 以外で日付があると拒む", () => {
    expect(referencePostInputSchema.safeParse({ body: "本文", postedDateMode: "week", postedDate: "2026-10-10" }).success).toBe(false);
  });

  it("媒体・選び方は一覧の値だけ、数字は0以上の整数か null、投稿者は100文字、メモは500文字まで", () => {
    const base = { body: "本文" };
    expect(referencePostInputSchema.safeParse({ ...base, platform: "facebook" }).success).toBe(false);
    expect(referencePostInputSchema.safeParse({ ...base, postedDateMode: "year" }).success).toBe(false);
    expect(referencePostInputSchema.safeParse({ ...base, metrics: { views: -1 } }).success).toBe(false);
    expect(referencePostInputSchema.safeParse({ ...base, metrics: { views: 1.5 } }).success).toBe(false);
    expect(referencePostInputSchema.parse({ ...base, metrics: { views: 0, likes: 820 } }).metrics).toMatchObject({ views: 0, likes: 820, replies: null });
    expect(referencePostInputSchema.safeParse({ ...base, author: "あ".repeat(101) }).success).toBe(false);
    expect(referencePostInputSchema.safeParse({ ...base, memo: "あ".repeat(501) }).success).toBe(false);
    expect(referencePostInputSchema.safeParse({ ...base, author: "あ".repeat(100), memo: "あ".repeat(500) }).success).toBe(true);
  });
});

describe("まとめての要求", () => {
  it("参考投稿のまとめての登録は1〜20件", () => {
    expect(referencePostBatchRequestSchema.safeParse({ items: [] }).success).toBe(false);
    expect(referencePostBatchRequestSchema.safeParse({ items: Array.from({ length: 20 }, () => ({ body: "本文" })) }).success).toBe(true);
    expect(referencePostBatchRequestSchema.safeParse({ items: Array.from({ length: 21 }, () => ({ body: "本文" })) }).success).toBe(false);
  });

  it("解説の保存は1〜10件、解説は1〜2,000文字、同じIDの重なりは拒む", () => {
    const id = "8f363364-c8e3-490e-93cc-deb8b67e3f4a";
    expect(explanationsRequestSchema.safeParse({ items: [{ id, whyGood: "【型の名前】…" }] }).success).toBe(true);
    expect(explanationsRequestSchema.safeParse({ items: [{ id, whyGood: "  " }] }).success).toBe(false);
    expect(explanationsRequestSchema.safeParse({ items: [{ id, whyGood: "あ".repeat(2001) }] }).success).toBe(false);
    expect(explanationsRequestSchema.safeParse({ items: [{ id, whyGood: "a" }, { id, whyGood: "b" }] }).success).toBe(false);
    expect(
      explanationsRequestSchema.safeParse({ items: Array.from({ length: 11 }, (_, i) => ({ id: `${id.slice(0, -2)}${String(i).padStart(2, "0")}`, whyGood: "a" })) })
        .success,
    ).toBe(false);
  });

  it("キーワードのまとめての登録は1〜20件", () => {
    expect(keywordBatchRequestSchema.safeParse({ items: [{ keyword: "20代後半 友達", purpose: "" }] }).success).toBe(true);
    expect(keywordBatchRequestSchema.safeParse({ items: Array.from({ length: 21 }, (_, i) => ({ keyword: `k${i}` })) }).success).toBe(false);
  });
});

describe("putPromptSettingsRequestSchema の length（FR-140〜FR-142）", () => {
  const ok = { target: 200, shortLength: 70, mediumLength: 135, longLength: 180, shortRatio: 35, mediumRatio: 45, longRatio: 20 };

  it("length は省略でき、送れば刻みと範囲を確かめる", () => {
    expect(putPromptSettingsRequestSchema.safeParse({ postCount: 10, expectedVersion: 1 }).success).toBe(true);
    expect(putPromptSettingsRequestSchema.safeParse({ postCount: 10, expectedVersion: 1, length: ok }).success).toBe(true);
    expect(putPromptSettingsRequestSchema.safeParse({ postCount: 10, expectedVersion: 1, length: { ...ok, target: 205 } }).success).toBe(false);
    expect(putPromptSettingsRequestSchema.safeParse({ postCount: 10, expectedVersion: 1, length: { ...ok, target: 40 } }).success).toBe(false);
    expect(putPromptSettingsRequestSchema.safeParse({ postCount: 10, expectedVersion: 1, length: { ...ok, shortLength: 72 } }).success).toBe(false);
    expect(putPromptSettingsRequestSchema.safeParse({ postCount: 10, expectedVersion: 1, length: { ...ok, shortRatio: 33, mediumRatio: 47 } }).success).toBe(false);
  });

  it("割合の合計が100でない・長さが目標を超えるときは、理由の分かるメッセージで拒む", () => {
    const sum = putPromptSettingsRequestSchema.safeParse({ postCount: 10, expectedVersion: 1, length: { ...ok, shortRatio: 40 } });
    expect(sum.success).toBe(false);
    expect(JSON.stringify(sum.error?.issues)).toContain("ratio_sum");
    const over = putPromptSettingsRequestSchema.safeParse({ postCount: 10, expectedVersion: 1, length: { ...ok, longLength: 210 } });
    expect(over.success).toBe(false);
    expect(JSON.stringify(over.error?.issues)).toContain("length_over_target");
  });
});
