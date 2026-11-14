// 運営メンバーの招待と、つながった運営メンバーが見る分配（specs/collect/003-revenue-sharing User Story 5、FR-050〜FR-056、tasks.md T016）。
import { neon } from "@neondatabase/serverless";
import { beforeEach, describe, expect, it } from "vitest";
import { onUserWithdrawn } from "../../../src/apps/collect/inbox/received-events";
import { call, makeApp, resetDb, testEnv } from "../../helpers/app";
import { collectUserId, createCollectEvent, errorOf, grantCollect, type EventBody } from "../../helpers/collect";

const app = makeApp();
let event: EventBody;
let kimura: string;

const path = (rest = "") => `/api/collect/events/${event.id}${rest}`;
const invite = async (memberId = kimura) => {
  const res = await call(app, "POST", path(`/members/${memberId}/invite`), { user: "o1" });
  return { res, body: (await res.clone().json()) as { url: string; expiresAt: string } };
};
const tokenOf = (url: string) => url.split("/collect/join/")[1]!;
const accept = (token: string, user = "m1") => call(app, "POST", `/api/collect/invites/${token}/accept`, { user });

beforeEach(async () => {
  await resetDb();
  await grantCollect(app, "o1");
  event = await createCollectEvent(app, "o1");
  const res = await call(app, "POST", path("/roster"), { user: "o1", body: { name: "参加者 太郎", media: "peatix", priceTierId: event.tiers[0]!.id, referrer: "井上" } });
  const personId = ((await res.json()) as { person: { id: string } }).person.id;
  await call(app, "PUT", path(`/reception/${personId}`), { user: "o1", body: { method: "cash", clientRequestId: crypto.randomUUID() } });
  const snap = (await (await call(app, "POST", path("/members"), { user: "o1", body: { name: "木村", role: "member" } })).json()) as { members: { id: string }[] };
  kimura = snap.members[1]!.id;
});

describe("招待のリンク", () => {
  it("出すとリンクと7日の期限。分配の画面には期限だけが出る。出し直すと前のリンクは使えない", async () => {
    const { res, body } = await invite();
    expect(res.status).toBe(201);
    expect(body.url).toMatch(/\/collect\/join\/ci_[A-Za-z0-9_-]{43}$/);
    expect(new Date(body.expiresAt).getTime() - Date.now()).toBeGreaterThan(6.9 * 24 * 3600_000);
    const snap = (await (await call(app, "GET", path("/sharing"), { user: "o1" })).json()) as { members: { invite: unknown }[] };
    expect(snap.members[1]!.invite).toEqual({ expiresAt: body.expiresAt });
    const again = await invite();
    expect(await errorOf(await call(app, "GET", `/api/collect/invites/${tokenOf(body.url)}`, { user: "m1" }))).toEqual([404, "INVITE_INACTIVE"]);
    expect((await call(app, "GET", `/api/collect/invites/${tokenOf(again.body.url)}`, { user: "m1" })).status).toBe(200);
  });

  it("止める・期限が過ぎたリンクは使えない。主催者の行には出せない", async () => {
    const { body } = await invite();
    await call(app, "DELETE", path(`/members/${kimura}/invite`), { user: "o1" });
    expect(await errorOf(await accept(tokenOf(body.url)))).toEqual([404, "INVITE_INACTIVE"]);
    const second = await invite();
    await neon(testEnv.DATABASE_URL)`UPDATE collect.sharing_invites SET expires_at = now() - interval '1 minute'`;
    expect(await errorOf(await accept(tokenOf(second.body.url)))).toEqual([404, "INVITE_INACTIVE"]);
    const snap = (await (await call(app, "GET", path("/sharing"), { user: "o1" })).json()) as { members: { id: string; invite: unknown }[] };
    expect(snap.members[1]!.invite).toBeNull();
    expect(await errorOf((await invite(snap.members[0]!.id)).res)).toEqual([409, "ALREADY_LINKED"]);
  });
});

