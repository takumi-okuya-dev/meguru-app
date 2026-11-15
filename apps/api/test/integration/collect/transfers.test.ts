// 振込待ち（specs/collect/001-event-day-collection contracts/api.md 7、FR-050・FR-051、tasks.md T062）。
import { beforeEach, describe, expect, it } from "vitest";
import { call, makeApp, resetDb } from "../../helpers/app";
import { createCollectEvent, errorOf, grantCollect } from "../../helpers/collect";

const app = makeApp();
const ids: Record<string, string> = {};
type List = { awaiting: { name: string; number: number; eventName: string; method: string; transferConfirmedAt: string | null }[]; confirmed: { name: string }[] };
const list = async (q?: string) => (await (await call(app, "GET", `/api/collect/transfers${q ? `?q=${encodeURIComponent(q)}` : ""}`, { user: "o1" })).json()) as List;

beforeEach(async () => {
  await resetDb();
  await grantCollect(app, "o1");
  for (const [eventName, people] of [
    ["11月の会", [["松本 れい", "まつもと れい", "transfer_today"], ["井上", null, "cash"]]],
    ["12月の会", [["木村", "きむら", "transfer_later"]]],
  ] as const) {
    const event = await createCollectEvent(app, "o1", { name: eventName });
    for (const [name, kana, method] of people) {
      const res = await call(app, "POST", `/api/collect/events/${event.id}/roster`, { user: "o1", body: { name, kana, media: "peatix", priceTierId: event.tiers[0]!.id } });
      ids[name] = ((await res.json()) as { person: { id: string } }).person.id;
      await call(app, "PUT", `/api/collect/events/${event.id}/reception/${ids[name]}`, { user: "o1", body: { method, clientRequestId: crypto.randomUUID() } });
    }
  }
});

describe("振込待ち", () => {
  it("すべてのイベントの振込待ち。受付番号・名前・ふりがなで探せる", async () => {
    const all = await list();
    expect(all.awaiting.map((t) => [t.name, t.eventName, t.method])).toEqual([
      ["松本 れい", "11月の会", "transfer_today"],
      ["木村", "12月の会", "transfer_later"],
    ]);
    expect((await list("マツモト")).awaiting.map((t) => t.name)).toEqual(["松本 れい"]);
    expect((await list("きむら")).awaiting.map((t) => t.name)).toEqual(["木村"]);
    expect((await list("1")).awaiting).toHaveLength(2);
    expect((await list("%")).awaiting).toHaveLength(0);
  });

  it("入金を確かめると支払い済み・確かめた日。締めの振込と /api/collect/me に反映。戻せる", async () => {
    expect(((await (await call(app, "GET", "/api/collect/me", { user: "o1" })).json()) as { awaitingTransferCount: number }).awaitingTransferCount).toBe(2);
    const res = await call(app, "POST", `/api/collect/transfers/${ids["木村"]}/confirm`, { user: "o1" });
    expect(((await res.json()) as { transferConfirmedAt: string | null }).transferConfirmedAt).not.toBeNull();
    const after = await list();
    expect(after.awaiting.map((t) => t.name)).toEqual(["松本 れい"]);
    expect(after.confirmed.map((t) => t.name)).toEqual(["木村"]);
    expect(((await (await call(app, "GET", "/api/collect/me", { user: "o1" })).json()) as { awaitingTransferCount: number }).awaitingTransferCount).toBe(1);
    const events = ((await (await call(app, "GET", "/api/collect/events", { user: "o1" })).json()) as { events: { id: string; name: string }[] }).events;
    const dec = events.find((e) => e.name === "12月の会")!;
    const closing = (await (await call(app, "GET", `/api/collect/events/${dec.id}/closing`, { user: "o1" })).json()) as { transfers: object };
    expect(closing.transfers).toEqual({ paid: { count: 1, amount: 3000 }, awaiting: { count: 0, amount: 0 } });
    await call(app, "DELETE", `/api/collect/transfers/${ids["木村"]}/confirm`, { user: "o1" });
    expect((await list()).awaiting).toHaveLength(2);
  });

  it("ほかの主催者の人・振込でない記録は 404", async () => {
    await grantCollect(app, "o2");
    expect(await errorOf(await call(app, "POST", `/api/collect/transfers/${ids["木村"]}/confirm`, { user: "o2" }))).toEqual([404, "ITEM_NOT_FOUND"]);
    expect(await errorOf(await call(app, "POST", `/api/collect/transfers/${ids["井上"]}/confirm`, { user: "o1" }))).toEqual([404, "ITEM_NOT_FOUND"]);
    expect(((await (await call(app, "GET", "/api/collect/transfers", { user: "o2" })).json()) as List).awaiting).toEqual([]);
  });
});
