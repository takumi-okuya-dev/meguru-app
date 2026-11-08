// US3：運営者の上限のAPI（specs/024-tester-invite-connect contracts/api.md「運営者の上限」、FR-016・FR-017、T043）
import type { OperatorLimitUser, OperatorLimits } from "@threads-grower/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { makeApp, resetDb, testEnv } from "../helpers/app";
import { TESTER_OPERATOR, callT, codeOf, operatorEventRows } from "../helpers/tester-invites";

const app = makeApp();
const OP = TESTER_OPERATOR;

beforeEach(async () => {
  await resetDb();
});

const limits = async () => (await (await callT(app, "GET", "/api/operator/limits", { user: OP })).json()) as OperatorLimits;

describe("既定値", () => {
  it("読み書きと範囲。記録が残る", async () => {
    expect((await limits()).defaults).toEqual({ accountLimit: 3, dailyPostLimit: 10 });
    expect((await callT(app, "PUT", "/api/operator/limits", { user: OP, body: { accountLimit: 0, dailyPostLimit: 10 } })).status).toBe(400);
    expect((await callT(app, "PUT", "/api/operator/limits", { user: OP, body: { accountLimit: 3, dailyPostLimit: 251 } })).status).toBe(400);
    await testEnv.AUTOPOST_KV.delete("autopost:wake");
    expect((await callT(app, "PUT", "/api/operator/limits", { user: OP, body: { accountLimit: 5, dailyPostLimit: 8 } })).status).toBe(200);
    // 上限を変えたら定期処理を起こす（次に見る時刻が変わりうる。PR #71 のCodexレビュー）
    expect(await testEnv.AUTOPOST_KV.get("autopost:wake")).not.toBeNull();
    const after = await limits();
    expect(after.defaults).toEqual({ accountLimit: 5, dailyPostLimit: 8 });
    expect(after.events.map((e) => e.action)).toEqual(["default_limits"]);
    expect((await operatorEventRows())[0]!.detail).toEqual({
      before: { accountLimit: 3, dailyPostLimit: 10 },
      after: { accountLimit: 5, dailyPostLimit: 8 },
    });
  });
});

describe("人ごとの上限", () => {
  it("探す（完全一致）・保存・null で既定値に戻す・既定値と違う人の一覧", async () => {
    await callT(app, "GET", "/api/me", { user: "u1" });
    expect(await codeOf(await callT(app, "GET", "/api/operator/limits/users?email=nobody@example.com", { user: OP }))).toBe("USER_NOT_FOUND");
    const found = (await (await callT(app, "GET", "/api/operator/limits/users?email=U1@example.com", { user: OP })).json()) as OperatorLimitUser;
    expect(found).toMatchObject({ email: "u1@example.com", operator: false, accountLimit: null, dailyPostLimit: null, ownedAccountCount: 0 });

    const saved = await callT(app, "PUT", `/api/operator/limits/users/${found.userId}`, { user: OP, body: { accountLimit: 5, dailyPostLimit: null } });
    expect(((await saved.json()) as OperatorLimitUser).accountLimit).toBe(5);
    expect((await limits()).overrides).toEqual([expect.objectContaining({ userId: found.userId, accountLimit: 5, dailyPostLimit: null })]);

    await callT(app, "PUT", `/api/operator/limits/users/${found.userId}`, { user: OP, body: { accountLimit: null, dailyPostLimit: null } });
    expect((await limits()).overrides).toEqual([]);
    expect((await operatorEventRows()).filter((e) => e.action === "user_limits")).toHaveLength(2);
  });

  it("UUID の形でない ID は 404 USER_NOT_FOUND（500 にしない。PR #71 のセルフレビュー）", async () => {
    for (const id of ["-".repeat(36), "a".repeat(36)]) {
      const res = await callT(app, "PUT", `/api/operator/limits/users/${id}`, { user: OP, body: { accountLimit: 3, dailyPostLimit: 10 } });
      expect([res.status, await codeOf(res)]).toEqual([404, "USER_NOT_FOUND"]);
    }
  });

  it("運営者を探すと operator: true", async () => {
    await callT(app, "GET", "/api/me", { user: OP });
    const found = (await (await callT(app, "GET", `/api/operator/limits/users?email=${OP}@example.com`, { user: OP })).json()) as OperatorLimitUser;
    expect(found.operator).toBe(true);
  });

  it("運営者でなければ OPERATOR_ONLY", async () => {
    for (const [method, path] of [
      ["GET", "/api/operator/limits"],
      ["PUT", "/api/operator/limits"],
      ["GET", "/api/operator/limits/users?email=a@example.com"],
    ] as const) {
      const res = await callT(app, method, path, { user: "u1", body: method === "PUT" ? { accountLimit: 3, dailyPostLimit: 10 } : undefined });
      expect(await codeOf(res), path).toBe("OPERATOR_ONLY");
    }
  });
});
