// ロールの切り替えと担当（specs/011-team-revision US2、FR-005・FR-020〜FR-024・FR-060・FR-062、research.md R3・R9）
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

const errorOf = async (res: Response) => ((await res.json()) as { error: { code: string; details?: string[] } }).error;

/** 管理者 a1、オーナー o1、メンバー m1 のチーム */
async function setup() {
  const { accountId: adminAcc } = await createUserWithAccount("a1");
  const { accountId: ownerAcc } = await createUserWithAccount("o1");
  const { accountId: memberAcc } = await createUserWithAccount("m1");
  const { teamId, adminUserId } = await makeTeam("a1", [adminAcc]);
  const o1 = await joinTeam(teamId, "o1", [ownerAcc]);
  const m1 = await joinTeam(teamId, "m1", [memberAcc]);
  return { teamId, adminUserId, adminAcc, ownerAcc, memberAcc, o1, m1 };
}

beforeEach(async () => {
  await resetDb();
});

describe("PATCH /api/threads/teams/:teamId/members/:userId（ロールの切り替え）", () => {
  it("管理者だけが、メンバー⇔編集者を切り替えられる。管理者自身のロールは変えられない", async () => {
    const { teamId, adminUserId, m1 } = await setup();
    expect((await call(app, "PATCH", `/api/threads/teams/${teamId}/members/${m1}`, { user: "o1", body: { role: "editor" } })).status).toBe(403);
    expect((await call(app, "PATCH", `/api/threads/teams/${teamId}/members/${m1}`, { user: "a1", body: { role: "editor" } })).status).toBe(204);
    expect((await teamMemberRows(teamId)).find((m) => m.user === "m1")!.role).toBe("editor");
    const self = await call(app, "PATCH", `/api/threads/teams/${teamId}/members/${adminUserId}`, { user: "a1", body: { role: "member" } });
    expect([self.status, (await errorOf(self)).code]).toEqual([403, "ROLE_FORBIDDEN"]);
    const bad = await call(app, "PATCH", `/api/threads/teams/${teamId}/members/${m1}`, { user: "a1", body: { role: "admin" } });
    expect(bad.status).toBe(400);
  });

  it("編集者をメンバーに戻すと担当が消え、そのアカウントを開けなくなる。記録 team_role_changed・assignment_removed", async () => {
    const { teamId, ownerAcc, memberAcc, m1 } = await setup();
    await setRole(teamId, "m1", "editor");
    await assign(teamId, "m1", ownerAcc);
    expect((await call(app, "GET", `/api/threads/accounts/${ownerAcc}/post-drafts`, { user: "m1" })).status).toBe(200);
    expect((await call(app, "PATCH", `/api/threads/teams/${teamId}/members/${m1}`, { user: "a1", body: { role: "member" } })).status).toBe(204);
    expect((await call(app, "GET", `/api/threads/accounts/${ownerAcc}/post-drafts`, { user: "m1" })).status).toBe(404);
    expect((await activityRows(memberAcc)).map((r) => [r.action, r.details])).toEqual([
      ["team_role_changed", { userName: "m1", from: "editor", to: "member" }],
    ]);
    expect((await activityRows(ownerAcc)).map((r) => [r.action, r.summary, r.actor_role])).toEqual([["assignment_removed", "m1", "admin"]]);
  });

  it("編集者は10人まで（TEAM_FULL、details は editors）", async () => {
    const { teamId } = await setup();
    for (let i = 0; i < 10; i++) {
      const { accountId } = await createUserWithAccount(`e${i}`);
      await joinTeam(teamId, `e${i}`, [accountId]);
      await setRole(teamId, `e${i}`, "editor");
    }
    const { m1 } = { m1: (await sql()`SELECT id FROM users WHERE clerk_user_id = 'm1'`) as { id: string }[] };
    const res = await call(app, "PATCH", `/api/threads/teams/${teamId}/members/${m1[0]!.id}`, { user: "a1", body: { role: "editor" } });
    const err = await errorOf(res);
    expect([res.status, err.code, err.details]).toEqual([409, "TEAM_FULL", ["editors"]]);
  });
});

