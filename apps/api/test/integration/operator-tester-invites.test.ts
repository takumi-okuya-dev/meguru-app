// US2：運営者の招待の管理（specs/024-tester-invite-connect contracts/api.md「運営者の招待の管理」、FR-008〜FR-014、SC-005、T022）
import { neon } from "@neondatabase/serverless";
import type { OperatorTesterApplication, OperatorTesterApplications } from "@threads-grower/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { call, connectExisting, fake, makeApp, resetDb, testEnv } from "../helpers/app";
import {
  TESTER_OPERATOR,
  applicationRow,
  applyFor,
  callT,
  codeOf,
  operatorEventRows,
  publicEnv,
  resetOperatorSettings,
  testerOperatorEnv,
  unconnectedAccountOf,
} from "../helpers/tester-invites";

const app = makeApp();
const q = () => neon(testEnv.DATABASE_URL);
const OP = TESTER_OPERATOR;

beforeEach(async () => {
  await resetDb();
  await resetOperatorSettings();
  await fake.reset();
});

/**
 * 利用者が申し込む。
 * @returns 申し込みのIDとアカウント
 */
async function applied(user: string, username: string) {
  const accountId = await unconnectedAccountOf(app, user);
  const { id } = (await (await applyFor(app, user, accountId, username)).json()) as { id: string };
  return { id, accountId };
}
const list = async (view = "pending", env = testerOperatorEnv()) =>
  (await (await callT(app, "GET", `/api/operator/tester-applications?view=${view}`, { user: OP, env })).json()) as OperatorTesterApplications;
const op = (id: string, action: string, body?: unknown, env?: ReturnType<typeof testerOperatorEnv>) =>
  callT(app, "POST", `/api/operator/tester-applications/${id}/${action}`, { user: OP, body: body ?? {}, env });

describe("一覧", () => {
  it("申し込み中は古い順。件数・枠・申し込んだ人・アプリIDを返す", async () => {
    const a = await applied("u1", "shop_a");
    await q()`UPDATE tester_applications SET created_at = now() - interval '1 hour' WHERE id = ${a.id}`;
    const b = await applied("u2", "shop_b");
    const res = await list();
    expect(res.enabled).toBe(true);
    expect(res.threadsAppId).toBe(testEnv.THREADS_APP_ID);
    expect(res.slots).toEqual({ used: 0, capacity: 25 });
    expect(res.counts).toEqual({ pending: 2, invited: 0, connected: 0, removable: 0 });
    expect(res.items.map((i) => i.id)).toEqual([a.id, b.id]);
    expect(res.items[0]!.applicant).toMatchObject({ email: "u1@example.com", name: "u1" });
  });

  it("同じユーザー名の申し込み（duplicate）と、すでにつながっている（alreadyConnected）を出す", async () => {
    const a = await applied("u1", "shop_tokyo");
    await applied("u2", "shop_tokyo");
    const c = await applied("u3", "connected_one");
    const other = await unconnectedAccountOf(app, "u4");
    await q()`UPDATE accounts SET connection_status = 'connected', connection_method = 'token', threads_user_id = 'tu9', username = 'Connected_One' WHERE id = ${other}`;
    const items = (await list()).items;
    expect(items.find((i) => i.id === a.id)!.duplicate).toBe(true);
    expect(items.find((i) => i.id === c.id)).toMatchObject({ duplicate: false, alreadyConnected: true });
  });

  it("見え方ごとの中身（招待済み・接続済み・外してよい・見送りと取り下げ）", async () => {
    const inv = await applied("u1", "inv");
    const con = await applied("u2", "con");
    const rem = await applied("u3", "rem");
    const dec = await applied("u4", "dec");
    await q()`UPDATE tester_applications SET status = 'invited', holds_slot = true WHERE id = ${inv.id}`;
    await q()`UPDATE tester_applications SET status = 'connected', holds_slot = true WHERE id = ${con.id}`;
    await q()`UPDATE tester_applications SET status = 'withdrawn', holds_slot = true, removal_reason = 'account_deleted' WHERE id = ${rem.id}`;
    await q()`UPDATE tester_applications SET status = 'declined' WHERE id = ${dec.id}`;
    expect((await list("invited")).items.map((i) => i.id)).toEqual([inv.id]);
    expect((await list("connected")).items.map((i) => i.id)).toEqual([con.id]);
    const removable = (await list("removable")).items;
    expect(removable.map((i) => [i.id, i.removalReason])).toEqual([[rem.id, "account_deleted"]]);
    expect((await list("closed")).items.map((i) => i.id)).toEqual([dec.id]);
    const all = await list();
    expect(all.counts).toEqual({ pending: 0, invited: 1, connected: 1, removable: 1 });
    expect(all.slots.used).toBe(3); // SC-005：holds_slot の数
  });

  it("退会した人の行は applicant が null", async () => {
    const a = await applied("u1", "shop_tokyo");
    await q()`UPDATE tester_applications SET status = 'withdrawn', holds_slot = true, removal_reason = 'user_withdrawn', user_id = NULL WHERE id = ${a.id}`;
    expect((await list("removable")).items[0]!.applicant).toBeNull();
  });

  it("view が違えば VALIDATION_FAILED、運営者でなければ OPERATOR_ONLY", async () => {
    expect((await callT(app, "GET", "/api/operator/tester-applications?view=all", { user: OP })).status).toBe(400);
    const res = await callT(app, "GET", "/api/operator/tester-applications", { user: "u1" });
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe("OPERATOR_ONLY");
  });
});

