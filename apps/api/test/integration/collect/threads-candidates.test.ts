// Threads のイベントの候補（specs/collect/001-event-day-collection contracts/events.md 2・3、FR-060〜FR-064、research.md R15、tasks.md T073）。
// Threads が出す出来事を、共通の出来事の仕組み（emitEvent → deliverPendingEvents）で集金管理に届けて確かめる。
import { neon } from "@neondatabase/serverless";
import { beforeEach, describe, expect, it } from "vitest";
import { onUserWithdrawn } from "../../../src/apps/collect/inbox/received-events";
import { withTransaction } from "../../../src/kernel/db/client";
import { deliverPendingEvents, emitEvent, type PlatformEventPayloads } from "../../../src/platform/events/events";
import { call, db, makeApp, resetDb, testEnv } from "../../helpers/app";
import { EVENT_INPUT, errorOf, grantCollect } from "../../helpers/collect";

const app = makeApp();
let owner: string;
const PROMO = "11111111-1111-4111-8111-111111111111";

/**
 * Threads の出来事を書いて、すぐ届ける（Threads がすることと同じ）。
 * @param type - 種類
 * @param payload - 中身
 * @returns 出来事の番号
 */
async function send<K extends "threads.promotion_event.saved" | "threads.promotion_event.deleted" | "threads.listing_status.changed">(
  type: K,
  payload: PlatformEventPayloads[K],
): Promise<string> {
  const id = await withTransaction(testEnv.DATABASE_URL, (tx) => emitEvent(tx, type, payload));
  await deliverPendingEvents(testEnv, new Date(), { eventIds: [id] });
  return id;
}

const saved = (over: Partial<PlatformEventPayloads["threads.promotion_event.saved"]> = {}) => ({
  promotionId: PROMO,
  threadsAccountId: "acc-1",
  ownerUserId: owner,
  name: "IT交流会",
  startsAt: "2099-11-25T10:00:00.000Z",
  endsAt: "2099-11-25T13:00:00.000Z",
  venue: "バー SHITEN",
  capacity: 25,
  feeAmount: 5000,
  feeNote: "学生は3,000円",
  occurredAt: "2026-11-13T01:00:00.000Z",
  ...over,
});

type Candidate = { promotionId: string; name: string; postedMedia: string[]; usedByEventId: string | null; feeAmount: number | null };
const candidates = async (user = "o1") => ((await (await call(app, "GET", "/api/collect/threads-candidates", { user })).json()) as { candidates: Candidate[] }).candidates;

beforeEach(async () => {
  await resetDb();
  owner = await grantCollect(app, "o1");
});

