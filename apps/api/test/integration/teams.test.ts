// チームを作る・読む・名前・削除・招待（specs/011-team-revision US1、FR-010・FR-011・FR-016・FR-017・FR-062）
import { neon } from "@neondatabase/serverless";
import { beforeEach, describe, expect, it } from "vitest";
import { call, createUserWithAccount, makeApp, resetDb, testEnv } from "../helpers/app";
import { activityRows, assign, joinTeam, makeTeam, setRole, teamMemberRows } from "../helpers/team";

const app = makeApp();
const sql = () => neon(testEnv.DATABASE_URL);

async function json<T>(res: Response, status = 200): Promise<T> {
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as T;
}

const codeOf = async (res: Response) => ((await res.json()) as { error: { code: string; details?: string[] } }).error;

type Detail = {
  id: string;
  name: string;
  myRole: string;
  admin: { userId: string; name: string };
  members: {
    userId: string;
    name: string;
    role: string;
    isMe: boolean;
    joinedNotice: boolean;
    accounts: { id: string; username: string; displayName: string | null; profilePictureUrl: string | null; shared: boolean; canOpen: boolean; relation: string | null }[];
  }[];
  limits: { members: number; editors: number };
};

beforeEach(async () => {
  await resetDb();
});

describe("POST /api/threads/teams（FR-010）", () => {
  it("自分のアカウントを1つ以上入れて作る。作った人が管理者、アカウントは見せない状態で入る。記録 team_created", async () => {
    const { accountId } = await createUserWithAccount("a1");
    const { teamId } = await json<{ teamId: string }>(
      await call(app, "POST", "/api/threads/teams", { user: "a1", body: { name: "  飲食チーム  ", accountIds: [accountId] } }),
      201,
    );
    expect(await teamMemberRows(teamId)).toEqual([{ user: "a1", role: "admin" }]);
    const detail = await json<Detail>(await call(app, "GET", `/api/threads/teams/${teamId}`, { user: "a1" }));
    expect(detail).toMatchObject({ name: "飲食チーム", myRole: "admin", admin: { name: "a1" }, limits: { members: 50, editors: 10 } });
    expect(detail.members[0]!.accounts.map((a) => [a.id, a.shared, a.relation])).toEqual([[accountId, false, "owner"]]);
    expect((await activityRows(accountId)).map((r) => [r.action, r.actor_role, r.summary])).toEqual([["team_created", "owner", "飲食チーム"]]);
  });

  it("名前は前後の空白を除いて1〜50文字。アカウントなしは TEAM_NEEDS_ACCOUNT、他人のアカウントは ACCOUNT_NOT_FOUND", async () => {
    const { accountId } = await createUserWithAccount("a1");
    const { accountId: others } = await createUserWithAccount("o1");
    for (const name of ["", "   ", "あ".repeat(51)]) {
      const res = await call(app, "POST", "/api/threads/teams", { user: "a1", body: { name, accountIds: [accountId] } });
      expect([res.status, (await codeOf(res)).code], name).toEqual([400, "VALIDATION_FAILED"]);
    }
    expect((await call(app, "POST", "/api/threads/teams", { user: "a1", body: { name: "あ".repeat(50), accountIds: [accountId] } })).status).toBe(201);
    const none = await call(app, "POST", "/api/threads/teams", { user: "a1", body: { name: "x", accountIds: [] } });
    expect([none.status, (await codeOf(none)).code]).toEqual([409, "TEAM_NEEDS_ACCOUNT"]);
    const notMine = await call(app, "POST", "/api/threads/teams", { user: "a1", body: { name: "x", accountIds: [others] } });
    expect([notMine.status, (await codeOf(notMine)).code]).toEqual([404, "ACCOUNT_NOT_FOUND"]);
  });

  it("ほかのチームに入っているアカウントでは作れない（ACCOUNT_IN_OTHER_TEAM、details にアカウント）", async () => {
    const { accountId } = await createUserWithAccount("a1");
    await makeTeam("a1", [accountId]);
    const res = await call(app, "POST", "/api/threads/teams", { user: "a1", body: { name: "2つ目", accountIds: [accountId] } });
    const err = await codeOf(res);
    expect([res.status, err.code, err.details]).toEqual([409, "ACCOUNT_IN_OTHER_TEAM", [accountId]]);
  });

  it("1人が管理者のチームは20まで（TEAM_LIMIT_REACHED）", async () => {
    const { accountId } = await createUserWithAccount("a1");
    for (let i = 0; i < 20; i++) await makeTeam("a1", i === 0 ? [accountId] : []);
    const { accountId: next } = await createUserWithAccount("a1");
    const res = await call(app, "POST", "/api/threads/teams", { user: "a1", body: { name: "21個目", accountIds: [next] } });
    expect([res.status, (await codeOf(res)).code]).toEqual([409, "TEAM_LIMIT_REACHED"]);
  });
});

