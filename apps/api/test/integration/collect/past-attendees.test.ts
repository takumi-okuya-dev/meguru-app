// 前回の参加者の候補（specs/collect/001-event-day-collection contracts/api.md 3、FR-027、research.md R9、tasks.md T022）。
import { beforeEach, describe, expect, it } from "vitest";
import { call, makeApp, resetDb } from "../../helpers/app";
import { createCollectEvent, errorOf, grantCollect, type EventBody } from "../../helpers/collect";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
  await grantCollect(app, "o1");
  await grantCollect(app, "o2");
});

/**
 * 名簿に人を足す。
 * @param user - 主催者
 * @param event - イベント
 * @param name - 名前
 * @param kana - ふりがな
 */
async function addTo(user: string, event: EventBody, name: string, kana?: string) {
  const res = await call(app, "POST", `/api/collect/events/${event.id}/roster`, { user, body: { name, kana, media: "peatix", priceTierId: event.tiers[0]!.id } });
  expect(res.status).toBe(201);
}

const search = async (user: string, eventId: string, q: string) => {
  const res = await call(app, "GET", `/api/collect/past-attendees?eventId=${eventId}&q=${encodeURIComponent(q)}`, { user });
  return { status: res.status, body: (await res.json()) as { candidates: { name: string; kana: string | null; lastEventName: string; lastEventStartsAt: string }[] } };
};

describe("前回の参加者", () => {
  it("ほかのイベントの名簿から、同じ名前ごとに最後に来たものを、ひらがなとカタカナを区別せずに返す", async () => {
    const sep = await createCollectEvent(app, "o1", { name: "9月の会", startsAt: "2026-09-10T10:00:00.000Z", endsAt: null });
    const oct = await createCollectEvent(app, "o1", { name: "10月の会", startsAt: "2026-10-10T10:00:00.000Z", endsAt: null });
    const now = await createCollectEvent(app, "o1", { name: "11月の会" });
    await addTo("o1", sep, "松本 れい", "まつもと れい");
    await addTo("o1", oct, "松本 れい", "マツモト レイ");
    await addTo("o1", oct, "松井 けん", "まつい けん");
    const { status, body } = await search("o1", now.id, "マツ");
    expect(status).toBe(200);
    expect(body.candidates).toEqual([
      { name: "松井 けん", kana: "まつい けん", lastEventName: "10月の会", lastEventStartsAt: "2026-10-10T10:00:00.000Z" },
      { name: "松本 れい", kana: "マツモト レイ", lastEventName: "10月の会", lastEventStartsAt: "2026-10-10T10:00:00.000Z" },
    ]);
  });

  it("いまのイベントにいる人・ほかの主催者の名簿は出さない。最大5件", async () => {
    const past = await createCollectEvent(app, "o1", { name: "前の会", startsAt: "2026-10-10T10:00:00.000Z", endsAt: null });
    const now = await createCollectEvent(app, "o1");
    const others = await createCollectEvent(app, "o2");
    for (let i = 0; i < 7; i++) await addTo("o1", past, `山田${i}`);
    await addTo("o1", now, "山田0");
    await addTo("o2", others, "山田太郎");
    const { body } = await search("o1", now.id, "山田");
    expect(body.candidates).toHaveLength(5);
    expect(body.candidates.map((c) => c.name)).not.toContain("山田0");
    expect(body.candidates.map((c) => c.name)).not.toContain("山田太郎");
  });

  it("% や _ は文字として探す。q が空なら 400", async () => {
    const past = await createCollectEvent(app, "o1", { startsAt: "2026-10-10T10:00:00.000Z", endsAt: null });
    const now = await createCollectEvent(app, "o1");
    await addTo("o1", past, "山田");
    expect((await search("o1", now.id, "%")).body.candidates).toEqual([]);
    expect(await errorOf(await call(app, "GET", `/api/collect/past-attendees?eventId=${now.id}&q=`, { user: "o1" }))).toEqual([400, "VALIDATION_FAILED"]);
  });
});
