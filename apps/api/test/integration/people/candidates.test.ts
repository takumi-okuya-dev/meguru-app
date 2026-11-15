// 誘う候補（specs/people/001-people-memo tasks.md T070、contracts/api.md 5、FR-018・FR-019・SC-003）。
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../../helpers/app";
import { callPeople, commitForm, FORM_COLUMNS, FORM_HEADERS, formRow, grantPeople, makeEvent, rawSql, read } from "../../helpers/people";

type Item = { id: string; displayName: string; lastMetOn: string | null; outreach: { stage: string; event: { id: string } | null } | null };
type List = { persons: Item[]; total: number };

let oct: string;
let dec: string;
let other: string;
beforeEach(async () => {
  await resetDb();
  await grantPeople("u1");
  oct = await makeEvent("u1", "10月の会", "2026-10-11");
  await makeEvent("u1", "11月の会", "2026-11-25");
  dec = await makeEvent("u1", "12月の会", "2026-12-13");
  other = await makeEvent("u1", "よその会", "2026-11-01", false);
  await commitForm("u1", oct, [
    formRow({ line: "たろう", consent: "交流会・勉強会の案内", next: "参加できそう" }, 1),
    formRow({ line: "はなこ", consent: "交流会・勉強会の案内, 転職・求人情報", next: "難しい" }, 2),
    formRow({ line: "じろう", consent: "個別の案内は希望しない", next: "参加できそう" }, 3),
    formRow({ line: "さぶろう", consent: "交流会・勉強会の案内, 個別の案内は希望しない", next: "参加できそう" }, 4),
  ]);
  await commitForm("u1", other, [formRow({ line: "しろう", consent: "交流会・勉強会の案内", at: "2026/11/01 21:00:00" }, 1)]);
});

/**
 * 誘う候補を読む。
 * @param query - クエリ
 * @returns 候補
 */
async function candidates(query: string): Promise<List> {
  const [status, body] = await read<List>(await callPeople("GET", `/candidates?${query}`, "u1"));
  expect(status).toBe(200);
  return body;
}

/**
 * 候補の表示名（名前の順）。
 * @param query - クエリ
 * @returns 表示名
 */
async function names(query: string): Promise<string[]> {
  return (await candidates(query)).persons.map((p) => p.displayName).sort();
}

