// 設定・数字・リピーター・初めて／前にも（specs/people/001-people-memo tasks.md T072・T084、contracts/api.md 2・6、research.md R12・R17）。
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../../helpers/app";
import { callPeople, commitForm, formRow, grantPeople, makeEvent, rawSql, read } from "../../helpers/people";

beforeEach(async () => {
  await resetDb();
  await grantPeople("u1");
});

describe("設定", () => {
  it("初めは両方 null。直すと読める。型の空白だけは null（初めの型）に戻る", async () => {
    expect(await read(await callPeople("GET", "/settings", "u1"))).toEqual([200, { inviteTemplate: null, repeaterGoal: null }]);
    expect(await read(await callPeople("PUT", "/settings", "u1", { inviteTemplate: "{名前}さん、来てね", repeaterGoal: 10 }))).toEqual([
      200,
      { inviteTemplate: "{名前}さん、来てね", repeaterGoal: 10 },
    ]);
    expect(await read(await callPeople("PUT", "/settings", "u1", { inviteTemplate: "  " }))).toEqual([200, { inviteTemplate: null, repeaterGoal: 10 }]);
    expect(await read(await callPeople("PUT", "/settings", "u1", { repeaterGoal: null }))).toEqual([200, { inviteTemplate: null, repeaterGoal: null }]);
  });

  it("上限を超える・形の違う値・空の本文は 400。ほかの作り手の設定は見えない", async () => {
    for (const bad of [{ inviteTemplate: "あ".repeat(501) }, { repeaterGoal: 0 }, { repeaterGoal: 10_001 }, { repeaterGoal: 1.5 }, {}]) {
      expect((await callPeople("PUT", "/settings", "u1", bad)).status).toBe(400);
    }
    expect((await callPeople("PUT", "/settings", "u1", { inviteTemplate: "🌸".repeat(500) })).status).toBe(200);
    await grantPeople("u2");
    expect(await read(await callPeople("GET", "/settings", "u2"))).toEqual([200, { inviteTemplate: null, repeaterGoal: null }]);
  });
});

describe("数字", () => {
  it("nextOwnEvent は今日以降でいちばん近い自分の会。なければ null", async () => {
    const [, none] = await read<{ nextOwnEvent: unknown }>(await callPeople("GET", "/stats", "u1"));
    expect(none.nextOwnEvent).toBeNull();
    await makeEvent("u1", "前の会", "2020-01-01");
    await makeEvent("u1", "よその会", "2099-01-01", false);
    await makeEvent("u1", "遠い会", "2099-12-01");
    await makeEvent("u1", "近い会", "2099-02-01");
    const [, body] = await read<{ nextOwnEvent: { name: string } }>(await callPeople("GET", "/stats", "u1"));
    expect(body.nextOwnEvent).toMatchObject({ name: "近い会" });
  });

  it("リピーターは自分の会に2回以上来た人（よその会は数えない・手で足した会ったイベントは数える・同じ会に回答が2つでも1回）", async () => {
    const oct = await makeEvent("u1", "10月の会", "2026-10-11");
    const nov = await makeEvent("u1", "11月の会", "2026-11-25");
    const other = await makeEvent("u1", "よその会", "2026-11-01", false);
    await callPeople("PUT", "/settings", "u1", { repeaterGoal: 10 });
    await commitForm("u1", oct, [formRow({ line: "たろう" }, 1), formRow({ line: "はなこ" }, 2), formRow({ line: "じろう" }, 3)]);
    const ids = Object.fromEntries(((await rawSql()`SELECT id, line_name FROM people.persons`) as { id: string; line_name: string }[]).map((r) => [r.line_name, r.id]));
    // たろう：11月にも回答 → 2回
    await commitForm("u1", nov, [formRow({ line: "たろう", at: "2026/11/25 21:00:00" }, 1)], [{ row: 0, action: "link", personId: ids["たろう"] }]);
    // はなこ：11月は手で足した会ったイベント → 2回
    await callPeople("POST", `/persons/${ids["はなこ"]}/attendances`, "u1", { eventId: nov });
    // じろう：よその会と、10月の会にもう1つの回答 → 1回
    await commitForm("u1", other, [formRow({ line: "じろう", at: "2026/11/01 21:00:00" }, 1)], [{ row: 0, action: "link", personId: ids["じろう"] }]);
    await commitForm("u1", oct, [formRow({ line: "じろう", at: "2026/10/11 22:59:00" }, 9)], [{ row: 0, action: "link", personId: ids["じろう"] }]);
    const [, body] = await read<{ repeaterCount: number; repeaterGoal: number }>(await callPeople("GET", "/stats", "u1"));
    expect([body.repeaterCount, body.repeaterGoal]).toEqual([2, 10]);
  });

  it("自分の会の数字に初めて・前にも来た人、来た人の一覧に firstTime。同じ日の会は前に数えない。消した人は別に出る。開催日・自分の会かを直すと変わる", async () => {
    const oct = await makeEvent("u1", "10月の会", "2026-10-11");
    const octSame = await makeEvent("u1", "10月の会（昼）", "2026-10-11");
    const nov = await makeEvent("u1", "11月の会", "2026-11-25");
    await commitForm("u1", oct, [formRow({ line: "たろう" }, 1), formRow({ line: "はなこ" }, 2)]);
    const ids = Object.fromEntries(((await rawSql()`SELECT id, line_name FROM people.persons`) as { id: string; line_name: string }[]).map((r) => [r.line_name, r.id]));
    await callPeople("POST", `/persons/${ids["はなこ"]}/attendances`, "u1", { eventId: octSame });
    await commitForm("u1", nov, [formRow({ line: "たろう", at: "2026/11/25 21:00:00" }, 1), formRow({ line: "じろう", at: "2026/11/25 21:01:00" }, 2), formRow({ line: "さぶろう", at: "2026/11/25 21:02:00" }, 3)], [
      { row: 0, action: "link", personId: ids["たろう"] },
    ]);
    const [saburo] = (await rawSql()`SELECT id FROM people.persons WHERE line_name = 'さぶろう'`) as { id: string }[];
    await callPeople("DELETE", `/persons/${saburo!.id}`, "u1", { confirmName: "さぶろう" });

    type Stats = { stats: { attendeeCount: number; firstTimeCount?: number; returningCount?: number; erasedCount: number } };
    const stats = async (id: string) => (await read<Stats>(await callPeople("GET", `/events/${id}`, "u1")))[1].stats;
    expect(await stats(nov)).toEqual({ attendeeCount: 3, firstTimeCount: 1, returningCount: 1, erasedCount: 1 });
    // 同じ日の自分の会は「前」に数えない
    expect(await stats(octSame)).toEqual({ attendeeCount: 1, firstTimeCount: 1, returningCount: 0, erasedCount: 0 });
    const [, att] = await read<{ attendees: { displayName: string; firstTime?: boolean }[] }>(await callPeople("GET", `/events/${nov}/attendees`, "u1"));
    expect(att.attendees.map((a) => [a.displayName, a.firstTime])).toEqual([
      ["じろう", true],
      ["たろう", false],
    ]);
    // 10月の会をよその会にすると、11月のたろうは初めてになる
    await callPeople("PATCH", `/events/${oct}`, "u1", { isOwn: false });
    expect(await stats(nov)).toEqual({ attendeeCount: 3, firstTimeCount: 2, returningCount: 0, erasedCount: 1 });
    // よその会には初めて・前にもを出さない
    expect(await stats(oct)).toEqual({ attendeeCount: 2, erasedCount: 0 });
  });
});
