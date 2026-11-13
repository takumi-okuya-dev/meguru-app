// 取り込み（書く。specs/people/001-people-memo tasks.md T026、contracts/api.md 3-2、research.md R6〜R11）。
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../../helpers/app";
import { callPeople, commitForm, FORM_HEADERS, formRow, grantPeople, makeEvent, peopleCounts, rawSql, read } from "../../helpers/people";

type Result = { import: { id: string; rowCount: number; importedCount: number; createdPeopleCount: number; linkedCount: number; skippedCount: number } };

let eventId: string;
beforeEach(async () => {
  await resetDb();
  await grantPeople("u1");
  eventId = await makeEvent("u1");
});

describe("取り込む", () => {
  it("人・回答・取り込みの数が書かれ、項目にあたらない答えも回答に残る", async () => {
    const rows = [
      formRow({ line: "たろう", wanted: "採用・人材の相談, 開発案件を相談・依頼", free: "もっと話したい" }, 1),
      formRow({ line: "はなこ", consent: "個別の案内は希望しない" }, 2),
      formRow({ line: "" }, 3),
    ];
    const [status, body] = await read<Result>(await commitForm("u1", eventId, rows));
    expect(status).toBe(201);
    expect(body.import).toMatchObject({ rowCount: 3, importedCount: 2, createdPeopleCount: 2, linkedCount: 0, skippedCount: 1 });
    const sql = rawSql();
    const responses = (await sql`SELECT line_name, wanted_connections, consent_invite, answers FROM people.responses ORDER BY line_name`) as {
      line_name: string;
      wanted_connections: string[];
      consent_invite: boolean;
      answers: { q: string; a: string }[];
    }[];
    expect(responses.map((r) => [r.line_name, r.consent_invite])).toEqual([
      ["たろう", true],
      ["はなこ", false],
    ]);
    expect(responses[0]!.wanted_connections).toEqual(["採用・人材の相談", "開発案件を相談・依頼"]);
    expect(responses[0]!.answers).toContainEqual({ q: "もっとこうだったら嬉しいこと", a: "もっと話したい" });
    expect(responses[0]!.answers).toContainEqual({ q: "今日の満足度", a: "5" });
  });

  it("人の同意は回答から決まり、consent_changes に1行（変わったときだけ）", async () => {
    await commitForm("u1", eventId, [formRow({ line: "たろう" }, 1)]);
    const sql = rawSql();
    const [p] = (await sql`SELECT consent_invite, consent_work, consent_source, consent_basis_on::text AS basis FROM people.persons`) as Record<string, unknown>[];
    expect(p).toEqual({ consent_invite: true, consent_work: false, consent_source: "response", basis: "2026-10-11" });
    const changes = (await sql`SELECT invite, work, source, basis_on::text AS basis FROM people.consent_changes`) as Record<string, unknown>[];
    expect(changes).toEqual([{ invite: true, work: false, source: "response", basis: "2026-10-11" }]);
  });

  it("列の対応と同意の選択肢の対応を覚える", async () => {
    const columns = FORM_HEADERS.map((_, i) => (i === 2 || i === 8 ? "other" : null));
    await commitForm("u1", eventId, [formRow({ line: "たろう", consent: "メルマガ" })], [], { columns, consentChoices: { メルマガ: "ignore" } });
    const sql = rawSql();
    const cols = (await sql`SELECT question_text, field FROM people.column_mappings ORDER BY question_text`) as { question_text: string; field: string }[];
    expect(cols).toHaveLength(9);
    expect(cols).toContainEqual({ question_text: "今日の満足度", field: "other" });
    const choices = (await sql`SELECT choice_text, purpose FROM people.choice_mappings`) as Record<string, string>[];
    expect(choices).toEqual([{ choice_text: "メルマガ", purpose: "ignore" }]);
  });

  it("項目のない列があると 400 IMPORT_MAPPING_INVALID、LINE名がないと details: line_name", async () => {
    const none = FORM_HEADERS.map(() => null);
    const [s1, b1] = await read<{ error: { code: string; details: string[] } }>(await commitForm("u1", eventId, [formRow({ line: "たろう" })], [], { columns: none }));
    expect([s1, b1.error.code, b1.error.details]).toEqual([400, "IMPORT_MAPPING_INVALID", ["columns"]]);
    const noLine = FORM_HEADERS.map((_, i) => (i === 1 ? "other" : "other"));
    const [, b2] = await read<{ error: { details: string[] } }>(await commitForm("u1", eventId, [formRow({ line: "たろう" })], [], { columns: noLine }));
    expect(b2.error.details).toEqual(["line_name"]);
    expect((await peopleCounts()).imports).toBe(0);
  });

  it("知らない同意の選択肢が残ると 409 IMPORT_DECISIONS_REQUIRED（consentChoices）で何も書かない", async () => {
    const columns = FORM_HEADERS.map((_, i) => (i === 2 || i === 8 ? "other" : null));
    const [status, body] = await read<{ error: { code: string; rows: number[]; consentChoices: string[] } }>(
      await commitForm("u1", eventId, [formRow({ line: "たろう", consent: "メルマガ" })], [], { columns }),
    );
    expect([status, body.error.code, body.error.rows, body.error.consentChoices]).toEqual([409, "IMPORT_DECISIONS_REQUIRED", [], ["メルマガ"]]);
    expect(await peopleCounts()).toMatchObject({ persons: 0, responses: 0, imports: 0, column_mappings: 0 });
  });
});

