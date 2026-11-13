// イベントを消す・まとめ（specs/collect/001-event-day-collection FR-011・FR-014、research.md R11、tasks.md T067）。
import { neon } from "@neondatabase/serverless";
import { beforeEach, describe, expect, it } from "vitest";
import { call, db, makeApp, resetDb, testEnv } from "../../helpers/app";
import { createCollectEvent, errorOf, grantCollect, type EventBody } from "../../helpers/collect";

const app = makeApp();
let event: EventBody;

beforeEach(async () => {
  await resetDb();
  await grantCollect(app, "o1");
  event = await createCollectEvent(app, "o1", { name: "消す会" });
  const res = await call(app, "POST", `/api/collect/events/${event.id}/roster`, { user: "o1", body: { name: "松本 れい", media: "peatix", priceTierId: event.tiers[0]!.id } });
  const personId = ((await res.json()) as { person: { id: string } }).person.id;
  await call(app, "POST", `/api/collect/events/${event.id}/roster`, { user: "o1", body: { name: "来ない人", media: "minato", priceTierId: event.tiers[0]!.id } });
  await call(app, "PUT", `/api/collect/events/${event.id}/reception/${personId}`, { user: "o1", body: { method: "cash", clientRequestId: crypto.randomUUID() } });
  const link = ((await (await call(app, "POST", `/api/collect/events/${event.id}/link`, { user: "o1" })).json()) as { link: { url: string } }).link;
  await call(app, "POST", `/api/collect/r/${link.url.split("/collect/r/")[1]}/join`, { body: { name: "手伝いの人" } });
  await call(app, "PUT", `/api/collect/events/${event.id}/settlements/owner`, { user: "o1", body: { countedAmount: 3000, settled: true } });
});

describe("イベントを消す", () => {
  it("名簿・記録・リンク・手伝う人・精算が消え、数字だけのまとめが残る（名前は入らない）", async () => {
    const res = await call(app, "DELETE", `/api/collect/events/${event.id}`, { user: "o1" });
    expect(res.status).toBe(200);
    const { summaryId } = (await res.json()) as { summaryId: string };
    db();
    const sql = neon(testEnv.DATABASE_URL);
    for (const table of ["roster_people", "reception_records", "reception_links", "helpers", "helper_devices", "settlements", "price_tiers"]) {
      const rows = (await sql.query(`SELECT count(*)::int AS n FROM collect.${table}`)) as { n: number }[];
      expect(rows[0]!.n, table).toBe(0);
    }
    const [summary] = (await sql`SELECT * FROM collect.event_summaries`) as Record<string, unknown>[];
    expect(summary!.id).toBe(summaryId);
    const json = JSON.stringify(summary);
    expect(json).not.toContain("松本");
    expect(json).not.toContain("来ない人");
    expect(json).not.toContain("手伝いの人");

    const list = (await (await call(app, "GET", "/api/collect/summaries", { user: "o1" })).json()) as { summaries: Record<string, unknown>[] };
    expect(list.summaries).toEqual([
      expect.objectContaining({
        id: summaryId,
        name: "消す会",
        rosterCount: 2,
        attendedCount: 1,
        awaitingTransfer: { count: 0, amount: 0 },
        byMedia: [
          { media: "minato", roster: 1, attended: 0, paid: 0, awaiting: 0 },
          { media: "peatix", roster: 1, attended: 1, paid: 3000, awaiting: 0 },
        ],
      }),
    ]);
    expect((list.summaries[0]!.byMethod as Record<string, unknown>).cash).toEqual({ count: 1, amount: 3000 });
    expect(await errorOf(await call(app, "GET", `/api/collect/events/${event.id}`, { user: "o1" }))).toEqual([404, "ITEM_NOT_FOUND"]);
  });

  it("消したイベントの人は、前回の参加者に出ない", async () => {
    const next = await createCollectEvent(app, "o1", { startsAt: "2026-12-20T10:00:00.000Z", endsAt: null });
    const before = (await (await call(app, "GET", `/api/collect/past-attendees?eventId=${next.id}&q=${encodeURIComponent("松本")}`, { user: "o1" })).json()) as {
      candidates: unknown[];
    };
    expect(before.candidates).toHaveLength(1);
    await call(app, "DELETE", `/api/collect/events/${event.id}`, { user: "o1" });
    const after = (await (await call(app, "GET", `/api/collect/past-attendees?eventId=${next.id}&q=${encodeURIComponent("松本")}`, { user: "o1" })).json()) as {
      candidates: unknown[];
    };
    expect(after.candidates).toHaveLength(0);
  });

  it("まとめも消せる。ほかの主催者のイベント・まとめは 404", async () => {
    await grantCollect(app, "o2");
    expect(await errorOf(await call(app, "DELETE", `/api/collect/events/${event.id}`, { user: "o2" }))).toEqual([404, "ITEM_NOT_FOUND"]);
    const { summaryId } = (await (await call(app, "DELETE", `/api/collect/events/${event.id}`, { user: "o1" })).json()) as { summaryId: string };
    expect(await errorOf(await call(app, "DELETE", `/api/collect/summaries/${summaryId}`, { user: "o2" }))).toEqual([404, "ITEM_NOT_FOUND"]);
    expect((await call(app, "DELETE", `/api/collect/summaries/${summaryId}`, { user: "o1" })).status).toBe(200);
    expect(((await (await call(app, "GET", "/api/collect/summaries", { user: "o1" })).json()) as { summaries: unknown[] }).summaries).toEqual([]);
  });
});
