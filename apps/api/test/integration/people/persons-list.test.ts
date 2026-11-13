// 人の一覧・探す・絞り込み・選べる値（specs/people/001-people-memo tasks.md T048、contracts/api.md 4、research.md R22）。
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../../helpers/app";
import { callPeople, commitForm, formRow, grantPeople, makeEvent, rawSql, read } from "../../helpers/people";

type Item = { id: string; displayName: string; lineName: string | null; lastMetOn: string | null; ownEventCount: number; consent: { invite: boolean } };
type List = { persons: Item[]; total: number };

let oct: string;
let nov: string;
beforeEach(async () => {
  await resetDb();
  await grantPeople("u1");
  oct = await makeEvent("u1", "10月の会", "2026-10-11");
  nov = await makeEvent("u1", "11月の会", "2026-11-25");
});

/**
 * 人の一覧を読む。
 * @param query - クエリ（? のあと）
 * @param user - 作り手
 * @returns 一覧
 */
async function list(query = "", user = "u1"): Promise<List> {
  const [status, body] = await read<List>(await callPeople("GET", `/persons${query ? `?${query}` : ""}`, user));
  expect(status).toBe(200);
  return body;
}

/**
 * 一覧の表示名だけ。
 * @param query - クエリ
 * @returns 表示名
 */
async function names(query = ""): Promise<string[]> {
  return (await list(query)).persons.map((p) => p.displayName);
}

/**
 * LINE名から人の番号を読む。
 * @param line - 今のLINE名
 * @returns 人の番号
 */
async function personId(line: string): Promise<string> {
  const [row] = (await rawSql()`SELECT id FROM people.persons WHERE line_name = ${line}`) as { id: string }[];
  return row!.id;
}

describe("探す", () => {
  it("本名・今のLINE名・前の回答のLINE名・手で足したときのLINE名・メモで探せる。ひらがなとカタカナ・全角と半角は区別しない", async () => {
    await commitForm("u1", oct, [formRow({ line: "さくら" }, 1), formRow({ line: "はなこ" }, 2)]);
    const sakura = await personId("さくら");
    await commitForm("u1", nov, [formRow({ line: "Sakura", at: "2026/11/25 21:00:00" }, 1)], [{ row: 0, action: "link", personId: sakura }]);
    const hanako = await personId("はなこ");
    expect((await callPeople("PATCH", `/persons/${hanako}`, "u1", { realName: "山田 花子", memoTalk: "Pythonの話をした" })).status).toBe(200);
    expect((await callPeople("POST", "/persons", "u1", { lineName: "まさと", consent: { invite: false, work: false } })).status).toBe(201);

    expect(await names("q=サクラ")).toEqual(["Sakura"]); // 前の回答のLINE名（カタカナで探してもひらがなに当たる）
    expect(await names("q=ｓａｋｕ")).toEqual(["Sakura"]); // 全角で探しても半角に当たる
    expect(await names("q=山田")).toEqual(["山田 花子"]);
    expect(await names("q=python")).toEqual(["山田 花子"]); // メモ（大文字と小文字を区別しない）
    expect(await names("q=マサト")).toEqual(["まさと"]);
    expect(await names(`q=${encodeURIComponent("%")}`)).toEqual([]);
    expect(await names("q=_")).toEqual([]);
  });

  it("ほかの作り手の人は出ない。同意に関わらず出る", async () => {
    await commitForm("u1", oct, [formRow({ line: "たろう", consent: "個別の案内は希望しない" })]);
    await grantPeople("u2");
    expect((await list("", "u2")).persons).toEqual([]);
    const [taro] = (await list()).persons;
    expect([taro!.displayName, taro!.consent.invite]).toEqual(["たろう", false]);
  });
});

