// 取り込みのプレビュー（specs/people/001-people-memo tasks.md T025、contracts/api.md 3-1、research.md R5〜R7）。
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../../helpers/app";
import { callPeople, commitForm, FORM_HEADERS, formRow, grantPeople, makeEvent, peopleCounts, previewForm, read } from "../../helpers/people";

type Preview = {
  columns: { header: string; field: string | null; source: string }[];
  mappingErrors: { code: string; field?: string }[];
  unknownConsentChoices: string[];
  summary: { newCount: number; candidateCount: number; duplicateInFileCount: number; skippedCount: number };
  rows: { row: number; status: string; invalidReason?: string; lineName?: string; consent?: { invite: boolean; work: boolean } }[];
};

let eventId: string;
beforeEach(async () => {
  await resetDb();
  await grantPeople("u1");
  eventId = await makeEvent("u1");
});

describe("列の対応", () => {
  it("初めから用意した質問文が当たり、当たらない列は null。送った対応が先", async () => {
    const [status, body] = await read<Preview>(await previewForm("u1", eventId, [formRow({ line: "たろう" })]));
    expect(status).toBe(200);
    expect(body.columns.map((c) => [c.field, c.source])).toEqual([
      ["submitted_at", "preset"],
      ["line_name", "preset"],
      [null, "none"],
      ["next_attendance", "preset"],
      ["bring_friends", "preset"],
      ["wanted_connections", "preset"],
      ["career_interests", "preset"],
      ["contact_consent", "preset"],
      [null, "none"],
    ]);
    const sent = FORM_HEADERS.map((_, i) => (i === 2 ? "other" : null));
    const [, again] = await read<Preview>(await previewForm("u1", eventId, [formRow({ line: "たろう" })], { columns: sent }));
    expect(again.columns[2]).toEqual({ header: "今日の満足度", field: "other", source: "sent" });
  });

  it("取り込んだあとは覚えた対応（remembered）が、初めから用意したものより先", async () => {
    const columns = FORM_HEADERS.map((_, i) => (i === 2 || i === 8 ? "other" : null));
    expect((await commitForm("u1", eventId, [formRow({ line: "たろう" })], [], { columns })).status).toBe(201);
    const [, body] = await read<Preview>(await previewForm("u1", eventId, [formRow({ line: "はなこ" })]));
    expect(body.columns.map((c) => c.source)).toEqual(Array(9).fill("remembered"));
  });

  it("LINE名の列がない・同じ項目に2列は mappingErrors（other は何列でもよい）。行は返さない", async () => {
    const noLine = FORM_HEADERS.map((_, i) => (i === 1 ? "other" : null));
    const [, a] = await read<Preview>(await previewForm("u1", eventId, [formRow({ line: "たろう" })], { columns: noLine }));
    expect(a.mappingErrors).toEqual([{ code: "line_name_missing" }]);
    expect(a.rows).toEqual([]);
    const dup = FORM_HEADERS.map((_, i) => (i === 2 ? "next_attendance" : i === 8 ? "other" : null));
    const [, b] = await read<Preview>(await previewForm("u1", eventId, [formRow({ line: "たろう" })], { columns: dup }));
    expect(b.mappingErrors).toEqual([{ code: "duplicate_field", field: "next_attendance" }]);
  });

  it("同意の列の知らない選択肢が unknownConsentChoices に出る。送れば消える", async () => {
    const rows = [formRow({ line: "たろう", consent: "交流会・勉強会の案内, メルマガ" })];
    const [, a] = await read<Preview>(await previewForm("u1", eventId, rows));
    expect(a.unknownConsentChoices).toEqual(["メルマガ"]);
    const [, b] = await read<Preview>(await previewForm("u1", eventId, rows, { consentChoices: { メルマガ: "invite" } }));
    expect(b.unknownConsentChoices).toEqual([]);
  });
});

describe("行の判定", () => {
  it("新しい行・取り込めない行・同意、数。何も書かない", async () => {
    const before = await peopleCounts();
    const rows = [
      formRow({ line: "たろう", consent: "交流会・勉強会の案内, 個別の案内は希望しない" }, 1),
      formRow({ line: "" }, 2),
      formRow({ line: "x".repeat(101) }, 3),
      formRow({ line: "はなこ", consent: "転職・求人情報" }, 4),
    ];
    const [, body] = await read<Preview>(await previewForm("u1", eventId, rows));
    expect(body.rows.map((r) => [r.row, r.status, r.invalidReason ?? null])).toEqual([
      [0, "new", null],
      [1, "invalid", "line_name_empty"],
      [2, "invalid", "line_name_too_long"],
      [3, "new", null],
    ]);
    expect(body.rows[0]!.consent).toEqual({ invite: false, work: false });
    expect(body.rows[3]!.consent).toEqual({ invite: false, work: true });
    // 取り込めない行には名前を返さない
    expect(body.rows[1]).toEqual({ row: 1, status: "invalid", invalidReason: "line_name_empty" });
    expect(body.summary).toEqual({ newCount: 2, candidateCount: 0, duplicateInFileCount: 0, skippedCount: 2 });
    expect(await peopleCounts()).toEqual(before);
  });

  it("もう取り込んだ行は already_imported", async () => {
    const rows = [formRow({ line: "たろう" }, 1), formRow({ line: "はなこ" }, 2)];
    await commitForm("u1", eventId, rows);
    const [, body] = await read<Preview>(await previewForm("u1", eventId, [...rows, formRow({ line: "じろう" }, 3)]));
    expect(body.rows.map((r) => r.status)).toEqual(["already_imported", "already_imported", "new"]);
    expect(body.summary.skippedCount).toBe(2);
  });
});

describe("上限", () => {
  it("行・列・見出し・値の上限を超えると 400 IMPORT_TOO_LARGE", async () => {
    const cases: [string[], string[][], string][] = [
      [FORM_HEADERS, Array.from({ length: 501 }, (_, i) => formRow({ line: `p${i}` }, i)), "too_many_rows"],
      [Array.from({ length: 61 }, (_, i) => `q${i}`), [], "too_many_columns"],
      [["x".repeat(501)], [], "header_too_long"],
      [FORM_HEADERS, [formRow({ line: "たろう", free: "x".repeat(5001) })], "cell_too_long"],
    ];
    for (const [headers, rows, reason] of cases) {
      const [status, body] = await read<{ error: { code: string; details: string[] } }>(await callPeople("POST", "/imports/preview", "u1", { eventId, headers, rows }));
      expect([status, body.error.code, body.error.details]).toEqual([400, "IMPORT_TOO_LARGE", [reason]]);
    }
  });

  it("本文が1.5MBを超えると 400 IMPORT_TOO_LARGE", async () => {
    const big = Array.from({ length: 400 }, (_, i) => formRow({ line: `p${i}`, free: "あ".repeat(1500) }, i));
    const [status, body] = await read<{ error: { code: string } }>(await previewForm("u1", eventId, big));
    expect([status, body.error.code]).toEqual([400, "IMPORT_TOO_LARGE"]);
  });

  it("ほかの作り手のイベントは 404", async () => {
    await grantPeople("u2");
    expect((await previewForm("u2", eventId, [formRow({ line: "たろう" })])).status).toBe(404);
  });
});