describe("誘う候補", () => {
  it("交流会への誘いの同意が真の人だけ。「希望しない」と答えた人は、どの絞り込みの組み合わせでも出ない", async () => {
    expect(await names("purpose=invite")).toEqual(["しろう", "たろう", "はなこ"]);
    const filters = [
      "",
      "visitedOwn=true",
      `next=${encodeURIComponent("参加できそう")}`,
      `eventId=${dec}`,
      "lastMetFrom=2026-01-01",
      "lastMetTo=2026-12-31",
      `q=${encodeURIComponent("ろう")}`,
      `wanted=${encodeURIComponent("エンジニアやSES企業とつながりたい")}`,
      `career=${encodeURIComponent("副業・業務委託")}`,
    ];
    for (let i = 0; i < 1 << filters.length; i += 7) {
      const q = filters.filter((_, b) => i & (1 << b)).join("&");
      const found = await names(`purpose=invite${q ? `&${q}` : ""}`);
      expect(found).not.toContain("じろう");
      expect(found).not.toContain("さぶろう");
    }
  });

  it("同意の列がなかった回答の人は出ない。手で同意した人は出る", async () => {
    const nocol = await makeEvent("u1", "同意の列のない会", "2026-11-10");
    const headers = FORM_HEADERS.filter((_, i) => i !== 7);
    const columns = FORM_COLUMNS.filter((_, i) => i !== 7);
    const row = formRow({ line: "ごろう", at: "2026/11/10 21:00:00" }).filter((_, i) => i !== 7);
    expect((await callPeople("POST", "/imports", "u1", { eventId: nocol, headers, rows: [row], columns, decisions: [] })).status).toBe(201);
    expect(await names("purpose=invite")).not.toContain("ごろう");
    const [goro] = (await rawSql()`SELECT id FROM people.persons WHERE line_name = 'ごろう'`) as { id: string }[];
    await callPeople("PUT", `/persons/${goro!.id}/consent`, "u1", { invite: true, work: false });
    expect(await names("purpose=invite")).toContain("ごろう");
  });

  it("visitedOwn=true は自分の会に1回以上来た人だけ（よその会だけの人は出ない）。仕事のつなぎは仕事の同意の人だけ", async () => {
    expect(await names("purpose=invite&visitedOwn=true")).toEqual(["たろう", "はなこ"]);
    expect(await names("purpose=work")).toEqual(["はなこ"]);
  });

  it("並びは最後に会った日の新しい順。eventId（誘う会）への声かけが行に入る。eventId で人は絞らない", async () => {
    const all = await candidates("purpose=invite");
    expect(all.persons.map((p) => p.displayName)).toEqual(["しろう", "たろう", "はなこ"]);
    const taro = all.persons.find((p) => p.displayName === "たろう")!;
    expect((await callPeople("POST", "/outreaches", "u1", { personId: taro.id, purpose: "invite", eventId: dec })).status).toBe(201);
    const withOutreach = await candidates(`purpose=invite&eventId=${dec}`);
    expect(withOutreach.persons.map((p) => p.displayName)).toEqual(["しろう", "たろう", "はなこ"]);
    expect(withOutreach.persons.find((p) => p.id === taro.id)!.outreach).toMatchObject({ stage: "asked", event: { id: dec } });
    expect(withOutreach.persons.find((p) => p.displayName === "はなこ")!.outreach).toBeNull();
    // 誘う会を渡さなければ、声かけは入らない
    expect(all.persons.every((p) => p.outreach === null)).toBe(true);
  });

  it("eventId=next なら次の自分の会（ホームの数字と同じ会）で、その会への声かけが行に入る。書かなければ選んでいない", async () => {
    // 次の自分の会は今日の日付で変わるので、ホームの数字（stats）の nextOwnEvent と比べる。なければ足す
    let [, stats] = await read<{ nextOwnEvent: { id: string } | null }>(await callPeople("GET", "/stats", "u1"));
    if (!stats.nextOwnEvent) {
      await makeEvent("u1", "先の会", "2099-01-01");
      [, stats] = await read<{ nextOwnEvent: { id: string } | null }>(await callPeople("GET", "/stats", "u1"));
    }
    const nextId = stats.nextOwnEvent!.id;
    const [taro] = (await rawSql()`SELECT id FROM people.persons WHERE line_name = 'たろう'`) as { id: string }[];
    await callPeople("POST", "/outreaches", "u1", { personId: taro!.id, purpose: "invite", eventId: nextId });
    const auto = (await candidates("purpose=invite&eventId=next")) as List & { inviteEvent: { id: string } | null };
    expect(auto.inviteEvent?.id).toBe(nextId);
    expect(auto.persons.find((p) => p.id === taro!.id)!.outreach?.event?.id).toBe(nextId);
    const none = (await candidates("purpose=invite")) as List & { inviteEvent: unknown };
    expect(none.inviteEvent).toBeNull();
    expect(none.persons.every((p) => p.outreach === null)).toBe(true);
    const chosen = (await candidates(`purpose=invite&eventId=${oct}`)) as List & { inviteEvent: { id: string; name: string } | null };
    expect(chosen.inviteEvent).toMatchObject({ id: oct, name: "10月の会" });
    const work = (await candidates("purpose=work&eventId=next")) as List & { inviteEvent: unknown };
    expect(work.inviteEvent).toBeNull();
    expect((await callPeople("GET", "/candidates?purpose=invite&eventId=nope", "u1")).status).toBe(400);
  });

  it("自分の会が先になければ、誘う会は選んでいない（null）", async () => {
    await rawSql()`DELETE FROM people.events WHERE user_id = (SELECT user_id FROM people.events WHERE id = ${dec}) AND held_on >= current_date - 1 AND is_own`;
    const [, stats] = await read<{ nextOwnEvent: unknown }>(await callPeople("GET", "/stats", "u1"));
    expect(stats.nextOwnEvent).toBeNull();
    expect(((await candidates("purpose=invite&eventId=next")) as List & { inviteEvent: unknown }).inviteEvent).toBeNull();
  });

  it("仕事のつなぎでは誘う会を見ない（消えた会の番号でも 404 にしない）。交流会への誘いでは 404", async () => {
    const gone = await makeEvent("u1", "消す会", "2026-12-20");
    await callPeople("DELETE", `/events/${gone}`, "u1", {});
    expect((await callPeople("GET", `/candidates?purpose=work&eventId=${gone}`, "u1")).status).toBe(200);
    expect((await callPeople("GET", `/candidates?purpose=invite&eventId=${gone}`, "u1")).status).toBe(404);
  });

  it("purpose がないと 400、ほかの作り手には出ない", async () => {
    expect((await callPeople("GET", "/candidates", "u1")).status).toBe(400);
    await grantPeople("u2");
    const [, body] = await read<List>(await callPeople("GET", "/candidates?purpose=invite", "u2"));
    expect(body.persons).toEqual([]);
  });
});
