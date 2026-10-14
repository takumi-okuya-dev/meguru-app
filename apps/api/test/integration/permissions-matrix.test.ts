// 関わり×APIの表のテスト（specs/011-team-revision contracts/permissions.md、SC-002・FR-060）。
// すべてのAccountのAPIを、関わりごとに呼び、許される／403 ROLE_FORBIDDEN／404 ACCOUNT_NOT_FOUND を確かめる。
// 各APIは「権限 → 入力の検証」の順で確かめるので、空の本文で呼ぶと、許された人は 400 VALIDATION_FAILED などになる。
import { permissionsFor, type Relation } from "@threads-grower/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { call, createUserWithAccount, makeApp, resetDb } from "../helpers/app";
import { ACCOUNT_ROUTES } from "../helpers/routes";
import { assign, joinTeam, makeTeam, setRole } from "../helpers/team";

const app = makeApp();


let accountId = "";
let hiddenAccountId = "";
let teamId = "";
let memberUserId = "";

function fill(path: string, id = accountId) {
  return path.replace(":accountId", id).replace(/:[A-Za-z]+Id/g, crypto.randomUUID());
}

async function send(method: string, path: string, user: string, id = accountId) {
  return call(app, method, fill(path, id), { user, body: method === "GET" || method === "DELETE" ? undefined : {} });
}

async function errorCode(res: Response): Promise<string | null> {
  if (res.status < 400) return null;
  const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
  return body?.error?.code ?? null;
}

beforeAll(async () => {
  await resetDb();
  // チームT：管理者 admin1（自分を担当にしている）、オーナー owner1（見せている）、編集者 editor1（担当）、
  // メンバー viewer1、オーナー owner2（見せていない）
  const { accountId: adminAcc } = await createUserWithAccount("admin1");
  ({ accountId } = await createUserWithAccount("owner1"));
  ({ accountId: hiddenAccountId } = await createUserWithAccount("owner2"));
  const { accountId: editorAcc } = await createUserWithAccount("editor1");
  const { accountId: viewerAcc } = await createUserWithAccount("viewer1");
  ({ teamId } = await makeTeam("admin1", [adminAcc]));
  await joinTeam(teamId, "owner1", [accountId], { shared: true });
  await joinTeam(teamId, "owner2", [hiddenAccountId], { shared: false });
  await joinTeam(teamId, "editor1", [editorAcc]);
  await setRole(teamId, "editor1", "editor");
  await assign(teamId, "editor1", accountId);
  await assign(teamId, "admin1", accountId);
  memberUserId = await joinTeam(teamId, "viewer1", [viewerAcc]);
  // 別のチーム（見せていても、別のチームの人には見えない）
  const { accountId: otherAcc } = await createUserWithAccount("other-admin");
  await makeTeam("other-admin", [otherAcc]);
  await createUserWithAccount("stranger1");
});

/** 関わりのある人と、その権限の集合 */
const ACTORS: [string, Relation, { isTeamAdmin?: boolean }][] = [
  ["owner1", "owner", {}],
  ["editor1", "assigned", {}],
  ["admin1", "assigned", { isTeamAdmin: true }],
  ["viewer1", "shared_viewer", {}],
];

describe("関わり×APIの表（SC-002）", () => {
  it.each(ACCOUNT_ROUTES)("%s %s（%s）", async (method, path, permission) => {
    // 関係のない人・別のチームの人は、存在の有無も分からない 404
    for (const user of ["stranger1", "other-admin"]) {
      const res = await send(method, path, user);
      expect([res.status, await errorCode(res)], user).toEqual([404, "ACCOUNT_NOT_FOUND"]);
    }
    // 見せていないアカウントは、担当でないチームの人（管理者を含む）には 404
    for (const user of ["viewer1", "editor1", "admin1"]) {
      const res = await send(method, path, user, hiddenAccountId);
      expect([res.status, await errorCode(res)], `${user} hidden`).toEqual([404, "ACCOUNT_NOT_FOUND"]);
    }
    for (const [user, relation, opts] of ACTORS) {
      const res = await send(method, path, user);
      const allowed = permissionsFor(relation, opts).has(permission);
      const code = await errorCode(res);
      if (allowed) {
        expect(code, user).not.toBe("ROLE_FORBIDDEN");
        expect(code, user).not.toBe("ACCOUNT_NOT_FOUND");
      } else {
        expect([res.status, code], user).toEqual([403, "ROLE_FORBIDDEN"]);
      }
    }
  });

  it("承認・設定は、オーナーのほかに許される関わりがない（FR-060）", () => {
    const reviewOrSettings = ACCOUNT_ROUTES.filter(([, , p]) => p === "review" || p === "settings");
    expect(reviewOrSettings.length).toBeGreaterThan(0);
    for (const [, relation, opts] of ACTORS.filter(([, r]) => r !== "owner")) {
      for (const [, , p] of reviewOrSettings) expect(permissionsFor(relation, opts).has(p)).toBe(false);
    }
  });

  it("Accountとチームのルートは、すべて上の表にある（置き換えの漏れを見つける）", () => {
    const known = new Set([...ACCOUNT_ROUTES.map(([m, p]) => `${m} ${p}`), ...TEAM_ROUTES.map(([m, p]) => `${m} ${p}`)]);
    const registered = new Set(
      app.routes
        .filter((r) => ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(r.method))
        .filter((r) => r.path.includes("/accounts/:accountId") || r.path.startsWith("/api/teams") || r.path.startsWith("/api/team/"))
        .map((r) => `${r.method} ${r.path}`),
    );
    const missing = [...registered].filter((k) => !known.has(k));
    expect(missing).toEqual([]);
  });
});

