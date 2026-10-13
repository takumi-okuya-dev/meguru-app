// チームに見せる・アカウントを足す／外す（specs/011-team-revision US3、SC-003、FR-030〜FR-034）
import { neon } from "@neondatabase/serverless";
import { beforeEach, describe, expect, it } from "vitest";
import { call, createUserWithAccount, makeApp, resetDb, testEnv } from "../helpers/app";
import { ACCOUNT_ROUTES } from "../helpers/routes";
import { activityRows, assign, joinTeam, makeTeam, setRole } from "../helpers/team";

const app = makeApp();
const sql = () => neon(testEnv.DATABASE_URL);

const errorOf = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

/** 管理者 a1、オーナー o1（2つのアカウント）、メンバー m1、編集者 e1（o1 の1つ目の担当）のチームと、別のチームの x1 */
async function setup() {
  const { accountId: adminAcc } = await createUserWithAccount("a1");
  const { accountId: ownerAcc } = await createUserWithAccount("o1");
  const { accountId: ownerAcc2 } = await createUserWithAccount("o1");
  const { accountId: memberAcc } = await createUserWithAccount("m1");
  const { accountId: editorAcc } = await createUserWithAccount("e1");
  const { teamId } = await makeTeam("a1", [adminAcc]);
  await joinTeam(teamId, "o1", [ownerAcc, ownerAcc2]);
  await joinTeam(teamId, "m1", [memberAcc]);
  await joinTeam(teamId, "e1", [editorAcc]);
  await setRole(teamId, "e1", "editor");
  await assign(teamId, "e1", ownerAcc);
  const { accountId: otherAcc } = await createUserWithAccount("x1");
  await makeTeam("x1", [otherAcc]);
  return { teamId, adminAcc, ownerAcc, ownerAcc2, memberAcc, editorAcc };
}

const share = (teamId: string, accountId: string, user: string, shared: boolean) =>
  call(app, "PATCH", `/api/teams/${teamId}/accounts/${accountId}`, { user, body: { shared } });

beforeEach(async () => {
  await resetDb();
});

describe("PATCH /api/teams/:teamId/accounts/:accountId（チームに見せる。FR-030）", () => {
  it("そのアカウントのオーナーだけが切り替えられる（管理者も不可）。記録 team_share_changed", async () => {
    const { teamId, ownerAcc } = await setup();
    for (const user of ["a1", "m1", "e1"]) {
      const res = await share(teamId, ownerAcc, user, true);
      expect([res.status, await errorOf(res)], user).toEqual([403, "ROLE_FORBIDDEN"]);
    }
    expect((await share(teamId, ownerAcc, "x1", true)).status).toBe(404);
    expect((await share(teamId, ownerAcc, "o1", true)).status).toBe(204);
    expect((await activityRows(ownerAcc)).map((r) => [r.action, r.details])).toEqual([["team_share_changed", { shared: true }]]);
  });

  it("見せていると、同じチームの人（管理者を含む）は read のGETだけ通り、ほかは ROLE_FORBIDDEN（SC-003）", async () => {
    const { teamId, ownerAcc2 } = await setup();
    expect((await share(teamId, ownerAcc2, "o1", true)).status).toBe(204);
    for (const user of ["a1", "m1", "e1"]) {
      for (const [method, path, permission] of ACCOUNT_ROUTES) {
        const res = await call(app, method, path.replace(":accountId", ownerAcc2).replace(/:[A-Za-z]+Id/g, crypto.randomUUID()), {
          user,
          body: method === "GET" || method === "DELETE" ? undefined : {},
        });
        const code = res.status >= 400 ? await errorOf(res) : null;
        if (permission === "read") expect(["ROLE_FORBIDDEN", "ACCOUNT_NOT_FOUND"], `${user} ${method} ${path}`).not.toContain(code);
        else expect([res.status, code], `${user} ${method} ${path}`).toEqual([403, "ROLE_FORBIDDEN"]);
      }
    }
  });

  it("オフにした次の要求で拒まれる（担当の人は開けたまま）。別のチームの人は見せていても見えない", async () => {
    const { teamId, ownerAcc } = await setup();
    expect((await share(teamId, ownerAcc, "o1", true)).status).toBe(204);
    expect((await call(app, "GET", `/api/accounts/${ownerAcc}/post-drafts`, { user: "m1" })).status).toBe(200);
    expect((await call(app, "GET", `/api/accounts/${ownerAcc}/post-drafts`, { user: "x1" })).status).toBe(404);
    expect((await share(teamId, ownerAcc, "o1", false)).status).toBe(204);
    for (const user of ["m1", "a1"]) {
      const res = await call(app, "GET", `/api/accounts/${ownerAcc}/post-drafts`, { user });
      expect([res.status, await errorOf(res)], user).toEqual([404, "ACCOUNT_NOT_FOUND"]);
    }
    expect((await call(app, "GET", `/api/accounts/${ownerAcc}/post-drafts`, { user: "e1" })).status).toBe(200);
  });

  it("見せてもらっている人には、投稿の一覧にNGワードを返さない（設定は見せない。FR-031）", async () => {
    const { teamId, ownerAcc } = await setup();
    await call(app, "POST", `/api/accounts/${ownerAcc}/ng-words`, { user: "o1", body: { words: ["秘密の言葉"] } });
    expect((await share(teamId, ownerAcc, "o1", true)).status).toBe(204);
    const res = await call(app, "GET", `/api/accounts/${ownerAcc}/post-drafts`, { user: "m1" });
    const body = (await res.json()) as { ngWords: unknown[]; canGeneratePrompt: boolean };
    expect(body.ngWords).toEqual([]);
    expect(body.canGeneratePrompt).toBe(false);
    expect(JSON.stringify(body)).not.toContain("秘密の言葉");
  });
});

