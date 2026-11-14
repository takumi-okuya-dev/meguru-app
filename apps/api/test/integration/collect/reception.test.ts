// 受付（specs/collect/001-event-day-collection contracts/api.md 4、FR-030〜FR-039、research.md R6・R17、tasks.md T032）。
import { beforeEach, describe, expect, it } from "vitest";
import { call, makeApp, resetDb } from "../../helpers/app";
import { createCollectEvent, errorOf, grantCollect, type EventBody } from "../../helpers/collect";

const app = makeApp();
let event: EventBody;
let personId: string;

type Rec = {
  personId: string;
  method: string;
  priceTierId: string;
  amount: number;
  amountOverridden: boolean;
  receiverKind: string;
  receiverHelperId: string | null;
  paymentStatus: string;
};
type Snapshot = {
  version: number;
  people: { person: { id: string; number: number; name: string; media: string; priceTierId: string; memo?: string | null }; record: Rec | null }[];
  stats: { arrived: number; rosterCount: number; cash: number; paypay: number; awaitingTransferCount: number; awaitingTransferAmount: number; mine: number; awaitingConfirmationCount: number; awaitingConfirmationAmount: number };
  settings: { hasPaypayQr: boolean; bankText: string | null };
};

const rid = () => crypto.randomUUID();
const addPerson = async (name: string, tier = 0) => {
  const res = await call(app, "POST", `/api/collect/events/${event.id}/roster`, {
    user: "o1",
    body: { name, media: "peatix", priceTierId: event.tiers[tier]!.id, memo: "紹介：井上さん" },
  });
  return ((await res.json()) as { person: { id: string } }).person.id;
};
const record = (pid: string, body: Partial<{ method: string; priceTierId: string; amount: number; clientRequestId: string }>) =>
  call(app, "PUT", `/api/collect/events/${event.id}/reception/${pid}`, { user: "o1", body: { method: "cash", clientRequestId: rid(), ...body } });
const snapshot = async () => (await (await call(app, "GET", `/api/collect/events/${event.id}/reception`, { user: "o1" })).json()) as Snapshot;

beforeEach(async () => {
  await resetDb();
  await grantCollect(app, "o1");
  event = await createCollectEvent(app, "o1");
  personId = await addPerson("松本 れい");
});

describe("記録する", () => {
  it("区分の金額で記録し、受け取った人は主催者。版が1上がる", async () => {
    const before = (await snapshot()).version;
    const res = await record(personId, { method: "cash" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { record: Rec; version: number };
    expect(body.record).toMatchObject({
      personId,
      method: "cash",
      priceTierId: event.tiers[0]!.id,
      amount: 3000,
      amountOverridden: false,
      receiverKind: "owner",
      receiverHelperId: null,
      paymentStatus: "paid",
    });
    expect(body.version).toBe(before + 1);
  });

  it("区分を変えると、記録の区分と金額が変わり、名簿の区分は変わらない（R17）", async () => {
    const res = await record(personId, { method: "paypay", priceTierId: event.tiers[1]!.id });
    expect(((await res.json()) as { record: Rec }).record).toMatchObject({ priceTierId: event.tiers[1]!.id, amount: 2500, amountOverridden: false });
    const snap = await snapshot();
    expect(snap.people[0]!.person.priceTierId).toBe(event.tiers[0]!.id);
  });

  it("金額を直接入れると「直接変えた」。来場のみは0円。振込は振込待ち", async () => {
    const b = await addPerson("井上 そら");
    const c = await addPerson("木村 ゆうき");
    expect(((await (await record(personId, { method: "cash", amount: 1000 })).json()) as { record: Rec }).record).toMatchObject({
      amount: 1000,
      amountOverridden: true,
    });
    expect(((await (await record(b, { method: "none", amount: 500 })).json()) as { record: Rec }).record).toMatchObject({
      amount: 0,
      amountOverridden: false,
      paymentStatus: "paid",
    });
    expect(((await (await record(c, { method: "transfer_later" })).json()) as { record: Rec }).record).toMatchObject({
      amount: 3000,
      paymentStatus: "awaiting_transfer",
    });
  });

  it("イベントで使わない払い方・ほかのイベントの区分は 400", async () => {
    const cashOnly = await createCollectEvent(app, "o1", { methods: ["cash"] });
    const res = await call(app, "POST", `/api/collect/events/${cashOnly.id}/roster`, {
      user: "o1",
      body: { name: "a", media: "peatix", priceTierId: cashOnly.tiers[0]!.id },
    });
    const pid = ((await res.json()) as { person: { id: string } }).person.id;
    const put = (body: object) => call(app, "PUT", `/api/collect/events/${cashOnly.id}/reception/${pid}`, { user: "o1", body: { clientRequestId: rid(), ...body } });
    expect(await errorOf(await put({ method: "paypay" }))).toEqual([400, "VALIDATION_FAILED"]);
    expect(await errorOf(await put({ method: "transfer_today" }))).toEqual([400, "VALIDATION_FAILED"]);
    expect((await put({ method: "none" })).status).toBe(201);
    expect(await errorOf(await record(personId, { priceTierId: cashOnly.tiers[0]!.id }))).toEqual([400, "VALIDATION_FAILED"]);
  });

  it("受付済みの人は 409 ALREADY_RECORDED と先の記録", async () => {
    await record(personId, { method: "paypay" });
    const res = await record(personId, { method: "cash" });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string; record: Rec } };
    expect(body.error.code).toBe("ALREADY_RECORDED");
    expect(body.error.record).toMatchObject({ personId, method: "paypay" });
  });

  it("同時に2つ送っても1件だけ残る", async () => {
    const results = await Promise.all([record(personId, { method: "cash" }), record(personId, { method: "paypay" })]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await snapshot()).stats.arrived).toBe(1);
  });

  it("同じ clientRequestId の送り直しは 201 で同じ結果（版は上がらない）", async () => {
    const clientRequestId = rid();
    const first = (await (await record(personId, { method: "cash", clientRequestId })).json()) as { record: Rec; version: number };
    const again = await record(personId, { method: "cash", clientRequestId });
    expect(again.status).toBe(201);
    expect(await again.json()).toEqual(first);
    // ほかの人に同じ clientRequestId は使えない
    const other = await addPerson("井上 そら");
    expect(await errorOf(await record(other, { clientRequestId }))).toEqual([400, "VALIDATION_FAILED"]);
  });

  it("受付の記録が使っている区分は消せない（409 TIER_IN_USE）", async () => {
    // 名簿は区分0、記録は区分2（招待）
    await record(personId, { method: "none", priceTierId: event.tiers[2]!.id });
    const tiers = event.tiers.slice(0, 2).map((t) => ({ id: t.id, name: t.name, amount: t.amount }));
    expect(await errorOf(await call(app, "PATCH", `/api/collect/events/${event.id}`, { user: "o1", body: { tiers } }))).toEqual([409, "TIER_IN_USE"]);
  });

  it("ほかの主催者のイベント・ない人は 404", async () => {
    await grantCollect(app, "o2");
    const res = await call(app, "PUT", `/api/collect/events/${event.id}/reception/${personId}`, { user: "o2", body: { method: "cash", clientRequestId: rid() } });
    expect(await errorOf(res)).toEqual([404, "ITEM_NOT_FOUND"]);
    expect(await errorOf(await record(crypto.randomUUID(), {}))).toEqual([404, "ITEM_NOT_FOUND"]);
    expect(await errorOf(await record("not-a-uuid", {}))).toEqual([404, "ITEM_NOT_FOUND"]);
  });
});

