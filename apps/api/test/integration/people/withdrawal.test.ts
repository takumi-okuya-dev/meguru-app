// 退会の受け取りと、ログに名前を出さないこと（specs/people/001-people-memo tasks.md T044・T047、contracts/events.md、research.md R18・R19）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEvent } from "../../../src/apps/people/events/event-service";
import { onUserWithdrawn } from "../../../src/apps/people/inbox/withdrawal";
import type { PlatformEvent } from "../../../src/platform";
import { db, resetDb, testEnv } from "../../helpers/app";
import { callPeople, commitForm, FORM_HEADERS, formRow, grantPeople, makeEvent, rawSql, read } from "../../helpers/people";

/**
 * 退会の出来事を作る。
 * @param userId - 退会した人
 * @param id - 出来事の番号
 * @returns 出来事
 */
function withdrawn(userId: string, id = crypto.randomUUID()): PlatformEvent<"user.withdrawn"> {
  return { id, type: "user.withdrawn", payload: { userId }, createdAt: new Date() } as unknown as PlatformEvent<"user.withdrawn">;
}

/**
 * 作り手ごとの人物メモの行の数。
 * @param userId - 作り手
 * @returns 表ごとの数
 */
async function rowsOf(userId: string) {
  const [r] = (await rawSql()`SELECT
    (SELECT count(*) FROM people.events WHERE user_id = ${userId})::int AS events,
    (SELECT count(*) FROM people.imports WHERE user_id = ${userId})::int AS imports,
    (SELECT count(*) FROM people.responses WHERE user_id = ${userId})::int AS responses,
    (SELECT count(*) FROM people.persons WHERE user_id = ${userId})::int AS persons,
    (SELECT count(*) FROM people.consent_changes WHERE user_id = ${userId})::int AS consent_changes,
    (SELECT count(*) FROM people.column_mappings WHERE user_id = ${userId})::int AS column_mappings,
    (SELECT count(*) FROM people.outreaches WHERE user_id = ${userId})::int AS outreaches,
    (SELECT count(*) FROM people.owner_settings WHERE user_id = ${userId})::int AS owner_settings`) as [Record<string, number>];
  return r;
}

beforeEach(async () => {
  await resetDb();
});

describe("退会", () => {
  it("その人の人物メモのデータが消え、同じ出来事を2回受け取っても同じ結果。ほかの人のデータは消えない", async () => {
    const u1 = await grantPeople("u1");
    const u2 = await grantPeople("u2");
    for (const u of ["u1", "u2"]) {
      const ev = await makeEvent(u);
      await commitForm(u, ev, [formRow({ line: "たろう" }, 1)]);
      const [p] = (await rawSql()`SELECT p.id FROM people.persons p JOIN people.events e ON e.user_id = p.user_id WHERE e.id = ${ev}`) as { id: string }[];
      await callPeople("POST", "/outreaches", u, { personId: p!.id, purpose: "invite", eventId: ev });
      await callPeople("PUT", "/settings", u, { repeaterGoal: 5 });
    }
    const event = withdrawn(u1);
    await onUserWithdrawn(event, testEnv);
    await onUserWithdrawn(event, testEnv);
    expect(await rowsOf(u1)).toEqual({ events: 0, imports: 0, responses: 0, persons: 0, consent_changes: 0, column_mappings: 0, outreaches: 0, owner_settings: 0 });
    expect(await rowsOf(u2)).toMatchObject({ events: 1, responses: 1, persons: 1, outreaches: 1, owner_settings: 1 });
    const received = (await rawSql()`SELECT count(*)::int AS n FROM people.received_events`) as { n: number }[];
    expect(received[0]!.n).toBe(1);
  });
});

describe("退会の途中・あと", () => {
  it("関所を通ったあとで退会が始まっても、ロックの中で確かめて、イベントを作らない（409 WITHDRAWAL_IN_PROGRESS）。利用者の行が消えたあとも作らない", async () => {
    const u1 = await grantPeople("u1");
    const sql = rawSql();
    const input = { name: "会", heldOn: "2026-10-11", isOwn: true };
    await sql`UPDATE users SET withdrawal_requested_at = now() WHERE id = ${u1}`;
    await expect(createEvent(testEnv, db(), u1, input)).rejects.toMatchObject({ code: "WITHDRAWAL_IN_PROGRESS", status: 409 });
    await sql`DELETE FROM users WHERE id = ${u1}`;
    await expect(createEvent(testEnv, db(), u1, input)).rejects.toMatchObject({ code: "WITHDRAWAL_IN_PROGRESS" });
    expect((await rowsOf(u1)).events).toBe(0);
  });
});

describe("ログに名前・答えを出さない", () => {
  const lines: string[] = [];
  beforeEach(() => {
    lines.length = 0;
    for (const m of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
        lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
      });
    }
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("プレビュー・取り込み（成功・409・400）・取り消し・イベントを消す・退会で、名前と答えが出ない", async () => {
    const u1 = await grantPeople("u1");
    const eventId = await makeEvent("u1");
    const secret = "ログニデナイ太郎";
    const answer = "ヒミツノコタエ";
    const rows = [formRow({ line: secret, free: answer }, 1)];
    await callPeople("POST", "/imports/preview", "u1", { eventId, headers: FORM_HEADERS, rows });
    await commitForm("u1", eventId, rows, [], { columns: FORM_HEADERS.map(() => null) });
    const [, ok] = await read<{ import: { id: string } }>(await commitForm("u1", eventId, rows));
    await commitForm("u1", eventId, [formRow({ line: secret, at: "2026/10/11 22:00:00" }, 2)]);
    await callPeople("DELETE", `/imports/${ok.import.id}`, "u1");
    await commitForm("u1", eventId, rows);
    await callPeople("DELETE", `/events/${eventId}`, "u1", { keepPeopleWithNotes: false });
    await onUserWithdrawn(withdrawn(u1), testEnv);
    const all = lines.join("\n");
    expect(all).not.toContain(secret);
    expect(all).not.toContain(answer);
  });
});
