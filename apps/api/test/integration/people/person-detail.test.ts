// 人のページ・直す・同意を直す（specs/people/001-people-memo tasks.md T049、contracts/api.md 4、research.md R10・R11）。
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../../helpers/app";
import { callPeople, commitForm, formRow, grantPeople, makeEvent, rawSql, read } from "../../helpers/people";

type Detail = {
  person: {
    id: string;
    displayName: string;
    realName: string | null;
    lineName: string | null;
    otherLineNames: string[];
    memoAppearance: string | null;
    memoTalk: string | null;
    consent: { invite: boolean; work: boolean; source: string; basisOn: string | null };
    lastMetOn: string | null;
  };
  attendances: { event: { name: string; heldOn: string }; via: string; responses: { lineName: string; nextAttendance: string | null; answers: { q: string; a: string }[] }[] }[];
  consentChanges: { invite: boolean; work: boolean; source: string; basisOn: string }[];
  outreaches: unknown[];
};

let oct: string;
let nov: string;
let taro: string;
beforeEach(async () => {
  await resetDb();
  await grantPeople("u1");
  oct = await makeEvent("u1", "10月の会", "2026-10-11");
  nov = await makeEvent("u1", "11月の会", "2026-11-25");
  await commitForm("u1", oct, [formRow({ line: "たろう", next: "参加できそう" })]);
  const [row] = (await rawSql()`SELECT id FROM people.persons`) as { id: string }[];
  taro = row!.id;
});

/**
 * 人のページを読む。
 * @param id - 人の番号
 * @returns 人のページ
 */
async function detail(id = taro): Promise<Detail> {
  const [status, body] = await read<Detail>(await callPeople("GET", `/persons/${id}`, "u1"));
  expect(status).toBe(200);
  return body;
}

describe("人のページ", () => {
  it("来たイベントは新しい順で、イベントごとの回答と答えを持つ。別名は前の回答のLINE名", async () => {
    await commitForm("u1", nov, [formRow({ line: "たろう🌸", next: "難しい", at: "2026/11/25 21:00:00" })], [{ row: 0, action: "link", personId: taro }]);
    const d = await detail();
    expect([d.person.displayName, d.person.lineName, d.person.otherLineNames, d.person.lastMetOn]).toEqual(["たろう🌸", "たろう🌸", ["たろう"], "2026-11-25"]);
    expect(d.attendances.map((a) => [a.event.name, a.via, a.responses.map((r) => r.nextAttendance)])).toEqual([
      ["11月の会", "response", ["難しい"]],
      ["10月の会", "response", ["参加できそう"]],
    ]);
    expect(d.attendances[0]!.responses[0]!.answers.find((x) => x.q === "今日の満足度")).toEqual({ q: "今日の満足度", a: "5" });
    expect(d.person.consent).toMatchObject({ invite: true, source: "response", basisOn: "2026-11-25" });
    expect(d.outreaches).toEqual([]);
  });

  it("ほかの作り手の人・形の違う番号は 404", async () => {
    await grantPeople("u2");
    expect((await callPeople("GET", `/persons/${taro}`, "u2")).status).toBe(404);
    expect((await callPeople("GET", "/persons/x", "u1")).status).toBe(404);
    expect((await callPeople("PATCH", `/persons/${taro}`, "u2", { memoTalk: "x" })).status).toBe(404);
  });
});

describe("直す", () => {
  it("本名・見た目の特徴・話したことを直せる。本名を直すと、新しい本名で探せる。空のメモは null", async () => {
    const [status] = await read(await callPeople("PATCH", `/persons/${taro}`, "u1", { realName: "鈴木 太郎", memoAppearance: "メガネ", memoTalk: "Pythonの話" }));
    expect(status).toBe(200);
    let d = await detail();
    expect([d.person.displayName, d.person.realName, d.person.memoAppearance, d.person.memoTalk]).toEqual(["鈴木 太郎", "鈴木 太郎", "メガネ", "Pythonの話"]);
    const [, found] = await read<{ persons: { id: string }[] }>(await callPeople("GET", `/persons?q=${encodeURIComponent("すずき")}`, "u1"));
    expect(found.persons).toEqual([]); // 漢字の本名は読みでは当たらない
    const [, found2] = await read<{ persons: { id: string }[] }>(await callPeople("GET", `/persons?q=${encodeURIComponent("鈴木")}`, "u1"));
    expect(found2.persons.map((p) => p.id)).toEqual([taro]);
    await callPeople("PATCH", `/persons/${taro}`, "u1", { realName: null, memoAppearance: "  " });
    d = await detail();
    expect([d.person.displayName, d.person.realName, d.person.memoAppearance]).toEqual(["たろう", null, null]);
  });

  it("上限を超える・空の本文は 400 VALIDATION_FAILED", async () => {
    for (const bad of [{ realName: "" }, { realName: "x".repeat(101) }, { memoAppearance: "x".repeat(301) }, { memoTalk: "x".repeat(1001) }, {}]) {
      const [status, body] = await read<{ error: { code: string } }>(await callPeople("PATCH", `/persons/${taro}`, "u1", bad));
      expect([status, body.error.code]).toEqual([400, "VALIDATION_FAILED"]);
    }
  });
});

describe("同意を直す", () => {
  it("手で直すと source = manual で記録が1行増える。そのあと新しいイベントの回答を取り込むと回答の同意に変わり、前のイベントの回答では変わらない", async () => {
    const [status, body] = await read<{ consent: { invite: boolean; work: boolean; source: string } }>(
      await callPeople("PUT", `/persons/${taro}/consent`, "u1", { invite: false, work: true }),
    );
    expect([status, body.consent]).toEqual([200, expect.objectContaining({ invite: false, work: true, source: "manual" })]);
    let d = await detail();
    expect(d.consentChanges.map((c) => [c.source, c.invite, c.work])).toEqual([
      ["manual", false, true],
      ["response", true, false],
    ]);

    // 前のイベント（9月）の回答をあとから取り込んでも、手直しの方が新しい
    const sep = await makeEvent("u1", "9月の会", "2026-09-10");
    await commitForm("u1", sep, [formRow({ line: "たろう", at: "2026/09/10 21:00:00" })], [{ row: 0, action: "link", personId: taro }]);
    d = await detail();
    expect(d.person.consent).toMatchObject({ invite: false, work: true, source: "manual" });

    // 12月（直した日より新しい開催日）の回答で、回答の同意に変わる
    const dec = await makeEvent("u1", "12月の会", "2099-12-10");
    await commitForm("u1", dec, [formRow({ line: "たろう", at: "2099/12/10 21:00:00", consent: "交流会・勉強会の案内" })], [{ row: 0, action: "link", personId: taro }]);
    d = await detail();
    expect(d.person.consent).toMatchObject({ invite: true, work: false, source: "response", basisOn: "2099-12-10" });
  });

  it("形が違えば 400", async () => {
    expect((await callPeople("PUT", `/persons/${taro}/consent`, "u1", { invite: true })).status).toBe(400);
  });
});
