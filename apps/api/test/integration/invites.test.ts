// 招待（specs/008-team-operations contracts/api.md「パートナーの招待」「招待の確認と参加」、research.md R4・R7）
import { neon } from "@neondatabase/serverless";
import { beforeEach, describe, expect, it } from "vitest";
import { call, createUserWithAccount, makeApp, resetDb, testEnv } from "../helpers/app";
import { ensureTeam, ensureUser, makePartner } from "../helpers/team";

const app = makeApp();
const sql = () => neon(testEnv.DATABASE_URL);

type Invite = { invite: { url: string; createdAt: string } | null };
const tokenOf = (url: string) => url.split("/invite/")[1]!;

async function json<T>(res: Response, status = 200): Promise<T> {
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as T;
}

async function createInvite(accountId: string, user = "o1") {
  const body = await json<Invite>(await call(app, "POST", `/api/accounts/${accountId}/partner-invite`, { user }));
  return body.invite!;
}

const codeOf = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

beforeEach(async () => {
  await resetDb();
});

describe("パートナーの招待リンク（オーナー）", () => {
  it("作る（2回呼んでも1本）・表示・作り直し・取り消し。URLは WEB_ORIGIN/invite/p_…", async () => {
    const { accountId } = await createUserWithAccount("o1");
    expect((await json<Invite>(await call(app, "GET", `/api/accounts/${accountId}/partner-invite`, { user: "o1" }))).invite).toBeNull();
    const first = await createInvite(accountId);
    expect(first.url).toMatch(new RegExp(`^${testEnv.WEB_ORIGIN}/invite/p_[A-Za-z0-9_-]{43}$`));
    expect((await createInvite(accountId)).url).toBe(first.url);
    expect((await json<Invite>(await call(app, "GET", `/api/accounts/${accountId}/partner-invite`, { user: "o1" }))).invite!.url).toBe(first.url);

    const rotated = (await json<Invite>(await call(app, "POST", `/api/accounts/${accountId}/partner-invite/rotate`, { user: "o1" }))).invite!;
    expect(rotated.url).not.toBe(first.url);
    const old = await call(app, "GET", `/api/invites/${tokenOf(first.url)}`);
    expect([old.status, await codeOf(old)]).toEqual([404, "INVITE_INVALID"]);

    expect((await call(app, "DELETE", `/api/accounts/${accountId}/partner-invite`, { user: "o1" })).status).toBe(204);
    const gone = await call(app, "GET", `/api/invites/${tokenOf(rotated.url)}`);
    expect(gone.status).toBe(404);
  });

  it("DBに文字列の平文は残さない（照合用のハッシュと暗号文だけ）", async () => {
    const { accountId } = await createUserWithAccount("o1");
    const token = tokenOf((await createInvite(accountId)).url);
    const rows = (await sql()`SELECT token_hash, encode(token_ciphertext, 'escape') AS c FROM account_partner_invites`) as {
      token_hash: string;
      c: string;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]!.c).not.toContain(token);
  });

  it("パートナーがいるAccountでは作れない（PARTNER_ALREADY_EXISTS）", async () => {
    const { accountId } = await createUserWithAccount("o1");
    await makePartner(accountId, "p1");
    const res = await call(app, "POST", `/api/accounts/${accountId}/partner-invite`, { user: "o1" });
    expect([res.status, await codeOf(res)]).toEqual([409, "PARTNER_ALREADY_EXISTS"]);
  });
});