describe("絞り込み", () => {
  it("答えの絞り込みは、いちばん新しい回答の答えで比べる。欲しいつながりは、どれか1つを含めば当たる", async () => {
    await commitForm("u1", oct, [
      formRow({ line: "たろう", next: "参加できそう", wanted: "エンジニアやSES企業とつながりたい" }, 1),
      formRow({ line: "はなこ", next: "参加できそう", wanted: "仕事の相談がしたい, 勉強会の仲間がほしい", career: "転職" }, 2),
    ]);
    const taro = await personId("たろう");
    await commitForm("u1", nov, [formRow({ line: "たろう", next: "難しい", at: "2026/11/25 21:00:00" }, 1)], [{ row: 0, action: "link", personId: taro }]);

    expect(await names(`next=${encodeURIComponent("参加できそう")}`)).toEqual(["はなこ"]);
    expect(await names(`next=${encodeURIComponent("難しい")}`)).toEqual(["たろう"]);
    expect(await names(`wanted=${encodeURIComponent("勉強会の仲間がほしい")}&wanted=${encodeURIComponent("存在しない")}`)).toEqual(["はなこ"]);
    expect(await names(`career=${encodeURIComponent("転職")}`)).toEqual(["はなこ"]);
  });

  it("来たイベント（回答か手で足した会ったイベント）・最後に会った日で絞る", async () => {
    await commitForm("u1", oct, [formRow({ line: "たろう" }, 1), formRow({ line: "はなこ" }, 2)]);
    await commitForm("u1", nov, [formRow({ line: "じろう", at: "2026/11/25 21:00:00" }, 1)]);
    const hanako = await personId("はなこ");
    expect((await callPeople("POST", `/persons/${hanako}/attendances`, "u1", { eventId: nov })).status).toBe(200);

    expect((await names(`eventId=${nov}`)).sort()).toEqual(["じろう", "はなこ"]);
    expect(await names("lastMetTo=2026-10-31")).toEqual(["たろう"]);
    expect((await names("lastMetFrom=2026-11-01")).sort()).toEqual(["じろう", "はなこ"]);
  });

  it("形の違うクエリは 400 VALIDATION_FAILED", async () => {
    expect((await callPeople("GET", "/persons?lastMetFrom=2026-13-01", "u1")).status).toBe(400);
    expect((await callPeople("GET", "/persons?eventId=x", "u1")).status).toBe(400);
  });
});

describe("並びと数", () => {
  it("最後に会った日の新しい順、同じなら名前の順。会っていない人は後ろ。自分の会の回数を持つ", async () => {
    const other = await makeEvent("u1", "よその会", "2026-12-01", false);
    await commitForm("u1", oct, [formRow({ line: "たろう" }, 1), formRow({ line: "あきら" }, 2)]);
    await commitForm("u1", other, [formRow({ line: "じろう", at: "2026/12/01 21:00:00" }, 1)]);
    const taro = await personId("たろう");
    await commitForm("u1", nov, [formRow({ line: "たろう", at: "2026/11/25 21:00:00" }, 1)], [{ row: 0, action: "link", personId: taro }]);
    await callPeople("POST", "/persons", "u1", { lineName: "みのる", consent: { invite: false, work: false } });

    const { persons, total } = await list();
    expect(persons.map((p) => [p.displayName, p.lastMetOn, p.ownEventCount])).toEqual([
      ["じろう", "2026-12-01", 0],
      ["たろう", "2026-11-25", 2],
      ["あきら", "2026-10-11", 1],
      ["みのる", null, 0],
    ]);
    expect(total).toBe(4);
  });

  it("100人ずつ返し、total は全体の数", async () => {
    await commitForm(
      "u1",
      oct,
      Array.from({ length: 101 }, (_, i) => formRow({ line: `p${String(i).padStart(3, "0")}`, at: `2026/10/11 ${String(10 + Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00` }, i)),
    );
    const first = await list();
    expect([first.persons.length, first.total]).toEqual([100, 101]);
    const second = await list("offset=100");
    expect([second.persons.length, second.persons[0]!.displayName]).toEqual([1, "p100"]);
  });
});

describe("選べる値", () => {
  it("いちばん新しい回答に出てくる値を、項目ごとに多い順で返す", async () => {
    await commitForm("u1", oct, [
      formRow({ line: "たろう", next: "参加できそう", wanted: "A, B" }, 1),
      formRow({ line: "はなこ", next: "参加できそう", wanted: "B" }, 2),
      formRow({ line: "じろう", next: "難しい", wanted: "B, C", career: "転職" }, 3),
    ]);
    const taro = await personId("たろう");
    await commitForm("u1", nov, [formRow({ line: "たろう", next: "難しい", wanted: "C", at: "2026/11/25 21:00:00" }, 1)], [{ row: 0, action: "link", personId: taro }]);
    const [status, body] = await read<Record<string, { value: string; count: number }[]>>(await callPeople("GET", "/facets", "u1"));
    expect(status).toBe(200);
    expect(body.nextAttendance).toEqual([
      { value: "難しい", count: 2 },
      { value: "参加できそう", count: 1 },
    ]);
    expect(body.wantedConnections).toEqual([
      { value: "B", count: 2 },
      { value: "C", count: 2 },
    ]);
    expect(body.careerInterests!.find((v) => v.value === "転職")).toEqual({ value: "転職", count: 1 });
  });
});
