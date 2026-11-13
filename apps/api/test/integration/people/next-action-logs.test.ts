// 次にやること・誕生日・ホーム・連絡の記録（specs/people/002-sales-list tasks.md T203・T204、FR-104〜FR-106）。
import { jstDate } from "@meguru/shared/people";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../../helpers/app";
import { callPeople, commitForm, formRow, grantPeople, makeEvent, rawSql, read } from "../../helpers/people";

type HomeItem = { id: string; displayName: string; nextAction: { on: string; note: string } | null; birthdayMd: string | null };
type Log = { id: string; contactedOn: string; channel: string; note: string };

/**
 * 今日から n 日ずらした日本時間の日付。
 * @param n - ずらす日数
 * @returns YYYY-MM-DD
 */
function day(n: number): string {
  return jstDate(new Date(Date.now() + n * 86_400_000));
}

let ids: Record<string, string>;
beforeEach(async () => {
  await resetDb();
  await grantPeople("u1");
  const oct = await makeEvent("u1", "10月の会", "2026-10-11");
  await commitForm("u1", oct, [formRow({ line: "たろう" }, 1), formRow({ line: "はなこ" }, 2), formRow({ line: "じろう" }, 3)]);
  ids = Object.fromEntries(((await rawSql()`SELECT id, line_name FROM people.persons`) as { id: string; line_name: string }[]).map((r) => [r.line_name, r.id]));
});

describe("次にやること", () => {
  it("決める（日付と文は一緒に）・人のページと一覧に出る・両方 null で消す", async () => {
    expect((await callPeople("PATCH", `/persons/${ids["たろう"]}`, "u1", { nextActionOn: day(0), nextActionNote: "12月の会の案内を送る" })).status).toBe(200);
    expect((await callPeople("PATCH", `/persons/${ids["たろう"]}`, "u1", { nextActionOn: day(0) })).status).toBe(400);
    expect((await callPeople("PATCH", `/persons/${ids["たろう"]}`, "u1", { nextActionOn: day(0), nextActionNote: "あ".repeat(201) })).status).toBe(400);
    const [, d] = await read<{ person: { nextAction: unknown } }>(await callPeople("GET", `/persons/${ids["たろう"]}`, "u1"));
    expect(d.person.nextAction).toEqual({ on: day(0), note: "12月の会の案内を送る" });
    const [, list] = await read<{ persons: { displayName: string; nextAction: unknown }[] }>(await callPeople("GET", "/persons", "u1"));
    expect(list.persons.find((p) => p.displayName === "たろう")!.nextAction).toEqual({ on: day(0), note: "12月の会の案内を送る" });
    await callPeople("PATCH", `/persons/${ids["たろう"]}`, "u1", { nextActionOn: null, nextActionNote: null });
    const [, d2] = await read<{ person: { nextAction: unknown } }>(await callPeople("GET", `/persons/${ids["たろう"]}`, "u1"));
    expect(d2.person.nextAction).toBeNull();
  });

  it("ホームに今日やること・過ぎたもの（日付の順）・近い誕生日（7日以内）", async () => {
    await callPeople("PATCH", `/persons/${ids["たろう"]}`, "u1", { nextActionOn: day(0), nextActionNote: "今日" });
    await callPeople("PATCH", `/persons/${ids["はなこ"]}`, "u1", { nextActionOn: day(-3), nextActionNote: "3日前" });
    await callPeople("PATCH", `/persons/${ids["じろう"]}`, "u1", { nextActionOn: day(-1), nextActionNote: "昨日" });
    const md = (n: number) => day(n).slice(5);
    await callPeople("PATCH", `/persons/${ids["たろう"]}`, "u1", { birthdayMd: md(2) });
    await callPeople("PATCH", `/persons/${ids["はなこ"]}`, "u1", { birthdayMd: md(10) });
    const [status, home] = await read<{ today: HomeItem[]; overdue: HomeItem[]; birthdays: HomeItem[] }>(await callPeople("GET", "/home", "u1"));
    expect(status).toBe(200);
    expect(home.today.map((p) => p.displayName)).toEqual(["たろう"]);
    expect(home.overdue.map((p) => p.displayName)).toEqual(["はなこ", "じろう"]);
    expect(home.birthdays.map((p) => [p.displayName, p.birthdayMd])).toEqual([["たろう", md(2)]]);
  });

  it("誕生日の形が違えば 400", async () => {
    for (const bad of ["13-01", "1-1", "02-30x", "2026-01-01", "02-30", "02-31", "04-31"]) {
      expect((await callPeople("PATCH", `/persons/${ids["たろう"]}`, "u1", { birthdayMd: bad })).status).toBe(400);
    }
  });

  it("終わった：次にやることを消し、記録に写す（log: true）・写さない（log: false）", async () => {
    await callPeople("PATCH", `/persons/${ids["たろう"]}`, "u1", { nextActionOn: day(-1), nextActionNote: "案内を送る" });
    expect((await callPeople("POST", `/persons/${ids["たろう"]}/next-action/done`, "u1", { log: true })).status).toBe(200);
    const [, d] = await read<{ person: { nextAction: unknown }; contactLogs: Log[] }>(await callPeople("GET", `/persons/${ids["たろう"]}`, "u1"));
    expect([d.person.nextAction, d.contactLogs.map((l) => [l.channel, l.note, l.contactedOn])]).toEqual([null, [["done", "案内を送る", day(0)]]]);
    await callPeople("PATCH", `/persons/${ids["はなこ"]}`, "u1", { nextActionOn: day(0), nextActionNote: "x" });
    await callPeople("POST", `/persons/${ids["はなこ"]}/next-action/done`, "u1", { log: false });
    const [, d2] = await read<{ contactLogs: Log[] }>(await callPeople("GET", `/persons/${ids["はなこ"]}`, "u1"));
    expect(d2.contactLogs).toEqual([]);
    // 次にやることがない人は 400
    expect((await callPeople("POST", `/persons/${ids["じろう"]}/next-action/done`, "u1", { log: true })).status).toBe(400);
  });
});

