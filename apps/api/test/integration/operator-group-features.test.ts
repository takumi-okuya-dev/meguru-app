// グループの使える機能（specs/019-feature-switches FR-017・FR-018、contracts/api.md「グループ」）。
import { beforeEach, describe, expect, it } from "vitest";
import { call, createUserWithAccount, makeApp, resetDb } from "../helpers/app";
import { callOp, FEATURE_OPERATOR } from "../helpers/features";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
});

const op = (method: string, path: string, body?: unknown) => callOp(app, method, path, { user: FEATURE_OPERATOR, body });
const json = async (res: Response) => (await res.json()) as Record<string, unknown> & { error?: { code: string } };
const ALL_ON = { autopost: true, strategy: true, team: true };

async function groupWith(user: string) {
  const g = (await json(await op("POST", "/api/operator/test-groups", { name: "飲食の会", capacity: 10 }))) as unknown as {
    id: string;
    inviteUrl: string;
  };
  await call(app, "GET", "/api/me", { user });
  expect((await call(app, "POST", `/api/test-invites/${g.inviteUrl.split("/test-invite/")[1]}/join`, { user })).status).toBe(200);
  return g.id;
}

describe("PUT /api/operator/test-groups/:groupId/features", () => {
  it("保存すると詳しい内容の disabled に出て、グループの全員に効く。ONに戻すと使える", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const group = await groupWith("u1");
    const saved = await json(await op("PUT", `/api/operator/test-groups/${group}/features`, { features: { ...ALL_ON, strategy: false } }));
    expect(saved).toMatchObject({ id: group, disabled: ["strategy"] });
    expect((await json(await op("GET", `/api/operator/test-groups/${group}`))).disabled).toEqual(["strategy"]);

    const blocked = await call(app, "GET", `/api/accounts/${accountId}/strategy`, { user: "u1" });
    expect(blocked.status).toBe(403);

    await op("PUT", `/api/operator/test-groups/${group}/features`, { features: ALL_ON });
    expect((await call(app, "GET", `/api/accounts/${accountId}/strategy`, { user: "u1" })).status).toBe(200);
  });

  it("グループから外すと、その人の設定だけに戻る", async () => {
    const { userId, accountId } = await createUserWithAccount("u1");
    const group = await groupWith("u1");
    await op("PUT", `/api/operator/test-groups/${group}/features`, { features: { ...ALL_ON, strategy: false } });
    await op("DELETE", `/api/operator/test-groups/${group}/members/${userId}`);
    expect((await call(app, "GET", `/api/accounts/${accountId}/strategy`, { user: "u1" })).status).toBe(200);
  });

  it("閉じたグループは 409 TEST_GROUP_CLOSED、運営者でなければ 403 OPERATOR_ONLY、3つ揃っていなければ 400", async () => {
    const group = await groupWith("u1");
    expect((await op("PUT", `/api/operator/test-groups/${group}/features`, { features: { strategy: false } })).status).toBe(400);
    const notOp = await callOp(app, "PUT", `/api/operator/test-groups/${group}/features`, { user: "u1", body: { features: ALL_ON } });
    expect((await json(notOp)).error?.code).toBe("OPERATOR_ONLY");
    await op("POST", `/api/operator/test-groups/${group}/close`);
    const closed = await op("PUT", `/api/operator/test-groups/${group}/features`, { features: ALL_ON });
    expect(closed.status).toBe(409);
    expect((await json(closed)).error?.code).toBe("TEST_GROUP_CLOSED");
  });
});
