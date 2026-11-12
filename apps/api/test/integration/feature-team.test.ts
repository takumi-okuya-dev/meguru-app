// チームが使えない人（specs/019-feature-switches FR-009、research.md R13）。
// チームを作れず、招待から入れず、チームの画面のAPIも使えない。チーム・担当・見せる設定の行は残り、ONに戻すと元どおり。
import { beforeEach, describe, expect, it } from "vitest";
import { call, createUserWithAccount, makeApp, resetDb } from "../helpers/app";
import { disableFeatures, enableAll } from "../helpers/features";
import { assign, joinTeam, makeTeam, setRole } from "../helpers/team";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
});

const errorOf = async (res: Response) => ((await res.clone().json()) as { error?: { code: string; details?: string[] } }).error;

describe("チームが使えない人", () => {
  it("チームを作れない（POST /api/threads/teams が 403 FEATURE_DISABLED）", async () => {
    const { userId, accountId } = await createUserWithAccount("u1");
    await disableFeatures(userId, "team");
    const res = await call(app, "POST", "/api/threads/teams", { user: "u1", body: { name: "新しいチーム", accountIds: [accountId] } });
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toMatchObject({ code: "FEATURE_DISABLED", details: ["team"] });
  });

  it("招待から入れない", async () => {
    const { accountId: adminAcc } = await createUserWithAccount("a1");
    const { token } = await makeTeam("a1", [adminAcc]);
    const { userId, accountId } = await createUserWithAccount("u1");
    await disableFeatures(userId, "team");
    const res = await call(app, "POST", `/api/threads/invites/${token}/accept`, { user: "u1", body: { accounts: [{ id: accountId, shared: false }] } });
    expect(res.status).toBe(403);
    expect((await errorOf(res))?.code).toBe("FEATURE_DISABLED");
  });

  it("チームの画面・担当のAPIを使えない。行は残り、ONに戻すと元どおり使える", async () => {
    const { userId: admin, accountId: adminAcc } = await createUserWithAccount("a1");
    const { accountId } = await createUserWithAccount("o1");
    const { accountId: editorAcc } = await createUserWithAccount("e1");
    const { teamId } = await makeTeam("a1", [adminAcc]);
    await joinTeam(teamId, "o1", [accountId], { shared: true });
    await joinTeam(teamId, "e1", [editorAcc]);
    await setRole(teamId, "e1", "editor");
    await assign(teamId, "e1", accountId);

    await disableFeatures(admin, "team");
    for (const path of [`/api/threads/teams/${teamId}`, `/api/threads/teams/${teamId}/assignments`, `/api/threads/teams/${teamId}/invite`]) {
      const res = await call(app, "GET", path, { user: "a1" });
      expect(res.status, path).toBe(403);
      expect((await errorOf(res))?.code, path).toBe("FEATURE_DISABLED");
    }
    // ほかの人は今までどおり
    expect((await call(app, "GET", `/api/threads/teams/${teamId}`, { user: "e1" })).status).toBe(200);

    await enableAll(admin);
    const back = await call(app, "GET", `/api/threads/teams/${teamId}/assignments`, { user: "a1" });
    expect(back.status).toBe(200);
  });

  it("自分がオーナーのAccountのチームの区分と操作の記録は、チームが使えなければ使えない", async () => {
    const { userId, accountId } = await createUserWithAccount("o1");
    await disableFeatures(userId, "team");
    for (const path of [`/api/threads/accounts/${accountId}/team`, `/api/threads/accounts/${accountId}/activity`]) {
      const res = await call(app, "GET", path, { user: "o1" });
      expect(res.status, path).toBe(403);
      expect((await errorOf(res))?.code).toBe("FEATURE_DISABLED");
    }
  });
});
