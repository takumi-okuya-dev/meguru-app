// 名簿（specs/collect/001-event-day-collection contracts/api.md 3、FR-020〜FR-026、research.md R8、tasks.md T021）。
import { beforeEach, describe, expect, it } from "vitest";
import { call, makeApp, resetDb } from "../../helpers/app";
import { createCollectEvent, errorOf, grantCollect, type EventBody } from "../../helpers/collect";

const app = makeApp();
let event: EventBody;
let tierId: string;

type Person = { id: string; number: number; name: string; kana: string | null; media: string; priceTierId: string; memo: string | null };

beforeEach(async () => {
  await resetDb();
  await grantCollect(app, "o1");
  event = await createCollectEvent(app, "o1");
  tierId = event.tiers[0]!.id;
});

const add = (body: Record<string, unknown>) =>
  call(app, "POST", `/api/collect/events/${event.id}/roster`, { user: "o1", body: { media: "peatix", priceTierId: tierId, ...body } });
const roster = async () => (await (await call(app, "GET", `/api/collect/events/${event.id}/roster`, { user: "o1" })).json()) as { people: Person[]; version: number };

describe("1人足す", () => {
  it("受付番号を足した順に振り、版を上げる。消した番号は使い回さない", async () => {
    const a = (await (await add({ name: "松本 れい", kana: "まつもと れい", memo: "紹介：井上さん" })).json()) as { person: Person; sameNameAs: unknown; version: number };
    expect(a.person).toMatchObject({ number: 1, name: "松本 れい", kana: "まつもと れい", memo: "紹介：井上さん" });
    expect(a.sameNameAs).toBeNull();
    expect(a.version).toBe(1);
    const b = (await (await add({ name: "井上 そら" })).json()) as { person: Person };
    expect(b.person.number).toBe(2);
    expect((await call(app, "DELETE", `/api/collect/events/${event.id}/roster/${b.person.id}`, { user: "o1" })).status).toBe(200);
    const c = (await (await add({ name: "木村 ゆうき" })).json()) as { person: Person };
    expect(c.person.number).toBe(3);
    const list = await roster();
    expect(list.people.map((p) => p.number)).toEqual([1, 3]);
    expect(list.version).toBe(4);
  });

  it("同じ名前（表記ゆれを除いて同じ）の人がいれば、その人の番号と媒体を知らせる（足すことは止めない）", async () => {
    await add({ name: "ﾏﾂﾓﾄ ﾚｲ", media: "kokuchpro" });
    const res = await add({ name: "まつもとれい" });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { sameNameAs: unknown }).sameNameAs).toEqual({ number: 1, media: "kokuchpro" });
    expect((await roster()).people).toHaveLength(2);
  });

  it("ほかのイベントの区分・名前なしは 400", async () => {
    const other = await createCollectEvent(app, "o1");
    expect(await errorOf(await add({ name: "a", priceTierId: other.tiers[0]!.id }))).toEqual([400, "VALIDATION_FAILED"]);
    expect(await errorOf(await add({ name: " " }))).toEqual([400, "VALIDATION_FAILED"]);
    // 失敗した呼び出しでは番号を使わない
    expect(((await (await add({ name: "a" })).json()) as { person: Person }).person.number).toBe(1);
  });

  it("2つの呼び出しで同時に足しても、番号が重ならない", async () => {
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => add({ name: `人${i}` })));
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect((await roster()).people.map((p) => p.number)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("まとめて足す", () => {
  it("APIでも行を整え、空の行を除き、番号を続けて振る", async () => {
    await add({ name: "先にいる人" });
    const res = await call(app, "POST", `/api/collect/events/${event.id}/roster/bulk`, {
      user: "o1",
      body: { names: ["1. 松本 れい 様 matsumoto@example.com", "", "2. 井上 そら 様 090-1234-5678", "3. 木村 ゆうき さん", "  "], media: "kokuchpro", priceTierId: tierId },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { people: Person[]; version: number };
    expect(body.people.map((p) => [p.number, p.name, p.media])).toEqual([
      [2, "松本 れい", "kokuchpro"],
      [3, "井上 そら", "kokuchpro"],
      [4, "木村 ゆうき", "kokuchpro"],
    ]);
    expect(body.version).toBe(2);
  });

  it("整えると1行も残らない・長すぎる行は 400", async () => {
    const bulk = (names: string[]) => call(app, "POST", `/api/collect/events/${event.id}/roster/bulk`, { user: "o1", body: { names, media: "peatix", priceTierId: tierId } });
    expect(await errorOf(await bulk(["", "090-1111-2222"]))).toEqual([400, "VALIDATION_FAILED"]);
    expect(await errorOf(await bulk(["あ".repeat(51)]))).toEqual([400, "VALIDATION_FAILED"]);
  });
});

describe("直す・消す", () => {
  it("名前・ふりがな・媒体・区分・メモを直せる。受付番号は変わらない", async () => {
    const { person } = (await (await add({ name: "松本 れい" })).json()) as { person: Person };
    const res = await call(app, "PATCH", `/api/collect/events/${event.id}/roster/${person.id}`, {
      user: "o1",
      body: { name: "松本 玲", kana: "まつもと れい", media: "minato", priceTierId: event.tiers[1]!.id, memo: "" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { person: Person; version: number };
    expect(body.person).toMatchObject({ number: 1, name: "松本 玲", kana: "まつもと れい", media: "minato", priceTierId: event.tiers[1]!.id, memo: null });
    expect(body.version).toBe(2);
  });

  it("何も直さない PATCH は 400（500 にしない）", async () => {
    const { person } = (await (await add({ name: "松本 れい" })).json()) as { person: Person };
    expect(await errorOf(await call(app, "PATCH", `/api/collect/events/${event.id}/roster/${person.id}`, { user: "o1", body: {} }))).toEqual([400, "VALIDATION_FAILED"]);
  });

  it("ない人・ほかのイベントの人は 404", async () => {
    const other = await createCollectEvent(app, "o1");
    const { person } = (await (
      await call(app, "POST", `/api/collect/events/${other.id}/roster`, { user: "o1", body: { name: "a", media: "peatix", priceTierId: other.tiers[0]!.id } })
    ).json()) as { person: Person };
    expect(await errorOf(await call(app, "PATCH", `/api/collect/events/${event.id}/roster/${person.id}`, { user: "o1", body: { name: "b" } }))).toEqual([404, "ITEM_NOT_FOUND"]);
    expect(await errorOf(await call(app, "DELETE", `/api/collect/events/${event.id}/roster/${person.id}`, { user: "o1" }))).toEqual([404, "ITEM_NOT_FOUND"]);
    expect(await errorOf(await call(app, "DELETE", `/api/collect/events/${event.id}/roster/x`, { user: "o1" }))).toEqual([404, "ITEM_NOT_FOUND"]);
  });
});