describe("うるう日の誕生日と、更新順", () => {
  it("2月29日の誕生日を入れられる。連絡の記録を足すと、一覧の更新順で先に出る", async () => {
    expect((await callPeople("PATCH", `/persons/${ids["じろう"]}`, "u1", { birthdayMd: "02-29" })).status).toBe(200);
    await callPeople("PATCH", `/persons/${ids["はなこ"]}`, "u1", { memoTalk: "x" });
    await callPeople("POST", `/persons/${ids["たろう"]}/contact-logs`, "u1", { contactedOn: "2026-11-01", channel: "line", note: "あいさつ" });
    const [, list] = await read<{ persons: { displayName: string }[] }>(await callPeople("GET", "/persons?sort=updated", "u1"));
    expect(list.persons[0]!.displayName).toBe("たろう");
  });
});

describe("連絡の記録", () => {
  it("足す・直す・消す。新しい順。探す欄で当たる。ほかの作り手は404", async () => {
    const add = (contactedOn: string, note: string, channel = "line") => callPeople("POST", `/persons/${ids["たろう"]}/contact-logs`, "u1", { contactedOn, channel, note });
    const [s1, b1] = await read<{ log: Log }>(await add("2026-10-12", "お礼を送った"));
    expect([s1, b1.log.channel]).toEqual([201, "line"]);
    await add("2026-11-01", "会場でGoの話", "venue");
    expect((await add("2026-11-01", "")).status).toBe(400);
    expect((await callPeople("POST", `/persons/${ids["たろう"]}/contact-logs`, "u1", { contactedOn: "2026-11-01", channel: "done", note: "x" })).status).toBe(400);
    expect((await callPeople("PATCH", `/contact-logs/${b1.log.id}`, "u1", { channel: "done" })).status).toBe(400);
    const [, d] = await read<{ contactLogs: Log[] }>(await callPeople("GET", `/persons/${ids["たろう"]}`, "u1"));
    expect(d.contactLogs.map((l) => l.note)).toEqual(["会場でGoの話", "お礼を送った"]);
    expect((await callPeople("PATCH", `/contact-logs/${b1.log.id}`, "u1", { note: "お礼のLINE" })).status).toBe(200);
    const [, found] = await read<{ persons: { displayName: string }[] }>(await callPeople("GET", `/persons?q=${encodeURIComponent("お礼のline")}`, "u1"));
    expect(found.persons.map((p) => p.displayName)).toEqual(["たろう"]);
    await grantPeople("u2");
    expect((await callPeople("PATCH", `/contact-logs/${b1.log.id}`, "u2", { note: "x" })).status).toBe(404);
    expect((await callPeople("DELETE", `/contact-logs/${b1.log.id}`, "u2")).status).toBe(404);
    expect((await callPeople("POST", `/persons/${ids["たろう"]}/contact-logs`, "u2", { contactedOn: "2026-11-01", channel: "line", note: "x" })).status).toBe(404);
    expect((await callPeople("DELETE", `/contact-logs/${b1.log.id}`, "u1")).status).toBe(204);
    const [, d2] = await read<{ contactLogs: Log[] }>(await callPeople("GET", `/persons/${ids["たろう"]}`, "u1"));
    expect(d2.contactLogs.map((l) => l.note)).toEqual(["会場でGoの話"]);
  });
});
