// 受付の手伝い（specs/collect/001-event-day-collection contracts/api.md 5・8、FR-070〜FR-075、research.md R7、tasks.md T043）。
import { neon } from "@neondatabase/serverless";
import { beforeEach, describe, expect, it } from "vitest";
import { call, db, makeApp, resetDb, testEnv } from "../../helpers/app";
import { createCollectEvent, errorOf, grantCollect, type EventBody } from "../../helpers/collect";

const app = makeApp();
let event: EventBody;
let personId: string;

type Link = { url: string; expiresAt: string; stoppedAt: string | null };
const rid = () => crypto.randomUUID();
const tokenOf = (link: Link) => link.url.split("/collect/r/")[1]!;
const createLink = async (body?: object, eventId = event.id) =>
  ((await (await call(app, "POST", `/api/collect/events/${eventId}/link`, { user: "o1", ...(body ? { body } : {}) })).json()) as { link: Link }).link;
const join = (token: string, body: object) => call(app, "POST", `/api/collect/r/${token}/join`, { body });
const asHelper = (token: string, device: string, method: string, path: string, body?: object) =>
  call(app, method, `/api/collect/r/${token}${path}`, { headers: { "X-Collect-Device": device }, ...(body ? { body } : {}) });
const joined = async (token: string, name: string, extra: object = {}) =>
  (await (await join(token, { name, ...extra })).json()) as { helperId: string; deviceSecret: string };

beforeEach(async () => {
  await resetDb();
  await grantCollect(app, "o1");
  // 19:00〜翌1:00（日本時間）のイベント
  event = await createCollectEvent(app, "o1", { startsAt: "2026-11-20T10:00:00.000Z", endsAt: "2026-11-20T16:00:00.000Z" });
  const res = await call(app, "POST", `/api/collect/events/${event.id}/roster`, {
    user: "o1",
    body: { name: "松本 れい", media: "peatix", priceTierId: event.tiers[0]!.id, memo: "紹介：井上さん" },
  });
  personId = ((await res.json()) as { person: { id: string } }).person.id;
});

describe("受付用リンク（主催者）", () => {
  it("出す：期限の既定は、開催日の日本時間23:59:59と終わりの1時間後の遅い方（翌2:00）。トークンはハッシュと暗号文で持つ", async () => {
    const link = await createLink();
    expect(link.url).toMatch(/^http:\/\/localhost:5173\/collect\/r\/cr_[A-Za-z0-9_-]{43}$/);
    expect(link.expiresAt).toBe("2026-11-20T17:00:00.000Z");
    expect(link.stoppedAt).toBeNull();
    db();
    const rows = (await neon(testEnv.DATABASE_URL)`SELECT token_hash FROM collect.reception_links`) as { token_hash: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token_hash).not.toContain(tokenOf(link));
    // 使えるリンクがあれば同じリンクを返す・GET でも同じ
    expect((await createLink()).url).toBe(link.url);
    const got = (await (await call(app, "GET", `/api/collect/events/${event.id}/link`, { user: "o1" })).json()) as { link: Link };
    expect(got.link?.url).toBe(link.url);
  });

  it("昼のイベントの期限は、開催日の日本時間23:59:59", async () => {
    const day = await createCollectEvent(app, "o1", { startsAt: "2026-11-21T01:00:00.000Z", endsAt: "2026-11-21T03:00:00.000Z" });
    expect((await createLink(undefined, day.id)).expiresAt).toBe("2026-11-21T14:59:59.000Z");
  });

  it("期限を変える・過去の期限は 400", async () => {
    await createLink();
    const res = await call(app, "PATCH", `/api/collect/events/${event.id}/link`, { user: "o1", body: { expiresAt: "2099-01-01T00:00:00.000Z" } });
    expect(((await res.json()) as { link: Link }).link.expiresAt).toBe("2099-01-01T00:00:00.000Z");
    expect(await errorOf(await call(app, "PATCH", `/api/collect/events/${event.id}/link`, { user: "o1", body: { expiresAt: "2000-01-01T00:00:00.000Z" } }))).toEqual([
      400,
      "VALIDATION_FAILED",
    ]);
  });

  it("止めると 410 LINK_INACTIVE で記録は残る。出し直すと前のトークンは使えない", async () => {
    const link = await createLink();
    const token = tokenOf(link);
    const h = await joined(token, "井上");
    expect((await asHelper(token, h.deviceSecret, "PUT", `/reception/${personId}`, { method: "cash", clientRequestId: rid() })).status).toBe(201);
    expect((await call(app, "POST", `/api/collect/events/${event.id}/link/stop`, { user: "o1" })).status).toBe(200);
    expect(await errorOf(await asHelper(token, h.deviceSecret, "GET", "/reception"))).toEqual([410, "LINK_INACTIVE"]);
    expect(((await (await call(app, "GET", `/api/collect/r/${token}`)).json()) as { status: string }).status).toBe("stopped");
    expect((await (await call(app, "GET", `/api/collect/events/${event.id}/link`, { user: "o1" })).json()) as { link: null }).toEqual({ link: null });
    const snap = (await (await call(app, "GET", `/api/collect/events/${event.id}/reception`, { user: "o1" })).json()) as { stats: { arrived: number } };
    expect(snap.stats.arrived).toBe(1);
    const next = await createLink();
    expect(next.url).not.toBe(link.url);
    expect(await errorOf(await join(token, { name: "木村" }))).toEqual([410, "LINK_INACTIVE"]);
    expect((await join(tokenOf(next), { name: "木村" })).status).toBe(201);
  });

  it("期限が過ぎたリンクは 410。出し直すと新しいリンクになる", async () => {
    const link = await createLink();
    db();
    await neon(testEnv.DATABASE_URL)`UPDATE collect.reception_links SET expires_at = now() - interval '1 minute'`;
    expect(((await (await call(app, "GET", `/api/collect/r/${tokenOf(link)}`)).json()) as { status: string }).status).toBe("expired");
    expect(await errorOf(await join(tokenOf(link), { name: "井上" }))).toEqual([410, "LINK_INACTIVE"]);
    expect((await createLink()).url).not.toBe(link.url);
  });

  it("ない・ほかの人のトークンは 404", async () => {
    expect(await errorOf(await call(app, "GET", "/api/collect/r/cr_nope"))).toEqual([404, "ITEM_NOT_FOUND"]);
    expect(await errorOf(await call(app, "GET", "/api/collect/r/whatever"))).toEqual([404, "ITEM_NOT_FOUND"]);
  });
});

