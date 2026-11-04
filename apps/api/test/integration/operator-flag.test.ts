// 運営者の判定（specs/019-feature-switches research.md R5、contracts/api.md「GET /api/me」「/access」）。
// 機能の設定の画面は招待制に関わらず使うので、運営者は OPERATOR_CLERK_USER_IDS だけで決める。
// テスト版に入れる・料金なし（016）は、今までどおり招待制がONのときだけ。
import { beforeEach, describe, expect, it } from "vitest";
import { call, createUserWithAccount, endTrial, makeApp, resetDb } from "../helpers/app";
import { billingEnv } from "../helpers/billing";
import { disableFeatures, disableGroupFeatures, enableAll, FEATURE_OPERATOR, makeGroup, operatorEnv } from "../helpers/features";
import { assign, joinTeam, makeTeam, setRole } from "../helpers/team";
import { groupsEnv, OPERATOR } from "../helpers/test-groups";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
});

const me = async (user: string, env = operatorEnv()) => (await (await call(app, "GET", "/api/me", { user, env })).json()) as Record<string, unknown>;

describe("/api/me の operator", () => {
  it("招待制がOFFでも、運営者は true、ほかの人は false", async () => {
    expect((await me(FEATURE_OPERATOR)).operator).toBe(true);
    expect((await me("someone")).operator).toBe(false);
  });

  it("招待制がOFFの運営者は、料金なしにならない（testGroups.operator は false のまま）", async () => {
    const env = billingEnv({ OPERATOR_CLERK_USER_IDS: FEATURE_OPERATOR });
    const { userId, accountId } = await createUserWithAccount(FEATURE_OPERATOR);
    await endTrial(userId);
    const body = await me(FEATURE_OPERATOR, env);
    expect(body.testGroups).toMatchObject({ enabled: false, operator: false });
    const res = await call(app, "POST", `/api/accounts/${accountId}/promotions`, {
      user: FEATURE_OPERATOR,
      env,
      body: { title: "宣伝", body: "本文" },
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("BILLING_REQUIRED");
  });

  it("招待制がONなら、016の振る舞い（運営者はテスト版の運営者）が変わらない", async () => {
    const body = await me(OPERATOR, groupsEnv());
    expect(body.operator).toBe(true);
    expect(body.testGroups).toMatchObject({ enabled: true, operator: true });
  });
});

describe("/access の features", () => {
  it("オーナーの設定でONのまとまりが入る", async () => {
    const { userId, accountId } = await createUserWithAccount("o1");
    const access = async () =>
      ((await (await call(app, "GET", `/api/accounts/${accountId}/access`, { user: "o1" })).json()) as { features: string[] }).features;
    expect(await access()).toEqual(["autopost", "strategy", "team"]);
    await disableFeatures(userId, "strategy", "team");
    expect(await access()).toEqual(["autopost"]);
  });
});

describe("/api/me の features と、チームが使えない人（research.md R13）", () => {
  type Me = { features: string[]; teams: unknown[]; accounts: { id: string; role: string }[] };
  const meOf = async (user: string) => (await (await call(app, "GET", "/api/me", { user })).json()) as Me;

  it("人 ∪ グループの使えるまとまり", async () => {
    const { userId } = await createUserWithAccount("u1");
    expect((await meOf("u1")).features).toEqual(["autopost", "strategy", "team"]);
    const group = await makeGroup("g", [userId]);
    await disableGroupFeatures(group, "strategy");
    await disableFeatures(userId, "autopost");
    expect((await meOf("u1")).features).toEqual(["team"]);
  });

  it("チームが使えない人は、teams が空で、担当しているAccountが accounts に出ない。オーナーのチームが使えないときも出ない", async () => {
    const { accountId: adminAcc } = await createUserWithAccount("a1");
    const { userId: owner, accountId } = await createUserWithAccount("o1");
    const { userId: editor, accountId: editorAcc } = await createUserWithAccount("e1");
    const { teamId } = await makeTeam("a1", [adminAcc]);
    await joinTeam(teamId, "o1", [accountId]);
    await joinTeam(teamId, "e1", [editorAcc]);
    await setRole(teamId, "e1", "editor");
    await assign(teamId, "e1", accountId);
    const before = await meOf("e1");
    expect(before.teams).toHaveLength(1);
    expect(before.accounts.map((a) => a.id)).toContain(accountId);

    await disableFeatures(editor, "team");
    const off = await meOf("e1");
    expect(off.teams).toEqual([]);
    expect(off.accounts.map((a) => a.id)).toEqual([editorAcc]);

    await enableAll(editor);
    await disableFeatures(owner, "team");
    expect((await meOf("e1")).accounts.map((a) => a.id)).toEqual([editorAcc]);
  });
});
