// Threads のイベントの候補（specs/people/003-threads-event-candidates spec.md US1・US2、FR-001〜FR-009、tasks.md T004）。
// Threads が出す出来事を、共通の出来事の仕組み（emitEvent → deliverPendingEvents）で人物メモに届けて確かめる。
import { beforeEach, describe, expect, it } from "vitest";
import { onPromotionEventSaved } from "../../../src/apps/people/inbox/threads-candidates";
import { onUserWithdrawn } from "../../../src/apps/people/inbox/withdrawal";
import { withTransaction } from "../../../src/kernel/db/client";
import { deliverPendingEvents, emitEvent, type PlatformEvent, type PlatformEventPayloads } from "../../../src/platform/events/events";
import { resetDb, testEnv } from "../../helpers/app";
import { callPeople, grantPeople, rawSql, read } from "../../helpers/people";

const PROMO = "22222222-2222-4222-8222-222222222222";
let owner: string;

/**
 * Threads の出来事を書いて、すぐ届ける（Threads がすることと同じ）。
 * @param type - 種類
 * @param payload - 中身
 * @returns 出来事の番号
 */
async function send<K extends "threads.promotion_event.saved" | "threads.promotion_event.deleted">(type: K, payload: PlatformEventPayloads[K]): Promise<string> {
  const id = await withTransaction(testEnv.DATABASE_URL, (tx) => emitEvent(tx, type, payload));
  await deliverPendingEvents(testEnv, new Date(), { eventIds: [id] });
  return id;
}

const saved = (over: Partial<PlatformEventPayloads["threads.promotion_event.saved"]> = {}): PlatformEventPayloads["threads.promotion_event.saved"] => ({
  promotionId: PROMO,
  threadsAccountId: "acc-1",
  ownerUserId: owner,
  name: "12月の交流会",
  // 日本時間の 2099-12-20 19:00
  startsAt: "2099-12-20T10:00:00.000Z",
  endsAt: null,
  venue: "バー SHITEN",
  capacity: 25,
  feeAmount: 5000,
  feeNote: null,
  occurredAt: "2026-11-15T01:00:00.000Z",
  ...over,
});

type Candidate = { promotionId: string; name: string; startsAt: string; usedByEventId: string | null };
const candidates = async (user = "u1") => (await read<{ candidates: Candidate[] }>(await callPeople("GET", "/threads-candidates", user)))[1].candidates;
const createFrom = (promotionId: string, user = "u1", name = "12月の交流会") => callPeople("POST", "/events", user, { name, heldOn: "2099-12-20", isOwn: true, sourceThreadsPromotionId: promotionId });

beforeEach(async () => {
  await resetDb();
  owner = await grantPeople("u1");
});

describe("出来事を受け取る（US2）", () => {
  it("「保存した」で候補ができ、名前と開始の時刻だけを写す。新しい出来事で上書きし、古い出来事は捨てる。2回届いても同じ", async () => {
    const id = await send("threads.promotion_event.saved", saved());
    expect(await candidates()).toEqual([{ promotionId: PROMO, name: "12月の交流会", startsAt: "2099-12-20T10:00:00.000Z", usedByEventId: null }]);
    await send("threads.promotion_event.saved", saved({ name: "12月の交流会（第2回）", startsAt: "2099-12-21T10:00:00.000Z", occurredAt: "2026-11-15T02:00:00.000Z" }));
    await send("threads.promotion_event.saved", saved({ name: "古い名前", occurredAt: "2026-11-15T01:30:00.000Z" }));
    expect(await candidates()).toEqual([expect.objectContaining({ name: "12月の交流会（第2回）", startsAt: "2099-12-21T10:00:00.000Z" })]);
    // 同じ出来事をもう一度届けても変わらない（received_events）
    const again = { id, type: "threads.promotion_event.saved", payload: saved({ name: "やり直し", occurredAt: "2026-11-15T09:00:00.000Z" }), createdAt: new Date() } as PlatformEvent<"threads.promotion_event.saved">;
    await onPromotionEventSaved(again, testEnv);
    expect((await candidates())[0]!.name).toBe("12月の交流会（第2回）");
    // 会場・定員・料金は写さない（FR-002）
    const cols = (await rawSql()`SELECT column_name FROM information_schema.columns WHERE table_schema = 'people' AND table_name = 'threads_event_candidates'`) as { column_name: string }[];
    expect(cols.map((c) => c.column_name).sort()).toEqual(["deleted_at", "details_occurred_at", "name", "promotion_id", "starts_at", "user_id"]);
  });

  it("「消した」で候補を見せなくなる。古い「消した」は捨てる。そのあと新しい「保存した」が来ればまた見せる", async () => {
    await send("threads.promotion_event.saved", saved({ occurredAt: "2026-11-15T02:00:00.000Z" }));
    await send("threads.promotion_event.deleted", { promotionId: PROMO, occurredAt: "2026-11-15T01:00:00.000Z" });
    expect(await candidates()).toHaveLength(1);
    await send("threads.promotion_event.deleted", { promotionId: PROMO, occurredAt: "2026-11-15T03:00:00.000Z" });
    expect(await candidates()).toEqual([]);
    await send("threads.promotion_event.saved", saved({ occurredAt: "2026-11-15T04:00:00.000Z" }));
    expect(await candidates()).toHaveLength(1);
  });

  it("並びは、今日からのものを開始の早い順に、そのあとに過ぎたものを新しい順に", async () => {
    const promo = (n: number) => `33333333-3333-4333-8333-33333333333${n}`;
    await send("threads.promotion_event.saved", saved({ promotionId: promo(1), name: "過ぎた古い会", startsAt: "2020-01-10T10:00:00.000Z" }));
    await send("threads.promotion_event.saved", saved({ promotionId: promo(2), name: "遠い会", startsAt: "2099-12-31T10:00:00.000Z" }));
    await send("threads.promotion_event.saved", saved({ promotionId: promo(3), name: "過ぎた新しい会", startsAt: "2021-05-10T10:00:00.000Z" }));
    await send("threads.promotion_event.saved", saved({ promotionId: promo(4), name: "近い会", startsAt: "2099-01-05T10:00:00.000Z" }));
    expect((await candidates()).map((c) => c.name)).toEqual(["近い会", "遠い会", "過ぎた新しい会", "過ぎた古い会"]);
  });

  it("候補は持ち主にだけ見せる。退会したら候補も消える。人物メモを使えない人は 403", async () => {
    await grantPeople("u2");
    await send("threads.promotion_event.saved", saved());
    expect(await candidates("u2")).toEqual([]);
    expect((await callPeople("GET", "/threads-candidates", "u3")).status).toBe(403);
    const withdrawn = { id: crypto.randomUUID(), type: "user.withdrawn", payload: { userId: owner }, createdAt: new Date() } as PlatformEvent<"user.withdrawn">;
    await onUserWithdrawn(withdrawn, testEnv);
    const rows = (await rawSql()`SELECT count(*)::int AS n FROM people.threads_event_candidates`) as { n: number }[];
    expect(rows[0]!.n).toBe(0);
  });
});

