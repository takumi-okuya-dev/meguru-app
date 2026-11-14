// 名簿なしで受付する（specs/collect/004-rosterless-check-in contracts/api.md、research.md R2〜R8、tasks.md T008・T012・T016・T018・T019）。
import { SELF_CHECK_IN_LIMITS } from "@meguru/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { call, makeApp, resetDb } from "../../helpers/app";
import { asParticipant, createCollectEvent, errorOf, grantCollect, selfToken, type EventBody } from "../../helpers/collect";

const app = makeApp();
let event: EventBody;
let token: string;
let helperToken: string;
let helper: { helperId: string; deviceSecret: string };
const DEVICE_A = "44444444-4444-4444-8444-444444444441";
const DEVICE_B = "44444444-4444-4444-8444-444444444442";

type SelfPerson = { id: string; number: number; name: string; tierName: string; amount: number; tierUndecided: boolean };
type RosterPerson = { id: string; number: number; name: string; media: string; priceTierId: string; referrer: string | null; tierUndecided: boolean; selfEntered: boolean };
type ReceptionRow = { person: { id: string; name: string; tierUndecided: boolean; sameName: boolean; selfEntered: boolean }; record: { paymentStatus: string; amount: number; priceTierId: string } | null };

const entryBody = (name: string, over: Record<string, unknown> = {}) => ({ name, media: "peatix", clientRequestId: crypto.randomUUID(), ...over });
const enter = (device: string, body: object, t = token) => asParticipant(app, "POST", `/api/collect/s/${t}/entries`, device, body);
const enterOk = async (device: string, name: string, over: Record<string, unknown> = {}, t = token) => {
  const res = await enter(device, entryBody(name, over), t);
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { requestId: string; person: SelfPerson }).person;
};
const declare = (device: string, personId: string, method: string, t = token) =>
  asParticipant(app, "POST", `/api/collect/s/${t}/declare`, device, { personId, method, clientRequestId: crypto.randomUUID() });
const roster = async (e = event) => ((await (await call(app, "GET", `/api/collect/events/${e.id}/roster`, { user: "o1" })).json()) as { people: RosterPerson[] }).people;
const reception = async (e = event) => ((await (await call(app, "GET", `/api/collect/events/${e.id}/reception`, { user: "o1" })).json()) as { people: ReceptionRow[]; stats: { cash: number } }).people;
const tierId = (name: string, e = event) => e.tiers.find((t) => t.name === name)!.id;
const asHelper = (method: string, path: string, body?: object) =>
  call(app, method, `/api/collect/r/${helperToken}${path}`, { headers: { "X-Collect-Device": helper.deviceSecret }, ...(body ? { body } : {}) });

/**
 * 区分が1つの名簿なしのイベントと、そのセルフ受付のリンクを作る。
 * @returns イベントとリンクの印
 */
async function singleTierEvent(): Promise<{ e: EventBody; t: string }> {
  const e = await createCollectEvent(app, "o1", { checkInMode: "rosterless", tiers: [{ name: "通常", amount: 3000 }] });
  return { e, t: await selfToken(app, "o1", e.id) };
}

beforeEach(async () => {
  await resetDb();
  await grantCollect(app, "o1");
  // 区分は 通常 3,000・早割 2,500・招待 0（EVENT_INPUT）
  event = await createCollectEvent(app, "o1", { checkInMode: "rosterless" });
  token = await selfToken(app, "o1", event.id);
  const link = ((await (await call(app, "POST", `/api/collect/events/${event.id}/link`, { user: "o1" })).json()) as { link: { url: string } }).link;
  helperToken = link.url.split("/collect/r/")[1]!;
  helper = (await (await call(app, "POST", `/api/collect/r/${helperToken}/join`, { body: { name: "手伝い大野" } })).json()) as typeof helper;
});

