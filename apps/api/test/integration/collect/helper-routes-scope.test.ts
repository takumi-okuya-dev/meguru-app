// 手伝う人の資格で呼べる道筋の範囲（specs/collect/001-event-day-collection FR-071、contracts/api.md 8、tasks.md T044）。
// 端末の印（X-Collect-Device）で呼べるのは /api/collect/r/:token/… だけ。名簿の編集・締め・振込・書き出し・設定・まとめ・ほかのイベントの道筋は、
// 主催者のログインが要る（端末の印では 401）。
import { beforeEach, describe, expect, it } from "vitest";
import { call, makeApp, resetDb } from "../../helpers/app";
import { createCollectEvent, errorOf, grantCollect, type EventBody } from "../../helpers/collect";

const app = makeApp();
let event: EventBody;
let token: string;
let device: string;
let personId: string;

beforeEach(async () => {
  await resetDb();
  await grantCollect(app, "o1");
  event = await createCollectEvent(app, "o1");
  const res = await call(app, "POST", `/api/collect/events/${event.id}/roster`, { user: "o1", body: { name: "松本 れい", media: "peatix", priceTierId: event.tiers[0]!.id } });
  personId = ((await res.json()) as { person: { id: string } }).person.id;
  const link = ((await (await call(app, "POST", `/api/collect/events/${event.id}/link`, { user: "o1" })).json()) as { link: { url: string } }).link;
  token = link.url.split("/collect/r/")[1]!;
  device = ((await (await call(app, "POST", `/api/collect/r/${token}/join`, { body: { name: "井上" } })).json()) as { deviceSecret: string }).deviceSecret;
});

describe("手伝う人の端末の印では、主催者の道筋は呼べない", () => {
  it.each([
    ["GET", "/api/collect/me"],
    ["GET", "/api/collect/events"],
    ["POST", "/api/collect/events"],
    ["GET", "/api/collect/events/:eventId"],
    ["PATCH", "/api/collect/events/:eventId"],
    ["GET", "/api/collect/events/:eventId/roster"],
    ["POST", "/api/collect/events/:eventId/roster"],
    ["POST", "/api/collect/events/:eventId/roster/bulk"],
    ["PATCH", "/api/collect/events/:eventId/roster/:personId"],
    ["DELETE", "/api/collect/events/:eventId/roster/:personId"],
    ["GET", "/api/collect/past-attendees?eventId=:eventId&q=a"],
    ["GET", "/api/collect/settings"],
    ["PUT", "/api/collect/settings"],
    ["GET", "/api/collect/settings/paypay-qr"],
    ["DELETE", "/api/collect/settings/paypay-qr"],
    ["GET", "/api/collect/events/:eventId/reception"],
    ["PUT", "/api/collect/events/:eventId/reception/:personId"],
    ["DELETE", "/api/collect/events/:eventId/reception/:personId"],
    ["POST", "/api/collect/events/:eventId/walk-ins"],
    ["POST", "/api/collect/events/:eventId/live-ticket"],
    ["GET", "/api/collect/events/:eventId/link"],
    ["POST", "/api/collect/events/:eventId/link"],
    ["PATCH", "/api/collect/events/:eventId/link"],
    ["POST", "/api/collect/events/:eventId/link/stop"],
    ["GET", "/api/collect/events/:eventId/helpers"],
    ["GET", "/api/collect/events/:eventId/closing"],
    ["PUT", "/api/collect/events/:eventId/settlements/owner"],
    ["POST", "/api/collect/events/:eventId/paypay-check"],
    ["POST", "/api/collect/events/:eventId/close"],
    ["GET", "/api/collect/events/:eventId/export.csv"],
    ["DELETE", "/api/collect/events/:eventId"],
    ["GET", "/api/collect/transfers"],
    ["POST", "/api/collect/transfers/:personId/confirm"],
    ["DELETE", "/api/collect/transfers/:personId/confirm"],
    ["GET", "/api/collect/summaries"],
  ])("%s %s は 401", async (method, template) => {
    const path = template.replace(":eventId", event.id).replace(":personId", personId);
    const body = method === "GET" ? undefined : { method: "cash", clientRequestId: crypto.randomUUID() };
    const res = await call(app, method, path, { headers: { "X-Collect-Device": device }, body });
    expect(res.status).toBe(401);
  });

  it("手伝う人の道筋では、名簿の人のメモ・ほかのイベントは見えない", async () => {
    const other = await createCollectEvent(app, "o1");
    const res = await call(app, "POST", `/api/collect/events/${other.id}/roster`, { user: "o1", body: { name: "別 イベント", media: "peatix", priceTierId: other.tiers[0]!.id } });
    const otherPerson = ((await res.json()) as { person: { id: string } }).person.id;
    // 道筋の :personId をほかのイベントの人にしても 404
    const put = await call(app, "PUT", `/api/collect/r/${token}/reception/${otherPerson}`, {
      headers: { "X-Collect-Device": device },
      body: { method: "cash", clientRequestId: crypto.randomUUID() },
    });
    expect(await errorOf(put)).toEqual([404, "ITEM_NOT_FOUND"]);
  });
});
