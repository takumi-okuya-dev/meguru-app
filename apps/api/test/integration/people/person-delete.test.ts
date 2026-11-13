// 参加者の求めで、その人の記録を消す（specs/people/001-people-memo tasks.md T065、contracts/api.md 4、research.md R13・SC-006）。
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../../helpers/app";
import { callPeople, commitForm, formRow, grantPeople, makeEvent, previewForm, rawSql, read } from "../../helpers/people";

let oct: string;
let nov: string;
let taro: string;
let octImport: string;
const octRows = [formRow({ line: "たろう" }, 1), formRow({ line: "はなこ" }, 2)];
beforeEach(async () => {
  await resetDb();
  await grantPeople("u1");
  oct = await makeEvent("u1", "10月の会", "2026-10-11");
  nov = await makeEvent("u1", "11月の会", "2026-11-25");
  const [, imp] = await read<{ import: { id: string } }>(await commitForm("u1", oct, octRows));
  octImport = imp.import.id;
  const [row] = (await rawSql()`SELECT id FROM people.persons WHERE line_name = 'たろう'`) as { id: string }[];
  taro = row!.id;
  await commitForm("u1", nov, [formRow({ line: "たろう", at: "2026/11/25 21:00:00" }, 1)], [{ row: 0, action: "link", personId: taro }]);
  await callPeople("PATCH", `/persons/${taro}`, "u1", { memoTalk: "Pythonの話" });
});

/**
 * イベントの数字。
 * @param eventId - イベント
 * @returns 参加者数と消した人の数
 */
async function stats(eventId: string): Promise<{ attendeeCount: number; erasedCount: number }> {
  const [, body] = await read<{ stats: { attendeeCount: number; erasedCount: number } }>(await callPeople("GET", `/events/${eventId}`, "u1"));
  return body.stats;
}

describe("人を消す", () => {
  it("名前が違えば 400 CONFIRMATION_MISMATCH で何も消えない。ひらがなとカタカナの違いは同じとみなす", async () => {
    const [status, body] = await read<{ error: { code: string } }>(await callPeople("DELETE", `/persons/${taro}`, "u1", { confirmName: "はなこ" }));
    expect([status, body.error.code]).toEqual([400, "CONFIRMATION_MISMATCH"]);
    expect((await callPeople("GET", `/persons/${taro}`, "u1")).status).toBe(200);
    expect((await callPeople("DELETE", `/persons/${taro}`, "u1", {})).status).toBe(400);
    expect((await callPeople("DELETE", `/persons/${taro}`, "u1", { confirmName: "タロウ" })).status).toBe(204);
  });

  it("回答・会ったイベント・同意の記録が消え、一覧・探す・選べる値・人のページに出ない。参加者数は変わらない", async () => {
    await callPeople("PUT", `/persons/${taro}/consent`, "u1", { invite: true, work: true });
    const third = await makeEvent("u1", "12月の会", "2026-12-10");
    await callPeople("POST", `/persons/${taro}/attendances`, "u1", { eventId: third });
    const before = [await stats(oct), await stats(nov), await stats(third)];
    expect((await callPeople("DELETE", `/persons/${taro}`, "u1", { confirmName: "たろう" })).status).toBe(204);

    expect((await callPeople("GET", `/persons/${taro}`, "u1")).status).toBe(404);
    const [, list] = await read<{ persons: { displayName: string }[] }>(await callPeople("GET", "/persons?q=python", "u1"));
    expect(list.persons).toEqual([]);
    const sql = rawSql();
    const [left] = (await sql`SELECT
      (SELECT count(*) FROM people.responses WHERE person_id = ${taro})::int AS responses,
      (SELECT count(*) FROM people.manual_attendances WHERE person_id = ${taro})::int AS manual,
      (SELECT count(*) FROM people.consent_changes WHERE person_id = ${taro})::int AS changes,
      (SELECT count(*) FROM people.responses)::int AS all_responses`) as Record<string, number>[];
    expect(left).toEqual({ responses: 0, manual: 0, changes: 0, all_responses: 1 });
    const after = [await stats(oct), await stats(nov), await stats(third)];
    expect(after.map((s) => s.attendeeCount)).toEqual(before.map((s) => s.attendeeCount));
    expect(after.map((s) => s.erasedCount)).toEqual([1, 1, 1]);
    // 消した人の記録に、名前・答えは入っていない（番号・ハッシュ・時刻だけ）
    const cols = (await sql`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'people' AND table_name IN ('erased_attendances', 'erased_responses') ORDER BY 1, 2`) as {
      column_name: string;
    }[];
    expect(cols.every((c) => !/name|answer|memo/.test(c.column_name))).toBe(true);
  });

  it("その会の取り込みを取り消すと、消した人の分も数から抜ける", async () => {
    await callPeople("DELETE", `/persons/${taro}`, "u1", { confirmName: "たろう" });
    expect(await stats(oct)).toEqual({ attendeeCount: 2, erasedCount: 1 });
    expect((await callPeople("DELETE", `/imports/${octImport}`, "u1", { keepPeopleWithNotes: false })).status).toBe(200);
    expect(await stats(oct)).toEqual({ attendeeCount: 0, erasedCount: 0 });
  });

  it("同じCSVをもう一度プレビューすると、消した人の行は erased になる。別のイベントの回答は新しい人として入る", async () => {
    await callPeople("DELETE", `/persons/${taro}`, "u1", { confirmName: "たろう" });
    const [, preview] = await read<{ rows: { status: string }[] }>(await previewForm("u1", oct, octRows));
    expect(preview.rows.map((r) => r.status)).toEqual(["erased", "already_imported"]);
    const dec = await makeEvent("u1", "12月の会", "2026-12-10");
    const [, next] = await read<{ rows: { status: string }[] }>(await previewForm("u1", dec, [formRow({ line: "たろう", at: "2026/12/10 21:00:00" })]));
    expect(next.rows.map((r) => r.status)).toEqual(["new"]);
  });

  it("ほかの作り手の人は 404", async () => {
    await grantPeople("u2");
    expect((await callPeople("DELETE", `/persons/${taro}`, "u2", { confirmName: "たろう" })).status).toBe(404);
  });
});
