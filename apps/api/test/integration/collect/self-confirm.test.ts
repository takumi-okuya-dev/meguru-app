// セルフ受付：受付をする人が本人の申告を確かめる（specs/collect/002-self-check-in User Story 2、FR-030〜FR-041、tasks.md T008）。
import { beforeEach, describe, expect, it } from "vitest";
import { call, makeApp, resetDb } from "../../helpers/app";
import { asParticipant, createCollectEvent, errorOf, grantCollect, selfToken, type EventBody } from "../../helpers/collect";

const app = makeApp();
let event: EventBody;
let token: string;
let helperToken: string;
let helper: { helperId: string; deviceSecret: string };
const ids: Record<string, string> = {};
const DEVICE = "33333333-3333-4333-8333-333333333333";

type Rec = { method: string; amount: number; receiverKind: string; receiverHelperId: string | null; paymentStatus: string; selfReported: boolean; confirmedAt: string | null };
const declare = (name: string, method: string) =>
  asParticipant(app, "POST", `/api/collect/s/${token}/declare`, DEVICE, { personId: ids[name], method, clientRequestId: crypto.randomUUID() });
const ownerConfirm = (name: string, body: object = {}) => call(app, "POST", `/api/collect/events/${event.id}/reception/${ids[name]}/confirm`, { user: "o1", body });
const asHelper = (method: string, path: string, body?: object) =>
  call(app, method, `/api/collect/r/${helperToken}${path}`, { headers: { "X-Collect-Device": helper.deviceSecret }, ...(body ? { body } : {}) });
const snapshot = async () =>
  (await (await call(app, "GET", `/api/collect/events/${event.id}/reception`, { user: "o1" })).json()) as {
    people: { person: { id: string }; record: Rec | null }[];
    stats: { cash: number; paypay: number; mine: number; awaitingConfirmationCount: number; awaitingConfirmationAmount: number };
  };
const recordOf = async (name: string) => (await snapshot()).people.find((p) => p.person.id === ids[name])!.record;

beforeEach(async () => {
  await resetDb();
  await grantCollect(app, "o1");
  event = await createCollectEvent(app, "o1");
  for (const [name, tier] of [["松本", 0], ["井上", 1], ["木村", 0], ["佐藤", 0]] as const) {
    const res = await call(app, "POST", `/api/collect/events/${event.id}/roster`, { user: "o1", body: { name, media: "peatix", priceTierId: event.tiers[tier]!.id } });
    ids[name] = ((await res.json()) as { person: { id: string } }).person.id;
  }
  token = await selfToken(app, "o1", event.id);
  const link = ((await (await call(app, "POST", `/api/collect/events/${event.id}/link`, { user: "o1" })).json()) as { link: { url: string } }).link;
  helperToken = link.url.split("/collect/r/")[1]!;
  helper = (await (await call(app, "POST", `/api/collect/r/${helperToken}/join`, { body: { name: "手伝い井上" } })).json()) as typeof helper;
});

