// 締め（specs/collect/001-event-day-collection contracts/api.md 6、FR-040〜FR-045、tasks.md T054）。
import { beforeEach, describe, expect, it } from "vitest";
import { call, makeApp, resetDb } from "../../helpers/app";
import { createCollectEvent, errorOf, grantCollect, type EventBody } from "../../helpers/collect";

const app = makeApp();
let event: EventBody;
let token: string;
let helper: { helperId: string; deviceSecret: string };
const ids: Record<string, string> = {};

type Closing = {
  version: number;
  closedAt: string | null;
  changedAfterClose: boolean;
  attendance: { arrived: number; rosterCount: number };
  byMethod: Record<string, { count: number; amount: number }>;
  cashByReceiver: { receiverKey: string; name: string; count: number; amount: number; countedAmount: number | null; settledAt: string | null; changedAfterSettle: boolean }[];
  paypay: { count: number; amount: number; checkedAt: string | null; records: { name: string; amount: number; receiverName: string }[] };
  transfers: { paid: { count: number; amount: number }; awaiting: { count: number; amount: number } };
  byMedia: { media: string; roster: number; attended: number; paid: number; awaiting: number }[];
  absent: { name: string }[];
};

const rid = () => crypto.randomUUID();
const ownerRecord = (name: string, method: string) =>
  call(app, "PUT", `/api/collect/events/${event.id}/reception/${ids[name]}`, { user: "o1", body: { method, clientRequestId: rid() } });
const helperRecord = (name: string, method: string) =>
  call(app, "PUT", `/api/collect/r/${token}/reception/${ids[name]}`, { headers: { "X-Collect-Device": helper.deviceSecret }, body: { method, clientRequestId: rid() } });
const closing = async () => (await (await call(app, "GET", `/api/collect/events/${event.id}/closing`, { user: "o1" })).json()) as Closing;
const settle = (key: string, body: object) => call(app, "PUT", `/api/collect/events/${event.id}/settlements/${key}`, { user: "o1", body });

beforeEach(async () => {
  await resetDb();
  await grantCollect(app, "o1");
  event = await createCollectEvent(app, "o1");
  const people: [string, string, number][] = [
    ["松本", "peatix", 0],
    ["井上", "peatix", 1],
    ["木村", "kokuchpro", 0],
    ["佐藤", "kokuchpro", 0],
    ["田中", "minato", 0],
    ["来ない人", "minato", 0],
  ];
  for (const [name, media, tier] of people) {
    const res = await call(app, "POST", `/api/collect/events/${event.id}/roster`, { user: "o1", body: { name, media, priceTierId: event.tiers[tier]!.id } });
    ids[name] = ((await res.json()) as { person: { id: string } }).person.id;
  }
  const link = ((await (await call(app, "POST", `/api/collect/events/${event.id}/link`, { user: "o1" })).json()) as { link: { url: string } }).link;
  token = link.url.split("/collect/r/")[1]!;
  helper = (await (await call(app, "POST", `/api/collect/r/${token}/join`, { body: { name: "手伝い井上" } })).json()) as typeof helper;
  // 主催者：現金 3,000（松本）・PayPay 2,500（井上）。手伝う人：現金 3,000（木村）・振込当日 3,000（佐藤）・振込後日 3,000（田中）
  await ownerRecord("松本", "cash");
  await ownerRecord("井上", "paypay");
  await helperRecord("木村", "cash");
  await helperRecord("佐藤", "transfer_today");
  await helperRecord("田中", "transfer_later");
});