describe("担当の表（GET・PUT・DELETE /api/threads/teams/:teamId/assignments）", () => {
  it("行は編集者と管理者（メンバーは出ない）、列はチームのアカウント（オーナー名つき）", async () => {
    const { teamId, adminAcc, ownerAcc, memberAcc } = await setup();
    const { accountId: editorAcc } = await createUserWithAccount("e1");
    await joinTeam(teamId, "e1", [editorAcc]);
    await setRole(teamId, "e1", "editor");
    await assign(teamId, "e1", ownerAcc);
    type Table = { accounts: { id: string; ownerName: string }[]; people: { name: string; role: string; isMe: boolean; accountIds: string[] }[] };
    const table = await json<Table>(await call(app, "GET", `/api/threads/teams/${teamId}/assignments`, { user: "a1" }));
    expect(table.accounts.map((a) => [a.id, a.ownerName])).toEqual([
      [adminAcc, "a1"],
      [ownerAcc, "o1"],
      [memberAcc, "m1"],
      [editorAcc, "e1"],
    ]);
    expect(table.people).toEqual([
      { userId: expect.any(String), name: "a1", role: "admin", isMe: true, accountIds: [] },
      { userId: expect.any(String), name: "e1", role: "editor", isMe: false, accountIds: [ownerAcc] },
    ]);
    expect((await call(app, "GET", `/api/threads/teams/${teamId}/assignments`, { user: "e1" })).status).toBe(403);
  });

  it("担当にできるのは編集者と管理者だけ。自分のアカウント・メンバーは ASSIGNMENT_NOT_ALLOWED。2回目は何もしない", async () => {
    const { teamId, adminUserId, adminAcc, ownerAcc, m1 } = await setup();
    const { accountId: editorAcc } = await createUserWithAccount("e1");
    const e1 = await joinTeam(teamId, "e1", [editorAcc]);
    await setRole(teamId, "e1", "editor");
    const put = (userId: string, accountId: string) =>
      call(app, "PUT", `/api/threads/teams/${teamId}/assignments/${userId}/accounts/${accountId}`, { user: "a1" });
    expect((await put(e1, ownerAcc)).status).toBe(204);
    expect((await put(e1, ownerAcc)).status).toBe(204);
    expect((await put(adminUserId, ownerAcc)).status).toBe(204);
    for (const [userId, accountId] of [
      [e1, editorAcc],
      [adminUserId, adminAcc],
      [m1, ownerAcc],
    ] as const) {
      const res = await put(userId, accountId);
      expect([res.status, (await errorOf(res)).code]).toEqual([409, "ASSIGNMENT_NOT_ALLOWED"]);
    }
    // チームにないアカウントは見つからない
    const { accountId: outside } = await createUserWithAccount("x1");
    const res = await put(e1, outside);
    expect([res.status, (await errorOf(res)).code]).toEqual([404, "TEAM_NOT_FOUND"]);
    expect((await activityRows(ownerAcc)).map((r) => [r.action, r.summary])).toEqual([
      ["assignment_added", "a1"],
      ["assignment_added", "e1"],
    ]);
    expect((await call(app, "DELETE", `/api/threads/teams/${teamId}/assignments/${e1}/accounts/${ownerAcc}`, { user: "a1" })).status).toBe(204);
    expect((await call(app, "GET", `/api/threads/accounts/${ownerAcc}/strategy`, { user: "e1" })).status).toBe(404);
  });
});