describe("招待した・見送る・戻す・外した", () => {
  it("招待した：招待済みになり、枠を使う。記録が残る", async () => {
    const a = await applied("u1", "shop");
    const res = await op(a.id, "invite");
    expect(res.status).toBe(200);
    expect(((await res.json()) as OperatorTesterApplication).status).toBe("invited");
    expect(await applicationRow(a.id)).toMatchObject({ status: "invited", holds_slot: true });
    expect((await operatorEventRows()).map((e) => e.action)).toEqual(["apply", "invite"]);
    // 利用者の画面に届く
    const mine = await callT(app, "GET", `/api/accounts/${a.accountId}/tester-application`, { user: "u1" });
    expect(((await mine.json()) as { application: { status: string } }).application.status).toBe("invited");
  });

  it("枠がいっぱいなら TESTER_SLOTS_FULL（使用数・枠の数）。force なら進む", async () => {
    await q()`UPDATE operator_settings SET tester_slot_capacity = 1`;
    const a = await applied("u1", "shop_a");
    const b = await applied("u2", "shop_b");
    expect((await op(a.id, "invite")).status).toBe(200);
    const full = await op(b.id, "invite");
    expect(full.status).toBe(409);
    expect(((await full.json()) as { error: { code: string; details: string[] } }).error).toMatchObject({
      code: "TESTER_SLOTS_FULL",
      details: ["1", "1"],
    });
    expect((await op(b.id, "invite", { force: true })).status).toBe(200);
    expect((await list()).slots).toEqual({ used: 2, capacity: 1 });
  });

  it("見送る：理由（200文字まで）が利用者に見える", async () => {
    const a = await applied("u1", "shop");
    expect((await op(a.id, "decline", { reason: "あ".repeat(201) })).status).toBe(400);
    expect((await op(a.id, "decline", { reason: "  今は枠がありません " })).status).toBe(200);
    const mine = await callT(app, "GET", `/api/accounts/${a.accountId}/tester-application`, { user: "u1" });
    expect(((await mine.json()) as { application: unknown }).application).toMatchObject({ status: "declined", declineReason: "今は枠がありません" });
  });

  it("戻す：招待済み → 申し込み中、枠を使わない", async () => {
    const a = await applied("u1", "shop");
    await op(a.id, "invite");
    expect((await op(a.id, "revert")).status).toBe(200);
    expect(await applicationRow(a.id)).toMatchObject({ status: "pending", holds_slot: false });
  });

  it("外した：枠を使わなくなる。退会した人の行は行ごと消える", async () => {
    await fake.addUser("9001", "shop_tokyo");
    const a = await applied("u1", "shop_tokyo");
    await op(a.id, "invite");
    await connectExisting(app, "u1", a.accountId, "9001");
    const [acc] = (await q()`SELECT name FROM accounts WHERE id = ${a.accountId}`) as { name: string }[];
    await call(app, "DELETE", `/api/accounts/${a.accountId}`, { user: "u1", body: { confirmName: acc!.name } });
    expect((await list("removable")).items).toHaveLength(1);
    expect((await op(a.id, "removed")).status).toBe(200);
    expect(await applicationRow(a.id)).toMatchObject({ holds_slot: false });
    expect((await list()).slots.used).toBe(0);

    const b = await applied("u2", "shop_b");
    await q()`UPDATE tester_applications SET status = 'withdrawn', holds_slot = true, removal_reason = 'user_withdrawn', user_id = NULL WHERE id = ${b.id}`;
    expect((await op(b.id, "removed")).status).toBe(200);
    expect(await applicationRow(b.id)).toBeUndefined();
    expect((await operatorEventRows()).at(-1)).toMatchObject({ action: "removed", application_id: null });
  });

  it("状態が合わない操作は TESTER_APPLICATION_NOT_PENDING", async () => {
    const a = await applied("u1", "shop");
    expect(await codeOf(await op(a.id, "revert"))).toBe("TESTER_APPLICATION_NOT_PENDING");
    expect(await codeOf(await op(a.id, "removed"))).toBe("TESTER_APPLICATION_NOT_PENDING");
    await op(a.id, "invite");
    expect(await codeOf(await op(a.id, "invite"))).toBe("TESTER_APPLICATION_NOT_PENDING");
    expect(await codeOf(await op(a.id, "decline"))).toBe("TESTER_APPLICATION_NOT_PENDING");
  });

  it("運営者でなければ OPERATOR_ONLY", async () => {
    const a = await applied("u1", "shop");
    const res = await callT(app, "POST", `/api/operator/tester-applications/${a.id}/invite`, { user: "u1", body: {} });
    expect(await codeOf(res)).toBe("OPERATOR_ONLY");
  });
});

