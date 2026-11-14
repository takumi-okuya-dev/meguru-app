// セルフ受付：参加者が自分で受付する（specs/collect/002-self-check-in User Story 1・3、FR-001〜FR-019・FR-050〜FR-052、tasks.md T007・T012）。
import { beforeEach, describe, expect, it } from "vitest";
import { call, makeApp, resetDb } from "../../helpers/app";
import { asParticipant, createCollectEvent, errorOf, grantCollect, selfToken, type EventBody } from "../../helpers/collect";

const app = makeApp();
let event: EventBody;
let token: string;
const ids: Record<string, string> = {};
const DEVICE = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

const s = (path = "") => `/api/collect/s/${token}${path}`;
const search = (query: string, device = DEVICE) => asParticipant(app, "POST", s("/search"), device, { query });
const declare = (personId: string, method: string | undefined, device = DEVICE, clientRequestId: string = crypto.randomUUID()) =>
  asParticipant(app, "POST", s("/declare"), device, { personId, ...(method ? { method } : {}), clientRequestId });

beforeEach(async () => {
  await resetDb();
  await grantCollect(app, "o1");
  event = await createCollectEvent(app, "o1");
  for (const [name, kana, tier, memo] of [
    ["松本 れい", "まつもと れい", 0, "紹介：井上さん"],
    ["井上 そら", null, 1, null],
    ["同名 太郎", null, 0, null],
    ["同名 太郎", null, 0, null],
    ["招待 さん", null, 2, null],
  ] as const) {
    const res = await call(app, "POST", `/api/collect/events/${event.id}/roster`, { user: "o1", body: { name, kana, media: "peatix", priceTierId: event.tiers[tier]!.id, memo } });
    ids[name] = ((await res.json()) as { person: { id: string } }).person.id;
  }
  token = await selfToken(app, "o1", event.id);
});

describe("リンク（主催者）", () => {
  it("手伝う人の受付用リンクとは別に出せる。トークンは cs_。参加者の画面にはイベントの名前・日時・会場・払い方だけ", async () => {
    expect(token).toMatch(/^cs_/);
    const helper = (await (await call(app, "POST", `/api/collect/events/${event.id}/link`, { user: "o1" })).json()) as { link: { url: string } };
    expect(helper.link.url).toContain("/collect/r/cr_");
    const info = (await (await call(app, "GET", s())).json()) as Record<string, unknown>;
    expect(info).toEqual({
      status: "active",
      event: { name: "IT交流会", startsAt: expect.any(String), venue: "渋谷", methods: ["cash", "paypay", "transfer"] },
      settings: { hasPaypayQr: false, bankText: null },
      // 名簿ありのイベントでは、名簿なしの入れる欄のための媒体・区分は空（specs/collect/004）
      checkInMode: "roster",
      media: [],
      tiers: [],
    });
    await call(app, "PUT", "/api/collect/settings", { user: "o1", body: { bankText: "めぐる銀行 渋谷支店 普通 1234567" } });
    expect(((await (await call(app, "GET", s())).json()) as { settings: unknown }).settings).toEqual({ hasPaypayQr: false, bankText: "めぐる銀行 渋谷支店 普通 1234567" });
    // 同じものを返す・GET でも同じ
    expect(await selfToken(app, "o1", event.id)).toBe(token);
  });

  it("手伝う人の受付用リンクではセルフ受付に入れず、セルフ受付のリンクでは手伝う人の道筋に入れない", async () => {
    const helper = (await (await call(app, "POST", `/api/collect/events/${event.id}/link`, { user: "o1" })).json()) as { link: { url: string } };
    const helperToken = helper.link.url.split("/collect/r/")[1]!;
    expect(await errorOf(await call(app, "GET", `/api/collect/s/${helperToken}`))).toEqual([404, "ITEM_NOT_FOUND"]);
    expect(await errorOf(await call(app, "GET", `/api/collect/r/${token}`))).toEqual([404, "ITEM_NOT_FOUND"]);
  });

  it("止めると探せない（410）・申告は残る。出し直すと前のトークンは使えない。期限を変えられる", async () => {
    await declare(ids["松本 れい"]!, "cash");
    expect((await call(app, "POST", `/api/collect/events/${event.id}/self-link/stop`, { user: "o1" })).status).toBe(200);
    expect(await errorOf(await search("松本 れい"))).toEqual([410, "LINK_INACTIVE"]);
    expect(((await (await call(app, "GET", s())).json()) as { status: string }).status).toBe("stopped");
    const snap = (await (await call(app, "GET", `/api/collect/events/${event.id}/reception`, { user: "o1" })).json()) as { stats: { arrived: number } };
    expect(snap.stats.arrived).toBe(1);
    const next = await selfToken(app, "o1", event.id);
    expect(next).not.toBe(token);
    const res = await call(app, "PATCH", `/api/collect/events/${event.id}/self-link`, { user: "o1", body: { expiresAt: "2099-01-01T00:00:00.000Z" } });
    expect(((await res.json()) as { link: { expiresAt: string } }).link.expiresAt).toBe("2099-01-01T00:00:00.000Z");
  });

  it("手伝う人はセルフ受付のリンクを出せない（ログインの要る道筋）", async () => {
    expect((await call(app, "POST", `/api/collect/events/${event.id}/self-link`, { headers: { "X-Collect-Device": DEVICE } })).status).toBe(401);
  });
});