describe("担当の人ができること（FR-005・FR-023・FR-060）", () => {
  it("担当の人は案を登録・直せ、登録した案は要確認になる。承認・設定は ROLE_FORBIDDEN", async () => {
    const { teamId, ownerAcc } = await setup();
    const { accountId: editorAcc } = await createUserWithAccount("e1");
    await joinTeam(teamId, "e1", [editorAcc]);
    await setRole(teamId, "e1", "editor");
    await assign(teamId, "e1", ownerAcc);
    const reg = await json<{ drafts: { id: string; version: number; status: string }[] }>(
      await call(app, "POST", `/api/threads/accounts/${ownerAcc}/draft-batches`, {
        user: "e1",
        body: { clientRequestId: crypto.randomUUID(), text: "編集者の案" },
      }),
      201,
    );
    expect(reg.drafts[0]!.status).toBe("needs_review");
    const review = await call(app, "POST", `/api/threads/accounts/${ownerAcc}/post-drafts/review`, {
      user: "e1",
      body: { requestId: crypto.randomUUID(), action: "approve", items: [{ id: reg.drafts[0]!.id, expectedVersion: reg.drafts[0]!.version }] },
    });
    expect([review.status, (await errorOf(review)).code]).toEqual([403, "ROLE_FORBIDDEN"]);
    const ng = await call(app, "POST", `/api/threads/accounts/${ownerAcc}/ng-words`, { user: "e1", body: { words: ["x"] } });
    expect([ng.status, (await errorOf(ng)).code]).toEqual([403, "ROLE_FORBIDDEN"]);
    // 承認はオーナーだけができる
    const ok = await call(app, "POST", `/api/threads/accounts/${ownerAcc}/post-drafts/review`, {
      user: "o1",
      body: { requestId: crypto.randomUUID(), action: "approve", items: [{ id: reg.drafts[0]!.id, expectedVersion: reg.drafts[0]!.version }] },
    });
    expect(ok.status).toBe(200);
  });

  it("担当の人が登録したNGワードを含む案は、オーナーでも承認できない（原則I・II）", async () => {
    const { teamId, ownerAcc } = await setup();
    const { accountId: editorAcc } = await createUserWithAccount("e1");
    await joinTeam(teamId, "e1", [editorAcc]);
    await setRole(teamId, "e1", "editor");
    await assign(teamId, "e1", ownerAcc);
    await json(await call(app, "POST", `/api/threads/accounts/${ownerAcc}/ng-words`, { user: "o1", body: { words: ["絶対"] } }));
    const reg = await json<{ drafts: { id: string; version: number; status: string }[] }>(
      await call(app, "POST", `/api/threads/accounts/${ownerAcc}/draft-batches`, {
        user: "e1",
        body: { clientRequestId: crypto.randomUUID(), text: "絶対に効きます" },
      }),
      201,
    );
    expect(reg.drafts[0]!.status).toBe("needs_review");
    const review = await call(app, "POST", `/api/threads/accounts/${ownerAcc}/post-drafts/review`, {
      user: "o1",
      body: { requestId: crypto.randomUUID(), action: "approve", items: [{ id: reg.drafts[0]!.id, expectedVersion: reg.drafts[0]!.version }] },
    });
    const body = await json<{ skipped: { id: string; reason: string }[] }>(review);
    expect(body.skipped).toEqual([expect.objectContaining({ id: reg.drafts[0]!.id, reason: "NG_WORD" })]);
    const [row] = (await sql()`SELECT status FROM threads.post_drafts WHERE id = ${reg.drafts[0]!.id}`) as { status: string }[];
    expect(row!.status).toBe("needs_review");
  });

  it("管理者は、自分を担当にしたアカウントでだけ案を作れ、そのアカウントの操作の記録を見られる", async () => {
    const { teamId, adminUserId, ownerAcc, memberAcc } = await setup();
    const register = (accountId: string) =>
      call(app, "POST", `/api/threads/accounts/${accountId}/draft-batches`, {
        user: "a1",
        body: { clientRequestId: crypto.randomUUID(), text: "管理者の案" },
      });
    expect((await register(ownerAcc)).status).toBe(404);
    expect((await call(app, "PUT", `/api/threads/teams/${teamId}/assignments/${adminUserId}/accounts/${ownerAcc}`, { user: "a1" })).status).toBe(204);
    expect((await register(ownerAcc)).status).toBe(201);
    expect((await register(memberAcc)).status).toBe(404);
    expect((await call(app, "GET", `/api/threads/accounts/${ownerAcc}/activity`, { user: "a1" })).status).toBe(200);
  });
});

describe("担当の知らせ（FR-062、research.md R9）", () => {
  it("担当になると /access の assignedNotice が true。閉じると false。オーナーにはいつも false", async () => {
    const { teamId, ownerAcc } = await setup();
    const { accountId: editorAcc } = await createUserWithAccount("e1");
    await joinTeam(teamId, "e1", [editorAcc]);
    await setRole(teamId, "e1", "editor");
    await assign(teamId, "e1", ownerAcc);
    const notice = async (user: string) =>
      (await json<{ assignedNotice: boolean }>(await call(app, "GET", `/api/threads/accounts/${ownerAcc}/access`, { user }))).assignedNotice;
    expect(await notice("e1")).toBe(true);
    expect(await notice("o1")).toBe(false);
    expect((await call(app, "POST", `/api/threads/accounts/${ownerAcc}/assigned-notice/dismiss`, { user: "e1" })).status).toBe(204);
    expect(await notice("e1")).toBe(false);
  });
});