describe("締めの画面", () => {
  it("受け取った人ごとの現金・PayPay・振込・媒体ごと・来なかった人", async () => {
    const c = await closing();
    expect(c.attendance).toEqual({ arrived: 5, rosterCount: 6 });
    expect(c.byMethod.cash).toEqual({ count: 2, amount: 6000 });
    expect(c.cashByReceiver).toEqual([
      expect.objectContaining({ receiverKey: "owner", name: "主催者", count: 1, amount: 3000, countedAmount: null, settledAt: null }),
      expect.objectContaining({ receiverKey: helper.helperId, name: "手伝い井上", count: 1, amount: 3000 }),
    ]);
    expect(c.paypay).toMatchObject({ count: 1, amount: 2500, checkedAt: null, records: [{ name: "井上", amount: 2500, receiverName: "主催者" }] });
    expect(c.transfers).toEqual({ paid: { count: 0, amount: 0 }, awaiting: { count: 2, amount: 6000 } });
    expect(c.byMedia).toEqual([
      { media: "minato", roster: 2, attended: 1, paid: 0, awaiting: 3000 },
      { media: "kokuchpro", roster: 2, attended: 2, paid: 3000, awaiting: 3000 },
      { media: "peatix", roster: 2, attended: 2, paid: 5500, awaiting: 0 },
    ]);
    expect(c.absent.map((p) => p.name)).toEqual(["来ない人"]);
    expect(c.closedAt).toBeNull();
    expect(c.changedAfterClose).toBe(false);
  });

  it("渡された額を入れ、精算した。精算したあとにその人の現金の記録を取り消すと「精算したあとで変わった」", async () => {
    let c = (await (await settle(helper.helperId, { countedAmount: 2500 })).json()) as Closing;
    expect(c.cashByReceiver[1]).toMatchObject({ countedAmount: 2500, settledAt: null });
    c = (await (await settle(helper.helperId, { settled: true })).json()) as Closing;
    expect(c.cashByReceiver[1]!.settledAt).not.toBeNull();
    expect(c.cashByReceiver[1]!.changedAfterSettle).toBe(false);
    await call(app, "DELETE", `/api/collect/events/${event.id}/reception/${ids["木村"]}`, { user: "o1" });
    c = await closing();
    expect(c.cashByReceiver[1]).toMatchObject({ amount: 0, countedAmount: 2500, changedAfterSettle: true });
    // 精算を外す
    c = (await (await settle(helper.helperId, { settled: false })).json()) as Closing;
    expect(c.cashByReceiver[1]).toMatchObject({ settledAt: null, changedAfterSettle: false });
  });

  it("ない受け取った人・入力なしは 404・400", async () => {
    expect(await errorOf(await settle(crypto.randomUUID(), { settled: true }))).toEqual([404, "ITEM_NOT_FOUND"]);
    expect(await errorOf(await settle("someone", { settled: true }))).toEqual([404, "ITEM_NOT_FOUND"]);
    expect(await errorOf(await settle("owner", {}))).toEqual([400, "VALIDATION_FAILED"]);
  });

  it("PayPayの「履歴と合った」", async () => {
    const res = await call(app, "POST", `/api/collect/events/${event.id}/paypay-check`, { user: "o1" });
    expect(((await res.json()) as Closing).paypay.checkedAt).not.toBeNull();
  });

  it("締めると精算していない人を返す（締めることは止めない）。締めたあとに記録を変えると「締めのあとで変わった」", async () => {
    await settle("owner", { settled: true });
    const res = await call(app, "POST", `/api/collect/events/${event.id}/close`, { user: "o1" });
    const body = (await res.json()) as { closedAt: string; unsettled: string[] };
    expect(body.unsettled).toEqual([helper.helperId]);
    let c = await closing();
    expect(c.closedAt).toBe(body.closedAt);
    expect(c.changedAfterClose).toBe(false);
    // 精算・PayPayの確かめは「変わった」にしない
    await settle(helper.helperId, { settled: true });
    await call(app, "POST", `/api/collect/events/${event.id}/paypay-check`, { user: "o1" });
    expect((await closing()).changedAfterClose).toBe(false);
    await ownerRecord("来ない人", "cash");
    c = await closing();
    expect(c.changedAfterClose).toBe(true);
    // 締め直すと戻る
    await call(app, "POST", `/api/collect/events/${event.id}/close`, { user: "o1" });
    expect((await closing()).changedAfterClose).toBe(false);
  });

  it("ほかの主催者・手伝う人は呼べない", async () => {
    await grantCollect(app, "o2");
    expect(await errorOf(await call(app, "GET", `/api/collect/events/${event.id}/closing`, { user: "o2" }))).toEqual([404, "ITEM_NOT_FOUND"]);
    expect((await call(app, "GET", `/api/collect/events/${event.id}/closing`, { headers: { "X-Collect-Device": helper.deviceSecret } })).status).toBe(401);
  });
});
