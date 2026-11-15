// 人物メモの関所と持ち主（specs/people/001-people-memo tasks.md T018・T020、contracts/api.md 0・1、FR-031・FR-032）。
import { beforeEach, describe, expect, it } from "vitest";
import { call, resetDb } from "../../helpers/app";
import { FEATURE_OPERATOR, operatorEnv } from "../../helpers/features";
import { callPeople, grantPeople, makeEvent, peopleApp, read } from "../../helpers/people";
import { userRow } from "../../helpers/test-groups";

beforeEach(async () => {
  await resetDb();
});

describe("利用の許可の関所", () => {
  it("ログインしていない人は 401、許可のない人は 403 APP_NOT_AVAILABLE", async () => {
    expect((await call(peopleApp, "GET", "/api/people/me")).status).toBe(401);
    await call(peopleApp, "GET", "/api/me", { user: "u1" });
    const [status, body] = await read<{ error: { code: string } }>(await callPeople("GET", "/me", "u1"));
    expect([status, body.error.code]).toEqual([403, "APP_NOT_AVAILABLE"]);
    expect((await callPeople("POST", "/events", "u1", { name: "会", heldOn: "2026-10-11", isOwn: true })).status).toBe(403);
  });

  it("許可のある人の /api/people/me は 0件から", async () => {
    await grantPeople("u1");
    expect(await read(await callPeople("GET", "/me", "u1"))).toEqual([200, { personCount: 0, eventCount: 0 }]);
  });

  it("運営者が閉じてもデータは残り、開き直すと前のまま読める", async () => {
    const id = await grantPeople("u1");
    await makeEvent("u1");
    const close = await call(peopleApp, "PUT", `/api/operator/app-access/users/${id}`, { user: FEATURE_OPERATOR, body: { apps: { people: false } }, env: operatorEnv() });
    expect(close.status).toBe(200);
    expect((await callPeople("GET", "/events", "u1")).status).toBe(403);
    await grantPeople("u1");
    const [, body] = await read<{ events: unknown[] }>(await callPeople("GET", "/events", "u1"));
    expect(body.events).toHaveLength(1);
  });
});

describe("持ち主", () => {
  it("ほかの作り手のイベントは 404 ITEM_NOT_FOUND（あるかを見せない）", async () => {
    await grantPeople("u1");
    await grantPeople("u2");
    const eventId = await makeEvent("u1");
    const [status, body] = await read<{ error: { code: string } }>(await callPeople("GET", `/events/${eventId}`, "u2"));
    expect([status, body.error.code]).toEqual([404, "ITEM_NOT_FOUND"]);
    expect((await callPeople("PATCH", `/events/${eventId}`, "u2", { name: "x" })).status).toBe(404);
    expect((await callPeople("GET", "/events/not-a-uuid", "u1")).status).toBe(404);
    const [, list] = await read<{ events: unknown[] }>(await callPeople("GET", "/events", "u2"));
    expect(list.events).toEqual([]);
  });
});

describe("使っているアプリ（料金は数えない）", () => {
  it("イベントを作ると /api/me の using に people が入り、料金の数は0のまま", async () => {
    await grantPeople("u1");
    await makeEvent("u1");
    const [, me] = await read<{ apps: { using: string[]; available: string[] } }>(await call(peopleApp, "GET", "/api/me", { user: "u1" }));
    expect(me.apps.using).toContain("people");
    expect(me.apps.available).toContain("people");
    const sql = (await import("../../helpers/people")).rawSql();
    const id = (await userRow("u1"))!.id;
    const rows = (await sql`SELECT quantity, in_use FROM app_usage WHERE user_id = ${id} AND app = 'people'`) as { quantity: number; in_use: boolean }[];
    expect(rows).toEqual([{ quantity: 0, in_use: true }]);
  });
});
