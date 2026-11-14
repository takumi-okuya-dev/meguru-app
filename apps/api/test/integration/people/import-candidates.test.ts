// 同じ人の候補（specs/people/001-people-memo tasks.md T038、FR-010・SC-004、research.md R9・R10）。
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../../helpers/app";
import { commitForm, formRow, grantPeople, makeEvent, peopleCounts, previewForm, rawSql, read } from "../../helpers/people";

type Candidate = { personId: string; displayName: string; lineName: string | null; otherLineNames: string[]; reasons: string[]; recentEvents: { name: string; heldOn: string }[]; latestAnswers: unknown };
type Preview = { rows: { row: number; status: string; groupId?: number; candidates?: Candidate[] }[]; summary: Record<string, number> };

let oct: string;
let nov: string;
beforeEach(async () => {
  await resetDb();
  await grantPeople("u1");
  oct = await makeEvent("u1", "10月の会", "2026-10-11");
  nov = await makeEvent("u1", "11月の会", "2026-11-25");
});

/**
 * 人の番号を LINE名で引く。
 * @param line - 今のLINE名
 * @returns 人の番号
 */
async function personId(line: string): Promise<string> {
  const [p] = (await rawSql()`SELECT id FROM people.persons WHERE line_name = ${line}`) as { id: string }[];
  return p!.id;
}

const novRow = (line: string, i: number, extra: Partial<Parameters<typeof formRow>[0]> = {}) => formRow({ line, at: `2026/11/25 21:0${i}:00`, ...extra }, i);

describe("候補になる条件", () => {
  it("LINE名が同じ・記号を除くと同じ・本名が同じ。候補の中身", async () => {
    await commitForm("u1", oct, [formRow({ line: "ﾀﾛｳ", next: "参加できそう" }, 1), formRow({ line: "はなこ🌸" }, 2), formRow({ line: "けんじ" }, 3)]);
    const [, body] = await read<Preview>(await previewForm("u1", nov, [novRow("たろう", 1), novRow("はなこ🌻", 2), novRow("あきら", 3)]));
    expect(body.rows.map((r) => r.status)).toEqual(["candidate", "candidate", "new"]);
    const taro = body.rows[0]!.candidates![0]!;
    expect(taro).toMatchObject({ displayName: "ﾀﾛｳ", reasons: ["line_name"], recentEvents: [{ name: "10月の会", heldOn: "2026-10-11" }] });
    expect(taro.latestAnswers).toMatchObject({ nextAttendance: "参加できそう" });
    expect(body.rows[1]!.candidates![0]!.reasons).toEqual(["line_name_loose"]);
    expect(body.summary).toMatchObject({ newCount: 1, candidateCount: 2 });
  });

  it("前の回答のLINE名（別名）でも候補になる", async () => {
    await commitForm("u1", oct, [formRow({ line: "たろう" }, 1)]);
    const id = await personId("たろう");
    await commitForm("u1", nov, [novRow("Taro", 1)], [{ row: 0, action: "link", personId: id }]);
    const dec = await makeEvent("u1", "12月の会", "2026-12-13");
    const [, body] = await read<Preview>(await previewForm("u1", dec, [formRow({ line: "たろう", at: "2026/12/13 21:00:00" }, 1)]));
    const c = body.rows[0]!.candidates![0]!;
    expect([c.lineName, c.otherLineNames, c.reasons]).toEqual(["Taro", ["たろう"], ["line_name"]]);
    expect(c.recentEvents.map((e) => e.name)).toEqual(["11月の会", "10月の会"]);
  });
});