describe("トークンでの接続し直しの表（specs/010 FR-034）", () => {
  it("POST /api/threads/token-connect（mode = reconnect）はオーナーだけ。関係のない人は404、担当・見せてもらっている人は403", async () => {
    const body = { mode: "reconnect", accountId, token: "t".repeat(40) };
    for (const user of ["stranger1", "other-admin"]) {
      const res = await call(app, "POST", "/api/threads/token-connect", { user, body });
      expect([res.status, await errorCode(res)], user).toEqual([404, "ACCOUNT_NOT_FOUND"]);
    }
    for (const user of ["editor1", "admin1", "viewer1"]) {
      const res = await call(app, "POST", "/api/threads/token-connect", { user, body });
      expect([res.status, await errorCode(res)], user).toEqual([403, "ROLE_FORBIDDEN"]);
    }
    // オーナーは判定を通り、トークンの確認に進む（偽のトークンなので TOKEN_INVALID）
    const res = await call(app, "POST", "/api/threads/token-connect", { user: "owner1", body });
    expect(await errorCode(res)).toBe("TOKEN_INVALID");
  });

  it("mode = new はログインしていれば誰でも呼べる（自分のAccountを作る）", async () => {
    const res = await call(app, "POST", "/api/threads/token-connect", { user: "editor1", body: { mode: "new", token: "bad" } });
    expect(await errorCode(res)).toBe("TOKEN_INVALID");
  });
});

/**
 * [メソッド, パス, 判定]。contracts/api.md「チーム」。member はチームの人、admin は管理者、login はログインだけ。
 * 許される人での成功は、各Storyのテスト（teams・team-roles・team-share・team-leave）で確かめる。
 */
const TEAM_ROUTES: [string, string, "member" | "admin" | "login"][] = [
  ["POST", "/api/teams", "login"],
  ["GET", "/api/teams/:teamId", "member"],
  ["PATCH", "/api/teams/:teamId", "admin"],
  ["DELETE", "/api/teams/:teamId", "admin"],
  ["GET", "/api/teams/:teamId/invite", "admin"],
  ["POST", "/api/teams/:teamId/invite/rotate", "admin"],
  ["PATCH", "/api/teams/:teamId/members/:userId", "admin"],
  ["DELETE", "/api/teams/:teamId/members/:userId", "admin"],
  ["POST", "/api/teams/:teamId/members/:userId/joined-notice/dismiss", "admin"],
  ["POST", "/api/teams/:teamId/leave", "member"],
  ["POST", "/api/teams/:teamId/admin", "admin"],
  ["POST", "/api/teams/:teamId/accounts", "member"],
  ["PATCH", "/api/teams/:teamId/accounts/:accountId", "member"],
  ["DELETE", "/api/teams/:teamId/accounts/:accountId", "member"],
  ["GET", "/api/teams/:teamId/assignments", "admin"],
  ["PUT", "/api/teams/:teamId/assignments/:userId/accounts/:accountId", "admin"],
  ["DELETE", "/api/teams/:teamId/assignments/:userId/accounts/:accountId", "admin"],
];

describe("チームのAPIの表（SC-002、research.md R4）", () => {
  const fillTeam = (path: string) =>
    path.replace(":teamId", teamId).replace(":userId", memberUserId).replace(":accountId", hiddenAccountId);
  it.each(TEAM_ROUTES.filter(([, , who]) => who !== "login"))("%s %s（%s）", async (method, path, who) => {
    // チームの人でなければ、存在の有無も分からない 404
    for (const user of ["stranger1", "other-admin"]) {
      const res = await call(app, method, fillTeam(path), { user, body: method === "GET" || method === "DELETE" ? undefined : {} });
      expect([res.status, await errorCode(res)], user).toEqual([404, "TEAM_NOT_FOUND"]);
    }
    // 管理者だけのAPIは、チームの人（メンバー・編集者・オーナー）には 403
    if (who === "admin") {
      for (const user of ["viewer1", "editor1", "owner1"]) {
        const res = await call(app, method, fillTeam(path), { user, body: method === "GET" || method === "DELETE" ? undefined : {} });
        expect([res.status, await errorCode(res)], user).toEqual([403, "ROLE_FORBIDDEN"]);
      }
    }
    // チームの形が違うIDは 404
    const res = await call(app, method, path.replace(":teamId", "x").replace(/:[A-Za-z]+Id/g, crypto.randomUUID()), {
      user: "admin1",
      body: method === "GET" || method === "DELETE" ? undefined : {},
    });
    expect([res.status, await errorCode(res)]).toEqual([404, "TEAM_NOT_FOUND"]);
  });

  it("GET /api/teams/:teamId は、チームの人なら誰でも読める", async () => {
    for (const user of ["admin1", "owner1", "editor1", "viewer1"]) {
      const res = await call(app, "GET", `/api/teams/${teamId}`, { user });
      expect(res.status, user).toBe(200);
    }
  });
});
