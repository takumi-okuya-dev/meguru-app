// 判定の本体（specs/008-team-operations contracts/permissions.md、research.md R2）。
import { beforeEach, describe, expect, it } from "vitest";
import { authorizeAccount, authorizeAssignment, authorizeTeam, listTeamAccounts } from "../../src/services/access";
import { createUserWithAccount, db, resetDb } from "../helpers/app";
import { ensureTeam, ensureUser, makeEditor, makePartner } from "../helpers/team";

async function codeOf(p: Promise<unknown>) {
  try {
    await p;
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
}

beforeEach(async () => {
  await resetDb();
});

describe("authorizeAccount", () => {
  it("オーナーはすべての権限。チームがなければ hasTeam は false", async () => {
    const { userId, accountId } = await createUserWithAccount("o1");
    const access = await authorizeAccount(db(), { id: userId }, accountId, "owner");
    expect(access.role).toBe("owner");
    expect(access.hasTeam).toBe(false);
    expect(access.delegation).toBeNull();
    expect(access.owner).toMatchObject({ id: userId, name: "o1" });
  });

  it("パートナーは任せる範囲に従い、足りなければ ROLE_FORBIDDEN。チームの情報も返す", async () => {
    const { accountId } = await createUserWithAccount("o1");
    const { partnerUserId } = await makePartner(accountId, "p1", { review: true });
    const access = await authorizeAccount(db(), { id: partnerUserId }, accountId, "review");
    expect(access.role).toBe("partner");
    expect(access.hasTeam).toBe(true);
    expect(access.delegation).toEqual({ review: true, settings: false });
    expect(access.team).toMatchObject({ name: "p1社", partnerName: "p1" });
    expect(await codeOf(authorizeAccount(db(), { id: partnerUserId }, accountId, "settings"))).toBe("ROLE_FORBIDDEN");
    expect(await codeOf(authorizeAccount(db(), { id: partnerUserId }, accountId, "owner"))).toBe("ROLE_FORBIDDEN");
  });

  it("担当の編集者は content まで。担当でない・関係のない人・UUIDでないIDは ACCOUNT_NOT_FOUND", async () => {
    const { accountId } = await createUserWithAccount("o1");
    const { teamId } = await makePartner(accountId, "p1");
    const editor = await makeEditor(teamId, "e1", [accountId]);
    const idle = await makeEditor(teamId, "e2", []);
    const stranger = await ensureUser("x1");
    expect((await authorizeAccount(db(), { id: editor }, accountId, "content")).role).toBe("editor");
    expect(await codeOf(authorizeAccount(db(), { id: editor }, accountId, "review"))).toBe("ROLE_FORBIDDEN");
    expect(await codeOf(authorizeAccount(db(), { id: editor }, accountId, "activity"))).toBe("ROLE_FORBIDDEN");
    expect(await codeOf(authorizeAccount(db(), { id: idle }, accountId, "view"))).toBe("ACCOUNT_NOT_FOUND");
    expect(await codeOf(authorizeAccount(db(), { id: stranger }, accountId, "view"))).toBe("ACCOUNT_NOT_FOUND");
    expect(await codeOf(authorizeAccount(db(), { id: stranger }, "not-a-uuid", "view"))).toBe("ACCOUNT_NOT_FOUND");
  });

  it("パートナー自身のAccountに自社の編集者がいれば、パートナーがいなくても hasTeam は true", async () => {
    const { userId: p, accountId: own } = await createUserWithAccount("p1");
    const { teamId } = await ensureTeam("p1");
    await makeEditor(teamId, "e1", [own]);
    const access = await authorizeAccount(db(), { id: p }, own, "owner");
    expect(access.role).toBe("owner");
    expect(access.hasTeam).toBe(true);
    expect(access.team).toBeNull();
  });
});

describe("チームの判定", () => {
  it("authorizeTeam：チームのパートナーだけ。ほかは TEAM_NOT_FOUND", async () => {
    const { teamId, partnerUserId } = await ensureTeam("p1");
    expect((await authorizeTeam(db(), { id: partnerUserId })).team.id).toBe(teamId);
    const editor = await makeEditor(teamId, "e1");
    expect(await codeOf(authorizeTeam(db(), { id: editor }))).toBe("TEAM_NOT_FOUND");
  });

  it("listTeamAccounts：手伝う先と自社。ほかのチームが手伝う先は含めない", async () => {
    const { accountId: helped } = await createUserWithAccount("o1");
    const { accountId: other } = await createUserWithAccount("o2");
    const { partnerUserId } = await makePartner(helped, "p1", { settings: true });
    await makePartner(other, "p2");
    const { accountId: own } = await createUserWithAccount("p1");
    const team = await authorizeTeam(db(), { id: partnerUserId });
    const list = await listTeamAccounts(db(), team);
    expect(list.map((a) => [a.account.id, a.own])).toEqual([
      [own, true],
      [helped, false],
    ]);
    expect(list[1]!.owner.name).toBe("o1");
    expect(list[1]!.delegation).toEqual({ review: false, settings: true });
    expect(list[0]!.delegation).toBeNull();
  });

  it("authorizeAssignment：チームの編集者×関われるAccountだけ", async () => {
    const { accountId: helped } = await createUserWithAccount("o1");
    const { accountId: other } = await createUserWithAccount("o2");
    const { teamId, partnerUserId } = await makePartner(helped, "p1");
    const editor = await makeEditor(teamId, "e1");
    const outsider = await ensureUser("x1");
    const team = await authorizeTeam(db(), { id: partnerUserId });
    expect((await authorizeAssignment(db(), team, editor, helped)).account.id).toBe(helped);
    expect(await codeOf(authorizeAssignment(db(), team, editor, other))).toBe("ASSIGNMENT_NOT_ALLOWED");
    expect(await codeOf(authorizeAssignment(db(), team, outsider, helped))).toBe("TEAM_NOT_FOUND");
  });
});