describe("User Story 1：名前と媒体を入れるだけで名簿に入る", () => {
  it("区分が1つなら、その区分で名簿に入り、受付番号が振られる。媒体・紹介した人も入る", async () => {
    const { e, t } = await singleTierEvent();
    const info = (await (await call(app, "GET", `/api/collect/s/${t}`)).json()) as { checkInMode: string; media: string[]; tiers: unknown[] };
    expect(info).toMatchObject({ checkInMode: "rosterless", tiers: [] });
    expect(info.media).toEqual(["minato", "kokuchpro", "tunagate", "jimoty", "peatix", "youtrust", "walk_in", "other"]);
    const person = await enterOk(DEVICE_A, "松本 れい", { kana: "まつもと れい", referrer: "井上" }, t);
    expect(person).toMatchObject({ number: 1, name: "松本 れい", tierName: "通常", amount: 3000, tierUndecided: false });
    expect(await roster(e)).toEqual([
      expect.objectContaining({ id: person.id, media: "peatix", referrer: "井上", tierUndecided: false, selfEntered: true, priceTierId: tierId("通常", e) }),
    ]);
  });

  it("区分が2つ以上なら、0円を除いた最も安い区分を仮に入れて区分を未定にし、参加者には0円を除いた区分を並べる", async () => {
    const info = (await (await call(app, "GET", `/api/collect/s/${token}`)).json()) as { tiers: unknown[] };
    expect(info.tiers).toEqual([
      { name: "通常", amount: 3000 },
      { name: "早割", amount: 2500 },
    ]);
    const person = await enterOk(DEVICE_A, "松本 れい");
    expect(person).toMatchObject({ tierName: "早割", amount: 2500, tierUndecided: true });
    expect((await roster())[0]).toMatchObject({ tierUndecided: true, priceTierId: tierId("早割") });
  });

  it("同じ clientRequestId の送り直しは同じ人を返し、2人にならない", async () => {
    const body = entryBody("松本 れい");
    const first = await enter(DEVICE_A, body);
    const again = await enter(DEVICE_A, body);
    expect(again.status).toBe(200);
    expect(((await again.json()) as { person: SelfPerson }).person.id).toBe(((await first.json()) as { person: SelfPerson }).person.id);
    expect(await roster()).toHaveLength(1);
  });

  it("入ったあとは me が名簿に入れた申し出を返し、002 と同じく払い方を申告できる（確かめ待ち）", async () => {
    const person = await enterOk(DEVICE_A, "松本 れい");
    const me = (await (await asParticipant(app, "GET", `/api/collect/s/${token}/me`, DEVICE_A)).json()) as { request: { status: string; person: SelfPerson | null } };
    expect(me.request).toMatchObject({ status: "accepted", person: { id: person.id, tierUndecided: true } });
    expect((await declare(DEVICE_A, person.id, "cash")).status).toBe(201);
    const row = (await reception()).find((r) => r.person.id === person.id)!;
    expect(row.record).toMatchObject({ paymentStatus: "awaiting_confirmation", amount: 2500 });
    expect(row.person).toMatchObject({ tierUndecided: true, selfEntered: true });
  });

  it("名簿ありのイベントでは 409 CHECK_IN_MODE_MISMATCH、止めたリンクでは 410。名前や媒体がおかしいと 400", async () => {
    const plain = await createCollectEvent(app, "o1");
    const plainToken = await selfToken(app, "o1", plain.id);
    expect(await errorOf(await enter(DEVICE_A, entryBody("松本"), plainToken))).toEqual([409, "CHECK_IN_MODE_MISMATCH"]);
    expect(await errorOf(await enter(DEVICE_A, entryBody("  "), token))).toEqual([400, "VALIDATION_FAILED"]);
    expect(await errorOf(await enter(DEVICE_A, entryBody("松本", { media: "twitter" })))).toEqual([400, "VALIDATION_FAILED"]);
    await call(app, "POST", `/api/collect/events/${event.id}/self-link/stop`, { user: "o1" });
    expect(await errorOf(await enter(DEVICE_A, entryBody("松本")))).toEqual([410, "LINK_INACTIVE"]);
  });

  it("参加者の応答に、ほかの名簿の人の名前・人数は出ない", async () => {
    await enterOk(DEVICE_A, "松本 れい");
    const res = await enter(DEVICE_B, entryBody("井上 そら"));
    const text = await res.text();
    expect(text).not.toContain("松本");
    const info = await (await call(app, "GET", `/api/collect/s/${token}`)).text();
    expect(info).not.toContain("松本");
    expect(info).not.toContain("井上");
  });
});

