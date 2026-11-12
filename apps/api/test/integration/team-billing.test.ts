// チームと契約（specs/013-billing FR-043・FR-044、research.md R9、T033）。決済ONで確かめる。
// 読むだけの人は、チームを作る・参加する・アカウントを足すことができない。ほかのチームの操作は止めない。
import { beforeEach, describe, expect, it } from "vitest";
import { createUserWithAccount, endTrial, makeApp, resetDb } from "../helpers/app";
import { callBilling } from "../helpers/billing";
import { joinTeam, makeTeam } from "../helpers/team";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
});

async function code(res: Response) {
  return ((await res.json()) as { error?: { code: string } }).error?.code;
}

describe("読むだけの人のチームの入口", () => {
  it("チームを作れない", async () => {
    const { userId, accountId } = await createUserWithAccount("u1");
    await endTrial(userId);
    const res = await callBilling(app, "POST", "/api/threads/teams", { user: "u1", body: { name: "チーム", accountIds: [accountId] } });
    expect(res.status).toBe(403);
    expect(await code(res)).toBe("BILLING_REQUIRED");
  });

  it("招待で参加できない・アカウントを足せない", async () => {
    const admin = await createUserWithAccount("a1");
    const { teamId, token } = await makeTeam("a1", [admin.accountId]);
    const { userId, accountId } = await createUserWithAccount("m1");
    await endTrial(userId);
    const accept = await callBilling(app, "POST", `/api/threads/invites/${token}/accept`, { user: "m1", body: { accounts: [{ id: accountId, shared: false }] } });
    expect(await code(accept)).toBe("BILLING_REQUIRED");

    // 入った後に読むだけになった人が、もう1つ足す
    const m2 = await createUserWithAccount("m2");
    await joinTeam(teamId, "m2", [m2.accountId]);
    const extra = await createUserWithAccount("m2");
    await endTrial(m2.userId);
    const add = await callBilling(app, "POST", `/api/threads/teams/${teamId}/accounts`, { user: "m2", body: { accountId: extra.accountId } });
    expect(await code(add)).toBe("BILLING_REQUIRED");
  });
});

describe("読むだけの管理者のチームの操作（止めない）", () => {
  it("ロールの切り替え・招待の作り直し・チームの名前の変更・チームに見せる・人を外すができる", async () => {
    const admin = await createUserWithAccount("a1");
    const { teamId } = await makeTeam("a1", [admin.accountId]);
    const m1 = await createUserWithAccount("m1");
    const m1UserId = await joinTeam(teamId, "m1", [m1.accountId]);
    const m2 = await createUserWithAccount("m2");
    const m2UserId = await joinTeam(teamId, "m2", [m2.accountId]);
    await endTrial(admin.userId);

    const role = await callBilling(app, "PATCH", `/api/threads/teams/${teamId}/members/${m1UserId}`, { user: "a1", body: { role: "editor" } });
    expect(role.status).toBe(204);
    expect((await callBilling(app, "POST", `/api/threads/teams/${teamId}/invite/rotate`, { user: "a1" })).status).toBe(200);
    expect((await callBilling(app, "PATCH", `/api/threads/teams/${teamId}`, { user: "a1", body: { name: "新しい名前" } })).status).toBe(204);
    const share = await callBilling(app, "PATCH", `/api/threads/teams/${teamId}/accounts/${admin.accountId}`, { user: "a1", body: { shared: true } });
    expect(share.status).toBe(204);
    expect((await callBilling(app, "DELETE", `/api/threads/teams/${teamId}/members/${m2UserId}`, { user: "a1" })).status).toBe(204);
  });
});
