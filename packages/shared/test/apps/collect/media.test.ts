// 集金管理の媒体（specs/collect/001-event-day-collection contracts/events.md 2、tasks.md T010）。
import { describe, expect, it } from "vitest";
import { COLLECT_MEDIA, COLLECT_MEDIA_LABELS, MEDIA, collectMediaFromThreads, isCollectMedia } from "../../../src";

describe("集金管理の媒体", () => {
  it("どの媒体にも表示名がある", () => {
    for (const m of COLLECT_MEDIA) expect(COLLECT_MEDIA_LABELS[m]).toBeTruthy();
    expect(COLLECT_MEDIA_LABELS.minato).toBe("港");
    expect(COLLECT_MEDIA_LABELS.walk_in).toBe("当日");
  });

  it("Threadsの外部媒体展開のすべての媒体を、集金管理の媒体に直せる", () => {
    for (const m of MEDIA) expect(isCollectMedia(collectMediaFromThreads(m))).toBe(true);
    expect(collectMediaFromThreads("tsunagate")).toBe("tunagate");
    expect(collectMediaFromThreads("jmty")).toBe("jimoty");
    expect(collectMediaFromThreads("unknown")).toBeUndefined();
    expect(collectMediaFromThreads("toString")).toBeUndefined();
  });
});
