// アプリの一覧（specs/028-meguru-shell data-model.md 2、T045）。
import { describe, expect, it } from "vitest";
import { APP_CATALOG, BILLING_UNIT_PRICE_JPY, appById, isReleasedAppId, lastAppRequestSchema, releasedApps, resolveLandingApp } from "../src";

describe("アプリの一覧", () => {
  it("IDとパスが重ならない", () => {
    expect(new Set(APP_CATALOG.map((a) => a.id)).size).toBe(APP_CATALOG.length);
    expect(new Set(APP_CATALOG.map((a) => a.basePath)).size).toBe(APP_CATALOG.length);
  });

  it("Threads は「めぐる Threads」で、パスは /threads、料金は1件の料金から作る", () => {
    const threads = appById("threads")!;
    expect(threads.name).toBe("めぐる Threads");
    expect(threads.basePath).toBe("/threads");
    expect(BILLING_UNIT_PRICE_JPY).toBe(1000);
    expect(threads.priceLabel).toBe("アカウント1件につき月1,000円");
  });

  it("出してよいアプリだけを releasedApps と isReleasedAppId が通す", () => {
    expect(releasedApps().map((a) => a.id)).toEqual(["threads", "people"]);
    expect(isReleasedAppId("threads")).toBe(true);
    expect(isReleasedAppId("people")).toBe(true);
    expect(isReleasedAppId("unknown-app")).toBe(false);
    expect(isReleasedAppId(1)).toBe(false);
  });
});

describe("PUT /api/me/last-app の入力", () => {
  it("出してよいアプリのIDだけを受ける", () => {
    expect(lastAppRequestSchema.safeParse({ app: "threads" }).success).toBe(true);
    expect(lastAppRequestSchema.safeParse({ app: "people" }).success).toBe(true);
    expect(lastAppRequestSchema.safeParse({ app: "unknown-app" }).success).toBe(false);
    expect(lastAppRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe("入口の行き先", () => {
  it("最後に使ったアプリを使っていればそれ、なければ使っているアプリの最初、なければ null", () => {
    expect(resolveLandingApp(["threads", "sample"], "sample")).toBe("sample");
    expect(resolveLandingApp(["threads"], "sample")).toBe("threads");
    expect(resolveLandingApp(["threads"], null)).toBe("threads");
    expect(resolveLandingApp([], "threads")).toBeNull();
  });
});