describe("出来事を受け取る", () => {
  it("「保存した」で候補ができ、上書きする。古い出来事は捨てる。2回届いても同じ", async () => {
    const id = await send("threads.promotion_event.saved", saved());
    expect(await candidates()).toEqual([expect.objectContaining({ promotionId: PROMO, name: "IT交流会", feeAmount: 5000, postedMedia: [], usedByEventId: null })]);
    await send("threads.promotion_event.saved", saved({ name: "IT交流会 11月", occurredAt: "2026-11-13T02:00:00.000Z" }));
    await send("threads.promotion_event.saved", saved({ name: "古い名前", occurredAt: "2026-11-13T01:30:00.000Z" }));
    expect((await candidates())[0]!.name).toBe("IT交流会 11月");
    // 同じ出来事をもう一度届けても変わらない（received_events）
    const { onPromotionEventSaved } = await import("../../../src/apps/collect/inbox/threads-candidates");
    await onPromotionEventSaved({ id, type: "threads.promotion_event.saved", payload: saved({ name: "やり直し" }), createdAt: new Date() }, testEnv);
    expect((await candidates())[0]!.name).toBe("IT交流会 11月");
  });

  it("掲載の状況：Threads の媒体の名前を集金管理の値に直す。古い出来事は捨てる。候補がなければ何もしない", async () => {
    await send("threads.listing_status.changed", { promotionId: PROMO, postedMedia: ["peatix"], occurredAt: "2026-11-13T00:00:00.000Z" });
    expect(await candidates()).toEqual([]);
    await send("threads.promotion_event.saved", saved());
    await send("threads.listing_status.changed", { promotionId: PROMO, postedMedia: ["tsunagate", "jmty", "unknown"], occurredAt: "2026-11-13T03:00:00.000Z" });
    await send("threads.listing_status.changed", { promotionId: PROMO, postedMedia: [], occurredAt: "2026-11-13T02:00:00.000Z" });
    expect((await candidates())[0]!.postedMedia).toEqual(["tunagate", "jimoty"]);
  });

  it("「消した」で候補を見せなくなる。そのあと「保存した」が来ればまた見せる", async () => {
    await send("threads.promotion_event.saved", saved());
    await send("threads.promotion_event.deleted", { promotionId: PROMO, occurredAt: "2026-11-13T02:00:00.000Z" });
    expect(await candidates()).toEqual([]);
    await send("threads.promotion_event.saved", saved({ occurredAt: "2026-11-13T03:00:00.000Z" }));
    expect(await candidates()).toHaveLength(1);
  });

  it("候補は持ち主にだけ見せる。退会したら候補も消える", async () => {
    await grantCollect(app, "o2");
    await send("threads.promotion_event.saved", saved());
    expect(await candidates("o2")).toEqual([]);
    await onUserWithdrawn({ id: crypto.randomUUID(), type: "user.withdrawn", payload: { userId: owner }, createdAt: new Date() }, testEnv);
    db();
    const rows = (await neon(testEnv.DATABASE_URL)`SELECT count(*)::int AS n FROM collect.threads_event_candidates`) as { n: number }[];
    expect(rows[0]!.n).toBe(0);
  });
});

describe("候補からイベントを作る", () => {
  it("候補の番号を付けて作れ、候補に作ったイベントが出る。元が直された・消されたら印が付く（イベントの中身は変えない）", async () => {
    await send("threads.promotion_event.saved", saved());
    await send("threads.listing_status.changed", { promotionId: PROMO, postedMedia: ["peatix"], occurredAt: "2026-11-13T01:10:00.000Z" });
    const res = await call(app, "POST", "/api/collect/events", { user: "o1", body: { ...EVENT_INPUT, sourceThreadsPromotionId: PROMO } });
    expect(res.status).toBe(201);
    const event = (await res.json()) as { id: string; name: string };
    expect((await candidates())[0]!.usedByEventId).toBe(event.id);
    const read = async () =>
      (await (await call(app, "GET", `/api/collect/events/${event.id}`, { user: "o1" })).json()) as {
        name: string;
        sourceChangedAt: string | null;
        sourceDeletedAt: string | null;
        threadsPostedMedia?: string[];
      };
    expect(await read()).toMatchObject({ sourceChangedAt: null, sourceDeletedAt: null, threadsPostedMedia: ["peatix"] });
    await send("threads.promotion_event.saved", saved({ name: "名前を直した", occurredAt: new Date(Date.now() + 1000).toISOString() }));
    const changed = await read();
    expect(changed.sourceChangedAt).not.toBeNull();
    expect(changed.name).toBe(EVENT_INPUT.name);
    await send("threads.promotion_event.deleted", { promotionId: PROMO, occurredAt: new Date(Date.now() + 2000).toISOString() });
    expect((await read()).sourceDeletedAt).not.toBeNull();
  });

  it("見せていない候補（ほかの人の・ない）の番号では作れない（400）", async () => {
    await grantCollect(app, "o2");
    await send("threads.promotion_event.saved", saved());
    expect(await errorOf(await call(app, "POST", "/api/collect/events", { user: "o2", body: { ...EVENT_INPUT, sourceThreadsPromotionId: PROMO } }))).toEqual([400, "VALIDATION_FAILED"]);
    expect(await errorOf(await call(app, "POST", "/api/collect/events", { user: "o1", body: { ...EVENT_INPUT, sourceThreadsPromotionId: "nope" } }))).toEqual([400, "VALIDATION_FAILED"]);
  });
});
