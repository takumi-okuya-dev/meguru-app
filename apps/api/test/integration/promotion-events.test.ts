// 宣伝内容のイベントの情報を、出来事でほかのアプリに伝える（specs/collect/001-event-day-collection contracts/events.md 2、docs/module-map.md 1-4）。
// 受け取りは集金管理が登録する。ここでは仮の受け取りを登録して、Threads が書く出来事の中身を確かめる。
import { beforeEach, describe, expect, it } from "vitest";
import { registerConsumer, resetConsumers, type PlatformEvent } from "../../src/platform/events/events";
import { call, createUserWithAccount, makeApp, resetDb } from "../helpers/app";

const app = makeApp();
const received: PlatformEvent[] = [];

const EVENT = { startAt: "2026-11-25T19:00", endAt: "2026-11-25T22:00", format: "venue", venueName: "バー SHITEN", prefecture: "東京都", capacity: 25, feeYen: 5000, feeNote: "学生は3,000円" };

/**
 * 仮の受け取りを登録する（受け取った出来事を集める）。
 */
function listen() {
  for (const type of ["threads.promotion_event.saved", "threads.promotion_event.deleted", "threads.listing_status.changed"] as const) {
    registerConsumer("collect", type, async (e) => {
      received.push(e as PlatformEvent);
    });
  }
}

beforeEach(async () => {
  await resetDb();
  received.length = 0;
});

const base = (accountId: string) => `/api/threads/accounts/${accountId}`;
const createPromotion = async (accountId: string, body: Record<string, unknown>) => {
  const res = await call(app, "POST", `${base(accountId)}/promotions`, { user: "u1", body: { title: "IT交流会", content: "ゆるく繋がる会です", ...body } });
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()) as { id: string; version: number };
};

describe("宣伝内容のイベントの情報の出来事", () => {
  it("イベントの情報があれば「保存した」を書き、書いた直後に届ける（開始は日本時間を時差つきに。持ち主の番号つき）", async () => {
    listen();
    const { userId, accountId } = await createUserWithAccount("u1");
    const p = await createPromotion(accountId, { event: EVENT });
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      type: "threads.promotion_event.saved",
      payload: {
        promotionId: p.id,
        threadsAccountId: accountId,
        ownerUserId: userId,
        name: "IT交流会",
        startsAt: "2026-11-25T10:00:00.000Z",
        endsAt: "2026-11-25T13:00:00.000Z",
        venue: "バー SHITEN",
        capacity: 25,
        feeAmount: 5000,
        feeNote: "学生は3,000円",
      },
    });
    // 本文やターゲットは入れない
    expect(JSON.stringify(received[0]!.payload)).not.toContain("ゆるく繋がる会です");
  });

  it("イベントの情報のない宣伝内容は何も書かない。あとでイベントの情報を消したら「消した」", async () => {
    listen();
    const { accountId } = await createUserWithAccount("u1");
    const plain = await createPromotion(accountId, {});
    expect(received).toHaveLength(0);
    const p = await createPromotion(accountId, { event: EVENT });
    const put = await call(app, "PUT", `${base(accountId)}/promotions/${p.id}`, {
      user: "u1",
      body: { title: "IT交流会", content: "ゆるく繋がる会です", event: null, expectedVersion: p.version },
    });
    expect(put.status, await put.clone().text()).toBe(200);
    expect(received.map((e) => e.type)).toEqual(["threads.promotion_event.saved", "threads.promotion_event.deleted"]);
    expect(received[1]!.payload).toMatchObject({ promotionId: p.id });
    // イベントの情報のない宣伝内容を直しても何も書かない
    await call(app, "PUT", `${base(accountId)}/promotions/${plain.id}`, { user: "u1", body: { title: "勉強会", content: "本文", expectedVersion: plain.version } });
    expect(received).toHaveLength(2);
  });

  it("宣伝内容を消すと「消した」。アカウントを消すと、イベントの情報のある宣伝内容ごとに「消した」", async () => {
    listen();
    const { accountId } = await createUserWithAccount("u1", { name: "テストのアカウント" });
    const a = await createPromotion(accountId, { event: EVENT });
    const b = await createPromotion(accountId, { event: EVENT, title: "勉強会" });
    await createPromotion(accountId, {});
    expect((await call(app, "DELETE", `${base(accountId)}/promotions/${a.id}`, { user: "u1" })).status).toBe(204);
    expect(received.at(-1)).toMatchObject({ type: "threads.promotion_event.deleted", payload: { promotionId: a.id } });
    received.length = 0;
    expect((await call(app, "DELETE", base(accountId), { user: "u1", body: { confirmName: "テストのアカウント" } })).status).toBe(204);
    expect(received.map((e) => [e.type, (e.payload as { promotionId: string }).promotionId])).toEqual([["threads.promotion_event.deleted", b.id]]);
  });

  it("掲載の状況を変えると、掲載済みの媒体の一覧を書く（Threads の媒体の名前のまま）", async () => {
    listen();
    const { accountId } = await createUserWithAccount("u1");
    const p = await createPromotion(accountId, { event: EVENT });
    received.length = 0;
    const listing = (media: string) => `${base(accountId)}/external-media/${p.id}/${media}`;
    const gen = await call(app, "POST", `${listing("peatix")}/generate`, { user: "u1", body: { expectedVersion: null } });
    expect(gen.status, await gen.clone().text()).toBe(200);
    const d = (await gen.json()) as { listing: { version: number } };
    // 欄を直すだけ（状況は変えない）なら書かない
    expect(received).toHaveLength(0);
    const put = await call(app, "PUT", listing("peatix"), { user: "u1", body: { expectedVersion: d.listing.version, status: "posted", postedUrl: "https://peatix.com/event/1" } });
    expect(put.status, await put.clone().text()).toBe(200);
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ type: "threads.listing_status.changed", payload: { promotionId: p.id, postedMedia: ["peatix"] } });
  });

  // 最後に置く（受け取りの登録をすべて消すため）
  it("受け取るアプリがなければ、何も書かずに宣伝内容は保存できる", async () => {
    resetConsumers();
    const { accountId } = await createUserWithAccount("u1");
    await createPromotion(accountId, { event: EVENT });
    expect(received).toHaveLength(0);
  });
});
