// US5：アカウントの名前を直す（specs/012 FR-040、contracts/api.md「PATCH /api/accounts/:accountId」）
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { accounts } from "../../src/db/schema";
import { call, createUserWithAccount, db, makeApp, resetDb } from "../helpers/app";
import { activityRows, assign, joinTeam, makeTeam, setRole, setShared } from "../helpers/team";

const app = makeApp();
const rename = (accountId: string, user: string, name: unknown) => call(app, "PATCH", `/api/accounts/${accountId}`, { user, body: { name } });

beforeEach(async () => {
  await resetDb();
});

describe("PATCH /api/accounts/:accountId", () => {
  it("オーナーは名前を直せる（前後の空白は除く）。応答は AccountSummary", async () => {
    const { accountId } = await createUserWithAccount("u1", { name: "カフェ" });
    const res = await rename(accountId, "u1", "  カフェの公式  ");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: accountId, name: "カフェの公式" });
    const [row] = await db().select().from(accounts).where(eq(accounts.id, accountId));
    expect(row!.name).toBe("カフェの公式");
  });

  it.each([[""], ["  "], ["あ".repeat(51)], [null]])("名前 %j は VALIDATION_FAILED", async (name) => {
    const { accountId } = await createUserWithAccount("u1", { name: "カフェ" });
    const res = await rename(accountId, "u1", name);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
  });

  it("担当の人・見せてもらっている人は直せない。関わりのない人には存在を明かさない", async () => {
    const { accountId } = await createUserWithAccount("owner", { name: "カフェ" });
    const { accountId: adminAcc } = await createUserWithAccount("admin");
    const { accountId: editorAcc } = await createUserWithAccount("editor");
    const { accountId: viewerAcc } = await createUserWithAccount("viewer");
    const { teamId } = await makeTeam("admin", [adminAcc]);
    await joinTeam(teamId, "owner", [accountId]);
    await joinTeam(teamId, "editor", [editorAcc]);
    await joinTeam(teamId, "viewer", [viewerAcc]);
    await setRole(teamId, "editor", "editor");
    await assign(teamId, "editor", accountId);
    await setShared(teamId, accountId, true);
    expect((await rename(accountId, "editor", "x")).status).toBe(403);
    expect((await rename(accountId, "viewer", "x")).status).toBe(403);
    expect((await rename(accountId, "stranger", "x")).status).toBe(404);
    const [row] = await db().select().from(accounts).where(eq(accounts.id, accountId));
    expect(row!.name).toBe("カフェ");
  });

  it("チームに入っているアカウントでは、操作の記録に前後の名前を残す。個人運用では残さない", async () => {
    const { accountId: solo } = await createUserWithAccount("u1", { name: "個人" });
    await rename(solo, "u1", "個人2");
    expect(await activityRows(solo)).toHaveLength(0);

    const { accountId } = await createUserWithAccount("owner", { name: "カフェ" });
    const { accountId: adminAcc } = await createUserWithAccount("admin");
    const { teamId } = await makeTeam("admin", [adminAcc]);
    await joinTeam(teamId, "owner", [accountId]);
    await rename(accountId, "owner", "カフェの公式");
    const rows = await activityRows(accountId);
    expect(rows.find((r) => r.action === "account_renamed")).toMatchObject({
      kind: "settings",
      details: { from: "カフェ", to: "カフェの公式" },
    });
  });
});
