// 招待の確認と参加（specs/011-team-revision contracts/api.md「招待の確認と参加」、FR-011〜FR-016）
import { neon } from "@neondatabase/serverless";
import { beforeEach, describe, expect, it } from "vitest";
import { call, createUserWithAccount, makeApp, resetDb, testEnv } from "../helpers/app";
import { activityRows, ensureUser, joinTeam, makeTeam, teamMemberRows } from "../helpers/team";

const app = makeApp();
const sql = () => neon(testEnv.DATABASE_URL);

async function json<T>(res: Response, status = 200): Promise<T> {
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as T;
}

const errorOf = async (res: Response) => ((await res.json()) as { error: { code: string; details?: string[] } }).error;

type Preview = {
  team: { name: string; adminName: string; memberCount: number };
  viewer: { status: string; teamId: string | null; accounts: { id: string; username: string; inOtherTeam: string | null }[] };
};

beforeEach(async () => {
  await resetDb();
});

async function team() {
  const { accountId } = await createUserWithAccount("a1");
  return makeTeam("a1", [accountId], { name: "飲食チーム" });
}

describe("GET /api/threads/invites/:token（招待の確認）", () => {
  it("ログイン前は anonymous で、チーム名・管理者・人数だけ", async () => {
    const { token } = await team();
    const res = await json<Preview>(await call(app, "GET", `/api/threads/invites/${token}`));
    expect(res).toEqual({
      team: { name: "飲食チーム", adminName: "a1", memberCount: 1 },
      viewer: { status: "anonymous", teamId: null, accounts: [] },
    });
  });

  it("自分のアカウントがなければ needs_account。あれば ready で、ほかのチームに入っているものはそのチーム名", async () => {
    const { token } = await team();
    await ensureUser("u1");
    expect((await json<Preview>(await call(app, "GET", `/api/threads/invites/${token}`, { user: "u1" }))).viewer.status).toBe("needs_account");
    const { accountId: free } = await createUserWithAccount("u1");
    const { accountId: busy } = await createUserWithAccount("u1");
    await makeTeam("u1", [busy], { name: "美容チーム" });
    const ready = await json<Preview>(await call(app, "GET", `/api/threads/invites/${token}`, { user: "u1" }));
    expect(ready.viewer.status).toBe("ready");
    expect(ready.viewer.accounts.map((a) => [a.id, a.inOtherTeam])).toEqual([
      [free, null],
      [busy, "美容チーム"],
    ]);
  });

  it("すでにチームの人なら already_member とチームのID", async () => {
    const { teamId, token } = await team();
    const res = await json<Preview>(await call(app, "GET", `/api/threads/invites/${token}`, { user: "a1" }));
    expect(res.viewer).toEqual({ status: "already_member", teamId, accounts: [] });
  });

  it("形が違う・見つからない文字列は INVITE_INVALID", async () => {
    for (const token of ["x", `t_${"A".repeat(43)}`, `p_${"A".repeat(43)}`]) {
      const res = await call(app, "GET", `/api/threads/invites/${token}`);
      expect([res.status, (await errorOf(res)).code], token).toEqual([404, "INVITE_INVALID"]);
    }
  });
});

