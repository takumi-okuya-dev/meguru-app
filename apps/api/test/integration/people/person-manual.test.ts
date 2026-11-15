// 手で人を足す・会ったイベントを足す／外す（specs/people/001-people-memo tasks.md T057、contracts/api.md 4、FR-014）。
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../../helpers/app";
import { callPeople, commitForm, formRow, grantPeople, makeEvent, previewForm, rawSql, read } from "../../helpers/people";

type Person = { person: { id: string; displayName: string; lineName: string | null; consent: { invite: boolean; work: boolean; source: string }; lastMetOn: string | null } };

let oct: string;
beforeEach(async () => {
  await resetDb();
  await grantPeople("u1");
  oct = await makeEvent("u1", "10月の会", "2026-10-11");
});

describe("手で足す", () => {
  it("本名かLINE名のどちらかがあれば足せる。同意は手直しの事実、eventId があれば会ったイベント", async () => {
    const [status, body] = await read<Person>(
      await callPeople("POST", "/persons", "u1", { realName: "佐藤 一郎", lineName: "いちろう", eventId: oct, consent: { invite: true, work: false } }),
    );
    expect(status).toBe(201);
    expect([body.person.displayName, body.person.lineName, body.person.consent, body.person.lastMetOn]).toEqual([
      "佐藤 一郎",
      "いちろう",
      expect.objectContaining({ invite: true, work: false, source: "manual" }),
      "2026-10-11",
    ]);
    const [changes] = (await rawSql()`SELECT count(*)::int AS n FROM people.consent_changes WHERE person_id = ${body.person.id} AND source = 'manual'`) as { n: number }[];
    expect(changes!.n).toBe(1);
    // 一覧に出て、来た記録と最後に会った日に入る
    const [, list] = await read<{ persons: { id: string; lastMetOn: string | null }[] }>(await callPeople("GET", `/persons?eventId=${oct}`, "u1"));
    expect(list.persons).toEqual([expect.objectContaining({ id: body.person.id, lastMetOn: "2026-10-11" })]);
    const [, attendees] = await read<{ attendees: { personId: string; via: string }[] }>(await callPeople("GET", `/events/${oct}/attendees`, "u1"));
    expect(attendees.attendees).toEqual([expect.objectContaining({ personId: body.person.id, via: "manual" })]);
  });

  it("名前がない・長すぎる・ほかの作り手のイベントは 400／404", async () => {
    const consent = { invite: false, work: false };
    for (const bad of [{ consent }, { realName: "", consent }, { lineName: "x".repeat(101), consent }, { lineName: "a" }]) {
      expect((await callPeople("POST", "/persons", "u1", bad)).status).toBe(400);
    }
    await grantPeople("u2");
    expect((await callPeople("POST", "/persons", "u2", { lineName: "a", eventId: oct, consent })).status).toBe(404);
  });

  it("手で足した人と同じLINE名の行は、取り込みで同じ人の候補になる", async () => {
    const [, body] = await read<Person>(await callPeople("POST", "/persons", "u1", { lineName: "いちろう", consent: { invite: false, work: false } }));
    const [, preview] = await read<{ rows: { status: string; candidates?: { personId: string }[] }[] }>(await previewForm("u1", oct, [formRow({ line: "イチロウ" })]));
    expect(preview.rows[0]!.status).toBe("candidate");
    expect(preview.rows[0]!.candidates!.map((c) => c.personId)).toEqual([body.person.id]);
  });
});

describe("会ったイベント", () => {
  it("足す（もうあれば何もしない）・外す。回答による来た記録は外せない", async () => {
    await commitForm("u1", oct, [formRow({ line: "たろう" })]);
    const [taro] = (await rawSql()`SELECT id FROM people.persons`) as { id: string }[];
    const nov = await makeEvent("u1", "11月の会", "2026-11-25");
    expect((await callPeople("POST", `/persons/${taro!.id}/attendances`, "u1", { eventId: nov })).status).toBe(200);
    expect((await callPeople("POST", `/persons/${taro!.id}/attendances`, "u1", { eventId: nov })).status).toBe(200);
    const [n] = (await rawSql()`SELECT count(*)::int AS n FROM people.manual_attendances`) as { n: number }[];
    expect(n!.n).toBe(1);
    const [, d] = await read<{ person: { lastMetOn: string }; attendances: { event: { name: string }; via: string }[] }>(await callPeople("GET", `/persons/${taro!.id}`, "u1"));
    expect([d.person.lastMetOn, d.attendances.map((a) => [a.event.name, a.via])]).toEqual([
      "2026-11-25",
      [
        ["11月の会", "manual"],
        ["10月の会", "response"],
      ],
    ]);

    expect((await callPeople("DELETE", `/persons/${taro!.id}/attendances/${nov}`, "u1")).status).toBe(204);
    const [status, body] = await read<{ error: { code: string } }>(await callPeople("DELETE", `/persons/${taro!.id}/attendances/${oct}`, "u1"));
    expect([status, body.error.code]).toEqual([400, "VALIDATION_FAILED"]);
    expect((await callPeople("DELETE", `/persons/${taro!.id}/attendances/${nov}`, "u1")).status).toBe(404);
  });

  it("ほかの作り手の人・イベントは 404", async () => {
    const [, body] = await read<Person>(await callPeople("POST", "/persons", "u1", { lineName: "a", consent: { invite: false, work: false } }));
    await grantPeople("u2");
    const theirs = await makeEvent("u2", "よその会", "2026-10-12");
    expect((await callPeople("POST", `/persons/${body.person.id}/attendances`, "u1", { eventId: theirs })).status).toBe(404);
    expect((await callPeople("POST", `/persons/${body.person.id}/attendances`, "u2", { eventId: theirs })).status).toBe(404);
  });
});
