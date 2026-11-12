// 判定の本体（specs/011-team-revision contracts/permissions.md、research.md R3・R4）。
import { beforeEach, describe, expect, it } from "vitest";
import { authorizeAccount, authorizeAssignment, authorizeTeamAdmin, authorizeTeamMember } from "../../src/apps/threads/access/access";
import { createUserWithAccount, db, resetDb } from "../helpers/app";
import { assign, ensureUser, joinTeam, makeTeam, setRole, setShared } from "../helpers/team";

async function codeOf(p: Promise<unknown>) {
  try {
    await p;
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
}

/** 決済OFF（判定はチームの関わりだけで決まる） */
const OFF = { enabled: false };

beforeEach(async () => {
  await resetDb();
});

describe("authorizeAccount（4つの関わり）", () => {
  it("オーナーはすべての権限。チームに入っていなければ hasTeam は false、team は NULL", async () => {
    const { userId, accountId } = await createUserWithAccount("o1");
    const access = await authorizeAccount(db(), { id: userId, billing: OFF }, accountId, "owner");
    expect(access.relation).toBe("owner");
    expect(access.hasTeam).toBe(false);
    expect(access.team).toBeNull();
    expect(access.isTeamAdmin).toBe(false);
    expect(access.owner).toMatchObject({ id: userId, name: "o1" });
    expect(access.actor).toMatchObject({ id: userId, role: "owner" });
  });

  it("チームに入っているオーナー：hasTeam は true、team にチームと自分のロール", async () => {
    const { userId, accountId } = await createUserWithAccount("a1");
    const { teamId } = await makeTeam("a1", [accountId], { name: "飲食チーム" });
    const access = await authorizeAccount(db(), { id: userId, billing: OFF }, accountId, "owner");
    expect(access.relation).toBe("owner");
    expect(access.hasTeam).toBe(true);
    expect(access.team).toEqual({ id: teamId, name: "飲食チーム", myRole: "admin" });
    expect(access.isTeamAdmin).toBe(true);
  });

  it("担当の人（編集者）は content まで。承認・設定・操作の記録は ROLE_FORBIDDEN", async () => {
    const { accountId: adminAcc } = await createUserWithAccount("a1");
    const { accountId } = await createUserWithAccount("o1");
    const { accountId: editorAcc } = await createUserWithAccount("e1");
    const { teamId } = await makeTeam("a1", [adminAcc]);
    await joinTeam(teamId, "o1", [accountId]);
    const editor = await joinTeam(teamId, "e1", [editorAcc]);
    await setRole(teamId, "e1", "editor");
    await assign(teamId, "e1", accountId);
    const access = await authorizeAccount(db(), { id: editor, billing: OFF }, accountId, "content");
    expect(access.relation).toBe("assigned");
    expect(access.actor.role).toBe("editor");
    expect(access.team?.myRole).toBe("editor");
    for (const p of ["review", "settings", "activity", "owner"] as const) {
      expect(await codeOf(authorizeAccount(db(), { id: editor, billing: OFF }, accountId, p)), p).toBe("ROLE_FORBIDDEN");
    }
  });

  it("自分を担当にした管理者は、content と操作の記録まで。記録の役割は admin", async () => {
    const { userId: admin, accountId: adminAcc } = await createUserWithAccount("a1");
    const { accountId } = await createUserWithAccount("o1");
    const { teamId } = await makeTeam("a1", [adminAcc]);
    await joinTeam(teamId, "o1", [accountId]);
    await assign(teamId, "a1", accountId);
    const access = await authorizeAccount(db(), { id: admin, billing: OFF }, accountId, "activity");
    expect(access.relation).toBe("assigned");
    expect(access.isTeamAdmin).toBe(true);
    expect(access.actor.role).toBe("admin");
    expect(await codeOf(authorizeAccount(db(), { id: admin, billing: OFF }, accountId, "review"))).toBe("ROLE_FORBIDDEN");
  });

  it("見せているアカウント：同じチームの人（管理者を含む）は read だけ。見せていなければ ACCOUNT_NOT_FOUND", async () => {
    const { userId: admin, accountId: adminAcc } = await createUserWithAccount("a1");
    const { accountId } = await createUserWithAccount("o1");
    const { accountId: memberAcc } = await createUserWithAccount("m1");
    const { teamId } = await makeTeam("a1", [adminAcc]);
    await joinTeam(teamId, "o1", [accountId], { shared: true });
    const member = await joinTeam(teamId, "m1", [memberAcc]);
    for (const id of [admin, member]) {
      const access = await authorizeAccount(db(), { id, billing: OFF }, accountId, "read");
      expect(access.relation).toBe("shared_viewer");
      expect(await codeOf(authorizeAccount(db(), { id, billing: OFF }, accountId, "view"))).toBe("ROLE_FORBIDDEN");
    }
    await setShared(teamId, accountId, false);
    for (const id of [admin, member]) {
      expect(await codeOf(authorizeAccount(db(), { id, billing: OFF }, accountId, "read"))).toBe("ACCOUNT_NOT_FOUND");
    }
  });

  it("担当は、見せていなくても開ける。別のチームの人・関係のない人・UUIDでないIDは ACCOUNT_NOT_FOUND", async () => {
    const { accountId: adminAcc } = await createUserWithAccount("a1");
    const { accountId } = await createUserWithAccount("o1");
    const { accountId: editorAcc } = await createUserWithAccount("e1");
    const { accountId: otherAcc } = await createUserWithAccount("x1");
    const { teamId } = await makeTeam("a1", [adminAcc]);
    await joinTeam(teamId, "o1", [accountId], { shared: false });
    const editor = await joinTeam(teamId, "e1", [editorAcc]);
    await setRole(teamId, "e1", "editor");
    await assign(teamId, "e1", accountId);
    expect((await authorizeAccount(db(), { id: editor, billing: OFF }, accountId, "read")).relation).toBe("assigned");
    // 別のチームの人（見せていても見えない）
    const { teamId: other } = await makeTeam("x1", [otherAcc]);
    await setShared(teamId, accountId, true);
    const outsider = await ensureUser("x1");
    expect(await codeOf(authorizeAccount(db(), { id: outsider, billing: OFF }, accountId, "read"))).toBe("ACCOUNT_NOT_FOUND");
    expect(other).not.toBe(teamId);
    const stranger = await ensureUser("s1");
    expect(await codeOf(authorizeAccount(db(), { id: stranger, billing: OFF }, accountId, "read"))).toBe("ACCOUNT_NOT_FOUND");
    expect(await codeOf(authorizeAccount(db(), { id: stranger, billing: OFF }, "not-a-uuid", "read"))).toBe("ACCOUNT_NOT_FOUND");
  });

  it("担当の行が残っていても、そのアカウントがチームから外れていれば開けない", async () => {
    const { accountId: adminAcc } = await createUserWithAccount("a1");
    const { accountId } = await createUserWithAccount("o1");
    const { accountId: editorAcc } = await createUserWithAccount("e1");
    const { teamId } = await makeTeam("a1", [adminAcc]);
    const editor = await joinTeam(teamId, "e1", [editorAcc]);
    await setRole(teamId, "e1", "editor");
    // o1 のアカウントはチームに入っていない（壊れたデータの想定）
    await ensureUser("o1");
    await assign(teamId, "e1", accountId);
    expect(await codeOf(authorizeAccount(db(), { id: editor, billing: OFF }, accountId, "read"))).toBe("ACCOUNT_NOT_FOUND");
  });
});

describe("チームの判定（research.md R4）", () => {
  it("authorizeTeamMember：チームの人だけ。ほか・形の違うIDは TEAM_NOT_FOUND", async () => {
    const { accountId } = await createUserWithAccount("a1");
    const { accountId: memberAcc } = await createUserWithAccount("m1");
    const { teamId, adminUserId } = await makeTeam("a1", [accountId]);
    const member = await joinTeam(teamId, "m1", [memberAcc]);
    expect((await authorizeTeamMember(db(), { id: adminUserId }, teamId)).member.role).toBe("admin");
    expect((await authorizeTeamMember(db(), { id: member }, teamId)).member).toMatchObject({ id: member, role: "member", name: "m1" });
    const stranger = await ensureUser("s1");
    expect(await codeOf(authorizeTeamMember(db(), { id: stranger }, teamId))).toBe("TEAM_NOT_FOUND");
    expect(await codeOf(authorizeTeamMember(db(), { id: member }, "x"))).toBe("TEAM_NOT_FOUND");
  });

  it("authorizeTeamAdmin：管理者だけ。チームの人は ROLE_FORBIDDEN、ほかは TEAM_NOT_FOUND", async () => {
    const { accountId } = await createUserWithAccount("a1");
    const { accountId: memberAcc } = await createUserWithAccount("m1");
    const { teamId, adminUserId } = await makeTeam("a1", [accountId]);
    const member = await joinTeam(teamId, "m1", [memberAcc]);
    expect((await authorizeTeamAdmin(db(), { id: adminUserId }, teamId)).team.id).toBe(teamId);
    expect(await codeOf(authorizeTeamAdmin(db(), { id: member }, teamId))).toBe("ROLE_FORBIDDEN");
    expect(await codeOf(authorizeTeamAdmin(db(), { id: await ensureUser("s1") }, teamId))).toBe("TEAM_NOT_FOUND");
  });

  it("authorizeAssignment：チームのアカウント×編集者・管理者だけ。自分のアカウント・メンバーは ASSIGNMENT_NOT_ALLOWED", async () => {
    const { userId: admin, accountId: adminAcc } = await createUserWithAccount("a1");
    const { accountId } = await createUserWithAccount("o1");
    const { accountId: editorAcc } = await createUserWithAccount("e1");
    const { accountId: outside } = await createUserWithAccount("x1");
    const { teamId } = await makeTeam("a1", [adminAcc]);
    const owner = await joinTeam(teamId, "o1", [accountId]);
    const editor = await joinTeam(teamId, "e1", [editorAcc]);
    await setRole(teamId, "e1", "editor");
    const team = await authorizeTeamAdmin(db(), { id: admin }, teamId);
    expect((await authorizeAssignment(db(), team, editor, accountId)).account.id).toBe(accountId);
    expect((await authorizeAssignment(db(), team, admin, accountId)).person.role).toBe("admin");
    expect(await codeOf(authorizeAssignment(db(), team, editor, editorAcc))).toBe("ASSIGNMENT_NOT_ALLOWED");
    expect(await codeOf(authorizeAssignment(db(), team, owner, adminAcc))).toBe("ASSIGNMENT_NOT_ALLOWED");
    expect(await codeOf(authorizeAssignment(db(), team, editor, outside))).toBe("TEAM_NOT_FOUND");
    expect(await codeOf(authorizeAssignment(db(), team, await ensureUser("s1"), accountId))).toBe("TEAM_NOT_FOUND");
  });
});
