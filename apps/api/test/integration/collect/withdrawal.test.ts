// 退会したら、その主催者の集金管理のデータを消す（specs/collect/001-event-day-collection contracts/events.md 1・3）。
import { neon } from "@neondatabase/serverless";
import { beforeEach, describe, expect, it } from "vitest";
import { onUserWithdrawn } from "../../../src/apps/collect/inbox/received-events";
import { makeApp, resetDb, testEnv, call } from "../../helpers/app";
import { createCollectEvent, grantCollect } from "../../helpers/collect";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
});

const sql = () => neon(testEnv.DATABASE_URL);
const count = async (query: string) => Number(((await sql().query(query)) as { n: number }[])[0]!.n);

describe("退会の出来事", () => {
  it("その主催者のイベント・区分・名簿・既定値を消し、ほかの主催者のものは残す。2回届いても同じ", async () => {
    const o1 = await grantCollect(app, "o1");
    await grantCollect(app, "o2");
    const e1 = await createCollectEvent(app, "o1");
    await call(app, "POST", `/api/collect/events/${e1.id}/roster`, { user: "o1", body: { name: "a", media: "peatix", priceTierId: e1.tiers[0]!.id } });
    await call(app, "PUT", "/api/collect/settings", { user: "o1", body: { bankText: "銀行" } });
    await createCollectEvent(app, "o2");

    const event = { id: crypto.randomUUID(), type: "user.withdrawn" as const, payload: { userId: o1 }, createdAt: new Date() };
    await onUserWithdrawn(event, testEnv);
    await onUserWithdrawn(event, testEnv);

    expect(await count(`SELECT count(*)::int AS n FROM collect.events WHERE owner_user_id = '${o1}'`)).toBe(0);
    expect(await count(`SELECT count(*)::int AS n FROM collect.price_tiers WHERE event_id = '${e1.id}'`)).toBe(0);
    expect(await count(`SELECT count(*)::int AS n FROM collect.roster_people WHERE event_id = '${e1.id}'`)).toBe(0);
    expect(await count(`SELECT count(*)::int AS n FROM collect.owner_settings WHERE owner_user_id = '${o1}'`)).toBe(0);
    expect(await count(`SELECT count(*)::int AS n FROM collect.events`)).toBe(1);
  });

  it("退会すると、集金管理にも出来事が届いて片づく", async () => {
    const o1 = await grantCollect(app, "o1");
    await createCollectEvent(app, "o1");
    const res = await call(app, "POST", "/api/me/withdraw", { user: "o1", body: { confirmEmail: "o1@example.com" } });
    expect(res.status).toBe(204);
    expect(await count(`SELECT count(*)::int AS n FROM collect.events WHERE owner_user_id = '${o1}'`)).toBe(0);
    expect(
      await count(`SELECT count(*)::int AS n FROM platform_event_deliveries d JOIN platform_events e ON e.id = d.event_id
        WHERE e.type = 'user.withdrawn' AND d.consumer = 'collect' AND d.status = 'done'`),
    ).toBe(1);
  });
});
