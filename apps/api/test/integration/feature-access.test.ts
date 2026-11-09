// 機能のまとまりの判定（specs/019-feature-switches research.md R1、contracts/api.md「守るAPI」、FR-005・FR-011・FR-012）。
// OFFの判定は authorizeAccount の中だけに置き、見るのはAccountのオーナーの設定。
import { beforeEach, describe, expect, it } from "vitest";
import { authorizeAccount } from "../../src/platform/access/access";
import { createUserWithAccount, db, endTrial, resetDb } from "../helpers/app";
import { closeGroupRow, disableFeatures, disableGroupFeatures, makeGroup } from "../helpers/features";
import { assign, joinTeam, makeTeam, setRole } from "../helpers/team";
import { authorizeTeamMember } from "../../src/platform/access/access";

async function errorOf(p: Promise<unknown>) {
  try {
    await p;
    return null;
  } catch (e) {
    const err = e as { code?: string; details?: unknown };
    return { code: err.code, details: err.details };
  }
}

const OFF = { enabled: false };

beforeEach(async () => {
  await resetDb();
});

describe("authorizeAccount の opts.feature", () => {
  it("行のないオーナーは3つすべてON。opts.feature を付けても通る", async () => {
    const { userId, accountId } = await createUserWithAccount("o1");
    const access = await authorizeAccount(db(), { id: userId, billing: OFF }, accountId, "content", { feature: "strategy" });
    expect([...access.features].sort()).toEqual(["autopost", "strategy", "team"]);
  });

  it("オーナーの strategy がOFF：strategy は 403 FEATURE_DISABLED、autopost と opts なしは通る", async () => {
    const { userId, accountId } = await createUserWithAccount("o1");
    await disableFeatures(userId, "strategy");
    const user = { id: userId, billing: OFF };
    expect(await errorOf(authorizeAccount(db(), user, accountId, "read", { feature: "strategy" }))).toEqual({
      code: "FEATURE_DISABLED",
      details: ["strategy"],
    });
    expect(await errorOf(authorizeAccount(db(), user, accountId, "view", { feature: "autopost" }))).toBeNull();
    const access = await authorizeAccount(db(), user, accountId, "read");
    expect([...access.features].sort()).toEqual(["autopost", "team"]);
  });

  it("関わりのないAccountは、OFFでも 404 ACCOUNT_NOT_FOUND が先", async () => {
    const { userId, accountId } = await createUserWithAccount("o1");
    await disableFeatures(userId, "strategy");
    const { userId: stranger } = await createUserWithAccount("x1");
    expect((await errorOf(authorizeAccount(db(), { id: stranger, billing: OFF }, accountId, "read", { feature: "strategy" })))?.code).toBe(
      "ACCOUNT_NOT_FOUND",
    );
  });
});

describe("チームではオーナーの設定に従う（FR-012）", () => {
  async function team() {
    const { userId: admin, accountId: adminAcc } = await createUserWithAccount("a1");
    const { userId: owner, accountId } = await createUserWithAccount("o1");
    const { accountId: editorAcc } = await createUserWithAccount("e1");
    const { teamId } = await makeTeam("a1", [adminAcc]);
    await joinTeam(teamId, "o1", [accountId], { shared: true });
    const editor = await joinTeam(teamId, "e1", [editorAcc]);
    await setRole(teamId, "e1", "editor");
    await assign(teamId, "e1", accountId);
    return { admin, owner, editor, accountId };
  }

  it("オーナーの strategy がOFFなら、担当の人も見せてもらっている人も拒む", async () => {
    const { admin, owner, editor, accountId } = await team();
    await disableFeatures(owner, "strategy");
    for (const [id, p] of [
      [editor, "content"],
      [admin, "read"],
    ] as const) {
      expect((await errorOf(authorizeAccount(db(), { id, billing: OFF }, accountId, p, { feature: "strategy" })))?.code).toBe(
        "FEATURE_DISABLED",
      );
    }
  });

  it("見る人だけが strategy をOFFなら、オーナーのAccountでは使える", async () => {
    const { admin, editor, accountId } = await team();
    await disableFeatures(editor, "strategy");
    await disableFeatures(admin, "strategy");
    expect(await errorOf(authorizeAccount(db(), { id: editor, billing: OFF }, accountId, "content", { feature: "strategy" }))).toBeNull();
    expect(await errorOf(authorizeAccount(db(), { id: admin, billing: OFF }, accountId, "read", { feature: "strategy" }))).toBeNull();
  });
});

