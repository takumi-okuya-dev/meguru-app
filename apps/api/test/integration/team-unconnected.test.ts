// US7：未接続のアカウントとチーム（specs/012 FR-050〜FR-052、research.md R7、contracts/api.md「チーム」）。
// 011 の「チームの人になれるのは、自分のThreadsアカウントを1つ以上チームに入れた人だけ」を、未接続のアカウントでも守る。
import { beforeEach, describe, expect, it } from "vitest";
import { call, createUnconnectedAccount, createUserWithAccount, makeApp, resetDb } from "../helpers/app";
import { makeTeam } from "../helpers/team";

const app = makeApp();

const errorOf = async (res: Response) => ((await res.json()) as { error: { code: string; details?: string[] } }).error;

type Preview = {
  viewer: { status: string; accounts: { id: string; name: string; connected: boolean }[] };
};

let token: string;
let teamId: string;

beforeEach(async () => {
  await resetDb();
  const { accountId } = await createUserWithAccount("admin");
  ({ token, teamId } = await makeTeam("admin", [accountId], { name: "飲食チーム" }));
});

describe("招待の確認（GET /api/invites/:token）", () => {
  it("未接続のアカウントだけなら needs_connection で、未接続のアカウントを connected: false で返す", async () => {
    const { accountId } = await createUnconnectedAccount("u1", { name: "カフェの公式" });
    const res = (await (await call(app, "GET", `/api/invites/${token}`, { user: "u1" })).json()) as Preview;
    expect(res.viewer.status).toBe("needs_connection");
    expect(res.viewer.accounts).toEqual([expect.objectContaining({ id: accountId, name: "カフェの公式", connected: false })]);
  });

  it("つないだアカウントがあれば ready で、各行に name・connected", async () => {
    const { accountId: connected } = await createUserWithAccount("u1", { name: "つないだ" });
    const { accountId: unconnected } = await createUnconnectedAccount("u1", { name: "まだ" });
    const res = (await (await call(app, "GET", `/api/invites/${token}`, { user: "u1" })).json()) as Preview;
    expect(res.viewer.status).toBe("ready");
    expect(res.viewer.accounts.map((a) => [a.id, a.name, a.connected])).toEqual([
      [connected, "つないだ", true],
      [unconnected, "まだ", false],
    ]);
  });
});

describe("未接続のアカウントはチームに入れない（ACCOUNT_NOT_CONNECTED）", () => {
  it("参加（POST /api/invites/:token/accept）", async () => {
    const { accountId } = await createUnconnectedAccount("u1");
    const res = await call(app, "POST", `/api/invites/${token}/accept`, { user: "u1", body: { accounts: [{ id: accountId, shared: false }] } });
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toEqual(expect.objectContaining({ code: "ACCOUNT_NOT_CONNECTED", details: [accountId] }));
  });

  it("つないだアカウントと一緒に選んでも止める", async () => {
    const { accountId: connected } = await createUserWithAccount("u1");
    const { accountId: unconnected } = await createUnconnectedAccount("u1");
    const res = await call(app, "POST", `/api/invites/${token}/accept`, {
      user: "u1",
      body: { accounts: [{ id: connected, shared: false }, { id: unconnected, shared: false }] },
    });
    expect((await errorOf(res)).code).toBe("ACCOUNT_NOT_CONNECTED");
  });

  it("チームを作る（POST /api/teams）", async () => {
    const { accountId } = await createUnconnectedAccount("u1");
    const res = await call(app, "POST", "/api/teams", { user: "u1", body: { name: "新しいチーム", accountIds: [accountId] } });
    expect(res.status).toBe(409);
    expect((await errorOf(res)).code).toBe("ACCOUNT_NOT_CONNECTED");
  });

  it("あとからアカウントを足す（POST /api/teams/:teamId/accounts）", async () => {
    const { accountId } = await createUnconnectedAccount("admin");
    const res = await call(app, "POST", `/api/teams/${teamId}/accounts`, { user: "admin", body: { accountId } });
    expect(res.status).toBe(409);
    expect((await errorOf(res)).code).toBe("ACCOUNT_NOT_CONNECTED");
  });
});