describe("User Story 2：受付をする人が区分を決めて受け取る", () => {
  it("区分が未定の人の確かめは区分が要る（主催者・手伝う人とも 400 TIER_REQUIRED）。選ぶとその金額で支払い済みになり、名簿の区分も決まる", async () => {
    const person = await enterOk(DEVICE_A, "松本 れい");
    await declare(DEVICE_A, person.id, "cash");
    expect((await reception()).length).toBe(1);
    expect(await errorOf(await call(app, "POST", `/api/collect/events/${event.id}/reception/${person.id}/confirm`, { user: "o1", body: {} }))).toEqual([400, "TIER_REQUIRED"]);
    expect(await errorOf(await asHelper("POST", `/reception/${person.id}/confirm`, {}))).toEqual([400, "TIER_REQUIRED"]);
    const res = await asHelper("POST", `/reception/${person.id}/confirm`, { priceTierId: tierId("通常") });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { record: { amount: number; paymentStatus: string } }).record).toMatchObject({ amount: 3000, paymentStatus: "paid" });
    expect((await roster())[0]).toMatchObject({ tierUndecided: false, priceTierId: tierId("通常") });
  });

  it("区分が1つのイベントでは、区分を選ばずに確かめられる", async () => {
    const { e, t } = await singleTierEvent();
    const person = await enterOk(DEVICE_A, "松本 れい", {}, t);
    await declare(DEVICE_A, person.id, "paypay", t);
    const res = await call(app, "POST", `/api/collect/events/${e.id}/reception/${person.id}/confirm`, { user: "o1", body: {} });
    expect(res.status).toBe(200);
  });

  it("振込の入金を確かめるときも区分が要り、一覧に区分を選ぶための区分が付く", async () => {
    const person = await enterOk(DEVICE_A, "松本 れい");
    await declare(DEVICE_A, person.id, "transfer_later");
    const list = (await (await call(app, "GET", "/api/collect/transfers", { user: "o1" })).json()) as {
      awaiting: { personId: string; tierUndecided: boolean; tiers: { name: string }[]; amount: number }[];
    };
    expect(list.awaiting[0]).toMatchObject({ personId: person.id, tierUndecided: true, amount: 2500 });
    expect(list.awaiting[0]!.tiers.map((t) => t.name)).toEqual(["通常", "早割", "招待"]);
    expect(await errorOf(await call(app, "POST", `/api/collect/transfers/${person.id}/confirm`, { user: "o1", body: {} }))).toEqual([400, "TIER_REQUIRED"]);
    const res = await call(app, "POST", `/api/collect/transfers/${person.id}/confirm`, { user: "o1", body: { priceTierId: tierId("通常") } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ amount: 3000, tierUndecided: false, tiers: [] });
    expect((await roster())[0]).toMatchObject({ tierUndecided: false, priceTierId: tierId("通常") });
  });

  it("受付をする人がその場で現金・PayPay を記録するときも区分が要る。主催者が名簿の区分を直すと未定でなくなる", async () => {
    const a = await enterOk(DEVICE_A, "松本 れい");
    const b = await enterOk(DEVICE_A, "井上 そら");
    const record = (personId: string, body: object) =>
      call(app, "PUT", `/api/collect/events/${event.id}/reception/${personId}`, { user: "o1", body: { method: "cash", clientRequestId: crypto.randomUUID(), ...body } });
    expect(await errorOf(await record(a.id, {}))).toEqual([400, "TIER_REQUIRED"]);
    expect((await record(a.id, { priceTierId: tierId("早割") })).status).toBe(201);
    expect((await roster()).find((p) => p.id === a.id)).toMatchObject({ tierUndecided: false, priceTierId: tierId("早割") });
    await call(app, "PATCH", `/api/collect/events/${event.id}/roster/${b.id}`, { user: "o1", body: { priceTierId: tierId("通常") } });
    expect((await roster()).find((p) => p.id === b.id)).toMatchObject({ tierUndecided: false });
  });

  it("確かめ待ちの仮の金額は現金の合計に入らず、振込待ちは見込みに仮の金額（0円を除いた最も安い区分）で入る", async () => {
    const a = await enterOk(DEVICE_A, "松本 れい");
    await declare(DEVICE_A, a.id, "cash");
    const stats = ((await (await call(app, "GET", `/api/collect/events/${event.id}/reception`, { user: "o1" })).json()) as { stats: { cash: number } }).stats;
    expect(stats.cash).toBe(0);
    const b = await enterOk(DEVICE_B, "井上 そら");
    await declare(DEVICE_B, b.id, "transfer_later");
    const sharing = (await (await call(app, "GET", `/api/collect/events/${event.id}/sharing`, { user: "o1" })).json()) as { current: { amount: number }; projected: { amount: number } };
    expect(sharing).toMatchObject({ current: { amount: 0 }, projected: { amount: 2500 } });
  });
});

