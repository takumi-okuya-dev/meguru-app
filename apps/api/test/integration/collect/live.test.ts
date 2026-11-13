// 会場の共有（specs/collect/001-event-day-collection contracts/realtime.md、research.md R4・R5、tasks.md T033）。
// 入場券の署名と期限、WebSocket につないだ画面への知らせ（Workers の中で Durable Object を動かす）。
import { beforeEach, describe, expect, it } from "vitest";
import { signLiveTicket } from "../../../src/apps/collect/live/live-ticket";
import { call, makeApp, resetDb, testEnv } from "../../helpers/app";
import { createCollectEvent, errorOf, grantCollect, type EventBody } from "../../helpers/collect";
import { TEST_COLLECT_LIVE_SECRET } from "../../env";

const app = makeApp();
let event: EventBody;
let personId: string;

type Message = { type: string; eventId: string; version: number; personId?: string; record?: { method: string }; person?: Record<string, unknown> };

/** つないだ画面。届いた知らせと、閉じた理由を集める。 */
type Screen = { messages: Message[]; closed: { code: number } | null; next: (type: string) => Promise<Message> };

/**
 * 入場券で WebSocket につなぐ。
 * @param ticket - 入場券
 * @returns つないだ画面
 */
async function connect(ticket: string): Promise<Screen> {
  const res = await call(app, "GET", `/api/collect/live?ticket=${encodeURIComponent(ticket)}`, { headers: { Upgrade: "websocket" } });
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  ws.accept();
  const screen: Screen = {
    messages: [],
    closed: null,
    next: (type) =>
      new Promise((resolve, reject) => {
        const started = Date.now();
        const tick = () => {
          const found = screen.messages.find((m) => m.type === type);
          if (found) return resolve(found);
          if (Date.now() - started > 3000) return reject(new Error(`no ${type}`));
          setTimeout(tick, 20);
        };
        tick();
      }),
  };
  ws.addEventListener("message", (e) => screen.messages.push(JSON.parse(e.data as string) as Message));
  ws.addEventListener("close", (e) => (screen.closed = { code: e.code }));
  return screen;
}

const ownerTicket = async (eventId = event.id) =>
  ((await (await call(app, "POST", `/api/collect/events/${eventId}/live-ticket`, { user: "o1" })).json()) as { ticket: string; expiresAt: string });

beforeEach(async () => {
  await resetDb();
  await grantCollect(app, "o1");
  event = await createCollectEvent(app, "o1");
  const res = await call(app, "POST", `/api/collect/events/${event.id}/roster`, { user: "o1", body: { name: "松本 れい", media: "peatix", priceTierId: event.tiers[0]!.id, memo: "秘密のメモ" } });
  personId = ((await res.json()) as { person: { id: string } }).person.id;
});

describe("入場券", () => {
  it("主催者の入場券は60秒。ほかの主催者のイベントは 404", async () => {
    const before = Date.now();
    const { ticket, expiresAt } = await ownerTicket();
    expect(ticket).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    const ms = new Date(expiresAt).getTime() - before;
    expect(ms).toBeGreaterThan(55_000);
    expect(ms).toBeLessThanOrEqual(61_000);
    await grantCollect(app, "o2");
    expect(await errorOf(await call(app, "POST", `/api/collect/events/${event.id}/live-ticket`, { user: "o2" }))).toEqual([404, "ITEM_NOT_FOUND"]);
  });

  it("署名が合わない・期限が過ぎた・ない入場券は 401。WebSocket でなければ 426", async () => {
    const { ticket } = await ownerTicket();
    const [body, sig] = ticket.split(".");
    const tampered = `${body}x.${sig}`;
    expect((await call(app, "GET", `/api/collect/live?ticket=${tampered}`, { headers: { Upgrade: "websocket" } })).status).toBe(401);
    const old = await signLiveTicket(TEST_COLLECT_LIVE_SECRET, event.id, "owner", new Date(Date.now() - 61_000));
    expect((await call(app, "GET", `/api/collect/live?ticket=${old.ticket}`, { headers: { Upgrade: "websocket" } })).status).toBe(401);
    const forged = await signLiveTicket("another-secret", event.id, "owner", new Date());
    expect((await call(app, "GET", `/api/collect/live?ticket=${forged.ticket}`, { headers: { Upgrade: "websocket" } })).status).toBe(401);
    expect((await call(app, "GET", "/api/collect/live", { headers: { Upgrade: "websocket" } })).status).toBe(401);
    expect((await call(app, "GET", `/api/collect/live?ticket=${ticket}`)).status).toBe(426);
  });

  it("秘密を入れていない間は、入場券の道筋だけ 503 CONFIG_ERROR（受付はできる）", async () => {
    const env = { ...testEnv, COLLECT_LIVE_SECRET: undefined };
    expect(await errorOf(await call(app, "POST", `/api/collect/events/${event.id}/live-ticket`, { user: "o1", env }))).toEqual([503, "CONFIG_ERROR"]);
    const put = await call(app, "PUT", `/api/collect/events/${event.id}/reception/${personId}`, { user: "o1", env, body: { method: "cash", clientRequestId: crypto.randomUUID() } });
    expect(put.status).toBe(201);
  });
});