describe("探す（完全に一致した1人だけ）", () => {
  it("名前・ふりがな・受付番号で見つかる（ひらがなとカタカナ・全角と半角・空白・敬称を区別しない）。区分と金額だけを返す", async () => {
    for (const q of ["松本 れい", "まつもとれい", "マツモト　レイ", "松本れい さん", "1", "１"]) {
      const res = (await (await search(q)).json()) as { result: string; person?: Record<string, unknown> };
      expect(res.result, q).toBe("found");
      expect(res.person).toEqual({ id: ids["松本 れい"], number: 1, name: "松本 れい", tierName: "通常", amount: 3000, tierUndecided: false });
    }
    // メモ・媒体は返さない
    expect(JSON.stringify(await (await search("松本 れい")).json())).not.toContain("紹介");
  });

  it("部分一致は見つからない（ほかの人の名前を出さない）。同じ名前が2人なら受付番号を聞く", async () => {
    expect(await (await search("松本")).json()).toEqual({ result: "not_found" });
    expect(await (await search("井")).json()).toEqual({ result: "not_found" });
    expect(await (await search("同名 太郎")).json()).toEqual({ result: "ambiguous" });
    expect(((await (await search("4")).json()) as { result: string }).result).toBe("found");
  });

  it("端末ごとに1分に10回まで（11回目は 429）。ほかの端末は探せる。端末の印がなければ 400", async () => {
    for (let i = 0; i < 10; i++) expect((await search("いない人")).status).toBe(200);
    expect(await errorOf(await search("いない人"))).toEqual([429, "RATE_LIMITED"]);
    expect((await search("松本 れい", OTHER)).status).toBe(200);
    expect((await call(app, "POST", s("/search"), { body: { query: "松本 れい" } })).status).toBe(400);
  });
});

