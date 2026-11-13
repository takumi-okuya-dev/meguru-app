// まとめる・分ける（specs/people/001-people-memo tasks.md T058、contracts/api.md 4、research.md R15）。
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../../helpers/app";
import { callPeople, commitForm, formRow, grantPeople, makeEvent, rawSql, read } from "../../helpers/people";

type Detail = {
  person: { id: string; realName: string | null; lineName: string | null; otherLineNames: string[]; memoAppearance: string | null; memoTalk: string | null; consent: { invite: boolean; source: string } };
  attendances: { event: { name: string }; via: string; responses: { id: string; lineName: string }[] }[];
  consentChanges: { source: string }[];
};

let oct: string;
let nov: string;
let taro: string;
let taro2: string;
beforeEach(async () => {
  await resetDb();
  await grantPeople("u1");
  oct = await makeEvent("u1", "10月の会", "2026-10-11");
  nov = await makeEvent("u1", "11月の会", "2026-11-25");
  // 10月に「たろう」、11月に別の人として「タロー」（同じ人なのに、つながなかった）
  await commitForm("u1", oct, [formRow({ line: "たろう" })]);
  await commitForm("u1", nov, [formRow({ line: "タロー", at: "2026/11/25 21:00:00", consent: "個別の案内は希望しない" })], [{ row: 0, action: "new" }]);
  const rows = (await rawSql()`SELECT id, line_name FROM people.persons ORDER BY line_name`) as { id: string; line_name: string }[];
  taro = rows.find((r) => r.line_name === "たろう")!.id;
  taro2 = rows.find((r) => r.line_name === "タロー")!.id;
});

/**
 * 人のページを読む。
 * @param id - 人の番号
 * @returns 状態と人のページ
 */
async function detail(id: string): Promise<[number, Detail]> {
  return read<Detail>(await callPeople("GET", `/persons/${id}`, "u1"));
}

/**
 * イベントの参加者数。
 * @param eventId - イベント
 * @returns 参加者数
 */
async function attendeeCount(eventId: string): Promise<number> {
  const [, body] = await read<{ stats: { attendeeCount: number } }>(await callPeople("GET", `/events/${eventId}`, "u1"));
  return body.stats.attendeeCount;
}

describe("まとめる", () => {
  it("相手の回答・会ったイベント（重なりは1つ）・同意の記録が移り、相手は消える。本名は残す人のもの（なければ相手）、メモはつなぐ。参加者数は変わらない", async () => {
    const sql = rawSql();
    await sql`UPDATE people.persons SET memo_talk = 'Pythonの話', memo_appearance = NULL WHERE id = ${taro}`;
    await sql`UPDATE people.persons SET real_name = '鈴木 太郎', real_name_key = '鈴木太郎', memo_talk = 'Goの話', memo_appearance = 'メガネ' WHERE id = ${taro2}`;
    // 両方に11月の会の会ったイベント（重なり）
    await callPeople("POST", `/persons/${taro}/attendances`, "u1", { eventId: nov });
    const [status, body] = await read<{ person: { id: string } }>(await callPeople("POST", `/persons/${taro}/merge`, "u1", { otherPersonId: taro2 }));
    expect([status, body.person.id]).toEqual([200, taro]);

    const [, d] = await detail(taro);
    expect([d.person.realName, d.person.memoTalk, d.person.memoAppearance]).toEqual(["鈴木 太郎", "Pythonの話 ／ Goの話", "メガネ"]);
    expect(d.attendances.map((a) => [a.event.name, a.via, a.responses.length])).toEqual([
      ["11月の会", "response", 1],
      ["10月の会", "response", 1],
    ]);
    // 今のLINE名・同意は、いちばん新しい回答（11月の「タロー」・希望しない）で決め直す
    expect([d.person.lineName, d.person.otherLineNames, d.person.consent.invite]).toEqual(["タロー", ["たろう"], false]);
    expect(d.consentChanges.length).toBeGreaterThanOrEqual(2);
    expect((await detail(taro2))[0]).toBe(404);
    expect([await attendeeCount(oct), await attendeeCount(nov)]).toEqual([1, 1]);
    const [erased] = (await sql`SELECT (SELECT count(*) FROM people.erased_attendances)::int + (SELECT count(*) FROM people.erased_responses)::int AS n`) as { n: number }[];
    expect(erased!.n).toBe(0);
    const [manual] = (await sql`SELECT count(*)::int AS n FROM people.manual_attendances WHERE person_id = ${taro}`) as { n: number }[];
    expect(manual!.n).toBe(1);
  });

  it("メモが上限を超えるときは、相手の方を切る", async () => {
    const sql = rawSql();
    await sql`UPDATE people.persons SET memo_appearance = ${"あ".repeat(290)} WHERE id = ${taro}`;
    await sql`UPDATE people.persons SET memo_appearance = ${"い".repeat(50)} WHERE id = ${taro2}`;
    await callPeople("POST", `/persons/${taro}/merge`, "u1", { otherPersonId: taro2 });
    const [, d] = await detail(taro);
    expect([...d.person.memoAppearance!].length).toBe(300);
    expect(d.person.memoAppearance!.startsWith("あ".repeat(290))).toBe(true);
  });

  it("自分自身は 400、ほかの作り手の人は 404", async () => {
    expect((await callPeople("POST", `/persons/${taro}/merge`, "u1", { otherPersonId: taro })).status).toBe(400);
    await grantPeople("u2");
    expect((await callPeople("POST", `/persons/${taro}/merge`, "u2", { otherPersonId: taro2 })).status).toBe(404);
  });
});

describe("分ける", () => {
  it("回答を新しい人に分ける。メモと手直しの同意は元の人に残り、両方の今のLINE名と同意を決め直す", async () => {
    await callPeople("POST", `/persons/${taro}/merge`, "u1", { otherPersonId: taro2 });
    await callPeople("PATCH", `/persons/${taro}`, "u1", { memoTalk: "Pythonの話" });
    const [, before] = await detail(taro);
    const novResponse = before.attendances.find((a) => a.event.name === "11月の会")!.responses[0]!.id;

    const [status, body] = await read<{ person: { id: string } }>(await callPeople("POST", `/responses/${novResponse}/split`, "u1"));
    expect(status).toBe(201);
    const [, fresh] = await detail(body.person.id);
    expect([fresh.person.lineName, fresh.person.memoTalk, fresh.person.consent.invite, fresh.attendances.map((a) => a.event.name)]).toEqual([
      "タロー",
      null,
      false,
      ["11月の会"],
    ]);
    const [, orig] = await detail(taro);
    expect([orig.person.lineName, orig.person.memoTalk, orig.person.consent.invite, orig.attendances.map((a) => a.event.name)]).toEqual([
      "たろう",
      "Pythonの話",
      true,
      ["10月の会"],
    ]);
  });

  it("回答が1つの人は 400 VALIDATION_FAILED、ほかの作り手の回答は 404", async () => {
    const [, d] = await detail(taro);
    const only = d.attendances[0]!.responses[0]!.id;
    const [status, body] = await read<{ error: { code: string } }>(await callPeople("POST", `/responses/${only}/split`, "u1"));
    expect([status, body.error.code]).toEqual([400, "VALIDATION_FAILED"]);
    await grantPeople("u2");
    expect((await callPeople("POST", `/responses/${only}/split`, "u2")).status).toBe(404);
    expect((await callPeople("POST", "/responses/x/split", "u1")).status).toBe(404);
  });
});