describe("候補からイベントを作る（US1）", () => {
  it("候補の番号を付けて作れ、候補に作ったイベントが出る。2つ目は 409。イベントを消すとまた選べる", async () => {
    await send("threads.promotion_event.saved", saved());
    const [status, body] = await read<{ event: { id: string; name: string; heldOn: string; isOwn: boolean } }>(await createFrom(PROMO));
    expect([status, body.event.name, body.event.heldOn, body.event.isOwn]).toEqual([201, "12月の交流会", "2099-12-20", true]);
    expect((await candidates())[0]!.usedByEventId).toBe(body.event.id);
    const [s2, b2] = await read<{ error: { code: string } }>(await createFrom(PROMO, "u1", "別の名前"));
    expect([s2, b2.error.code]).toEqual([409, "PEOPLE_THREADS_EVENT_USED"]);
    expect((await callPeople("DELETE", `/events/${body.event.id}`, "u1", {})).status).toBe(200);
    expect((await candidates())[0]!.usedByEventId).toBeNull();
    expect((await createFrom(PROMO)).status).toBe(201);
  });

  it("Threads で元を直す・消しても、作ったイベントは変わらない", async () => {
    await send("threads.promotion_event.saved", saved());
    const [, body] = await read<{ event: { id: string } }>(await createFrom(PROMO, "u1", "自分で付けた名前"));
    await send("threads.promotion_event.saved", saved({ name: "Threadsで直した", startsAt: "2099-12-25T10:00:00.000Z", occurredAt: "2026-11-15T05:00:00.000Z" }));
    await send("threads.promotion_event.deleted", { promotionId: PROMO, occurredAt: "2026-11-15T06:00:00.000Z" });
    const [, detail] = await read<{ event: { name: string; heldOn: string } }>(await callPeople("GET", `/events/${body.event.id}`, "u1"));
    expect([detail.event.name, detail.event.heldOn]).toEqual(["自分で付けた名前", "2099-12-20"]);
  });

  it("見せていない候補（ほかの人の・消された・ない）の番号では作れない（400）。直すときに元の番号は変えられない", async () => {
    await grantPeople("u2");
    await send("threads.promotion_event.saved", saved());
    for (const [user, promo] of [
      ["u2", PROMO],
      ["u1", "44444444-4444-4444-8444-444444444444"],
    ] as const) {
      const [s, b] = await read<{ error: { code: string; details?: string[] } }>(await createFrom(promo, user));
      expect([s, b.error.code]).toEqual([400, "VALIDATION_FAILED"]);
    }
    await send("threads.promotion_event.deleted", { promotionId: PROMO, occurredAt: "2026-11-15T02:00:00.000Z" });
    expect((await createFrom(PROMO)).status).toBe(400);
    // 候補なしで作ったイベントに、あとから元の番号を付けることはできない（入力の形にない項目は無視する）
    const [, plain] = await read<{ event: { id: string } }>(await callPeople("POST", "/events", "u1", { name: "手で作った会", heldOn: "2099-12-20", isOwn: true }));
    await callPeople("PATCH", `/events/${plain.event.id}`, "u1", { name: "手で作った会2", sourceThreadsPromotionId: PROMO });
    const rows = (await rawSql()`SELECT source_threads_promotion_id AS s FROM people.events WHERE id = ${plain.event.id}`) as { s: string | null }[];
    expect(rows[0]!.s).toBeNull();
  });
});