describe("User Story 3：受付のしかたと締め", () => {
  it("名簿なしの締めは来なかった人を出さず、受付の記録がない人の数を出す。CSV の区分は未定の人を「未定」にする", async () => {
    const a = await enterOk(DEVICE_A, "松本 れい");
    await declare(DEVICE_A, a.id, "cash");
    await call(app, "POST", `/api/collect/events/${event.id}/reception/${a.id}/confirm`, { user: "o1", body: { priceTierId: tierId("通常") } });
    await enterOk(DEVICE_B, "井上 そら");
    const closing = (await (await call(app, "GET", `/api/collect/events/${event.id}/closing`, { user: "o1" })).json()) as { checkInMode: string; absent: unknown[]; unrecordedCount: number };
    expect(closing).toMatchObject({ checkInMode: "rosterless", absent: [], unrecordedCount: 1 });
    const csv = await (await call(app, "GET", `/api/collect/events/${event.id}/export.csv`, { user: "o1" })).text();
    const lines = csv.split("\n");
    expect(lines.find((l) => l.includes("井上 そら"))).toContain("未定");
    expect(lines.find((l) => l.includes("松本 れい"))).toContain("通常");
  });

  it("名簿ありに変えると、参加者の画面は探す形に戻り、入口は 409。名簿と記録は変わらない", async () => {
    await enterOk(DEVICE_A, "松本 れい");
    await call(app, "PATCH", `/api/collect/events/${event.id}`, { user: "o1", body: { checkInMode: "roster" } });
    const info = (await (await call(app, "GET", `/api/collect/s/${token}`)).json()) as { checkInMode: string; media: unknown[]; tiers: unknown[] };
    expect(info).toMatchObject({ checkInMode: "roster", media: [], tiers: [] });
    expect(await errorOf(await enter(DEVICE_B, entryBody("井上")))).toEqual([409, "CHECK_IN_MODE_MISMATCH"]);
    expect(await roster()).toHaveLength(1);
    const closing = (await (await call(app, "GET", `/api/collect/events/${event.id}/closing`, { user: "o1" })).json()) as { absent: unknown[] };
    expect(closing.absent).toHaveLength(1);
  });
});