describe("テスター枠の数", () => {
  it("1〜10000 で変えられ、記録が残る", async () => {
    expect((await callT(app, "PUT", "/api/operator/tester-settings", { user: OP, body: { slotCapacity: 0 } })).status).toBe(400);
    expect((await callT(app, "PUT", "/api/operator/tester-settings", { user: OP, body: { slotCapacity: 10001 } })).status).toBe(400);
    const res = await callT(app, "PUT", "/api/operator/tester-settings", { user: OP, body: { slotCapacity: 40 } });
    expect(await res.json()).toEqual({ used: 0, capacity: 40 });
    expect((await list()).slots.capacity).toBe(40);
    expect((await operatorEventRows()).map((e) => [e.action, e.detail])).toEqual([["slot_capacity", { before: 25, after: 40 }]]);
  });
});

describe("招待の管理がOFFの環境（US5・FR-027）", () => {
  it("一覧は enabled: false で読め、操作は 404。行は残る", async () => {
    const a = await applied("u1", "shop");
    await op(a.id, "invite");
    const off = await list("invited", publicEnv());
    expect(off.enabled).toBe(false);
    expect(off.items.map((i) => i.id)).toEqual([a.id]);
    for (const action of ["invite", "decline", "revert", "removed"]) {
      expect((await op(a.id, action, {}, publicEnv())).status).toBe(404);
    }
    expect(await applicationRow(a.id)).toMatchObject({ status: "invited", holds_slot: true });
  });

  it("OAuthでつながったときは、OFFでも申し込みを進める（記録を正しく保つ）", async () => {
    await fake.addUser("9001", "shop_tokyo");
    const a = await applied("u1", "shop_tokyo");
    await op(a.id, "invite");
    const res = await call(app, "POST", "/api/threads/connect", {
      user: "u1",
      body: { mode: "connect", accountId: a.accountId },
      env: publicEnv(),
    });
    expect(res.status).toBe(200);
    await connectExisting(app, "u1", a.accountId, "9001");
    expect(await applicationRow(a.id)).toMatchObject({ status: "connected" });
  });
});
