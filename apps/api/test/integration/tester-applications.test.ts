// US1：利用者の申し込み（specs/024-tester-invite-connect contracts/api.md「利用者の申し込み」、FR-004〜FR-006、T010）
import { neon } from "@neondatabase/serverless";
import { beforeEach, describe, expect, it } from "vitest";
import { call, fake, makeApp, resetDb, testEnv } from "../helpers/app";
import {
  applicationRow,
  applicationsOf,
  applyFor,
  callT,
  codeOf,
  markInvited,
  operatorEventRows,
  publicEnv,
  resetOperatorSettings,
  testerOperatorEnv,
  unconnectedAccountOf,
} from "../helpers/tester-invites";

const app = makeApp();
const q = () => neon(testEnv.DATABASE_URL);
type Res = { enabled: boolean; application: null | { id: string; threadsUsername: string; status: string; declineReason: string | null } };

beforeEach(async () => {
  await resetDb();
  await resetOperatorSettings();
  await fake.reset();
});

describe("GET /api/accounts/:id/tester-application", () => {
  it("申し込みがなければ null。いちばん新しい申し込みを返し、取り下げだけなら null", async () => {
    const acc = await unconnectedAccountOf(app, "u1");
    let res = await callT(app, "GET", `/api/accounts/${acc}/tester-application`, { user: "u1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: true, application: null });

    await applyFor(app, "u1", acc, "@Shop_Tokyo");
    res = await callT(app, "GET", `/api/accounts/${acc}/tester-application`, { user: "u1" });
    const body = (await res.json()) as Res;
    expect(body.application).toMatchObject({ threadsUsername: "shop_tokyo", status: "pending", declineReason: null });

    await callT(app, "DELETE", `/api/accounts/${acc}/tester-application`, { user: "u1" });
    res = await callT(app, "GET", `/api/accounts/${acc}/tester-application`, { user: "u1" });
    expect(((await res.json()) as Res).application).toBeNull();
  });

  it("見送りは理由とともに返す", async () => {
    const acc = await unconnectedAccountOf(app, "u1");
    const { id } = (await (await applyFor(app, "u1", acc, "shop")).json()) as { id: string };
    await q()`UPDATE threads.tester_applications SET status = 'declined', decline_reason = '枠がいっぱいです' WHERE id = ${id}`;
    const res = await callT(app, "GET", `/api/accounts/${acc}/tester-application`, { user: "u1" });
    expect(((await res.json()) as Res).application).toMatchObject({ status: "declined", declineReason: "枠がいっぱいです" });
  });
});

describe("POST /api/accounts/:id/tester-application", () => {
  it("@を取り小文字にそろえて、申し込み中で作る。記録に apply が残る（ユーザー名は入れない）", async () => {
    const acc = await unconnectedAccountOf(app, "u1");
    const res = await applyFor(app, "u1", acc, "  @Shop_Tokyo ");
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; threadsUsername: string; status: string };
    expect(body).toMatchObject({ threadsUsername: "shop_tokyo", status: "pending" });
    const row = await applicationRow(body.id);
    expect(row).toMatchObject({ holds_slot: false, removal_reason: null });
    const events = await operatorEventRows();
    expect(events.map((e) => e.action)).toEqual(["apply"]);
    expect(JSON.stringify(events[0]!.detail ?? null)).not.toContain("shop_tokyo");
  });

  it("形が違えば VALIDATION_FAILED", async () => {
    const acc = await unconnectedAccountOf(app, "u1");
    for (const bad of ["", "@", "shop tokyo", "ショップ", "a".repeat(31)]) {
      const res = await applyFor(app, "u1", acc, bad);
      expect(res.status).toBe(400);
      expect(await codeOf(res)).toBe("VALIDATION_FAILED");
    }
  });

  it("生きている申し込みがあれば TESTER_APPLICATION_EXISTS。見送りのあとは作れる", async () => {
    const acc = await unconnectedAccountOf(app, "u1");
    const first = (await (await applyFor(app, "u1", acc, "shop")).json()) as { id: string };
    const dup = await applyFor(app, "u1", acc, "shop2");
    expect(dup.status).toBe(409);
    expect(await codeOf(dup)).toBe("TESTER_APPLICATION_EXISTS");
    await markInvited(first.id);
    expect(await codeOf(await applyFor(app, "u1", acc, "shop2"))).toBe("TESTER_APPLICATION_EXISTS");
    await q()`UPDATE threads.tester_applications SET status = 'declined', holds_slot = false WHERE id = ${first.id}`;
    expect((await applyFor(app, "u1", acc, "shop2")).status).toBe(201);
    expect(await applicationsOf(acc)).toHaveLength(2);
  });

  it("つながっているアカウントには申し込めない（VALIDATION_FAILED）", async () => {
    const acc = await unconnectedAccountOf(app, "u1");
    await q()`UPDATE threads.accounts SET connection_status = 'connected', connection_method = 'token', threads_user_id = 'tu1', username = 'shop' WHERE id = ${acc}`;
    const res = await applyFor(app, "u1", acc, "shop");
    expect(res.status).toBe(400);
    expect(await codeOf(res)).toBe("VALIDATION_FAILED");
  });

  it("他人のアカウントには申し込めない（ACCOUNT_NOT_FOUND）", async () => {
    const acc = await unconnectedAccountOf(app, "u1");
    await unconnectedAccountOf(app, "u2");
    const res = await applyFor(app, "u2", acc, "shop");
    expect(res.status).toBe(404);
    expect(await codeOf(res)).toBe("ACCOUNT_NOT_FOUND");
  });
});

describe("DELETE /api/accounts/:id/tester-application", () => {
  it("申し込み中は理由なしの取り下げ（枠を使わない）", async () => {
    const acc = await unconnectedAccountOf(app, "u1");
    const { id } = (await (await applyFor(app, "u1", acc, "shop")).json()) as { id: string };
    const res = await callT(app, "DELETE", `/api/accounts/${acc}/tester-application`, { user: "u1" });
    expect(res.status).toBe(204);
    expect(await applicationRow(id)).toMatchObject({ status: "withdrawn", removal_reason: null, holds_slot: false });
    expect((await operatorEventRows()).map((e) => e.action)).toEqual(["apply", "cancel"]);
  });

  it("招待済みは removal_reason = withdrawn で取り下げ、枠を使ったまま（外してよい）", async () => {
    const acc = await unconnectedAccountOf(app, "u1");
    const { id } = (await (await applyFor(app, "u1", acc, "shop")).json()) as { id: string };
    await markInvited(id);
    expect((await callT(app, "DELETE", `/api/accounts/${acc}/tester-application`, { user: "u1" })).status).toBe(204);
    expect(await applicationRow(id)).toMatchObject({ status: "withdrawn", removal_reason: "withdrawn", holds_slot: true });
  });

  it("接続済み・見送り・申し込みなしは TESTER_APPLICATION_NOT_PENDING", async () => {
    const acc = await unconnectedAccountOf(app, "u1");
    expect(await codeOf(await callT(app, "DELETE", `/api/accounts/${acc}/tester-application`, { user: "u1" }))).toBe(
      "TESTER_APPLICATION_NOT_PENDING",
    );
    const { id } = (await (await applyFor(app, "u1", acc, "shop")).json()) as { id: string };
    await q()`UPDATE threads.tester_applications SET status = 'connected', holds_slot = true WHERE id = ${id}`;
    const res = await callT(app, "DELETE", `/api/accounts/${acc}/tester-application`, { user: "u1" });
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("TESTER_APPLICATION_NOT_PENDING");
  });
});

describe("回数の制限（10分に5回）", () => {
  it("申し込みと取り消しの合計が5回を超えたら RATE_LIMITED", async () => {
    const acc = await unconnectedAccountOf(app, "u1");
    for (let i = 0; i < 2; i++) {
      expect((await applyFor(app, "u1", acc, `shop${i}`)).status).toBe(201);
      expect((await callT(app, "DELETE", `/api/accounts/${acc}/tester-application`, { user: "u1" })).status).toBe(204);
    }
    expect((await applyFor(app, "u1", acc, "shop9")).status).toBe(201); // 5回目
    const res = await callT(app, "DELETE", `/api/accounts/${acc}/tester-application`, { user: "u1" });
    expect(res.status).toBe(429);
    expect(await codeOf(res)).toBe("RATE_LIMITED");
    // 10分より前の記録は数えない
    await q()`UPDATE operator_events SET created_at = now() - interval '11 minutes'`;
    expect((await callT(app, "DELETE", `/api/accounts/${acc}/tester-application`, { user: "u1" })).status).toBe(204);
  });
});

describe("招待の管理がOFFの環境", () => {
  it.each([
    ["審査の後（public）", publicEnv()],
    ["token だけ", testerOperatorEnv({ THREADS_CONNECT_METHODS: "token" })],
  ])("%s では3つとも 404", async (_label, env) => {
    const acc = await unconnectedAccountOf(app, "u1");
    expect((await call(app, "GET", `/api/accounts/${acc}/tester-application`, { user: "u1", env })).status).toBe(404);
    expect((await applyFor(app, "u1", acc, "shop", env)).status).toBe(404);
    expect((await call(app, "DELETE", `/api/accounts/${acc}/tester-application`, { user: "u1", env })).status).toBe(404);
  });
});
