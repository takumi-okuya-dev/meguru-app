// US1：GET /api/me（FR-004・FR-005、research.md R2・R10）
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { accounts, users } from "../../src/db/schema";
import { call, connectNew, createUserWithAccount, db, fake, makeApp, resetDb } from "../helpers/app";
import { ensureTeam, makeEditor, makePartner } from "../helpers/team";

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

// ---- チーム運用（specs/008-team-operations research.md R11、FR-045）----
describe("GET /api/me（チーム運用）", () => {
  type TeamMe = Omit<Me, "accounts"> & {
    accounts: { id: string; role: string; ownerName: string | null }[];
    partnerTeam: { name: string | null; unassignedEditorCount: number } | null;
    editorWaiting: { partnerName: string } | null;
  };
  const me = async (user: string) => (await (await call(app, "GET", "/api/me", { user })).json()) as TeamMe;

  it("パートナーは、自分のAccount → 手伝っているAccount（オーナー名つき）の順。上限の使用数は自分のAccountだけ", async () => {
    const { accountId: helped } = await createUserWithAccount("o1");
    const { accountId: own } = await createUserWithAccount("p1");
    const { teamId } = await makePartner(helped, "p1");
    await makeEditor(teamId, "e-idle");
    const res = await me("p1");
    expect(res.accounts.map((a) => [a.id, a.role, a.ownerName])).toEqual([
      [own, "owner", null],
      [helped, "partner", "o1"],
    ]);
    expect(res.accountLimit.used).toBe(1);
    expect(res.partnerTeam).toEqual({ name: "p1社", unassignedEditorCount: 1 });
    expect(res.editorWaiting).toBeNull();
  });

  it("自分のAccountがなく手伝い先があるとき、最後に開いた手伝い先（なければ最初）に入る", async () => {
    const { accountId: a1 } = await createUserWithAccount("o1");
    const { accountId: a2 } = await createUserWithAccount("o2");
    const { teamId } = await makePartner(a1, "p1");
    await makePartner(a2, "p2");
    await makeEditor(teamId, "e1", [a1]);
    const editor = await me("e1");
    expect(editor.accounts.map((a) => [a.id, a.role, a.ownerName])).toEqual([[a1, "editor", "o1"]]);
    expect(editor.landingAccountId).toBe(a1);
    expect(editor.partnerTeam).toBeNull();
    expect(editor.editorWaiting).toBeNull();
  });

  it("担当がなく、自分のAccountも手伝い先もない編集者には editorWaiting（パートナーの名前）", async () => {
    const { teamId } = await ensureTeam("p1");
    await makeEditor(teamId, "e1");
    const res = await me("e1");
    expect(res.accounts).toEqual([]);
    expect(res.landingAccountId).toBeNull();
    expect(res.editorWaiting).toEqual({ partnerName: "p1" });
  });

  it("手伝う人がAccountを開いても、オーナーの last_used_at は変えない", async () => {
    const { accountId } = await createUserWithAccount("o1");
    await makePartner(accountId, "p1");
    const res = await call(app, "POST", `/api/accounts/${accountId}/open`, {
      user: "p1",
      body: { clientId: "c1", openSeq: 1 },
    });
    expect(res.status).toBe(200);
    const [row] = await db().select().from(accounts).where(eq(accounts.id, accountId));
    expect(row!.lastUsedAt).toBeNull();
    expect((await me("p1")).landingAccountId).toBe(accountId);
  });
});