describe("決済の読むだけと重なったとき（FR-011）", () => {
  it("まとまりがOFFなら FEATURE_DISABLED が先、ONなら今までどおり BILLING_REQUIRED", async () => {
    const { userId, accountId } = await createUserWithAccount("o1");
    await endTrial(userId);
    const user = { id: userId, billing: { enabled: true } };
    expect((await errorOf(authorizeAccount(db(), user, accountId, "content", { feature: "autopost" })))?.code).toBe("BILLING_REQUIRED");
    await disableFeatures(userId, "autopost");
    expect((await errorOf(authorizeAccount(db(), user, accountId, "content", { feature: "autopost" })))?.code).toBe("FEATURE_DISABLED");
    // まとまりを付けない操作は、今までどおり決済の判定
    expect((await errorOf(authorizeAccount(db(), user, accountId, "content")))?.code).toBe("BILLING_REQUIRED");
  });
});

describe("グループの設定（FR-018）", () => {
  it("グループでOFFなら使えず、グループから外れる・閉じると使える。人の設定と合わせて、どちらかがOFFならOFF", async () => {
    const { userId, accountId } = await createUserWithAccount("o1");
    const group = await makeGroup("g1", [userId]);
    await disableGroupFeatures(group, "strategy");
    const user = { id: userId, billing: OFF };
    expect((await errorOf(authorizeAccount(db(), user, accountId, "read", { feature: "strategy" })))?.code).toBe("FEATURE_DISABLED");
    await disableFeatures(userId, "autopost");
    const access = await authorizeAccount(db(), user, accountId, "read");
    expect([...access.features]).toEqual(["team"]);

    await closeGroupRow(group);
    const afterClose = await authorizeAccount(db(), user, accountId, "read");
    expect([...afterClose.features].sort()).toEqual(["strategy", "team"]);
  });
});

describe("チームのまとまり（FR-009・FR-012）", () => {
  async function team() {
    const { userId: admin, accountId: adminAcc } = await createUserWithAccount("a1");
    const { userId: owner, accountId } = await createUserWithAccount("o1");
    const { accountId: editorAcc } = await createUserWithAccount("e1");
    const { teamId } = await makeTeam("a1", [adminAcc]);
    await joinTeam(teamId, "o1", [accountId], { shared: true });
    const editor = await joinTeam(teamId, "e1", [editorAcc]);
    await setRole(teamId, "e1", "editor");
    await assign(teamId, "e1", accountId);
    return { admin, owner, editor, accountId, teamId };
  }

  it("オーナーのチームがOFFなら、担当の人も見せてもらっている人も 404。オーナーは開ける", async () => {
    const { admin, owner, editor, accountId } = await team();
    await disableFeatures(owner, "team");
    expect((await errorOf(authorizeAccount(db(), { id: editor, billing: OFF }, accountId, "read")))?.code).toBe("ACCOUNT_NOT_FOUND");
    expect((await errorOf(authorizeAccount(db(), { id: admin, billing: OFF }, accountId, "read")))?.code).toBe("ACCOUNT_NOT_FOUND");
    expect(await errorOf(authorizeAccount(db(), { id: owner, billing: OFF }, accountId, "owner"))).toBeNull();
  });

  it("見る人のチームがOFFなら、その人は手伝えない（404）。ONに戻すと元どおり", async () => {
    const { editor, accountId } = await team();
    await disableFeatures(editor, "team");
    expect((await errorOf(authorizeAccount(db(), { id: editor, billing: OFF }, accountId, "content")))?.code).toBe("ACCOUNT_NOT_FOUND");
    const { enableAll } = await import("../helpers/features");
    await enableAll(editor);
    expect(await errorOf(authorizeAccount(db(), { id: editor, billing: OFF }, accountId, "content"))).toBeNull();
  });

  it("authorizeTeamMember：チームを使えない人は 403 FEATURE_DISABLED", async () => {
    const { editor, teamId } = await team();
    await disableFeatures(editor, "team");
    expect((await errorOf(authorizeTeamMember(db(), { id: editor }, teamId)))?.code).toBe("FEATURE_DISABLED");
  });
});