describe("User Story 4：同じ名前・先に入れた人・外す・上限", () => {
  it("別の端末から同じ名前（ひらがなとカタカナ・空白の違い）が入ると、両方の行に同じ名前の知らせ。名簿ありでは出さない", async () => {
    const a = await enterOk(DEVICE_A, "松本 れい");
    const b = await enterOk(DEVICE_B, "松本　レイ");
    expect(b.number).toBe(2);
    const rows = await reception();
    expect(rows.filter((r) => r.person.sameName).map((r) => r.person.id).sort()).toEqual([a.id, b.id].sort());

    const plain = await createCollectEvent(app, "o1");
    for (const name of ["井上 そら", "井上 そら"]) {
      await call(app, "POST", `/api/collect/events/${plain.id}/roster`, { user: "o1", body: { name, media: "peatix", priceTierId: plain.tiers[0]!.id } });
    }
    expect((await reception(plain)).every((r) => !r.person.sameName)).toBe(true);
  });

  it("主催者が先に入れた未受付の人と名前が一致すれば、その人に当てる（人数は増えず、紹介した人が空なら埋まる）", async () => {
    const pre = ((await (await call(app, "POST", `/api/collect/events/${event.id}/roster`, { user: "o1", body: { name: "井上 そら", media: "minato", priceTierId: tierId("招待") } })).json()) as { person: RosterPerson }).person;
    const person = await enterOk(DEVICE_A, "井上そら", { referrer: "木村", media: "peatix" });
    expect(person).toMatchObject({ id: pre.id, tierName: "招待", amount: 0, tierUndecided: false });
    expect(await roster()).toEqual([expect.objectContaining({ id: pre.id, media: "minato", referrer: "木村", selfEntered: false })]);
    const me = (await (await asParticipant(app, "GET", `/api/collect/s/${token}/me`, DEVICE_A)).json()) as { request: { status: string } };
    expect(me.request.status).toBe("matched");
  });

  it("一致した人が受付済み・名簿なしで入った人どうしのときは当てず、新しい人として入る", async () => {
    const pre = ((await (await call(app, "POST", `/api/collect/events/${event.id}/roster`, { user: "o1", body: { name: "井上 そら", media: "minato", priceTierId: tierId("通常") } })).json()) as { person: RosterPerson }).person;
    await call(app, "PUT", `/api/collect/events/${event.id}/reception/${pre.id}`, { user: "o1", body: { method: "cash", clientRequestId: crypto.randomUUID() } });
    expect((await enterOk(DEVICE_A, "井上 そら")).id).not.toBe(pre.id);
    const first = await enterOk(DEVICE_A, "佐藤");
    expect((await enterOk(DEVICE_B, "佐藤")).id).not.toBe(first.id);
    expect(await roster()).toHaveLength(4);
  });

  it("名簿なしで入った人で記録がなければ、主催者も手伝う人も名簿から外せる。記録があれば 409、名簿なしで入っていない人は 404", async () => {
    const a = await enterOk(DEVICE_A, "松本 れい");
    const b = await enterOk(DEVICE_B, "松本 れい");
    expect((await call(app, "DELETE", `/api/collect/events/${event.id}/reception/${a.id}/entry`, { user: "o1" })).status).toBe(200);
    const me = (await (await asParticipant(app, "GET", `/api/collect/s/${token}/me`, DEVICE_A)).json()) as { request: { person: unknown } };
    expect(me.request.person).toBeNull();
    await declare(DEVICE_B, b.id, "cash");
    expect(await errorOf(await asHelper("DELETE", `/reception/${b.id}/entry`))).toEqual([409, "ALREADY_RECORDED"]);
    await call(app, "DELETE", `/api/collect/events/${event.id}/reception/${b.id}`, { user: "o1" });
    expect((await asHelper("DELETE", `/reception/${b.id}/entry`)).status).toBe(200);
    expect(await roster()).toHaveLength(0);
    const pre = ((await (await call(app, "POST", `/api/collect/events/${event.id}/roster`, { user: "o1", body: { name: "木村", media: "minato", priceTierId: tierId("通常") } })).json()) as { person: RosterPerson }).person;
    expect(await errorOf(await asHelper("DELETE", `/reception/${pre.id}/entry`))).toEqual([404, "ITEM_NOT_FOUND"]);
  });

  it(`1つの端末から入れられるのは ${SELF_CHECK_IN_LIMITS.entriesPerDevicePerLink} 人まで（次は 429 RATE_LIMITED）`, async () => {
    for (let i = 1; i <= SELF_CHECK_IN_LIMITS.entriesPerDevicePerLink; i += 1) await enterOk(DEVICE_A, `参加者${i}`);
    expect(await errorOf(await enter(DEVICE_A, entryBody("もう1人")))).toEqual([429, "RATE_LIMITED"]);
    expect((await enter(DEVICE_B, entryBody("別の端末"))).status).toBe(201);
  });
});
