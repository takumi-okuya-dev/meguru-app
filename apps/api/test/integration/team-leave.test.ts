// 抜ける・外す・管理者を引き継ぐ（specs/011-team-revision US5、SC-004、FR-040〜FR-046、research.md R7）
import { neon } from "@neondatabase/serverless";
import { beforeEach, describe, expect, it } from "vitest";
import { call, createUserWithAccount, makeApp, resetDb, testEnv } from "../helpers/app";
import { activityRows, assign, joinTeam, makeTeam, setRole, teamMemberRows } from "../helpers/team";

const app = makeApp();
const sql = () => neon(testEnv.DATABASE_URL);

const errorOf = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

/** 管理者 a1、メンバー m1（a1 のアカウントの担当ではない）、編集者 e1（m1 のアカウントの担当） */
async function setup() {
  const { accountId: adminAcc } = await createUserWithAccount("a1");
  const { accountId: memberAcc } = await createUserWithAccount("m1");
  const { accountId: editorAcc } = await createUserWithAccount("e1");
  const { teamId, adminUserId } = await makeTeam("a1", [adminAcc]);
  const m1 = await joinTeam(teamId, "m1", [memberAcc]);
  const e1 = await joinTeam(teamId, "e1", [editorAcc]);
  await setRole(teamId, "e1", "editor");
  await assign(teamId, "e1", memberAcc);
  return { teamId, adminUserId, adminAcc, memberAcc, editorAcc, m1, e1 };
}

/** チームの管理者の人数（いつも1人のはず） */
async function adminCount(teamId: string) {
  const [row] = (await sql()`SELECT count(*)::int AS n FROM team_members WHERE team_id = ${teamId} AND role = 'admin'`) as { n: number }[];
  return row?.n ?? 0;
}

async function deleteAccount(accountId: string, user: string) {
  const [acc] = (await sql()`SELECT username FROM accounts WHERE id = ${accountId}`) as { username: string }[];
  return call(app, "DELETE", `/api/accounts/${accountId}`, { user, body: { confirmUsername: acc!.username } });
}

beforeEach(async () => {
  await resetDb();
});

describe("POST /api/teams/:teamId/leave（抜ける）", () => {
  it("メンバー・編集者はいつでも抜けられる。アカウント・担当が外れ、記録とデータは残る", async () => {
    const { teamId, memberAcc, editorAcc } = await setup();
    expect((await call(app, "POST", `/api/teams/${teamId}/leave`, { user: "e1", body: {} })).status).toBe(204);
    expect((await call(app, "GET", `/api/accounts/${memberAcc}/post-drafts`, { user: "e1" })).status).toBe(404);
    expect((await activityRows(editorAcc)).map((r) => [r.action, r.actor_role])).toEqual([["team_member_left", "owner"]]);
    expect((await call(app, "POST", `/api/teams/${teamId}/leave`, { user: "m1" })).status).toBe(204);
    expect(await teamMemberRows(teamId)).toEqual([{ user: "a1", role: "admin" }]);
    const [left] = (await sql()`SELECT count(*)::int AS n FROM team_accounts WHERE account_id IN (${memberAcc}, ${editorAcc})`) as { n: number }[];
    expect(left!.n).toBe(0);
    expect((await call(app, "GET", `/api/accounts/${memberAcc}/post-drafts`, { user: "m1" })).status).toBe(200);
  });

  it("管理者は引き継ぎ先なしでは TEAM_ADMIN_MUST_TRANSFER、ほかに誰もいなければ TEAM_ADMIN_ALONE", async () => {
    const { teamId } = await setup();
    const res = await call(app, "POST", `/api/teams/${teamId}/leave`, { user: "a1", body: {} });
    expect([res.status, await errorOf(res)]).toEqual([409, "TEAM_ADMIN_MUST_TRANSFER"]);
    const { accountId } = await createUserWithAccount("solo");
    const { teamId: alone } = await makeTeam("solo", [accountId]);
    const solo = await call(app, "POST", `/api/teams/${alone}/leave`, { user: "solo", body: {} });
    expect([solo.status, await errorOf(solo)]).toEqual([409, "TEAM_ADMIN_ALONE"]);
  });

  it("管理者は引き継いで抜ける。引き継ぎ先がチームの人でなければ TEAM_NOT_FOUND", async () => {
    const { teamId, m1 } = await setup();
    const { accountId } = await createUserWithAccount("x1");
    const { adminUserId: outsider } = await makeTeam("x1", [accountId]);
    const bad = await call(app, "POST", `/api/teams/${teamId}/leave`, { user: "a1", body: { newAdminUserId: outsider } });
    expect([bad.status, await errorOf(bad)]).toEqual([404, "TEAM_NOT_FOUND"]);
    expect(await adminCount(teamId)).toBe(1);
    expect((await call(app, "POST", `/api/teams/${teamId}/leave`, { user: "a1", body: { newAdminUserId: m1 } })).status).toBe(204);
    expect(await teamMemberRows(teamId)).toEqual([
      { user: "m1", role: "admin" },
      { user: "e1", role: "editor" },
    ]);
    const [team] = (await sql()`SELECT admin_user_id FROM teams WHERE id = ${teamId}`) as { admin_user_id: string }[];
    expect(team!.admin_user_id).toBe(m1);
  });
});

