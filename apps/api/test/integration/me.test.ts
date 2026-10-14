// US1：GET /api/me（FR-004・FR-005、research.md R2・R10）
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { accounts, users } from "../../src/db/schema";
import { call, connectNew, createUserWithAccount, db, fake, makeApp, resetDb } from "../helpers/app";
import { assign, joinTeam, makeTeam, setRole, setShared } from "../helpers/team";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
  await fake.reset();
  await fake.addUser("1001", "takumi");
});

type Me = {
  user: { id: string; email: string };
  accounts: { id: string }[];
  landingAccountId: string | null;
  accountLimit: { max: number; used: number };
};

describe("GET /api/me", () => {
  it("Clerkの新しいユーザーで呼ぶと users 行が作られ、Accountが0件なら landingAccountId は null", async () => {
    const res = await call(app, "GET", "/api/me", { user: "new-user" });
    expect(res.status).toBe(200);
    const me = (await res.json()) as Me;
    expect(me.landingAccountId).toBeNull();
    expect(me.accounts).toEqual([]);
    expect(me.accountLimit).toEqual({ max: 1, used: 0 });
    const rows = await db().select().from(users).where(eq(users.clerkUserId, "new-user"));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.email).toBe("new-user@example.com");
  });

  it("Accountを登録した後は、そのAccountが landingAccountId になる", async () => {
    await connectNew(app, "u1", "1001");
    const me = (await (await call(app, "GET", "/api/me", { user: "u1" })).json()) as Me;
    expect(me.accounts).toHaveLength(1);
    expect(me.landingAccountId).toBe(me.accounts[0]!.id);
    expect(me.accountLimit).toEqual({ max: 1, used: 1 });
  });

  it("Accountの要約に接続の方法を出す。このアプリで接続したAccountは app、補いは NULL（specs/010）", async () => {
    await connectNew(app, "u1", "1001");
    const me = (await (await call(app, "GET", "/api/me", { user: "u1" })).json()) as {
      accounts: { connectionMethod: string; reconnectHint: string | null }[];
    };
    expect(me.accounts[0]).toMatchObject({ connectionMethod: "app", reconnectHint: null });
  });

  it("ブラウザのキャッシュに残さない（Cache-Control: no-store）", async () => {
    const res = await call(app, "GET", "/api/me", { user: "u1" });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("未ログインなら 401", async () => {
    expect((await call(app, "GET", "/api/me")).status).toBe(401);
  });
});

// ---- チーム（specs/011-team-revision research.md R5、contracts/api.md「/api/me」）----
describe("GET /api/me（チーム）", () => {
  type TeamMe = Omit<Me, "accounts"> & {
    accounts: { id: string; role: string; ownerName: string | null }[];
    teams: { id: string; name: string; memberCount: number; role: string }[];
  };
  const me = async (user: string) => (await (await call(app, "GET", "/api/me", { user })).json()) as TeamMe;

  it("チームに入っていなければ teams は空", async () => {
    await createUserWithAccount("o1");
    expect((await me("o1")).teams).toEqual([]);
  });

  it("入っているチームを参加した順に、人数と自分のロールつきで返す", async () => {
    const { accountId: a1 } = await createUserWithAccount("a1");
    const { accountId: a2 } = await createUserWithAccount("a1");
    const { accountId: m1 } = await createUserWithAccount("m1");
    const { teamId: t1 } = await makeTeam("a1", [a1], { name: "飲食チーム" });
    const { teamId: t2 } = await makeTeam("a1", [a2], { name: "美容チーム" });
    await joinTeam(t1, "m1", [m1]);
    expect((await me("a1")).teams).toEqual([
      { id: t1, name: "飲食チーム", memberCount: 2, role: "admin" },
      { id: t2, name: "美容チーム", memberCount: 1, role: "admin" },
    ]);
    expect((await me("m1")).teams).toEqual([{ id: t1, name: "飲食チーム", memberCount: 2, role: "member" }]);
  });

  it("担当のアカウントはオーナー名つきで、自分のアカウントの後。見せてもらっているアカウントは出さない", async () => {
    const { accountId: adminAcc } = await createUserWithAccount("a1");
    const { accountId: owned } = await createUserWithAccount("o1");
    const { accountId: shared } = await createUserWithAccount("o2");
    const { accountId: own } = await createUserWithAccount("e1");
    const { teamId } = await makeTeam("a1", [adminAcc]);
    await joinTeam(teamId, "o1", [owned]);
    await joinTeam(teamId, "o2", [shared], { shared: true });
    await joinTeam(teamId, "e1", [own]);
    await setRole(teamId, "e1", "editor");
    await assign(teamId, "e1", owned);
    await setShared(teamId, shared, true);
    const res = await me("e1");
    expect(res.accounts.map((a) => [a.id, a.role, a.ownerName])).toEqual([
      [own, "owner", null],
      [owned, "editor", "o1"],
    ]);
    expect(res.accountLimit.used).toBe(1);
    expect(res.teams.map((t) => t.role)).toEqual(["editor"]);
  });

  it("担当の人がAccountを開いても、オーナーの last_used_at は変えない", async () => {
    const { accountId: adminAcc } = await createUserWithAccount("a1");
    const { accountId } = await createUserWithAccount("o1");
    const { teamId } = await makeTeam("a1", [adminAcc]);
    await joinTeam(teamId, "o1", [accountId]);
    await assign(teamId, "a1", accountId);
    const res = await call(app, "POST", `/api/accounts/${accountId}/open`, {
      user: "a1",
      body: { clientId: "c1", openSeq: 1 },
    });
    expect(res.status).toBe(200);
    const [row] = await db().select().from(accounts).where(eq(accounts.id, accountId));
    expect(row!.lastUsedAt).toBeNull();
  });
});