describe("招待を受ける", () => {
  it("中身を見て受ける（集金管理の利用の許可はいらない）。受けたリンクはもう使えない。主催者の画面に「つながった」", async () => {
    const { body } = await invite();
    const token = tokenOf(body.url);
    const info = await call(app, "GET", `/api/collect/invites/${token}`, { user: "m1" });
    expect(await info.json()).toEqual({ event: { name: "IT交流会", startsAt: "2026-11-20T10:00:00.000Z" }, memberName: "木村", ownerIsYou: false, alreadyLinked: false });
    const res = await accept(token);
    expect(await res.json()).toEqual({ eventId: event.id });
    expect(await errorOf(await accept(token, "m2"))).toEqual([404, "INVITE_INACTIVE"]);
    const snap = (await (await call(app, "GET", path("/sharing"), { user: "o1" })).json()) as { members: { linked: boolean; invite: unknown }[] };
    expect(snap.members[1]).toMatchObject({ linked: true, invite: null });
    // つながった人には招待を出せない
    expect(await errorOf((await invite()).res)).toEqual([409, "ALREADY_LINKED"]);
  });

  it("主催者自身は受けられない。同じイベントでつながっている人は、別の運営メンバーの招待を受けられない", async () => {
    const { body } = await invite();
    const info = (await (await call(app, "GET", `/api/collect/invites/${tokenOf(body.url)}`, { user: "o1" })).json()) as { ownerIsYou: boolean };
    expect(info.ownerIsYou).toBe(true);
    expect(await errorOf(await accept(tokenOf(body.url), "o1"))).toEqual([409, "ALREADY_LINKED"]);
    await accept(tokenOf(body.url), "m1");
    const snap = (await (await call(app, "POST", path("/members"), { user: "o1", body: { name: "佐藤", role: "member" } })).json()) as { members: { id: string }[] };
    const sato = await invite(snap.members[2]!.id);
    const info2 = (await (await call(app, "GET", `/api/collect/invites/${tokenOf(sato.body.url)}`, { user: "m1" })).json()) as { alreadyLinked: boolean };
    expect(info2.alreadyLinked).toBe(true);
    expect(await errorOf(await accept(tokenOf(sato.body.url), "m1"))).toEqual([409, "ALREADY_LINKED"]);
  });

  it("ログインしていなければ 401", async () => {
    const { body } = await invite();
    expect((await call(app, "POST", `/api/collect/invites/${tokenOf(body.url)}/accept`, {})).status).toBe(401);
  });
});

describe("つながった運営メンバー", () => {
  it("一覧と分配を読むだけで見られる。名簿・参加者の名前・紹介した人は返さない", async () => {
    await accept(tokenOf((await invite()).body.url));
    const list = (await (await call(app, "GET", "/api/collect/shares", { user: "m1" })).json()) as { events: unknown[] };
    // 売上 3,000円・2人（リーダー1.2倍）：主催者 floor(3000×12/20)=1800、木村 1200
    expect(list.events).toEqual([{ eventId: event.id, name: "IT交流会", startsAt: "2026-11-20T10:00:00.000Z", memberName: "木村", total: 1200, deficit: false }]);
    const res = await call(app, "GET", `/api/collect/shares/${event.id}`, { user: "m1" });
    expect(res.status).toBe(200);
    const text = await res.text();
    const view = JSON.parse(text) as { you: string; members: Record<string, unknown>[]; revenue: { paid: number } };
    expect(view.you).toBe(kimura);
    expect(view.revenue.paid).toBe(3000);
    expect(view.members[0]).not.toHaveProperty("invite");
    expect(text).not.toContain("参加者 太郎");
    expect(text).not.toContain("井上");
    // 主催者の一覧には、自分のイベントは出ない（主催者の画面で見る）
    await grantCollect(app, "o1");
    expect(((await (await call(app, "GET", "/api/collect/shares", { user: "o1" })).json()) as { events: unknown[] }).events).toEqual([]);
  });

  it("つながっていない人・つながりを外した人・運営メンバーを消した人は 404。経費や傾斜を変えると新しい額", async () => {
    await accept(tokenOf((await invite()).body.url));
    expect(await errorOf(await call(app, "GET", `/api/collect/shares/${event.id}`, { user: "m2" }))).toEqual([404, "ITEM_NOT_FOUND"]);
    await call(app, "POST", path("/expenses"), { user: "o1", body: { name: "会場費", amount: 1000 } });
    const view = (await (await call(app, "GET", `/api/collect/shares/${event.id}`, { user: "m1" })).json()) as { current: { amount: number } };
    expect(view.current.amount).toBe(2000);
    await call(app, "DELETE", path(`/members/${kimura}/link`), { user: "o1" });
    expect((await call(app, "GET", `/api/collect/shares/${event.id}`, { user: "m1" })).status).toBe(404);
    await accept(tokenOf((await invite()).body.url));
    await call(app, "DELETE", path(`/members/${kimura}`), { user: "o1" });
    expect((await call(app, "GET", `/api/collect/shares/${event.id}`, { user: "m1" })).status).toBe(404);
  });

  it("退会したら、つながりだけ外れる（運営メンバーは名前で残る）", async () => {
    await accept(tokenOf((await invite()).body.url));
    const userId = await collectUserId(app, "m1");
    await onUserWithdrawn({ id: crypto.randomUUID(), type: "user.withdrawn", payload: { userId }, createdAt: new Date() }, testEnv);
    const snap = (await (await call(app, "GET", path("/sharing"), { user: "o1" })).json()) as { members: { name: string; linked: boolean }[] };
    expect(snap.members[1]).toMatchObject({ name: "木村", linked: false });
  });
});