describe("参加する（手伝う人）", () => {
  it("名前を入れると端末の印を返す。リンクを開いた画面にはイベントの名前と状態", async () => {
    const token = tokenOf(await createLink());
    const info = (await (await call(app, "GET", `/api/collect/r/${token}`)).json()) as { status: string; event: { name: string } };
    expect(info).toMatchObject({ status: "active", event: { name: "IT交流会" } });
    const res = await join(token, { name: "井上" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { helperId: string; deviceSecret: string };
    expect(body.deviceSecret).toMatch(/^cd_/);
    db();
    const devices = (await neon(testEnv.DATABASE_URL)`SELECT secret_hash FROM collect.helper_devices`) as { secret_hash: string }[];
    expect(devices[0]!.secret_hash).not.toBe(body.deviceSecret);
  });

  it("同じ名前は 409 HELPER_NAME_TAKEN。sameAsHelperId で同じ人に端末を足す・asNew で別の人", async () => {
    const token = tokenOf(await createLink());
    const first = await joined(token, "井上");
    const res = await join(token, { name: " 井上 " });
    expect(res.status).toBe(409);
    const err = (await res.json()) as { error: { code: string; helperId: string; joinedAt: string } };
    expect(err.error).toMatchObject({ code: "HELPER_NAME_TAKEN", helperId: first.helperId });
    const same = await joined(token, "井上", { sameAsHelperId: first.helperId });
    expect(same.helperId).toBe(first.helperId);
    expect(same.deviceSecret).not.toBe(first.deviceSecret);
    const other = await joined(token, "井上", { asNew: true });
    expect(other.helperId).not.toBe(first.helperId);
    // 名前の違う人を「同じ人」にはできない
    expect(await errorOf(await join(token, { name: "木村", sameAsHelperId: first.helperId }))).toEqual([400, "VALIDATION_FAILED"]);
    const workers = (await (await call(app, "GET", `/api/collect/events/${event.id}/helpers`, { user: "o1" })).json()) as {
      helpers: { id: string; deviceCount: number }[];
    };
    expect(workers.helpers.map((h) => h.deviceCount)).toEqual([2, 1]);
  });

  it("端末の印がない・合わない・ほかのリンクの印は 401 DEVICE_REQUIRED", async () => {
    const token = tokenOf(await createLink());
    const other = await createCollectEvent(app, "o1");
    const otherToken = tokenOf(await createLink(undefined, other.id));
    const h = await joined(otherToken, "井上");
    expect(await errorOf(await call(app, "GET", `/api/collect/r/${token}/reception`))).toEqual([401, "DEVICE_REQUIRED"]);
    expect(await errorOf(await asHelper(token, "cd_wrong", "GET", "/reception"))).toEqual([401, "DEVICE_REQUIRED"]);
    expect(await errorOf(await asHelper(token, h.deviceSecret, "GET", "/reception"))).toEqual([401, "DEVICE_REQUIRED"]);
  });
});

describe("手伝う人の受付", () => {
  it("記録は受け取った人＝手伝う人。スナップショットにメモが入らず、mine は自分の現金", async () => {
    const token = tokenOf(await createLink());
    const h = await joined(token, "井上");
    const res = await asHelper(token, h.deviceSecret, "PUT", `/reception/${personId}`, { method: "cash", clientRequestId: rid() });
    expect(((await res.json()) as { record: { receiverKind: string; receiverHelperId: string } }).record).toMatchObject({
      receiverKind: "helper",
      receiverHelperId: h.helperId,
    });
    const snap = (await (await asHelper(token, h.deviceSecret, "GET", "/reception")).json()) as {
      people: { person: Record<string, unknown> }[];
      stats: { mine: number; cash: number };
      helpers: { id: string; name: string }[];
    };
    expect("memo" in snap.people[0]!.person).toBe(false);
    expect(snap.stats).toMatchObject({ cash: 3000, mine: 3000 });
    expect(snap.helpers).toEqual([expect.objectContaining({ id: h.helperId, name: "井上" })]);
    const owner = (await (await call(app, "GET", `/api/collect/events/${event.id}/reception`, { user: "o1" })).json()) as { stats: { mine: number } };
    expect(owner.stats.mine).toBe(0);
  });

  it("ほかの人の記録の取り消しは 403 RECORD_NOT_YOURS。自分の記録は取り消せる。主催者はすべて取り消せる", async () => {
    const token = tokenOf(await createLink());
    const a = await joined(token, "井上");
    const b = await joined(token, "木村");
    const res = await call(app, "POST", `/api/collect/events/${event.id}/roster`, { user: "o1", body: { name: "井上 そら", media: "peatix", priceTierId: event.tiers[0]!.id } });
    const second = ((await res.json()) as { person: { id: string } }).person.id;
    await asHelper(token, a.deviceSecret, "PUT", `/reception/${personId}`, { method: "cash", clientRequestId: rid() });
    await call(app, "PUT", `/api/collect/events/${event.id}/reception/${second}`, { user: "o1", body: { method: "cash", clientRequestId: rid() } });
    expect(await errorOf(await asHelper(token, b.deviceSecret, "DELETE", `/reception/${personId}`))).toEqual([403, "RECORD_NOT_YOURS"]);
    expect(await errorOf(await asHelper(token, a.deviceSecret, "DELETE", `/reception/${second}`))).toEqual([403, "RECORD_NOT_YOURS"]);
    expect((await asHelper(token, a.deviceSecret, "DELETE", `/reception/${personId}`)).status).toBe(200);
    await asHelper(token, b.deviceSecret, "PUT", `/reception/${personId}`, { method: "paypay", clientRequestId: rid() });
    expect((await call(app, "DELETE", `/api/collect/events/${event.id}/reception/${personId}`, { user: "o1" })).status).toBe(200);
  });

  it("飛び入りは足した手伝う人を残す。QRの画像は主催者のもの", async () => {
    const token = tokenOf(await createLink());
    const h = await joined(token, "井上");
    const res = await asHelper(token, h.deviceSecret, "POST", "/walk-ins", { name: "飛び入り", clientRequestId: rid() });
    expect(res.status).toBe(201);
    db();
    const rows = (await neon(testEnv.DATABASE_URL)`SELECT added_by_helper_id FROM collect.roster_people WHERE media = 'walk_in'`) as { added_by_helper_id: string }[];
    expect(rows[0]!.added_by_helper_id).toBe(h.helperId);
    expect(await errorOf(await asHelper(token, h.deviceSecret, "GET", "/paypay-qr"))).toEqual([404, "ITEM_NOT_FOUND"]);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const put = await app.request(
      "/api/collect/settings/paypay-qr",
      { method: "PUT", headers: { Authorization: "Bearer test:o1", "Content-Type": "image/png" }, body: png },
      testEnv,
    );
    expect(put.status).toBe(200);
    const qr = await asHelper(token, h.deviceSecret, "GET", "/paypay-qr");
    expect(qr.status).toBe(200);
    expect(new Uint8Array(await qr.arrayBuffer())).toEqual(png);
  });

  it("受付をしている人の一覧：件数・受け取った現金・最後の記録と、主催者の行", async () => {
    const token = tokenOf(await createLink());
    const h = await joined(token, "井上");
    await asHelper(token, h.deviceSecret, "PUT", `/reception/${personId}`, { method: "cash", clientRequestId: rid() });
    const res = await call(app, "POST", `/api/collect/events/${event.id}/roster`, { user: "o1", body: { name: "井上 そら", media: "peatix", priceTierId: event.tiers[1]!.id } });
    const second = ((await res.json()) as { person: { id: string } }).person.id;
    await call(app, "PUT", `/api/collect/events/${event.id}/reception/${second}`, { user: "o1", body: { method: "paypay", clientRequestId: rid() } });
    const workers = (await (await call(app, "GET", `/api/collect/events/${event.id}/helpers`, { user: "o1" })).json()) as {
      owner: { recordCount: number; cashAmount: number; lastRecordedAt: string | null };
      helpers: { name: string; recordCount: number; cashAmount: number; deviceCount: number; lastRecordedAt: string | null }[];
    };
    expect(workers.owner).toMatchObject({ recordCount: 1, cashAmount: 0 });
    expect(workers.owner.lastRecordedAt).not.toBeNull();
    expect(workers.helpers).toEqual([expect.objectContaining({ name: "井上", recordCount: 1, cashAmount: 3000, deviceCount: 1 })]);
  });
});
