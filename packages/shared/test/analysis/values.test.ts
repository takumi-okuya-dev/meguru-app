// 投稿ごとの値と区切り（specs/022-algorithm-analysis research.md R3・R4、T006）。
import { describe, expect, it } from "vitest";
import { POST_LENGTH_DEFAULTS, lengthBuckets, postValues } from "../../src";
import { jst, post } from "./fixtures";

const ls = POST_LENGTH_DEFAULTS;

describe("postValues", () => {
  it("反応率・返信率・広がり・初速・後からの伸び", () => {
    const v = postValues(post({ views: 200, likes: 10, replies: 4, reposts: 2, quotes: 4, followersAtPost: 50, h24Views: 80 }), ls);
    expect(v.engagementRate).toBeCloseTo(20 / 200);
    expect(v.replyRate).toBeCloseTo(4 / 200);
    expect(v.spread).toBeCloseTo(4);
    expect(v.firstSpeed).toBe(80);
    expect(v.laterGrowth).toBeCloseTo(2.5);
  });

  it("求められない値は null", () => {
    const v = postValues(post({ views: 0, followersAtPost: null, h24Views: null }), ls);
    expect(v.engagementRate).toBeNull();
    expect(v.replyRate).toBeNull();
    expect(v.spread).toBeNull();
    expect(v.firstSpeed).toBeNull();
    expect(v.laterGrowth).toBeNull();
    expect(postValues(post({ followersAtPost: 0, h24Views: 0 }), ls)).toMatchObject({ spread: null, firstSpeed: 0, laterGrowth: null });
  });

  it("時間帯は日本時間で決まる", () => {
    expect(postValues(post({ publishedAt: "2026-10-07T11:30:00.000Z" }), ls).timeBucket).toBe("night");
    expect(postValues(post({ publishedAt: jst("2026-10-07", 5) }), ls).timeBucket).toBe("morning");
    expect(postValues(post({ publishedAt: jst("2026-10-07", 15) }), ls).timeBucket).toBe("noon");
    expect(postValues(post({ publishedAt: jst("2026-10-07", 19) }), ls).timeBucket).toBe("evening");
    expect(postValues(post({ publishedAt: jst("2026-10-07", 4) }), ls).timeBucket).toBe("latenight");
  });

  it("土日と祝日は休日", () => {
    expect(postValues(post({ publishedAt: jst("2026-10-07", 12) }), ls).dayKind).toBe("weekday");
    expect(postValues(post({ publishedAt: jst("2026-10-10", 12) }), ls).dayKind).toBe("holiday");
    expect(postValues(post({ publishedAt: jst("2026-10-12", 12) }), ls).dayKind).toBe("holiday");
    // UTCでは前の日でも、日本時間の日付で決める
    expect(postValues(post({ publishedAt: "2026-10-11T16:00:00.000Z" }), ls).dayKind).toBe("holiday");
  });

  it("本文の特徴", () => {
    const f = (body: string) => postValues(post({ body }), ls).features;
    expect(f("みんなはどうしてる？\n\n").question).toBe(true);
    expect(f("どうしてる?").question).toBe(true);
    expect(f("どうしてる？\n私はこうしてる").question).toBe(false);
    expect(f("３年続けた").number).toBe(true);
    expect(f("ずっと続けた").number).toBe(false);
    expect(f("あ".repeat(20) + "\n続き").shortFirstLine).toBe(true);
    expect(f("あ".repeat(21)).shortFirstLine).toBe(false);
    expect(f("1\n2\n\n3\n4\n5").manyLines).toBe(true);
    expect(f("1\n2\n3\n4").manyLines).toBe(false);
    expect(f("うれしい😊").emoji).toBe(true);
    expect(f("うれしい").emoji).toBe(false);
    expect(f("みなさんへ").callout).toBe(true);
    expect(f("私は").callout).toBe(false);
  });

  it("文字数はコードポイントで数え、Accountの設定で区切る", () => {
    expect(postValues(post({ body: "😊".repeat(77) }), ls)).toMatchObject({ length: 77, lengthBucket: "short" });
    expect(postValues(post({ body: "あ".repeat(78) }), ls).lengthBucket).toBe("medium");
    expect(postValues(post({ body: "あ".repeat(117) }), ls).lengthBucket).toBe("medium");
    expect(postValues(post({ body: "あ".repeat(118) }), ls).lengthBucket).toBe("long");
  });
});

describe("lengthBuckets", () => {
  it("初めの値で 〜77字・78〜117字・118字〜", () => {
    expect(lengthBuckets(ls).map((b) => b.label)).toEqual(["短い（〜77字）", "中くらい（78〜117字）", "長い（118字〜）"]);
  });
  it("設定を変えると幅も変わる", () => {
    const b = lengthBuckets({ ...ls, shortLength: 40, mediumLength: 80, longLength: 120 });
    expect(b.map((x) => x.max)).toEqual([60, 100, null]);
  });
});
