// イベント（specs/people/001-people-memo tasks.md T024、contracts/api.md 2）。
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../../helpers/app";
import { callPeople, commitForm, formRow, grantPeople, makeEvent, read } from "../../helpers/people";

beforeEach(async () => {
  await resetDb();
  await grantPeople("u1");
});

describe("イベント", () => {
  it("作る・入力の誤りは 400 VALIDATION_FAILED", async () => {
    const [status, body] = await read<{ event: { name: string; heldOn: string; isOwn: boolean } }>(
      await callPeople("POST", "/events", "u1", { name: " IT交流会 ", heldOn: "2026-10-11", isOwn: true }),
    );
    expect([status, body.event.name, body.event.heldOn, body.event.isOwn]).toEqual([201, "IT交流会", "2026-10-11", true]);
    for (const bad of [
      { name: "", heldOn: "2026-10-11", isOwn: true },
      { name: "x".repeat(101), heldOn: "2026-10-11", isOwn: true },
      { name: "会", heldOn: "2026-13-01", isOwn: true },
      { name: "会", heldOn: "2026-10-11" },
    ]) {
      const [s, b] = await read<{ error: { code: string } }>(await callPeople("POST", "/events", "u1", bad));
      expect([s, b.error.code]).toEqual([400, "VALIDATION_FAILED"]);
    }
  });

  it("一覧は開催日の新しい順で、参加者数と取り込みの数を持つ。直すと変わる", async () => {
    const oct = await makeEvent("u1", "10月の会", "2026-10-11");
    const nov = await makeEvent("u1", "11月の会", "2026-11-25", false);
    await commitForm("u1", oct, [formRow({ line: "たろう" }, 1), formRow({ line: "はなこ" }, 2)]);
    const [, body] = await read<{ events: { id: string; attendeeCount: number; importCount: number; isOwn: boolean }[] }>(await callPeople("GET", "/events", "u1"));
    expect(body.events.map((e) => [e.id, e.attendeeCount, e.importCount, e.isOwn])).toEqual([
      [nov, 0, 0, false],
      [oct, 2, 1, true],
    ]);
    const [s, patched] = await read<{ event: { name: string; isOwn: boolean } }>(await callPeople("PATCH", `/events/${nov}`, "u1", { name: "11月の勉強会", isOwn: true }));
    expect([s, patched.event.name, patched.event.isOwn]).toEqual([200, "11月の勉強会", true]);
    expect((await callPeople("PATCH", `/events/${nov}`, "u1", {})).status).toBe(400);
  });

  it("イベントのページ：数字と取り込みの一覧、来た人の一覧", async () => {
    const oct = await makeEvent("u1");
    await commitForm("u1", oct, [formRow({ line: "たろう" }, 1), formRow({ line: "あきら" }, 2)]);
    const [, detail] = await read<{ stats: unknown; imports: { rowCount: number; importedCount: number; createdPeopleCount: number }[] }>(
      await callPeople("GET", `/events/${oct}`, "u1"),
    );
    expect(detail.stats).toEqual({ attendeeCount: 2, erasedCount: 0 });
    expect(detail.imports.map((i) => [i.rowCount, i.importedCount, i.createdPeopleCount])).toEqual([[2, 2, 2]]);
    const [, att] = await read<{ attendees: { displayName: string; via: string }[] }>(await callPeople("GET", `/events/${oct}/attendees`, "u1"));
    expect(att.attendees.map((a) => [a.displayName, a.via])).toEqual([
      ["あきら", "response"],
      ["たろう", "response"],
    ]);
  });
});