describe("GET /api/threads/teams/:teamId（チームの詳細）", () => {
  it("チームの人だけ読める。isMe・ロール・開けるアカウントの関わり。開けないアカウントは名前だけ", async () => {
    const { accountId: adminAcc } = await createUserWithAccount("a1");
    const { accountId: shared } = await createUserWithAccount("o1");
    const { accountId: hidden } = await createUserWithAccount("o2");
    const { accountId: editorAcc } = await createUserWithAccount("e1");
    const { teamId } = await makeTeam("a1", [adminAcc]);
    await joinTeam(teamId, "o1", [shared], { shared: true });
    await joinTeam(teamId, "o2", [hidden], { shared: false });
    await joinTeam(teamId, "e1", [editorAcc]);
    await setRole(teamId, "e1", "editor");
    await assign(teamId, "e1", hidden);
    const asEditor = await json<Detail>(await call(app, "GET", `/api/threads/teams/${teamId}`, { user: "e1" }));
    expect(asEditor.myRole).toBe("editor");
    expect(asEditor.members.map((m) => [m.name, m.role, m.isMe])).toEqual([
      ["a1", "admin", false],
      ["o1", "member", false],
      ["o2", "member", false],
      ["e1", "editor", true],
    ]);
    const accountsOf = (d: Detail, name: string) => d.members.find((m) => m.name === name)!.accounts;
    expect(accountsOf(asEditor, "o1")[0]).toMatchObject({ shared: true, canOpen: true, relation: "shared_viewer" });
    // 見せていなくても担当なら開ける
    expect(accountsOf(asEditor, "o2")[0]).toMatchObject({ shared: false, canOpen: true, relation: "assigned" });
    expect(accountsOf(asEditor, "a1")[0]).toMatchObject({ shared: false, canOpen: false, relation: null, profilePictureUrl: null });
    expect(accountsOf(asEditor, "e1")[0]).toMatchObject({ canOpen: true, relation: "owner" });
    // 管理者も、見せていない・担当でないアカウントは開けない（FR-002）
    const asAdmin = await json<Detail>(await call(app, "GET", `/api/threads/teams/${teamId}`, { user: "a1" }));
    expect(accountsOf(asAdmin, "o2")[0]).toMatchObject({ canOpen: false, relation: null });
    const stranger = await call(app, "GET", `/api/threads/teams/${teamId}`, { user: "x1" });
    expect([stranger.status, (await codeOf(stranger)).code]).toEqual([404, "TEAM_NOT_FOUND"]);
  });

  it("参加の知らせは、管理者が閉じるまで joinedNotice が true（管理者だけに出す。FR-062）", async () => {
    const { accountId: adminAcc } = await createUserWithAccount("a1");
    const { accountId } = await createUserWithAccount("m1");
    const { teamId } = await makeTeam("a1", [adminAcc]);
    const m1 = await joinTeam(teamId, "m1", [accountId]);
    const notice = async (user: string) =>
      (await json<Detail>(await call(app, "GET", `/api/threads/teams/${teamId}`, { user }))).members.find((m) => m.name === "m1")!.joinedNotice;
    expect(await notice("a1")).toBe(true);
    expect(await notice("m1")).toBe(false);
    const forbidden = await call(app, "POST", `/api/threads/teams/${teamId}/members/${m1}/joined-notice/dismiss`, { user: "m1" });
    expect(forbidden.status).toBe(403);
    expect((await call(app, "POST", `/api/threads/teams/${teamId}/members/${m1}/joined-notice/dismiss`, { user: "a1" })).status).toBe(204);
    expect(await notice("a1")).toBe(false);
  });
});

