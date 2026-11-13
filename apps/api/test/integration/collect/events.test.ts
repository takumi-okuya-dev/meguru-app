// イベントと料金の区分（specs/collect/001-event-day-collection contracts/api.md 2、FR-010〜FR-012、tasks.md T020）。
import { beforeEach, describe, expect, it } from "vitest";
import { neon } from "@neondatabase/serverless";
import { call, makeApp, resetDb, testEnv } from "../../helpers/app";
import { EVENT_INPUT, createCollectEvent, errorOf, grantCollect } from "../../helpers/collect";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
  await grantCollect(app, "o1");
});

describe("イベントを作る", () => {
  it("区分を並びのとおりに持ち、版は0で始まる", async () => {
    const event = await createCollectEvent(app, "o1");
    expect(event).toMatchObject({ name: "IT交流会", version: 0 });
    expect(event.tiers.map((t) => [t.name, t.amount, t.position])).toEqual([
      ["通常", 3000, 0],
      ["早割", 2500, 1],
      ["招待", 0, 2],
    ]);
    const res = await call(app, "GET", `/api/collect/events/${event.id}`, { user: "o1" });
    expect(await res.json()).toMatchObject({ id: event.id, venue: "渋谷", capacity: 30, methods: ["cash", "paypay", "transfer"], closedAt: null });
  });

  it("区分・払い方がないと 400", async () => {
    expect(await errorOf(await call(app, "POST", "/api/collect/events", { user: "o1", body: { ...EVENT_INPUT, tiers: [] } }))).toEqual([400, "VALIDATION_FAILED"]);
    expect(await errorOf(await call(app, "POST", "/api/collect/events", { user: "o1", body: { ...EVENT_INPUT, methods: [] } }))).toEqual([400, "VALIDATION_FAILED"]);
  });

  it("作ると、共通の利用の記録で「使っている」になる（料金の数は0）", async () => {
    const userId = await grantCollect(app, "o1");
    await createCollectEvent(app, "o1");
    const rows = (await neon(testEnv.DATABASE_URL)`SELECT quantity, in_use FROM app_usage WHERE user_id = ${userId} AND app = 'collect'`) as {
      quantity: number;
      in_use: boolean;
    }[];
    expect(rows).toEqual([{ quantity: 0, in_use: true }]);
  });
});

describe("一覧", () => {
  it("今日からのイベントを早い順に、過ぎたイベントを新しい順に並べ、名簿の人数を数える", async () => {
    const soon = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const later = new Date(Date.now() + 9 * 86_400_000).toISOString();
    const past = new Date(Date.now() - 9 * 86_400_000).toISOString();
    const older = new Date(Date.now() - 30 * 86_400_000).toISOString();
    for (const [name, startsAt] of [["later", later], ["older", older], ["soon", soon], ["past", past]] as const) {
      await createCollectEvent(app, "o1", { name, startsAt, endsAt: null });
    }
    const soonEvent = ((await (await call(app, "GET", "/api/collect/events", { user: "o1" })).json()) as { events: { id: string; name: string }[] }).events.find((e) => e.name === "soon")!;
    const detail = (await (await call(app, "GET", `/api/collect/events/${soonEvent.id}`, { user: "o1" })).json()) as { tiers: { id: string }[] };
    await call(app, "POST", `/api/collect/events/${soonEvent.id}/roster/bulk`, { user: "o1", body: { names: ["a", "b"], media: "peatix", priceTierId: detail.tiers[0]!.id } });

    const body = (await (await call(app, "GET", "/api/collect/events", { user: "o1" })).json()) as {
      events: { name: string; rosterCount: number; attendedCount: number; awaitingTransferCount: number; fromThreads: boolean }[];
    };
    expect(body.events.map((e) => e.name)).toEqual(["soon", "later", "past", "older"]);
    expect(body.events[0]).toMatchObject({ rosterCount: 2, attendedCount: 0, awaitingTransferCount: 0, fromThreads: false });
  });

  it("ほかの主催者のイベントは出ない", async () => {
    await grantCollect(app, "o2");
    await createCollectEvent(app, "o2");
    const body = (await (await call(app, "GET", "/api/collect/events", { user: "o1" })).json()) as { events: unknown[] };
    expect(body.events).toEqual([]);
  });
});

describe("直す", () => {
  it("名前・会場を直し、区分を足す・並べ替える・消すと、版が1上がる", async () => {
    const event = await createCollectEvent(app, "o1");
    const [normal, early, invite] = event.tiers;
    const res = await call(app, "PATCH", `/api/collect/events/${event.id}`, {
      user: "o1",
      body: {
        name: "IT交流会 11月",
        venue: null,
        tiers: [
          { id: early!.id, name: "早割", amount: 2000 },
          { id: normal!.id, name: "通常", amount: 3000 },
          { name: "紹介割", amount: 2500 },
        ],
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string; venue: string | null; version: number; tiers: { id: string; name: string; amount: number }[] };
    expect(body).toMatchObject({ name: "IT交流会 11月", venue: null, version: 1 });
    expect(body.tiers.map((t) => [t.name, t.amount])).toEqual([
      ["早割", 2000],
      ["通常", 3000],
      ["紹介割", 2500],
    ]);
    expect(body.tiers.some((t) => t.id === invite!.id)).toBe(false);
  });

  it("名簿の人が使っている区分を消すと 409 TIER_IN_USE（何も変わらない）", async () => {
    const event = await createCollectEvent(app, "o1");
    const [normal, early] = event.tiers;
    await call(app, "POST", `/api/collect/events/${event.id}/roster`, { user: "o1", body: { name: "松本 れい", media: "peatix", priceTierId: early!.id } });
    const res = await call(app, "PATCH", `/api/collect/events/${event.id}`, { user: "o1", body: { name: "変えない", tiers: [{ id: normal!.id, name: "通常", amount: 3000 }] } });
    expect(await errorOf(res)).toEqual([409, "TIER_IN_USE"]);
    const after = (await (await call(app, "GET", `/api/collect/events/${event.id}`, { user: "o1" })).json()) as { name: string; tiers: unknown[] };
    expect(after.name).toBe("IT交流会");
    expect(after.tiers).toHaveLength(3);
  });

  it("ほかのイベントの区分の番号・終わりが始まりより前は 400", async () => {
    const a = await createCollectEvent(app, "o1");
    const b = await createCollectEvent(app, "o1");
    const other = b.tiers[0]!;
    expect(await errorOf(await call(app, "PATCH", `/api/collect/events/${a.id}`, { user: "o1", body: { tiers: [{ id: other.id, name: "x", amount: 1 }] } }))).toEqual([400, "VALIDATION_FAILED"]);
    expect(await errorOf(await call(app, "PATCH", `/api/collect/events/${a.id}`, { user: "o1", body: { endsAt: "2026-11-20T09:00:00.000Z" } }))).toEqual([400, "VALIDATION_FAILED"]);
    expect((await call(app, "PATCH", `/api/collect/events/${a.id}`, { user: "o1", body: { endsAt: null } })).status).toBe(200);
  });
});