describe("招待の確認と参加（パートナー）", () => {
  type Preview = {
    kind: string;
    account: { displayName: string | null; username: string } | null;
    inviterName: string;
    viewer: { status: string; accountId?: string | null; needsTeamName?: boolean };
  };

  it("ログインなしで確認でき、Account・招いた人だけを返す。ログインしていれば参加できるかを返す", async () => {
    const { accountId } = await createUserWithAccount("o1");
    const token = tokenOf((await createInvite(accountId)).url);
    const anon = await json<Preview>(await call(app, "GET", `/api/invites/${token}`));
    expect(anon).toMatchObject({ kind: "partner", inviterName: "o1", viewer: { status: "anonymous" } });
    expect(anon.account?.username).toMatch(/^o1_/);
    expect((await json<Preview>(await call(app, "GET", `/api/invites/${token}`, { user: "p1" }))).viewer).toMatchObject({
      status: "can_join",
      needsTeamName: true,
    });
    expect((await json<Preview>(await call(app, "GET", `/api/invites/${token}`, { user: "o1" }))).viewer.status).toBe("self");
  });

  it("参加でパートナーになり、チーム（名前つき）ができ、リンクは使えなくなる。2つ目のAccountでは同じチーム", async () => {
    const { accountId } = await createUserWithAccount("o1");
    const token = tokenOf((await createInvite(accountId)).url);
    const joined = await json<{ kind: string; accountId: string }>(
      await call(app, "POST", `/api/invites/${token}/accept`, { user: "p1", body: { teamName: "A社" } }),
    );
    expect(joined).toEqual({ kind: "partner", accountId });
    expect((await call(app, "GET", `/api/accounts/${accountId}/post-drafts`, { user: "p1" })).status).toBe(200);
    const review = await call(app, "POST", `/api/accounts/${accountId}/post-drafts/review`, { user: "p1", body: {} });
    expect(review.status).toBe(403);
    const again = await call(app, "GET", `/api/invites/${token}`, { user: "x1" });
    expect(again.status).toBe(404);

    const { accountId: second } = await createUserWithAccount("o2");
    const token2 = tokenOf((await createInvite(second, "o2")).url);
    expect((await json<Preview>(await call(app, "GET", `/api/invites/${token2}`, { user: "p1" }))).viewer).toMatchObject({
      status: "can_join",
      needsTeamName: false,
    });
    await json(await call(app, "POST", `/api/invites/${token2}/accept`, { user: "p1", body: { teamName: "無視される" } }));
    const teams = (await sql()`SELECT name FROM teams`) as { name: string }[];
    expect(teams).toEqual([{ name: "A社" }]);
  });

  it("自分のAccount・すでに関わっている人は参加できない", async () => {
    const { accountId } = await createUserWithAccount("o1");
    const token = tokenOf((await createInvite(accountId)).url);
    const self = await call(app, "POST", `/api/invites/${token}/accept`, { user: "o1", body: {} });
    expect([self.status, await codeOf(self)]).toEqual([409, "INVITE_SELF"]);
  });

  it("2人がほぼ同時に参加すると、1人だけがパートナーになる", async () => {
    const { accountId } = await createUserWithAccount("o1");
    const token = tokenOf((await createInvite(accountId)).url);
    await ensureUser("p1");
    await ensureUser("p2");
    const [a, b] = await Promise.all([
      call(app, "POST", `/api/invites/${token}/accept`, { user: "p1", body: {} }),
      call(app, "POST", `/api/invites/${token}/accept`, { user: "p2", body: {} }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 404]);
    const partners = (await sql()`SELECT count(*)::int AS n FROM account_partners WHERE account_id = ${accountId}`) as { n: number }[];
    expect(partners[0]!.n).toBe(1);
  });

  it("チーム名は50文字まで", async () => {
    const { accountId } = await createUserWithAccount("o1");
    await ensureTeam("other");
    const token = tokenOf((await createInvite(accountId)).url);
    const res = await call(app, "POST", `/api/invites/${token}/accept`, { user: "p1", body: { teamName: "あ".repeat(51) } });
    expect(res.status).toBe(400);
  });
});

describe("編集者の招待（チームのリンク）", () => {
  type TeamInvite = { url: string; rotatedAt: string };
  const teamInvite = async (user = "p1") =>
    json<TeamInvite>(await call(app, "GET", "/api/team/invite", { user }));

  async function partnerWithTeam() {
    const { accountId } = await createUserWithAccount("o1");
    await makePartner(accountId, "p1");
    return accountId;
  }

  it("最初に表示したときに作られ、同じリンクを返す。作り直すと前のリンクは使えない", async () => {
    await partnerWithTeam();
    const first = await teamInvite();
    expect(first.url).toMatch(new RegExp(`^${testEnv.WEB_ORIGIN}/invite/e_[A-Za-z0-9_-]{43}$`));
    expect((await teamInvite()).url).toBe(first.url);
    const rotated = await json<TeamInvite>(await call(app, "POST", "/api/team/invite/rotate", { user: "p1" }));
    expect(rotated.url).not.toBe(first.url);
    const old = await call(app, "GET", `/api/invites/${tokenOf(first.url)}`);
    expect([old.status, await codeOf(old)]).toEqual([404, "INVITE_INVALID"]);
  });

  it("同じリンクで何人でも参加でき、担当はつかない。参加済み・パートナー本人は参加できない", async () => {
    await partnerWithTeam();
    const token = tokenOf((await teamInvite()).url);
    const preview = await json<{ kind: string; team: { name: string; editorsRemaining: number } }>(
      await call(app, "GET", `/api/invites/${token}`),
    );
    expect(preview).toMatchObject({ kind: "editor", team: { name: "p1社", editorsRemaining: 10 } });
    for (const user of ["e1", "e2"]) {
      expect(await json(await call(app, "POST", `/api/invites/${token}/accept`, { user, body: {} }))).toEqual({
        kind: "editor",
        accountId: null,
      });
    }
    const helpers = (await sql()`SELECT count(*)::int AS n FROM memberships WHERE role = 'editor'`) as { n: number }[];
    expect(helpers[0]!.n).toBe(0);
    const again = await call(app, "POST", `/api/invites/${token}/accept`, { user: "e1", body: {} });
    expect([again.status, await codeOf(again)]).toEqual([409, "INVITE_ALREADY_MEMBER"]);
    const self = await call(app, "POST", `/api/invites/${token}/accept`, { user: "p1", body: {} });
    expect([self.status, await codeOf(self)]).toEqual([409, "INVITE_SELF"]);
  });

  it("10人を超えて参加できない。上限ちょうどで2人が同時に参加しても超えない", async () => {
    await partnerWithTeam();
    const token = tokenOf((await teamInvite()).url);
    for (let i = 1; i <= 9; i++) {
      await json(await call(app, "POST", `/api/invites/${token}/accept`, { user: `e${i}`, body: {} }));
    }
    await ensureUser("e10");
    await ensureUser("e11");
    const [a, b] = await Promise.all([
      call(app, "POST", `/api/invites/${token}/accept`, { user: "e10", body: {} }),
      call(app, "POST", `/api/invites/${token}/accept`, { user: "e11", body: {} }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const n = (await sql()`SELECT count(*)::int AS n FROM team_editors`) as { n: number }[];
    expect(n[0]!.n).toBe(10);
    expect((await json<{ viewer: { status: string } }>(await call(app, "GET", `/api/invites/${token}`, { user: "e12" }))).viewer.status).toBe(
      "limit_reached",
    );
  });
});

describe("招待の安全性（PR #9 のCodexレビュー）", () => {
  it("参加とリンクの作り直しが同時でも、500にならない（同じ順番で鍵をかける）", async () => {
    for (let round = 0; round < 3; round++) {
      await resetDb();
      const { accountId } = await createUserWithAccount("o1");
      const token = tokenOf((await createInvite(accountId)).url);
      await ensureUser("p1");
      const [accept, rotate] = await Promise.all([
        call(app, "POST", `/api/invites/${token}/accept`, { user: "p1", body: {} }),
        call(app, "POST", `/api/accounts/${accountId}/partner-invite/rotate`, { user: "o1" }),
      ]);
      expect([200, 404]).toContain(accept.status);
      expect([200, 409]).toContain(rotate.status);
    }
  });

  it("取り消しと、参加・作り直しが同時でも、500にならない（同じ順番で鍵をかける。PR #9 のCodexレビュー）", async () => {
    for (let round = 0; round < 3; round++) {
      await resetDb();
      const { accountId } = await createUserWithAccount("o1");
      const token = tokenOf((await createInvite(accountId)).url);
      await ensureUser("p1");
      const [cancel, accept, rotate] = await Promise.all([
        call(app, "DELETE", `/api/accounts/${accountId}/partner-invite`, { user: "o1" }),
        call(app, "POST", `/api/invites/${token}/accept`, { user: "p1", body: {} }),
        call(app, "POST", `/api/accounts/${accountId}/partner-invite/rotate`, { user: "o1" }),
      ]);
      expect(cancel.status).toBe(204);
      expect([200, 404]).toContain(accept.status);
      expect([200, 409]).toContain(rotate.status);
    }
  });

  it("WEB_ORIGIN の末尾が「/」でも、招待のURLに二重スラッシュを入れない", async () => {
    const { accountId } = await createUserWithAccount("o1");
    const res = await app.request(
      `/api/accounts/${accountId}/partner-invite`,
      { method: "POST", headers: { Authorization: "Bearer test:o1" } },
      { ...testEnv, WEB_ORIGIN: `${testEnv.WEB_ORIGIN}/` },
    );
    const { invite } = (await res.json()) as { invite: { url: string } };
    expect(invite.url).toMatch(new RegExp(`^${testEnv.WEB_ORIGIN}/invite/p_`));
  });

  it("PATCH をCORSで許す（チーム名・任せる範囲）", async () => {
    const res = await app.request(
      "/api/team",
      { method: "OPTIONS", headers: { Origin: testEnv.WEB_ORIGIN, "Access-Control-Request-Method": "PATCH" } },
      testEnv,
    );
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("PATCH");
  });
});