describe("知らせ", () => {
  it("記録・取り消し・飛び入りのあと、つないだ2つの画面の両方に届く（version つき・メモなし）", async () => {
    const a = await connect((await ownerTicket()).ticket);
    const b = await connect((await ownerTicket()).ticket);
    const put = await call(app, "PUT", `/api/collect/events/${event.id}/reception/${personId}`, { user: "o1", body: { method: "paypay", clientRequestId: crypto.randomUUID() } });
    const { version } = (await put.json()) as { version: number };
    for (const s of [a, b]) {
      const m = await s.next("reception.recorded");
      expect(m).toMatchObject({ eventId: event.id, version, personId, record: { method: "paypay" } });
    }
    await call(app, "DELETE", `/api/collect/events/${event.id}/reception/${personId}`, { user: "o1" });
    expect((await a.next("reception.undone")).version).toBe(version + 1);
    await call(app, "POST", `/api/collect/events/${event.id}/walk-ins`, { user: "o1", body: { name: "飛び入り", clientRequestId: crypto.randomUUID() } });
    const walkIn = await b.next("roster.changed");
    expect(walkIn.person).toMatchObject({ name: "飛び入り", media: "walk_in" });
    // 名簿を直した知らせにも、メモは入れない
    await call(app, "PATCH", `/api/collect/events/${event.id}/roster/${personId}`, { user: "o1", body: { memo: "もっと秘密" } });
    await new Promise((r) => setTimeout(r, 100));
    expect(JSON.stringify(a.messages)).not.toContain("秘密");
  });

  it("手伝う人も入場券でつなげる。リンクを止めると link.stopped が届き、手伝う人の画面だけ閉じる", async () => {
    const link = ((await (await call(app, "POST", `/api/collect/events/${event.id}/link`, { user: "o1" })).json()) as { link: { url: string } }).link;
    const token = link.url.split("/collect/r/")[1]!;
    const owner = await connect((await ownerTicket()).ticket);
    const joined = await call(app, "POST", `/api/collect/r/${token}/join`, { body: { name: "井上" } });
    const { deviceSecret } = (await joined.json()) as { deviceSecret: string };
    expect((await owner.next("helpers.changed")) as unknown).toMatchObject({ helpers: [expect.objectContaining({ name: "井上" })] });
    const t = await call(app, "POST", `/api/collect/r/${token}/live-ticket`, { headers: { "X-Collect-Device": deviceSecret } });
    expect(t.status).toBe(200);
    const helper = await connect(((await t.json()) as { ticket: string }).ticket);
    await call(app, "POST", `/api/collect/events/${event.id}/link/stop`, { user: "o1" });
    await helper.next("link.stopped");
    await owner.next("link.stopped");
    await new Promise((r) => setTimeout(r, 200));
    expect(helper.closed?.code).toBe(4001);
    expect(owner.closed).toBeNull();
  });
});