describe("二重にしない", () => {
  const columns = FORM_HEADERS.map((_, i) => (i === 2 || i === 8 ? "other" : null));
  it("同じCSVをもう一度書いても回答は増えない", async () => {
    const rows = [formRow({ line: "たろう" }, 1), formRow({ line: "はなこ" }, 2)];
    await commitForm("u1", eventId, rows, [], { columns });
    const [, body] = await read<Result>(await commitForm("u1", eventId, rows, [], { columns }));
    expect(body.import).toMatchObject({ importedCount: 0, createdPeopleCount: 0, skippedCount: 2 });
    expect(await peopleCounts()).toMatchObject({ persons: 2, responses: 2 });
  });

  it("同時に2つ送っても、回答と人は1回分だけ", async () => {
    const rows = [formRow({ line: "たろう" }, 1), formRow({ line: "はなこ" }, 2), formRow({ line: "じろう" }, 3)];
    const results = await Promise.all([commitForm("u1", eventId, rows, [], { columns }), commitForm("u1", eventId, rows, [], { columns })]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(await peopleCounts()).toMatchObject({ persons: 3, responses: 3 });
  });

  it("回答の時刻の列がないCSVでも二重にならない。印は64文字の16進で名前を含まない", async () => {
    const headers = ["あなたのLINE名を教えて下さい", "感想"];
    const body = { eventId, headers, rows: [["ログニデナイ太郎", "よかった"]], columns: ["line_name", "other"], decisions: [] };
    expect((await callPeople("POST", "/imports", "u1", body)).status).toBe(201);
    const [, again] = await read<Result>(await callPeople("POST", "/imports", "u1", body));
    expect(again.import.importedCount).toBe(0);
    const [r] = (await rawSql()`SELECT dedupe_hash FROM people.responses`) as { dedupe_hash: string }[];
    expect(r!.dedupe_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("同じ行が1つのCSVに2つあれば組になり、両方「別の人」でも回答は1つで、回答のない人は残らない", async () => {
    const row = formRow({ line: "たろう" }, 1);
    const [, body] = await read<Result>(
      await commitForm("u1", eventId, [row, row], [
        { row: 0, action: "new" },
        { row: 1, action: "new" },
      ], { columns }),
    );
    expect(body.import).toMatchObject({ importedCount: 1, createdPeopleCount: 1 });
    expect(await peopleCounts()).toMatchObject({ persons: 1, responses: 1 });
  });
});