describe("本人の申告", () => {
  type Rec = { method: string; paymentStatus: string; amount: number };
  it("現金・PayPayは確かめ待ち、振込は振込待ち、0円の区分は来場だけ。受付の記録には本人の申告の印", async () => {
    const cash = await declare(ids["松本 れい"]!, "cash");
    expect(cash.status).toBe(201);
    expect(((await cash.json()) as { record: Rec }).record).toEqual({ method: "cash", paymentStatus: "awaiting_confirmation", amount: 3000 });
    expect(((await (await declare(ids["井上 そら"]!, "transfer_later")).json()) as { record: Rec }).record).toMatchObject({ paymentStatus: "awaiting_transfer", amount: 2500 });
    expect(((await (await declare(ids["招待 さん"]!, undefined)).json()) as { record: Rec }).record).toEqual({ method: "none", paymentStatus: "paid", amount: 0 });
    const snap = (await (await call(app, "GET", `/api/collect/events/${event.id}/reception`, { user: "o1" })).json()) as {
      people: { person: { id: string }; record: { receiverKind: string; selfReported: boolean; paymentStatus: string } | null }[];
      stats: { cash: number; awaitingConfirmationCount: number; awaitingConfirmationAmount: number; awaitingTransferCount: number; arrived: number };
    };
    const mine = snap.people.find((p) => p.person.id === ids["松本 れい"])!.record!;
    expect(mine).toMatchObject({ receiverKind: "self", selfReported: true, paymentStatus: "awaiting_confirmation" });
    expect(snap.stats).toMatchObject({ arrived: 3, cash: 0, awaitingConfirmationCount: 1, awaitingConfirmationAmount: 3000, awaitingTransferCount: 1 });
  });

  it("払い方を選ばない（0円でない）・使わない払い方は 400", async () => {
    expect(await errorOf(await declare(ids["松本 れい"]!, undefined))).toEqual([400, "VALIDATION_FAILED"]);
    const cashOnly = await createCollectEvent(app, "o1", { methods: ["cash"] });
    const res = await call(app, "POST", `/api/collect/events/${cashOnly.id}/roster`, { user: "o1", body: { name: "a", media: "peatix", priceTierId: cashOnly.tiers[0]!.id } });
    const pid = ((await res.json()) as { person: { id: string } }).person.id;
    const t = await selfToken(app, "o1", cashOnly.id);
    expect(await errorOf(await asParticipant(app, "POST", `/api/collect/s/${t}/declare`, DEVICE, { personId: pid, method: "paypay", clientRequestId: crypto.randomUUID() }))).toEqual([400, "VALIDATION_FAILED"]);
    // ほかのイベントの人は 404
    expect(await errorOf(await declare(pid, "cash"))).toEqual([404, "ITEM_NOT_FOUND"]);
  });

  it("同じ端末なら確かめられる前は選び直せる（200）。ほかの端末・受付済みは 409。送り直しは同じ結果", async () => {
    const clientRequestId = crypto.randomUUID();
    await declare(ids["松本 れい"]!, "cash", DEVICE, clientRequestId);
    const again = await declare(ids["松本 れい"]!, "cash", DEVICE, clientRequestId);
    expect(again.status).toBe(201);
    const changed = await declare(ids["松本 れい"]!, "paypay");
    expect(changed.status).toBe(200);
    expect(((await changed.json()) as { record: Rec }).record.method).toBe("paypay");
    expect(await errorOf(await declare(ids["松本 れい"]!, "cash", OTHER))).toEqual([409, "ALREADY_RECORDED"]);
    // 受付をする人が先に記録した人
    await call(app, "PUT", `/api/collect/events/${event.id}/reception/${ids["井上 そら"]}`, { user: "o1", body: { method: "cash", clientRequestId: crypto.randomUUID() } });
    expect(await errorOf(await declare(ids["井上 そら"]!, "cash"))).toEqual([409, "ALREADY_RECORDED"]);
    // 振込の申告は、入金を確かめたら選び直せない
    const transfer = await declare(ids["招待 さん"]!, undefined);
    expect(transfer.status).toBe(201);
    expect(await errorOf(await declare(ids["招待 さん"]!, undefined))).toEqual([409, "ALREADY_RECORDED"]);
  });

  it("振込の申告は入金を確かめたら選び直せない。長すぎる受付番号は見つからない", async () => {
    await declare(ids["井上 そら"]!, "transfer_later");
    await call(app, "POST", `/api/collect/transfers/${ids["井上 そら"]}/confirm`, { user: "o1" });
    expect(await errorOf(await declare(ids["井上 そら"]!, "cash"))).toEqual([409, "ALREADY_RECORDED"]);
    expect(await (await search("99999999999")).json()).toEqual({ result: "not_found" });
  });

  it("探したときに、自分の記録の状態が分かる。自分の状態（me）に最後の申告が出る", async () => {
    await declare(ids["松本 れい"]!, "paypay");
    const found = (await (await search("松本 れい")).json()) as { record: Rec | null };
    expect(found.record).toEqual({ method: "paypay", paymentStatus: "awaiting_confirmation", amount: 3000 });
    const me = (await (await asParticipant(app, "GET", s("/me"), DEVICE)).json()) as { status: string; declaration: { person: { number: number }; record: Rec } | null };
    expect(me).toMatchObject({ status: "active", declaration: { person: { number: 1 }, record: { method: "paypay" } } });
    const other = (await (await asParticipant(app, "GET", s("/me"), OTHER)).json()) as { declaration: unknown };
    expect(other.declaration).toBeNull();
  });
});
