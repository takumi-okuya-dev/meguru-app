// 紹介した人と紹介経由の売上（specs/collect/003-revenue-sharing User Story 3、FR-020〜FR-023、tasks.md T016）。
import { beforeEach, describe, expect, it } from "vitest";
import { call, makeApp, resetDb } from "../../helpers/app";
import { createCollectEvent, grantCollect, type EventBody } from "../../helpers/collect";

const app = makeApp();
let event: EventBody;
const ids: Record<string, string> = {};

const path = (rest = "") => `/api/collect/events/${event.id}${rest}`;
const add = async (name: string, referrer?: string | null) => {
  const res = await call(app, "POST", path("/roster"), {
    user: "o1",
    body: { name, media: "minato", priceTierId: event.tiers[0]!.id, ...(referrer !== undefined ? { referrer } : {}) },
  });
  const { person } = (await res.json()) as { person: { id: string; referrer: string | null } };
  ids[name] = person.id;
  return person;
};
const record = (name: string, method: string) =>
  call(app, "PUT", path(`/reception/${ids[name]}`), { user: "o1", body: { method, clientRequestId: crypto.randomUUID() } });
const referrals = async () => ((await (await call(app, "GET", path("/referrals"), { user: "o1" })).json()) as { rows: unknown[] }).rows;

beforeEach(async () => {
  await resetDb();
  await grantCollect(app, "o1");
  event = await createCollectEvent(app, "o1");
});

describe("紹介した人", () => {
  it("足す・直す・消す。名簿の人に出る", async () => {
    expect((await add("松本", " 井上 ")).referrer).toBe("井上");
    expect((await add("木村")).referrer).toBeNull();
    const res = await call(app, "PATCH", path(`/roster/${ids["木村"]}`), { user: "o1", body: { referrer: "木下さん" } });
    expect(((await res.json()) as { person: { referrer: string } }).person.referrer).toBe("木下さん");
    const res2 = await call(app, "PATCH", path(`/roster/${ids["木村"]}`), { user: "o1", body: { referrer: "" } });
    expect(((await res2.json()) as { person: { referrer: string | null } }).person.referrer).toBeNull();
    expect((await call(app, "POST", path("/roster"), { user: "o1", body: { name: "長い", media: "minato", priceTierId: event.tiers[0]!.id, referrer: "あ".repeat(41) } })).status).toBe(400);
  });

  it("まとめて貼るときに、みなに付けられる", async () => {
    const res = await call(app, "POST", path("/roster/bulk"), { user: "o1", body: { names: ["A", "B"], media: "minato", priceTierId: event.tiers[0]!.id, referrer: "井上" } });
    const { people } = (await res.json()) as { people: { referrer: string }[] };
    expect(people.map((p) => p.referrer)).toEqual(["井上", "井上"]);
  });
});

describe("紹介経由の売上", () => {
  it("紹介した人ごと（敬称・かなの違いはまとめる）。人数の多い順で、紹介なしは最後。確かめ待ちは売上に入れない", async () => {
    await add("A", "井上");
    await add("B", "井上さん");
    await add("C", "いのうえ");
    await add("D", "木村");
    await add("E", "木村");
    await add("F");
    await record("A", "cash");
    await record("B", "paypay");
    await record("D", "transfer_later");
    await record("F", "cash");
    expect(await referrals()).toEqual([
      { name: "井上", people: 2, attended: 2, paid: 6000, awaiting: 0 },
      { name: "木村", people: 2, attended: 1, paid: 0, awaiting: 3000 },
      { name: "いのうえ", people: 1, attended: 0, paid: 0, awaiting: 0 },
      { name: null, people: 1, attended: 1, paid: 3000, awaiting: 0 },
    ]);
  });

  it("紹介なしの人がいなければ、その行は出さない。ほかの主催者は 404", async () => {
    await add("A", "井上");
    expect(await referrals()).toEqual([{ name: "井上", people: 1, attended: 0, paid: 0, awaiting: 0 }]);
    await grantCollect(app, "o2");
    expect((await call(app, "GET", path("/referrals"), { user: "o2" })).status).toBe(404);
  });

  it("候補は、この主催者が使った名前（同じ形はまとめる・新しい順）", async () => {
    await add("A", "井上");
    await add("B", "木村");
    await add("C", "井上さん");
    const res = await call(app, "GET", "/api/collect/referrers", { user: "o1" });
    expect(await res.json()).toEqual({ names: ["井上さん", "木村"] });
  });

  it("CSV に「紹介した人」の列。イベントを消すと、まとめに経費の合計と紹介ありの数字が残る", async () => {
    await add("A", "井上");
    await add("B");
    await record("A", "cash");
    await record("B", "cash");
    const csv = await (await call(app, "GET", path("/export.csv"), { user: "o1" })).text();
    expect(csv.split("\r\n")[0]).toContain("紹介した人,メモ");
    expect(csv.split("\r\n")[1]).toContain(",井上,");
    await call(app, "POST", path("/expenses"), { user: "o1", body: { name: "会場費", amount: 1000 } });
    await call(app, "DELETE", path(), { user: "o1" });
    const { summaries } = (await (await call(app, "GET", "/api/collect/summaries", { user: "o1" })).json()) as { summaries: { expenseTotal: number; referred: unknown }[] };
    expect(summaries[0]).toMatchObject({ expenseTotal: 1000, referred: { count: 1, paid: 3000, awaiting: 0 } });
  });
});