describe("POST /api/threads/invites/:token/accept（参加）", () => {
  it("選んだアカウントを入れてメンバーとして入る。見せる設定はアカウントごと。記録 team_member_joined", async () => {
    const { teamId, token } = await team();
    const { accountId: a } = await createUserWithAccount("u1");
    const { accountId: b } = await createUserWithAccount("u1");
    const res = await json<{ teamId: string }>(
      await call(app, "POST", `/api/threads/invites/${token}/accept`, { user: "u1", body: { accounts: [{ id: a, shared: true }, { id: b, shared: false }] } }),
    );
    expect(res.teamId).toBe(teamId);
    expect(await teamMemberRows(teamId)).toEqual([
      { user: "a1", role: "admin" },
      { user: "u1", role: "member" },
    ]);
    const rows = (await sql()`SELECT account_id, shared FROM threads.team_accounts WHERE team_id = ${teamId} AND account_id IN (${a}, ${b})`) as {
      account_id: string;
      shared: boolean;
    }[];
    expect(Object.fromEntries(rows.map((r) => [r.account_id, r.shared]))).toEqual({ [a]: true, [b]: false });
    expect((await activityRows(a)).map((r) => [r.action, r.actor_role, r.summary])).toEqual([["team_member_joined", "owner", "u1"]]);
    // 見せたアカウントは、管理者が読むだけで開ける
    expect((await call(app, "GET", `/api/threads/accounts/${a}/strategy`, { user: "a1" })).status).toBe(200);
    expect((await call(app, "GET", `/api/threads/accounts/${b}/strategy`, { user: "a1" })).status).toBe(404);
  });

  it("0件は TEAM_NEEDS_ACCOUNT、ほかのチームのアカウントは ACCOUNT_IN_OTHER_TEAM、他人のアカウントは ACCOUNT_NOT_FOUND", async () => {
    const { token } = await team();
    const { accountId: busy } = await createUserWithAccount("u1");
    await makeTeam("u1", [busy]);
    const { accountId: free } = await createUserWithAccount("u2");
    const { accountId: others } = await createUserWithAccount("u3");
    const none = await call(app, "POST", `/api/threads/invites/${token}/accept`, { user: "u2", body: { accounts: [] } });
    expect([none.status, (await errorOf(none)).code]).toEqual([409, "TEAM_NEEDS_ACCOUNT"]);
    const inOther = await call(app, "POST", `/api/threads/invites/${token}/accept`, { user: "u1", body: { accounts: [{ id: busy, shared: false }] } });
    const err = await errorOf(inOther);
    expect([inOther.status, err.code, err.details]).toEqual([409, "ACCOUNT_IN_OTHER_TEAM", [busy]]);
    const notMine = await call(app, "POST", `/api/threads/invites/${token}/accept`, {
      user: "u2",
      body: { accounts: [{ id: free, shared: false }, { id: others, shared: false }] },
    });
    expect([notMine.status, (await errorOf(notMine)).code]).toEqual([404, "ACCOUNT_NOT_FOUND"]);
    // 失敗した参加では、何も入らない
    expect((await sql()`SELECT count(*)::int AS n FROM threads.team_accounts WHERE account_id = ${free}`) as { n: number }[]).toEqual([{ n: 0 }]);
  });

  it("すでにチームの人は INVITE_ALREADY_MEMBER。同じ人の同時の参加でも1回だけ入る", async () => {
    const { teamId, token } = await team();
    const { accountId } = await createUserWithAccount("u1");
    const body = { accounts: [{ id: accountId, shared: false }] };
    const results = await Promise.all([
      call(app, "POST", `/api/threads/invites/${token}/accept`, { user: "u1", body }),
      call(app, "POST", `/api/threads/invites/${token}/accept`, { user: "u1", body }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const again = await call(app, "POST", `/api/threads/invites/${token}/accept`, { user: "u1", body });
    expect([again.status, (await errorOf(again)).code]).toEqual([409, "INVITE_ALREADY_MEMBER"]);
    expect((await teamMemberRows(teamId)).filter((m) => m.user === "u1")).toHaveLength(1);
  });

  it("50人で TEAM_FULL。作り直した前のリンク・削除したチームのリンクは INVITE_INVALID", async () => {
    const { teamId, token } = await team();
    for (let i = 0; i < 49; i++) {
      const { accountId } = await createUserWithAccount(`m${i}`);
      await joinTeam(teamId, `m${i}`, [accountId]);
    }
    const { accountId } = await createUserWithAccount("u1");
    const full = await call(app, "POST", `/api/threads/invites/${token}/accept`, { user: "u1", body: { accounts: [{ id: accountId, shared: false }] } });
    const err = await errorOf(full);
    expect([full.status, err.code, err.details]).toEqual([409, "TEAM_FULL", ["members"]]);

    const { teamId: t2, token: old } = await team();
    await call(app, "POST", `/api/threads/teams/${t2}/invite/rotate`, { user: "a1" });
    const rotated = await call(app, "POST", `/api/threads/invites/${old}/accept`, { user: "u1", body: { accounts: [{ id: accountId, shared: false }] } });
    expect([rotated.status, (await errorOf(rotated)).code]).toEqual([404, "INVITE_INVALID"]);

    const { teamId: t3, token: deleted } = await team();
    expect((await call(app, "DELETE", `/api/threads/teams/${t3}`, { user: "a1" })).status).toBe(204);
    const gone = await call(app, "POST", `/api/threads/invites/${deleted}/accept`, { user: "u1", body: { accounts: [{ id: accountId, shared: false }] } });
    expect([gone.status, (await errorOf(gone)).code]).toEqual([404, "INVITE_INVALID"]);
  });

  it("ログインしていなければ 401", async () => {
    const { token } = await team();
    expect((await call(app, "POST", `/api/threads/invites/${token}/accept`, { body: { accounts: [] } })).status).toBe(401);
  });
});