describe("決めないと取り込まない", () => {
  it("決めのない候補の行があると 409 で何も書かない。link でつながり、new で別の人", async () => {
    await commitForm("u1", oct, [formRow({ line: "たろう" }, 1), formRow({ line: "はなこ" }, 2)]);
    const before = await peopleCounts();
    const rows = [novRow("たろう", 1), novRow("はなこ", 2)];
    const [status, body] = await read<{ error: { code: string; rows: number[] } }>(await commitForm("u1", nov, rows));
    expect([status, body.error.code, body.error.rows]).toEqual([409, "IMPORT_DECISIONS_REQUIRED", [0, 1]]);
    expect(await peopleCounts()).toEqual(before);

    const taro = await personId("たろう");
    const [s2, r2] = await read<{ import: Record<string, number> }>(
      await commitForm("u1", nov, rows, [
        { row: 0, action: "link", personId: taro },
        { row: 1, action: "new" },
      ]),
    );
    expect([s2, r2.import.linkedCount, r2.import.createdPeopleCount]).toEqual([201, 1, 1]);
    const people = (await rawSql()`SELECT p.line_name, count(r.id)::int AS n FROM people.persons p JOIN people.responses r ON r.person_id = p.id GROUP BY p.id ORDER BY p.line_name, n`) as Record<string, unknown>[];
    expect(people).toEqual([
      { line_name: "たろう", n: 2 },
      { line_name: "はなこ", n: 1 },
      { line_name: "はなこ", n: 1 },
    ]);
  });

  it("link で今のLINE名が新しい回答のものに変わり、前のLINE名は別名に残る", async () => {
    await commitForm("u1", oct, [formRow({ line: "たろう" }, 1)]);
    const taro = await personId("たろう");
    await commitForm("u1", nov, [novRow("Taro🍺", 1)], [{ row: 0, action: "link", personId: taro }]);
    const [p] = (await rawSql()`SELECT line_name FROM people.persons WHERE id = ${taro}`) as { line_name: string }[];
    expect(p!.line_name).toBe("Taro🍺");
  });

  it("1つの取り込みで2つの行を同じ人に link すると 400、ほかの作り手の人への link は 404", async () => {
    await commitForm("u1", oct, [formRow({ line: "たろう" }, 1)]);
    const taro = await personId("たろう");
    const rows = [novRow("たろう", 1), novRow("たろう2", 2)];
    const [s1] = await read(await commitForm("u1", nov, rows, [
      { row: 0, action: "link", personId: taro },
      { row: 1, action: "link", personId: taro },
    ]));
    expect(s1).toBe(400);
    await grantPeople("u2");
    const other = await makeEvent("u2");
    expect((await commitForm("u2", other, [formRow({ line: "だれか" }, 1)], [{ row: 0, action: "link", personId: taro }])).status).toBe(404);
  });

  it("1つのCSVの中の同じLINE名は組になり、全部に決めが要る（1つを残してほかを skip）", async () => {
    const rows = [formRow({ line: "たろう" }, 1), formRow({ line: "タロウ" }, 2), formRow({ line: "はなこ" }, 3)];
    const [, body] = await read<Preview>(await previewForm("u1", oct, rows));
    expect(body.rows.map((r) => [r.status, r.groupId ?? null])).toEqual([
      ["duplicate_in_file", 0],
      ["duplicate_in_file", 0],
      ["new", null],
    ]);
    expect((await commitForm("u1", oct, rows, [{ row: 0, action: "new" }])).status).toBe(409);
    const [, ok] = await read<{ import: Record<string, number> }>(
      await commitForm("u1", oct, rows, [
        { row: 0, action: "new" },
        { row: 1, action: "skip" },
      ]),
    );
    expect(ok.import).toMatchObject({ importedCount: 2, createdPeopleCount: 2, skippedCount: 1 });
  });

  it("プレビューのあとで同じLINE名の人が増えたら、書く方が 409（勝手につながない）", async () => {
    const rows = [formRow({ line: "たろう" }, 1)];
    const [, preview] = await read<Preview>(await previewForm("u1", nov, rows));
    expect(preview.rows[0]!.status).toBe("new");
    await commitForm("u1", oct, [formRow({ line: "たろう" }, 5)]);
    const [status] = await read(await commitForm("u1", nov, rows));
    expect(status).toBe(409);
  });
});
