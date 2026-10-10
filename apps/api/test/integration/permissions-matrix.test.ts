// 役割×APIの表のテスト（specs/008-team-operations contracts/permissions.md、SC-002）。
// すべてのAccountのAPIを、役割ごとに呼び、許される／403 ROLE_FORBIDDEN／404 ACCOUNT_NOT_FOUND を確かめる。
// 各APIは「権限 → 入力の検証」の順で確かめるので、空の本文で呼ぶと、許された役割は 400 VALIDATION_FAILED などになる。
import { permissionsFor, type Permission } from "@threads-grower/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { call, createUserWithAccount, makeApp, resetDb } from "../helpers/app";
import { makeEditor, makePartner, setDelegation } from "../helpers/team";

const app = makeApp();

/** [メソッド, パス（Honoのルートの形）, 要る権限]。contracts/permissions.md「APIごとの必要な権限」 */
export const ACCOUNT_ROUTES: [string, string, Permission][] = [
  ["GET", "/api/accounts/:accountId", "view"],
  ["POST", "/api/accounts/:accountId/open", "view"],
  ["DELETE", "/api/accounts/:accountId", "owner"],
  ["GET", "/api/accounts/:accountId/auto-post", "view"],
  ["POST", "/api/accounts/:accountId/auto-post/notices/blocked/dismiss", "review"],
  ["GET", "/api/accounts/:accountId/performance", "view"],
  ["GET", "/api/accounts/:accountId/performance/export", "view"],
  ["PATCH", "/api/accounts/:accountId/performance/:draftId/feedback", "content"],
  ["GET", "/api/accounts/:accountId/posting-schedule", "view"],
  ["PUT", "/api/accounts/:accountId/posting-schedule", "settings"],
  ["GET", "/api/accounts/:accountId/promotion-settings", "view"],
  ["PUT", "/api/accounts/:accountId/promotion-settings", "content"],
  ["GET", "/api/accounts/:accountId/promotions", "view"],
  ["POST", "/api/accounts/:accountId/promotions", "content"],
  ["PUT", "/api/accounts/:accountId/promotions/:promotionId", "content"],
  ["DELETE", "/api/accounts/:accountId/promotions/:promotionId", "content"],
  ["GET", "/api/accounts/:accountId/posting-rules", "view"],
  ["POST", "/api/accounts/:accountId/ng-words", "settings"],
  ["DELETE", "/api/accounts/:accountId/ng-words/:ngWordId", "settings"],
  ["PUT", "/api/accounts/:accountId/core-rules", "settings"],
  ["POST", "/api/accounts/:accountId/threads-check", "settings"],
  ["GET", "/api/accounts/:accountId/profile-status", "view"],
  ["GET", "/api/accounts/:accountId/strategy", "view"],
  ["PUT", "/api/accounts/:accountId/strategy", "content"],
  ["GET", "/api/accounts/:accountId/reference-posts", "view"],
  ["POST", "/api/accounts/:accountId/reference-posts", "content"],
  ["PUT", "/api/accounts/:accountId/reference-posts/:referencePostId", "content"],
  ["DELETE", "/api/accounts/:accountId/reference-posts/:referencePostId", "content"],
  ["GET", "/api/accounts/:accountId/research-keywords", "view"],
  ["POST", "/api/accounts/:accountId/research-keywords", "content"],
  ["PUT", "/api/accounts/:accountId/research-keywords/:keywordId", "content"],
  ["DELETE", "/api/accounts/:accountId/research-keywords/:keywordId", "content"],
  ["GET", "/api/accounts/:accountId/prompt", "view"],
  ["PUT", "/api/accounts/:accountId/prompt-settings", "content"],
  ["GET", "/api/accounts/:accountId/post-drafts", "view"],
  ["GET", "/api/accounts/:accountId/post-drafts/published", "view"],
  ["GET", "/api/accounts/:accountId/post-drafts/counts", "view"],
  ["POST", "/api/accounts/:accountId/draft-batches", "content"],
  ["DELETE", "/api/accounts/:accountId/draft-batches/:batchId", "content"],
  ["PUT", "/api/accounts/:accountId/post-drafts/:draftId", "content"],
  ["POST", "/api/accounts/:accountId/post-drafts/delete", "content"],
  ["POST", "/api/accounts/:accountId/post-drafts/:draftId/prioritize", "review"],
  ["POST", "/api/accounts/:accountId/post-drafts/review", "review"],
  // 本featureで足したAccountのAPI（specs/008 contracts/api.md）
  ["GET", "/api/accounts/:accountId/access", "view"],
  ["GET", "/api/accounts/:accountId/partner-invite", "owner"],
  ["POST", "/api/accounts/:accountId/partner-invite", "owner"],
  ["POST", "/api/accounts/:accountId/partner-invite/rotate", "owner"],
  ["DELETE", "/api/accounts/:accountId/partner-invite", "owner"],
  ["GET", "/api/accounts/:accountId/team", "view"],
  ["POST", "/api/accounts/:accountId/partner/joined-notice/dismiss", "owner"],
  ["PATCH", "/api/accounts/:accountId/partner", "owner"],
  ["GET", "/api/accounts/:accountId/activity", "activity"],
];

/** パートナーの任せる範囲の4通り */
const DELEGATIONS = [
  { review: false, settings: false },
  { review: true, settings: false },
  { review: false, settings: true },
  { review: true, settings: true },
];

let accountId = "";
let editorUserId = "";