describe("POST・DELETE /api/teams/:teamId/accounts（自分のアカウントを足す・外す。FR-034・FR-046）", () => {
  it("自分のアカウントを足せる。他人のアカウント・ほかのチームのアカウントは足せない", async () => {
    const { teamId } = await setup();
    const { accountId: extra } = await createUserWithAccount("m1");
    expect((await call(app, "POST", `/api/teams/${teamId}/accounts`, { user: "m1", body: { accountId: extra, shared: true } })).status).toBe(204);
    const [row] = (await sql()`SELECT shared FROM team_accounts WHERE account_id = ${extra}`) as { shared: boolean }[];
    expect(row!.shared).toBe(true);
    expect((await activityRows(extra)).map((r) => r.action)).toEqual(["team_account_added"]);
    const { accountId: others } = await createUserWithAccount("z1");
    expect((await call(app, "POST", `/api/teams/${teamId}/accounts`, { user: "m1", body: { accountId: others } })).status).toBe(404);
    const again = await call(app, "POST", `/api/teams/${teamId}/accounts`, { user: "m1", body: { accountId: extra } });
    expect([again.status, await errorOf(again)]).toEqual([409, "ACCOUNT_IN_OTHER_TEAM"]);
  });

  it("外すと、そのアカウントでの担当も消える。最後の1つは TEAM_LAST_ACCOUNT。外せるのはオーナーと管理者", async () => {
    const { teamId, ownerAcc, ownerAcc2, memberAcc } = await setup();
    const del = (accountId: string, user: string) => call(app, "DELETE", `/api/teams/${teamId}/accounts/${accountId}`, { user });
    expect((await del(ownerAcc, "m1")).status).toBe(403);
    expect((await del(ownerAcc, "o1")).status).toBe(204);
    expect((await call(app, "GET", `/api/accounts/${ownerAcc}/post-drafts`, { user: "e1" })).status).toBe(404);
    const [assigned] = (await sql()`SELECT count(*)::int AS n FROM memberships WHERE account_id = ${ownerAcc} AND role = 'editor'`) as { n: number }[];
    expect(assigned!.n).toBe(0);
    const last = await del(ownerAcc2, "o1");
    expect([last.status, await errorOf(last)]).toEqual([409, "TEAM_LAST_ACCOUNT"]);
    const lastByAdmin = await del(memberAcc, "a1");
    expect([lastByAdmin.status, await errorOf(lastByAdmin)]).toEqual([409, "TEAM_LAST_ACCOUNT"]);
    // 外したアカウントのデータと記録は残る
    expect((await activityRows(ownerAcc)).map((r) => r.action)).toContain("team_account_removed");
    expect((await call(app, "GET", `/api/accounts/${ownerAcc}/post-drafts`, { user: "o1" })).status).toBe(200);
  });
});
