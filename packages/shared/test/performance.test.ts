import { describe, expect, it } from "vitest";
import {
  catchUpKind,
  confirmAtOf,
  elapsedMinutes,
  formatRatio,
  judge,
  median,
  milestoneForElapsed,
  nextFetchAtOf,
} from "../src/performance";

const h = (hours: number, minutes = 0) => hours * 60 + minutes;

describe("時点の取り込みの種類（specs/006 FR-002d、research.md R4）", () => {
  it("24時間・3日・7日の±1時間の中なら、その時点", () => {
    expect(milestoneForElapsed(h(23))).toBe("h24");
    expect(milestoneForElapsed(h(24))).toBe("h24");
    expect(milestoneForElapsed(h(25))).toBe("h24");
    expect(milestoneForElapsed(h(71))).toBe("d3");
    expect(milestoneForElapsed(h(73))).toBe("d3");
    expect(milestoneForElapsed(h(167))).toBe("d7");
    expect(milestoneForElapsed(h(169))).toBe("d7");
  });

  it("幅の外なら null", () => {
    expect(milestoneForElapsed(h(22, 59))).toBeNull();
    expect(milestoneForElapsed(h(25, 1))).toBeNull();
    expect(milestoneForElapsed(h(48))).toBeNull();
    expect(milestoneForElapsed(h(70, 59))).toBeNull();
    expect(milestoneForElapsed(h(169, 1))).toBeNull();
    expect(milestoneForElapsed(0)).toBeNull();
  });
});

describe("補いの種類（FR-002）", () => {
  const none = new Set<"h24" | "d3" | "d7">();

  it("時点の幅を過ぎていなければ補わない", () => {
    expect(catchUpKind(h(10), none)).toBeNull();
    expect(catchUpKind(h(25), none)).toBeNull();
  });

  it("過ぎた時点のうち最も新しい1つだけを補う", () => {
    expect(catchUpKind(h(25, 1), none)).toBe("h24");
    expect(catchUpKind(h(60), none)).toBe("h24");
    expect(catchUpKind(h(80), none)).toBe("d3");
    expect(catchUpKind(h(80), new Set(["h24"]))).toBe("d3");
    expect(catchUpKind(h(170), new Set(["h24", "d3"]))).toBe("d7");
  });

  it("過ぎた時点か、それより後の時点を取っていれば補わない", () => {
    expect(catchUpKind(h(60), new Set(["h24"]))).toBeNull();
    expect(catchUpKind(h(100), new Set(["d3"]))).toBeNull();
    expect(catchUpKind(h(30), new Set(["d3"]))).toBeNull();
    expect(catchUpKind(h(180), new Set(["d7"]))).toBeNull();
  });

  it("192時間ちょうどまでは7日、超えたら遅れて確定", () => {
    expect(catchUpKind(h(192), none)).toBe("d7");
    expect(catchUpKind(h(192, 1), none)).toBe("late");
    expect(catchUpKind(h(300), new Set(["h24", "d3"]))).toBe("late");
    expect(catchUpKind(h(300), new Set(["d7"]))).toBeNull();
  });
});

describe("判定（FR-008、research.md R5）", () => {
  it("2倍以上は好調、0.5倍以下は低調、その間は普通（丸める前の値で比べる）", () => {
    expect(judge(100, 50)).toBe("good");
    expect(judge(99.99, 50)).toBe("normal");
    expect(judge(25, 50)).toBe("poor");
    expect(judge(25.01, 50)).toBe("normal");
    expect(judge(167, 49.5)).toBe("good");
    expect(judge(23, 49.5)).toBe("poor");
    expect(judge(64, 49.5)).toBe("normal");
    expect(judge(0, 49.5)).toBe("poor");
  });
});

describe("中央値", () => {
  it("奇数個は真ん中、偶数個は真ん中2つの平均", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([49, 50])).toBe(49.5);
  });

  it("空なら null", () => {
    expect(median([])).toBeNull();
  });
});

describe("表示と目安", () => {
  it("倍率は小数第1位", () => {
    expect(formatRatio(167 / 49.5)).toBe("3.4");
    expect(formatRatio(23 / 49.5)).toBe("0.5");
    expect(formatRatio(2)).toBe("2.0");
  });

  it("確定の目安は7日後、最初の取り込みの目安は24時間後", () => {
    const at = new Date("2026-10-07T12:00:00Z");
    expect(confirmAtOf(at).toISOString()).toBe("2026-10-14T12:00:00.000Z");
    expect(nextFetchAtOf(at).toISOString()).toBe("2026-10-08T12:00:00.000Z");
  });

  it("経過は分の切り捨て", () => {
    expect(elapsedMinutes(new Date("2026-10-07T00:00:00Z"), new Date("2026-10-07T01:30:59Z"))).toBe(90);
  });
});
