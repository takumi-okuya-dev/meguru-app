// 取り込みの取り消しとイベントを消す（specs/people/001-people-memo tasks.md T027、FR-008・FR-027、research.md R14）。
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../../helpers/app";
import { callPeople, commitForm, formRow, grantPeople, makeEvent, peopleCounts, rawSql, read } from "../../helpers/people";

type Result = { import: { id: string } };

let oct: string;
let nov: string;
beforeEach(async () => {
  await resetDb();
  await grantPeople("u1");
  oct = await makeEvent("u1", "10月の会", "2026-10-11");
  nov = await makeEvent("u1", "11月の会", "2026-11-25");
});

/**
 * 10月に たろう・はなこ、11月に たろう（つなぐ）・じろう を取り込む。
 * @returns 2つの取り込みの番号と、たろうの番号
 */
async function twoImports() {
  const [, a] = await read<Result>(await commitForm("u1", oct, [formRow({ line: "たろう" }, 1), formRow({ line: "はなこ" }, 2)]));
  const [taro] = (await rawSql()`SELECT id FROM people.persons WHERE line_name = 'たろう'`) as { id: string }[];
  const [, b] = await read<Result>(
    await commitForm("u1", nov, [formRow({ line: "たろう🌸", at: "2026/11/25 21:00:00", consent: "個別の案内は希望しない" }, 1), formRow({ line: "じろう", at: "2026/11/25 21:01:00" }, 2)], [
      { row: 0, action: "link", personId: taro!.id },
    ]),
  );
  return { first: a.import.id, second: b.import.id, taro: taro!.id };
}

describe("取り込みの取り消し", () => {
  it("その取り込みの回答と、その取り込みだけで作られた人が消える。ほかの回答がある人は残り、LINE名と同意が決め直される", async () => {
    const { second, taro } = await twoImports();
    const sql = rawSql();
    const [before] = (await sql`SELECT line_name, consent_invite FROM people.persons WHERE id = ${taro}`) as Record<string, unknown>[];
    expect(before).toEqual({ line_name: "たろう🌸", consent_invite: false });
    expect(await read(await callPeople("GET", `/imports/${second}/undo-preview`, "u1"))).toEqual([200, { responseCount: 2, removedPeopleCount: 1, peopleWithNotes: [] }]);
    expect(await read(await callPeople("DELETE", `/imports/${second}`, "u1"))).toEqual([200, { removedPeopleCount: 1, keptPeopleCount: 0 }]);
    const people = (await sql`SELECT line_name, consent_invite FROM people.persons ORDER BY line_name`) as Record<string, unknown>[];
    expect(people).toEqual([
      { line_name: "たろう", consent_invite: true },
      { line_name: "はなこ", consent_invite: true },
    ]);
    expect(await peopleCounts()).toMatchObject({ responses: 2, imports: 1 });
  });

  it("書き足しのある人がいるのに keepPeopleWithNotes を省くと 409、true で残し、false で消す", async () => {
    const { first } = await twoImports();
    const sql = rawSql();
    await sql`UPDATE people.persons SET memo_talk = 'Pythonの話' WHERE line_name = 'はなこ'`;
    const [, preview] = await read<{ peopleWithNotes: { displayName: string; notes: string[] }[] }>(await callPeople("GET", `/imports/${first}/undo-preview`, "u1"));
    expect(preview.peopleWithNotes.map((p) => [p.displayName, p.notes])).toEqual([["はなこ", ["memo"]]]);
    const [status, body] = await read<{ error: { code: string; count: number } }>(await callPeople("DELETE", `/imports/${first}`, "u1"));
    expect([status, body.error.code, body.error.count]).toEqual([409, "PEOPLE_CONFIRM_REQUIRED", 1]);
    expect(await read(await callPeople("DELETE", `/imports/${first}`, "u1", { keepPeopleWithNotes: true }))).toEqual([200, { removedPeopleCount: 0, keptPeopleCount: 1 }]);
    const [hanako] = (await sql`SELECT line_name, consent_source FROM people.persons WHERE memo_talk IS NOT NULL`) as Record<string, unknown>[];
    expect(hanako).toEqual({ line_name: "はなこ", consent_source: "none" });
  });

  it("false なら書き足しのある人も消える", async () => {
    const { first } = await twoImports();
    await rawSql()`UPDATE people.persons SET memo_appearance = 'メガネ' WHERE line_name = 'はなこ'`;
    expect(await read(await callPeople("DELETE", `/imports/${first}`, "u1", { keepPeopleWithNotes: false }))).toEqual([200, { removedPeopleCount: 1, keptPeopleCount: 0 }]);
  });

  it("ほかの作り手の取り込みは 404", async () => {
    const { first } = await twoImports();
    await grantPeople("u2");
    expect((await callPeople("GET", `/imports/${first}/undo-preview`, "u2")).status).toBe(404);
    expect((await callPeople("DELETE", `/imports/${first}`, "u2")).status).toBe(404);
  });
});

describe("イベントを消す", () => {
  it("取り込みをすべて取り消してからイベントを消す。見積もりと 409 も同じ", async () => {
    await twoImports();
    await rawSql()`UPDATE people.persons SET memo_talk = '話した' WHERE line_name = 'じろう'`;
    const [, preview] = await read<Record<string, unknown>>(await callPeople("GET", `/events/${nov}/delete-preview`, "u1"));
    expect(preview).toMatchObject({ responseCount: 2, removedPeopleCount: 1, importCount: 1, outreachCount: 0 });
    expect((await callPeople("DELETE", `/events/${nov}`, "u1")).status).toBe(409);
    expect(await read(await callPeople("DELETE", `/events/${nov}`, "u1", { keepPeopleWithNotes: false }))).toEqual([200, { removedPeopleCount: 1, keptPeopleCount: 0 }]);
    expect((await callPeople("GET", `/events/${nov}`, "u1")).status).toBe(404);
    expect(await peopleCounts()).toMatchObject({ persons: 2, responses: 2, imports: 1 });
  });
});