describe("POST /api/teams/:teamId/admin（抜けずに引き継ぐ）", () => {
  it("前の管理者は、担当があれば編集者、なければメンバーになる（担当はそのまま）。記録 team_admin_transferred", async () => {
    const { teamId, adminUserId, memberAcc, m1, e1 } = await setup();
    // 担当なし → メンバー
    expect((await call(app, "POST", `/api/teams/${teamId}/admin`, { user: "a1", body: { userId: m1 } })).status).toBe(204);
    expect((await teamMemberRows(teamId)).find((m) => m.user === "a1")!.role).toBe("member");
    expect((await activityRows(memberAcc)).map((r) => [r.action, r.details])).toContainEqual([
      "team_admin_transferred",
      { from: "a1", to: "m1" },
    ]);
    // 担当あり → 編集者（担当はそのまま）
    const { accountId } = await createUserWithAccount("e1");
    await call(app, "POST", `/api/teams/${teamId}/accounts`, { user: "e1", body: { accountId } });
    await call(app, "PUT", `/api/teams/${teamId}/assignments/${m1}/accounts/${accountId}`, { user: "m1" });
    expect((await call(app, "POST", `/api/teams/${teamId}/admin`, { user: "m1", body: { userId: e1 } })).status).toBe(204);
    expect((await teamMemberRows(teamId)).find((m) => m.user === "m1")!.role).toBe("editor");
    expect((await call(app, "GET", `/api/accounts/${accountId}/post-drafts`, { user: "m1" })).status).toBe(200);
    expect(await adminCount(teamId)).toBe(1);
    // もう管理者でない人は引き継げない
    expect((await call(app, "POST", `/api/teams/${teamId}/admin`, { user: "a1", body: { userId: adminUserId } })).status).toBe(403);
  });

  it("同時に2つの引き継ぎが届いても、管理者は1人（SC-004）", async () => {
    const { teamId, m1, e1 } = await setup();
    const results = await Promise.all([
      call(app, "POST", `/api/teams/${teamId}/admin`, { user: "a1", body: { userId: m1 } }),
      call(app, "POST", `/api/teams/${teamId}/admin`, { user: "a1", body: { userId: e1 } }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([204, 403]);
    expect(await adminCount(teamId)).toBe(1);
  });
});

describe("引き継ぎと編集者の上限（PR #14 のCodexレビュー）", () => {
  it("編集者が10人のとき、担当のある管理者がメンバーへ引き継ぐと TEAM_FULL。引き継いで抜けるときは通る", async () => {
    const { teamId, adminUserId, m1, editorAcc } = await setup();
    // e1 を入れて編集者は1人。あと9人足して10人にする
    for (let i = 0; i < 9; i++) {
      const { accountId } = await createUserWithAccount(`x${i}`);
      await joinTeam(teamId, `x${i}`, [accountId]);
      await setRole(teamId, `x${i}`, "editor");
    }
    // 管理者は担当を持つ（引き継ぐと編集者になる）
    expect((await call(app, "PUT", `/api/teams/${teamId}/assignments/${adminUserId}/accounts/${editorAcc}`, { user: "a1" })).status).toBe(204);
    const res = await call(app, "POST", `/api/teams/${teamId}/admin`, { user: "a1", body: { userId: m1 } });
    expect([res.status, await errorOf(res)]).toEqual([409, "TEAM_FULL"]);
    expect(await adminCount(teamId)).toBe(1);
    expect((await teamMemberRows(teamId)).find((m) => m.user === "a1")!.role).toBe("admin");
    // 抜けるときは編集者として残らないので通る
    expect((await call(app, "POST", `/api/teams/${teamId}/leave`, { user: "a1", body: { newAdminUserId: m1 } })).status).toBe(204);
    const [editors] = (await sql()`SELECT count(*)::int AS n FROM team_members WHERE team_id = ${teamId} AND role = 'editor'`) as { n: number }[];
    expect(editors!.n).toBe(10);
  });
});

describe("DELETE /api/teams/:teamId/members/:userId（外す）", () => {
  it("管理者だけが外せる。自分は外せない。外すとその人のアカウントと担当が外れる", async () => {
    const { teamId, adminUserId, memberAcc, e1 } = await setup();
    expect((await call(app, "DELETE", `/api/teams/${teamId}/members/${e1}`, { user: "m1" })).status).toBe(403);
    expect((await call(app, "DELETE", `/api/teams/${teamId}/members/${adminUserId}`, { user: "a1" })).status).toBe(400);
    expect((await call(app, "DELETE", `/api/teams/${teamId}/members/${e1}`, { user: "a1" })).status).toBe(204);
    expect((await call(app, "GET", `/api/accounts/${memberAcc}/post-drafts`, { user: "e1" })).status).toBe(404);
    expect((await teamMemberRows(teamId)).map((m) => m.user)).toEqual(["a1", "m1"]);
  });

  it("外したメンバーのアカウントでの、ほかの人の担当も消える", async () => {
    const { teamId, memberAcc, m1 } = await setup();
    expect((await call(app, "DELETE", `/api/teams/${teamId}/members/${m1}`, { user: "a1" })).status).toBe(204);
    const [row] = (await sql()`SELECT count(*)::int AS n FROM memberships WHERE account_id = ${memberAcc} AND role = 'editor'`) as { n: number }[];
    expect(row!.n).toBe(0);
    expect((await activityRows(memberAcc)).map((r) => [r.action, r.actor_role])).toEqual([["team_member_removed", "admin"]]);
  });
});

describe("アカウントの削除（FR-046）", () => {
  it("最後のアカウントを消したメンバーは、チームを抜けたものになる", async () => {
    const { teamId, editorAcc } = await setup();
    expect((await deleteAccount(editorAcc, "e1")).status).toBe(204);
    expect((await teamMemberRows(teamId)).map((m) => m.user)).toEqual(["a1", "m1"]);
  });

  it("最後のアカウントを消した管理者は、いちばん早く入った人へ引き継いでから抜ける", async () => {
    const { teamId, adminAcc } = await setup();
    expect((await deleteAccount(adminAcc, "a1")).status).toBe(204);
    expect(await teamMemberRows(teamId)).toEqual([
      { user: "m1", role: "admin" },
      { user: "e1", role: "editor" },
    ]);
    expect(await adminCount(teamId)).toBe(1);
  });

  it("管理者しかいないチームで最後のアカウントを消すと、チームが消える", async () => {
    const { accountId } = await createUserWithAccount("solo");
    const { teamId } = await makeTeam("solo", [accountId]);
    expect((await deleteAccount(accountId, "solo")).status).toBe(204);
    const [row] = (await sql()`SELECT count(*)::int AS n FROM teams WHERE id = ${teamId}`) as { n: number }[];
    expect(row!.n).toBe(0);
  });

  it("同じアカウントの削除とチームから外すが同時に届いても、残ったアカウントを最後の1件と取り違えない（PR #14 のCodexレビュー）", async () => {
    for (let round = 0; round < 3; round++) {
      await resetDb();
      const { teamId, memberAcc } = await setup();
      const { accountId: second } = await createUserWithAccount("m1");
      await call(app, "POST", `/api/teams/${teamId}/accounts`, { user: "m1", body: { accountId: second } });
      await Promise.all([deleteAccount(memberAcc, "m1"), call(app, "DELETE", `/api/teams/${teamId}/accounts/${memberAcc}`, { user: "m1" })]);
      // どちらの順で終わっても、m1 は2つ目のアカウントでチームに残る
      expect((await teamMemberRows(teamId)).map((m) => m.user), `round ${round}`).toContain("m1");
      const [left] = (await sql()`SELECT count(*)::int AS n FROM team_accounts WHERE account_id = ${second}`) as { n: number }[];
      expect(left!.n, `round ${round}`).toBe(1);
    }
  });

  it("ほかにもアカウントがあれば、そのアカウントだけが外れ、チームには残る", async () => {
    const { teamId, memberAcc } = await setup();
    const { accountId: second } = await createUserWithAccount("m1");
    await call(app, "POST", `/api/teams/${teamId}/accounts`, { user: "m1", body: { accountId: second } });
    expect((await deleteAccount(memberAcc, "m1")).status).toBe(204);
    expect((await teamMemberRows(teamId)).map((m) => m.user)).toContain("m1");
  });
});

describe("どの順番でも管理者がいないチームはできない（SC-004）", () => {
  it("引き継ぎ・抜ける・外す・アカウントの削除を続けても、チームが残る限り管理者は1人", async () => {
    const { teamId, m1, e1, editorAcc } = await setup();
    const steps = [
      () => call(app, "POST", `/api/teams/${teamId}/admin`, { user: "a1", body: { userId: e1 } }),
      () => call(app, "DELETE", `/api/teams/${teamId}/members/${m1}`, { user: "e1" }),
      () => call(app, "POST", `/api/teams/${teamId}/leave`, { user: "a1", body: {} }),
      () => deleteAccount(editorAcc, "e1"),
    ];
    for (const step of steps) {
      await step();
      const [exists] = (await sql()`SELECT count(*)::int AS n FROM teams WHERE id = ${teamId}`) as { n: number }[];
      if (exists!.n > 0) expect(await adminCount(teamId)).toBe(1);
    }
  });
});
