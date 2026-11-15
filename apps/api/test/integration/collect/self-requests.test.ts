// セルフ受付：名簿にいない人の申し出（specs/collect/002-self-check-in User Story 4、FR-020〜FR-023、tasks.md T014）。
import { beforeEach, describe, expect, it } from "vitest";
import { call, makeApp, resetDb } from "../../helpers/app";
import { asParticipant, createCollectEvent, errorOf, grantCollect, selfToken, type EventBody } from "../../helpers/collect";

const app = makeApp();
let event: EventBody;
let token: string;
let personId: string;
const DEVICE = "44444444-4444-4444-8444-444444444444";
const device = (i: number) => `55555555-5555-4555-8555-${String(i).padStart(12, "0")}`;

const request = (name: string, d = DEVICE, kana?: string) => asParticipant(app, "POST", `/api/collect/s/${token}/requests`, d, { name, ...(kana ? { kana } : {}) });
const me = async (d = DEVICE) =>
  (await (await asParticipant(app, "GET", `/api/collect/s/${token}/me`, d)).json()) as {
    request: { id: string; status: string; person: { id: string; number: number; name: string } | null } | null;
  };
const resolve = (requestId: string, action: string, body?: object) =>
  call(app, "POST", `/api/collect/events/${event.id}/self-requests/${requestId}/${action}`, { user: "o1", ...(body ? { body } : {}) });
const snapshot = async () =>
  (await (await call(app, "GET", `/api/collect/events/${event.id}/reception`, { user: "o1" })).json()) as {
    people: { person: { id: string; number: number; name: string; media: string } }[];
    selfRequests: { id: string; name: string; kana: string | null }[];
  };

beforeEach(async () => {
  await resetDb();
  await grantCollect(app, "o1");
  event = await createCollectEvent(app, "o1");
  const res = await call(app, "POST", `/api/collect/events/${event.id}/roster`, { user: "o1", body: { name: "松本", media: "peatix", priceTierId: event.tiers[0]!.id } });
  personId = ((await res.json()) as { person: { id: string } }).person.id;
  token = await selfToken(app, "o1", event.id);
});

describe("申し出る", () => {
  it("受付の画面に待ちの申し出が出る。参加者の状態は待ち", async () => {
    const res = await request("飛び入り 花子", DEVICE, "とびいり はなこ");
    expect(res.status).toBe(201);
    const { requestId } = (await res.json()) as { requestId: string };
    expect((await snapshot()).selfRequests).toEqual([{ id: requestId, name: "飛び入り 花子", kana: "とびいり はなこ", createdAt: expect.any(String) }]);
    expect((await me()).request).toEqual({ id: requestId, status: "pending", person: null });
  });

  it("1つの端末が待てるのは1件（409）。リンク全体で待ちは30件まで（429）。名前がなければ 400", async () => {
    await request("a");
    expect(await errorOf(await request("b"))).toEqual([409, "REQUEST_PENDING"]);
    for (let i = 1; i < 30; i++) expect((await request(`人${i}`, device(i))).status).toBe(201);
    expect(await errorOf(await request("31人め", device(99)))).toEqual([429, "RATE_LIMITED"]);
    expect((await request("  ", device(100))).status).toBe(400);
  });
});

describe("片付ける", () => {
  it("名簿に入れる：次の受付番号・媒体「当日」・最初の区分。参加者の状態に名簿の人が出て、申告できる", async () => {
    const { requestId } = (await (await request("飛び入り 花子")).json()) as { requestId: string };
    const res = await resolve(requestId, "accept");
    expect(res.status).toBe(200);
    const { person } = (await res.json()) as { person: { id: string; number: number; media: string; priceTierId: string } };
    expect(person).toMatchObject({ number: 2, media: "walk_in", priceTierId: event.tiers[0]!.id });
    const s = await snapshot();
    expect(s.selfRequests).toEqual([]);
    expect(s.people.map((p) => p.person.name)).toContain("飛び入り 花子");
    expect((await me()).request).toMatchObject({ status: "accepted", person: { id: person.id, number: 2, name: "飛び入り 花子" } });
    const declared = await asParticipant(app, "POST", `/api/collect/s/${token}/declare`, DEVICE, { personId: person.id, method: "cash", clientRequestId: crypto.randomUUID() });
    expect(declared.status).toBe(201);
    // 片付けたので、もう1件申し出られる
    expect((await request("もう1人")).status).toBe(201);
  });

  it("名簿の人に当てる・断る。片付けた申し出は 409。ほかのイベントの人には当てられない（400）", async () => {
    const a = ((await (await request("まつもと")).json()) as { requestId: string }).requestId;
    expect(await errorOf(await resolve(a, "match", { personId: crypto.randomUUID() }))).toEqual([400, "VALIDATION_FAILED"]);
    expect((await resolve(a, "match", { personId })).status).toBe(200);
    expect((await me()).request).toMatchObject({ status: "matched", person: { id: personId } });
    expect(await errorOf(await resolve(a, "reject"))).toEqual([409, "REQUEST_RESOLVED"]);
    const b = ((await (await request("いたずら", device(1))).json()) as { requestId: string }).requestId;
    expect((await resolve(b, "reject")).status).toBe(200);
    expect((await me(device(1))).request).toMatchObject({ status: "rejected", person: null });
    expect(await errorOf(await resolve(crypto.randomUUID(), "accept"))).toEqual([404, "ITEM_NOT_FOUND"]);
  });

  it("手伝う人も片付けられる。ほかの主催者は片付けられない", async () => {
    const link = ((await (await call(app, "POST", `/api/collect/events/${event.id}/link`, { user: "o1" })).json()) as { link: { url: string } }).link;
    const helperToken = link.url.split("/collect/r/")[1]!;
    const helper = (await (await call(app, "POST", `/api/collect/r/${helperToken}/join`, { body: { name: "井上" } })).json()) as { deviceSecret: string };
    const id = ((await (await request("飛び入り")).json()) as { requestId: string }).requestId;
    await grantCollect(app, "o2");
    expect((await call(app, "POST", `/api/collect/events/${event.id}/self-requests/${id}/accept`, { user: "o2" })).status).toBe(404);
    const res = await call(app, "POST", `/api/collect/r/${helperToken}/self-requests/${id}/accept`, { headers: { "X-Collect-Device": helper.deviceSecret } });
    expect(res.status).toBe(200);
  });

  it("止めたリンクでは申し出られない（410）", async () => {
    await call(app, "POST", `/api/collect/events/${event.id}/self-link/stop`, { user: "o1" });
    expect(await errorOf(await request("遅れた人"))).toEqual([410, "LINK_INACTIVE"]);
  });
});