describe("PATCH・DELETE /api/threads/teams/:teamId（FR-017）", () => {
  it("名前を直せるのは管理者だけ。チームのすべてのアカウントに team_renamed", async () => {
    const { accountId: adminAcc } = await createUserWithAccount("a1");
    const { accountId } = await createUserWithAccount("m1");
    const { teamId } = await makeTeam("a1", [adminAcc], { name: "前の名前" });
    await joinTeam(teamId, "m1", [accountId]);
    expect((await call(app, "PATCH", `/api/threads/teams/${teamId}`, { user: "m1", body: { name: "x" } })).status).toBe(403);
    expect((await call(app, "PATCH", `/api/threads/teams/${teamId}`, { user: "a1", body: { name: "" } })).status).toBe(400);
    expect((await call(app, "PATCH", `/api/threads/teams/${teamId}`, { user: "a1", body: { name: "新しい名前" } })).status).toBe(204);
    expect((await json<Detail>(await call(app, "GET", `/api/threads/teams/${teamId}`, { user: "m1" }))).name).toBe("新しい名前");
    for (const id of [adminAcc, accountId]) {
      expect((await activityRows(id)).map((r) => [r.action, r.details])).toEqual([["team_renamed", { from: "前の名前", to: "新しい名前" }]]);
    }
  });

  it("削除するとチームの人・アカウント・担当が外れ、アカウントのデータと記録は残る", async () => {
    const { accountId: adminAcc } = await createUserWithAccount("a1");
    const { accountId } = await createUserWithAccount("o1");
    const { teamId } = await makeTeam("a1", [adminAcc]);
    await joinTeam(teamId, "o1", [accountId]);
    await assign(teamId, "a1", accountId);
    const reg = await call(app, "POST", `/api/threads/accounts/${accountId}/draft-batches`, {
      user: "a1",
      body: { clientRequestId: crypto.randomUUID(), text: "案" },
    });
    expect(reg.status).toBe(201);
    expect((await call(app, "DELETE", `/api/threads/teams/${teamId}`, { user: "o1" })).status).toBe(403);
    expect((await call(app, "DELETE", `/api/threads/teams/${teamId}`, { user: "a1" })).status).toBe(204);
    const counts = (await sql()`SELECT
      (SELECT count(*)::int FROM threads.teams) AS teams,
      (SELECT count(*)::int FROM threads.team_members) AS members,
      (SELECT count(*)::int FROM threads.team_accounts) AS accounts,
      (SELECT count(*)::int FROM threads.memberships WHERE role = 'editor') AS assigned,
      (SELECT count(*)::int FROM threads.post_drafts) AS drafts`) as Record<string, number>[];
    expect(counts[0]).toEqual({ teams: 0, members: 0, accounts: 0, assigned: 0, drafts: 1 });
    expect((await activityRows(accountId)).map((r) => r.action)).toEqual(["team_deleted", "drafts_registered"]);
    // 担当だった人は、もう開けない
    expect((await call(app, "GET", `/api/threads/accounts/${accountId}/post-drafts`, { user: "a1" })).status).toBe(404);
    expect((await call(app, "GET", `/api/threads/teams/${teamId}`, { user: "a1" })).status).toBe(404);
  });
});

describe("招待リンク（FR-011・FR-016）", () => {
  it("管理者だけが表示・作り直しできる。URL は WEB_ORIGIN/invite/t_…。作り直すと前のリンクはすぐ使えない", async () => {
    const { accountId: adminAcc } = await createUserWithAccount("a1");
    const { accountId } = await createUserWithAccount("m1");
    const { teamId, token } = await makeTeam("a1", [adminAcc]);
    await joinTeam(teamId, "m1", [accountId]);
    expect((await call(app, "GET", `/api/threads/teams/${teamId}/invite`, { user: "m1" })).status).toBe(403);
    const first = await json<{ url: string; rotatedAt: string }>(await call(app, "GET", `/api/threads/teams/${teamId}/invite`, { user: "a1" }));
    expect(first.url).toBe(`${testEnv.WEB_ORIGIN}/invite/${token}`);
    expect(first.url).toMatch(/\/invite\/t_[A-Za-z0-9_-]{43}$/);
    const rotated = await json<{ url: string }>(await call(app, "POST", `/api/threads/teams/${teamId}/invite/rotate`, { user: "a1" }));
    expect(rotated.url).not.toBe(first.url);
    const old = await call(app, "GET", `/api/threads/invites/${token}`);
    expect([old.status, (await codeOf(old)).code]).toEqual([404, "INVITE_INVALID"]);
    expect((await call(app, "GET", `/api/threads/invites/${rotated.url.split("/invite/")[1]}`)).status).toBe(200);
  });

  it("DBに招待の文字列の平文は残さない（照合用のハッシュと暗号文だけ）", async () => {
    const { accountId } = await createUserWithAccount("a1");
    const { teamId } = await json<{ teamId: string }>(
      await call(app, "POST", "/api/threads/teams", { user: "a1", body: { name: "飲食チーム", accountIds: [accountId] } }),
      201,
    );
    const { url } = await json<{ url: string }>(await call(app, "GET", `/api/threads/teams/${teamId}/invite`, { user: "a1" }));
    const token = url.split("/invite/")[1]!;
    const rows = (await sql()`SELECT invite_token_hash AS h, encode(invite_token_ciphertext, 'escape') AS c FROM threads.teams`) as {
      h: string;
      c: string;
    }[];
    expect(rows[0]!.h).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]!.c).not.toContain(token);
    expect(JSON.stringify(await sql()`SELECT * FROM threads.teams`)).not.toContain(token);
  });
});