describe("取り消す・飛び入り", () => {
  it("取り消すと未受付に戻り、版が上がる。記録のない人は 404", async () => {
    await record(personId, { method: "cash" });
    const before = (await snapshot()).version;
    const res = await call(app, "DELETE", `/api/collect/events/${event.id}/reception/${personId}`, { user: "o1" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { version: number }).version).toBe(before + 1);
    expect((await snapshot()).people[0]!.record).toBeNull();
    expect(await errorOf(await call(app, "DELETE", `/api/collect/events/${event.id}/reception/${personId}`, { user: "o1" }))).toEqual([404, "ITEM_NOT_FOUND"]);
  });

  it("飛び入りは媒体「当日」・最初の区分・次の受付番号。送り直しは同じ人", async () => {
    const clientRequestId = rid();
    const res = await call(app, "POST", `/api/collect/events/${event.id}/walk-ins`, { user: "o1", body: { name: " 飛び入り 太郎 ", clientRequestId } });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { person: { id: string; number: number; name: string; media: string; priceTierId: string }; version: number };
    expect(body.person).toMatchObject({ number: 2, name: "飛び入り 太郎", media: "walk_in", priceTierId: event.tiers[0]!.id });
    const again = await call(app, "POST", `/api/collect/events/${event.id}/walk-ins`, { user: "o1", body: { name: "飛び入り 太郎", clientRequestId } });
    expect(((await again.json()) as { person: { id: string } }).person.id).toBe(body.person.id);
    expect((await snapshot()).people).toHaveLength(2);
    expect(await errorOf(await call(app, "POST", `/api/collect/events/${event.id}/walk-ins`, { user: "o1", body: { name: "", clientRequestId: rid() } }))).toEqual([
      400,
      "VALIDATION_FAILED",
    ]);
  });
});

describe("スナップショット", () => {
  it("数字（来場・現金・PayPay・振込待ち・あなたが受け取った現金）とメモ", async () => {
    const b = await addPerson("井上 そら", 1);
    const c = await addPerson("木村 ゆうき");
    await addPerson("来ていない 人");
    await record(personId, { method: "cash" });
    await record(b, { method: "paypay" });
    await record(c, { method: "transfer_today" });
    const snap = await snapshot();
    expect(snap.stats).toEqual({ arrived: 3, rosterCount: 4, cash: 3000, paypay: 2500, awaitingTransferCount: 1, awaitingTransferAmount: 3000, mine: 3000, awaitingConfirmationCount: 0, awaitingConfirmationAmount: 0 });
    expect(snap.people[0]!.person.memo).toBe("紹介：井上さん");
    expect(snap.people.map((p) => p.person.number)).toEqual([1, 2, 3, 4]);
    expect(snap.settings).toEqual({ hasPaypayQr: false, bankText: null });
  });

  it("イベントの一覧に、来場の数と振込待ちの数が出る", async () => {
    const b = await addPerson("井上 そら");
    await record(personId, { method: "cash" });
    await record(b, { method: "transfer_later" });
    const list = (await (await call(app, "GET", "/api/collect/events", { user: "o1" })).json()) as { events: { attendedCount: number; awaitingTransferCount: number }[] };
    expect(list.events[0]).toMatchObject({ attendedCount: 2, awaitingTransferCount: 1 });
    const me = (await (await call(app, "GET", "/api/collect/me", { user: "o1" })).json()) as { awaitingTransferCount: number };
    expect(me.awaitingTransferCount).toBe(1);
  });
});