describe("確かめる", () => {
  it("主催者が確かめると支払い済み。受け取った人は主催者・本人の申告の印は残る・数字に入る", async () => {
    await declare("松本", "cash");
    expect((await snapshot()).stats).toMatchObject({ cash: 0, mine: 0, awaitingConfirmationCount: 1, awaitingConfirmationAmount: 3000 });
    const res = await ownerConfirm("松本");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { record: Rec }).record).toMatchObject({ receiverKind: "owner", paymentStatus: "paid", selfReported: true, confirmedAt: expect.any(String) });
    expect((await snapshot()).stats).toMatchObject({ cash: 3000, mine: 3000, awaitingConfirmationCount: 0, awaitingConfirmationAmount: 0 });
  });

  it("手伝う人も確かめられる（受け取った人は手伝う人）。払い方・区分・金額を直せる", async () => {
    await declare("井上", "cash");
    const res = await asHelper("POST", `/reception/${ids["井上"]}/confirm`, { method: "paypay", priceTierId: event.tiers[0]!.id });
    expect(res.status).toBe(200);
    expect(await recordOf("井上")).toMatchObject({ method: "paypay", amount: 3000, receiverKind: "helper", receiverHelperId: helper.helperId, paymentStatus: "paid" });
    await declare("木村", "paypay");
    await ownerConfirm("木村", { amount: 1000 });
    expect(await recordOf("木村")).toMatchObject({ amount: 1000, method: "paypay" });
  });

  it("確かめ待ちでない（受付をする人の記録・振込の申告・確かめ済み）は 409。未受付は 404。使わない払い方は 400", async () => {
    await call(app, "PUT", `/api/collect/events/${event.id}/reception/${ids["松本"]}`, { user: "o1", body: { method: "cash", clientRequestId: crypto.randomUUID() } });
    expect(await errorOf(await ownerConfirm("松本"))).toEqual([409, "NOT_AWAITING_CONFIRMATION"]);
    await declare("井上", "transfer_later");
    expect(await errorOf(await ownerConfirm("井上"))).toEqual([409, "NOT_AWAITING_CONFIRMATION"]);
    await declare("木村", "cash");
    await ownerConfirm("木村");
    expect(await errorOf(await ownerConfirm("木村"))).toEqual([409, "NOT_AWAITING_CONFIRMATION"]);
    expect(await errorOf(await ownerConfirm("佐藤"))).toEqual([404, "ITEM_NOT_FOUND"]);
    await declare("佐藤", "cash");
    expect(await errorOf(await ownerConfirm("佐藤", { method: "transfer_later" }))).toEqual([400, "VALIDATION_FAILED"]);
  });

  it("確かめたあとは、参加者は選び直せない（409）", async () => {
    await declare("松本", "cash");
    await ownerConfirm("松本");
    expect(await errorOf(await declare("松本", "paypay"))).toEqual([409, "ALREADY_RECORDED"]);
  });
});

describe("取り消し", () => {
  it("手伝う人は、まだ確かめていない本人の申告を取り消せる。確かめたあと（主催者が受け取った）は取り消せない", async () => {
    await declare("松本", "cash");
    expect((await asHelper("DELETE", `/reception/${ids["松本"]}`)).status).toBe(200);
    expect(await recordOf("松本")).toBeNull();
    await declare("井上", "transfer_today");
    expect((await asHelper("DELETE", `/reception/${ids["井上"]}`)).status).toBe(200);
    await declare("木村", "cash");
    await ownerConfirm("木村");
    expect(await errorOf(await asHelper("DELETE", `/reception/${ids["木村"]}`))).toEqual([403, "RECORD_NOT_YOURS"]);
  });
});

describe("締め・書き出し", () => {
  type Closing = {
    attendance: { arrived: number };
    awaitingConfirmation: { count: number; amount: number; people: { name: string; method: string; amount: number }[] };
    byMethod: Record<string, { count: number; amount: number }>;
    cashByReceiver: { amount: number }[];
    paypay: { count: number; amount: number };
    byMedia: { attended: number; paid: number }[];
  };
  it("確かめ待ちは払い方ごとの合計と受け取った人ごとの現金の外。件数と人を別に出す。来場には数える", async () => {
    await declare("松本", "cash");
    await declare("井上", "paypay");
    await declare("木村", "cash");
    await ownerConfirm("木村");
    const c = (await (await call(app, "GET", `/api/collect/events/${event.id}/closing`, { user: "o1" })).json()) as Closing;
    expect(c.attendance.arrived).toBe(3);
    expect(c.awaitingConfirmation).toEqual({
      count: 2,
      amount: 5500,
      people: [
        { personId: ids["松本"], number: 1, name: "松本", method: "cash", amount: 3000 },
        { personId: ids["井上"], number: 2, name: "井上", method: "paypay", amount: 2500 },
      ],
    });
    expect(c.byMethod.cash).toEqual({ count: 1, amount: 3000 });
    expect(c.byMethod.paypay).toEqual({ count: 0, amount: 0 });
    expect(c.cashByReceiver.reduce((n, r) => n + r.amount, 0)).toBe(3000);
    expect(c.paypay).toMatchObject({ count: 0, amount: 0 });
    expect(c.byMedia[0]).toMatchObject({ attended: 3, paid: 3000 });
  });

  it("書き出しの受け取った人の欄：確かめ待ちは「本人の申告（確かめ待ち）」、確かめたら「本人の申告→主催者」", async () => {
    await declare("松本", "cash");
    await declare("井上", "cash");
    await asHelper("POST", `/reception/${ids["井上"]}/confirm`);
    const csv = await (await call(app, "GET", `/api/collect/events/${event.id}/export.csv`, { user: "o1" })).text();
    expect(csv).toContain("本人の申告（確かめ待ち）");
    expect(csv).toContain("本人の申告→手伝い井上");
  });
});