function fill(path: string) {
  return path.replace(":accountId", accountId).replace(/:[A-Za-z]+Id/g, crypto.randomUUID());
}

async function send(method: string, path: string, user: string) {
  return call(app, method, fill(path), { user, body: method === "GET" || method === "DELETE" ? undefined : {} });
}

async function errorCode(res: Response): Promise<string | null> {
  if (res.status < 400) return null;
  const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
  return body?.error?.code ?? null;
}

beforeAll(async () => {
  await resetDb();
  ({ accountId } = await createUserWithAccount("owner1"));
  const { teamId } = await makePartner(accountId, "partner1");
  editorUserId = await makeEditor(teamId, "editor1", [accountId]);
  // 別のチームのパートナー（自分のチームはあるが、このチームの編集者は操作できない）
  const { accountId: otherAccount } = await createUserWithAccount("other-owner");
  await makePartner(otherAccount, "partner2");
  await makeEditor(teamId, "editor-unassigned", []);
  await createUserWithAccount("stranger1");
});

describe("役割×APIの表（SC-002）", () => {
  it.each(ACCOUNT_ROUTES)("%s %s（%s）", async (method, path, permission) => {
    // 関係のない人・担当のない編集者は、存在の有無も分からない 404
    for (const user of ["stranger1", "editor-unassigned"]) {
      const res = await send(method, path, user);
      expect([res.status, await errorCode(res)], `${user}`).toEqual([404, "ACCOUNT_NOT_FOUND"]);
    }
    // 編集者
    {
      const res = await send(method, path, "editor1");
      const allowed = permissionsFor("editor", null).has(permission);
      const code = await errorCode(res);
      if (allowed) {
        expect(code, "editor").not.toBe("ROLE_FORBIDDEN");
        expect(code, "editor").not.toBe("ACCOUNT_NOT_FOUND");
      } else {
        expect([res.status, code], "editor").toEqual([403, "ROLE_FORBIDDEN"]);
      }
    }
    // パートナー（任せる範囲の4通り）
    for (const delegation of DELEGATIONS) {
      await setDelegation(accountId, delegation);
      const res = await send(method, path, "partner1");
      const allowed = permissionsFor("partner", delegation).has(permission);
      const code = await errorCode(res);
      const label = `partner ${JSON.stringify(delegation)}`;
      if (allowed) {
        expect(code, label).not.toBe("ROLE_FORBIDDEN");
        expect(code, label).not.toBe("ACCOUNT_NOT_FOUND");
      } else {
        expect([res.status, code], label).toEqual([403, "ROLE_FORBIDDEN"]);
      }
    }
    await setDelegation(accountId, { review: false, settings: false });
    // オーナーは常に許される
    {
      const res = await send(method, path, "owner1");
      const code = await errorCode(res);
      expect(code, "owner").not.toBe("ROLE_FORBIDDEN");
      expect(code, "owner").not.toBe("ACCOUNT_NOT_FOUND");
    }
  });

  it("Accountのルートは、すべて上の表にある（置き換えの漏れを見つける）", () => {
    const known = new Set([...ACCOUNT_ROUTES, ...TEAM_ROUTES].map(([m, p]) => `${m} ${p}`));
    const registered = new Set(
      app.routes
        .filter((r) => ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(r.method))
        .filter((r) => r.path.includes("/accounts/:accountId") || r.path.startsWith("/api/team"))
        .map((r) => `${r.method} ${r.path}`),
    );
    const missing = [...registered].filter((k) => !known.has(k) && !EXTRA_ROUTES.has(k));
    expect(missing).toEqual([]);
  });
});

/** [メソッド, パス]。チームのパートナー本人だけ（contracts/permissions.md「チームの判定」）。消す操作は最後に呼ぶ */
const TEAM_ROUTES: [string, string][] = [
  ["GET", "/api/team"],
  ["PATCH", "/api/team"],
  ["GET", "/api/team/invite"],
  ["GET", "/api/team/accounts"],
  ["POST", "/api/team/invite/rotate"],
  ["PUT", "/api/team/editors/:userId/accounts/:accountId"],
  ["DELETE", "/api/team/editors/:userId/accounts/:accountId"],
  ["DELETE", "/api/team/editors/:userId"],
];

describe("チームのAPIの表（SC-002）", () => {
  const fillTeam = (path: string) => path.replace(":userId", editorUserId).replace(":accountId", accountId);
  it.each(TEAM_ROUTES)("%s %s", async (method, path) => {
    for (const user of ["stranger1", "editor1", "owner1", "partner2"]) {
      const res = await call(app, method, fillTeam(path), { user, body: method === "PATCH" ? { name: "x" } : undefined });
      // partner2 は自分のチームの GET・PATCH・招待はできるが、このチームの編集者は操作できない
      if (user === "partner2" && !path.includes(":userId")) continue;
      expect([res.status, await errorCode(res)], user).toEqual([404, "TEAM_NOT_FOUND"]);
    }
    const res = await call(app, method, fillTeam(path), { user: "partner1", body: method === "PATCH" ? { name: "A社" } : undefined });
    expect(res.status, "partner1").toBeLessThan(300);
  });
});

/** 別の表（チーム・招待・記録など）で確かめるルート。各Storyのテストで足す */
const EXTRA_ROUTES = new Set<string>([
  // オーナーが呼ぶとパートナーが外れて、この表の続きが成り立たないので team.test.ts で確かめる（owner だけ・他は403）
  "DELETE /api/accounts/:accountId/partner",
]);
