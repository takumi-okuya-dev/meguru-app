// 集金管理の関所（specs/collect/001-event-day-collection contracts/api.md 0、tasks.md T014）。
// 許可のない人は 403 APP_NOT_AVAILABLE、ログインしていない人は 401、ほかの主催者のイベントは 404（あるかを見せない）。運営者は許可なしで使える。
import { beforeEach, describe, expect, it } from "vitest";
import { call, makeApp, resetDb } from "../../helpers/app";
import { FEATURE_OPERATOR, operatorEnv } from "../../helpers/features";
import { createCollectEvent, errorOf, grantCollect } from "../../helpers/collect";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
});

describe("集金管理の関所", () => {
  it("ログインしていない人は 401", async () => {
    expect((await call(app, "GET", "/api/collect/events")).status).toBe(401);
  });

  it("許可のない人は、どの道筋も 403 APP_NOT_AVAILABLE", async () => {
    for (const [method, path] of [
      ["GET", "/api/collect/me"],
      ["GET", "/api/collect/events"],
      ["POST", "/api/collect/events"],
      ["GET", "/api/collect/settings"],
      ["GET", "/api/collect/past-attendees?eventId=00000000-0000-4000-8000-000000000000&q=a"],
    ] as const) {
      expect(await errorOf(await call(app, method, path, { user: "u1", body: method === "POST" ? {} : undefined }))).toEqual([403, "APP_NOT_AVAILABLE"]);
    }
  });

  it("許可のある人は使える。運営者は許可なしで使える", async () => {
    await grantCollect(app, "o1");
    expect((await call(app, "GET", "/api/collect/me", { user: "o1" })).status).toBe(200);
    const res = await call(app, "GET", "/api/collect/me", { user: FEATURE_OPERATOR, env: operatorEnv() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hasPaypayQr: false, hasBankText: false, awaitingTransferCount: 0 });
  });

  it("ほかの主催者のイベント・名簿・候補は 404", async () => {
    await grantCollect(app, "o1");
    await grantCollect(app, "o2");
    const event = await createCollectEvent(app, "o1");
    const tierId = event.tiers[0]!.id;
    for (const [method, path, body] of [
      ["GET", `/api/collect/events/${event.id}`, undefined],
      ["PATCH", `/api/collect/events/${event.id}`, { name: "とる" }],
      ["GET", `/api/collect/events/${event.id}/roster`, undefined],
      ["POST", `/api/collect/events/${event.id}/roster`, { name: "a", media: "peatix", priceTierId: tierId }],
      ["POST", `/api/collect/events/${event.id}/roster/bulk`, { names: ["a"], media: "peatix", priceTierId: tierId }],
      ["GET", `/api/collect/past-attendees?eventId=${event.id}&q=a`, undefined],
    ] as const) {
      expect(await errorOf(await call(app, method, path, { user: "o2", body }))).toEqual([404, "ITEM_NOT_FOUND"]);
    }
    // 番号の形でないものも 404
    expect(await errorOf(await call(app, "GET", "/api/collect/events/abc", { user: "o1" }))).toEqual([404, "ITEM_NOT_FOUND"]);
  });
});
