// チーム運用（specs/008-team-operations contracts/api.md「チーム」「パートナーのチーム」、FR-030〜FR-033・FR-042・FR-047）
import { neon } from "@neondatabase/serverless";
import { beforeEach, describe, expect, it } from "vitest";
import { call, createUserWithAccount, makeApp, resetDb, testEnv } from "../helpers/app";
import { makeEditor, makePartner } from "../helpers/team";

const app = makeApp();
const sql = () => neon(testEnv.DATABASE_URL);

async function json<T>(res: Response, status = 200): Promise<T> {
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as T;
}
const codeOf = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

type AccountTeam = {
  partner: { userId: string; name: string; teamName: string | null; joinedAt: string } | null;
  delegation: { review: boolean; settings: boolean } | null;
  editors: { userId: string; name: string }[];
  joinedNotice: { show: boolean };
};

beforeEach(async () => {
  await resetDb();
});

describe("このAccountを手伝っている人（オーナー側）", () => {
  it("全役割で読め、パートナー・担当の編集者を返す。参加の知らせはオーナーだけに出て、閉じると出ない", async () => {
    const { accountId } = await createUserWithAccount("o1");
    const { teamId } = await makePartner(accountId, "p1");
    await makeEditor(teamId, "e1", [accountId]);
    await makeEditor(teamId, "e2", []);
    for (const user of ["o1", "p1", "e1"]) {
      const team = await json<AccountTeam>(await call(app, "GET", `/api/accounts/${accountId}/team`, { user }));
      expect(team.partner).toMatchObject({ name: "p1", teamName: "p1社" });
      expect(team.delegation).toEqual({ review: false, settings: false });
      expect(team.editors.map((e) => e.name)).toEqual(["e1"]);
      expect(team.joinedNotice.show).toBe(user === "o1");
    }
    expect((await call(app, "POST", `/api/accounts/${accountId}/partner/joined-notice/dismiss`, { user: "p1" })).status).toBe(403);
    expect((await call(app, "POST", `/api/accounts/${accountId}/partner/joined-notice/dismiss`, { user: "o1" })).status).toBe(204);
    expect((await json<AccountTeam>(await call(app, "GET", `/api/accounts/${accountId}/team`, { user: "o1" }))).joinedNotice.show).toBe(false);
  });

  it("パートナーがいなければ partner・delegation は NULL、editors は空", async () => {
    const { accountId } = await createUserWithAccount("o1");
    expect(await json<AccountTeam>(await call(app, "GET", `/api/accounts/${accountId}/team`, { user: "o1" }))).toEqual({
      partner: null,
      delegation: null,
      editors: [],
      joinedNotice: { show: false },
    });
  });

  it("オーナーが外すと、パートナーと担当の編集者が次の要求から開けなくなり、任せる範囲もなくなる（SC-003）", async () => {
    const { accountId } = await createUserWithAccount("o1");
    const { teamId } = await makePartner(accountId, "p1", { review: true, settings: true });
    await makeEditor(teamId, "e1", [accountId]);
    expect((await call(app, "DELETE", `/api/accounts/${accountId}/partner`, { user: "p1" })).status).toBe(403);
    expect((await call(app, "DELETE", `/api/accounts/${accountId}/partner`, { user: "o1" })).status).toBe(204);
    for (const user of ["p1", "e1"]) {
      const res = await call(app, "GET", `/api/accounts/${accountId}/post-drafts`, { user });
      expect([res.status, await codeOf(res)]).toEqual([404, "ACCOUNT_NOT_FOUND"]);
    }
    const rows = (await sql()`SELECT
      (SELECT count(*)::int FROM account_partners) AS partners,
      (SELECT count(*)::int FROM memberships WHERE role <> 'owner') AS helpers,
      (SELECT count(*)::int FROM team_editors) AS editors`) as { partners: number; helpers: number; editors: number }[];
    expect(rows[0]).toEqual({ partners: 0, helpers: 0, editors: 1 });
    const team = await json<AccountTeam>(await call(app, "GET", `/api/accounts/${accountId}/team`, { user: "o1" }));
    expect(team.partner).toBeNull();
  });

  it("オーナーがAccountを削除すると、手伝いの関係・招待・担当も消える", async () => {
    const { accountId } = await createUserWithAccount("o1");
    const { teamId } = await makePartner(accountId, "p1");
    await makeEditor(teamId, "e1", [accountId]);
    const username = ((await sql()`SELECT username FROM accounts WHERE id = ${accountId}`) as { username: string }[])[0]!.username;
    const del = await call(app, "DELETE", `/api/accounts/${accountId}`, { user: "o1", body: { confirmUsername: username } });
    expect(del.status).toBe(204);
    const rows = (await sql()`SELECT
      (SELECT count(*)::int FROM account_partners) AS partners,
      (SELECT count(*)::int FROM memberships) AS memberships`) as { partners: number; memberships: number }[];
    expect(rows[0]).toEqual({ partners: 0, memberships: 0 });
  });
});

describe("パートナーのチーム（/api/team）", () => {
  type Team = {
    name: string | null;
    partnerName: string;
    editorLimit: number;
    editors: { userId: string; name: string; accountIds: string[] }[];
    accounts: { id: string; ownerName: string; own: boolean }[];
    unassignedEditorCount: number;
  };

  it("チームのパートナー以外は TEAM_NOT_FOUND", async () => {
    const { accountId } = await createUserWithAccount("o1");
    const { teamId } = await makePartner(accountId, "p1");
    await makeEditor(teamId, "e1");
    for (const user of ["o1", "e1"]) {
      const res = await call(app, "GET", "/api/team", { user });
      expect([res.status, await codeOf(res)]).toEqual([404, "TEAM_NOT_FOUND"]);
    }
  });

  it("担当の付け外し：手伝う先と自社アカウントだけ。外すと次の要求から開けない", async () => {
    const { accountId: helped } = await createUserWithAccount("o1");
    const { accountId: other } = await createUserWithAccount("o2");
    const { teamId } = await makePartner(helped, "p1");
    const { accountId: own } = await createUserWithAccount("p1");
    const e1 = await makeEditor(teamId, "e1");
    const team = await json<Team>(await call(app, "GET", "/api/team", { user: "p1" }));
    expect(team.accounts.map((a) => [a.id, a.own])).toEqual([
      [own, true],
      [helped, false],
    ]);
    expect(team.unassignedEditorCount).toBe(1);

    for (const accountId of [helped, own]) {
      expect((await call(app, "PUT", `/api/team/editors/${e1}/accounts/${accountId}`, { user: "p1" })).status).toBe(204);
      expect((await call(app, "GET", `/api/accounts/${accountId}/post-drafts`, { user: "e1" })).status).toBe(200);
    }
    const bad = await call(app, "PUT", `/api/team/editors/${e1}/accounts/${other}`, { user: "p1" });
    expect([bad.status, await codeOf(bad)]).toEqual([409, "ASSIGNMENT_NOT_ALLOWED"]);
    const after = await json<Team>(await call(app, "GET", "/api/team", { user: "p1" }));
    expect(after.editors[0]!.accountIds.sort()).toEqual([helped, own].sort());
    expect(after.unassignedEditorCount).toBe(0);

    expect((await call(app, "DELETE", `/api/team/editors/${e1}/accounts/${helped}`, { user: "p1" })).status).toBe(204);
    const res = await call(app, "GET", `/api/accounts/${helped}/post-drafts`, { user: "e1" });
    expect([res.status, await codeOf(res)]).toEqual([404, "ACCOUNT_NOT_FOUND"]);
  });

  it("編集者を外すと、すべての担当がなくなる。チーム名を直せる（50文字まで）", async () => {
    const { accountId } = await createUserWithAccount("o1");
    const { teamId } = await makePartner(accountId, "p1");
    const e1 = await makeEditor(teamId, "e1", [accountId]);
    expect((await call(app, "DELETE", `/api/team/editors/${e1}`, { user: "p1" })).status).toBe(204);
    expect((await call(app, "GET", `/api/accounts/${accountId}/post-drafts`, { user: "e1" })).status).toBe(404);
    const rows = (await sql()`SELECT count(*)::int AS n FROM team_editors`) as { n: number }[];
    expect(rows[0]!.n).toBe(0);
    expect((await call(app, "PATCH", "/api/team", { user: "p1", body: { name: "A社" } })).status).toBe(200);
    expect((await json<Team>(await call(app, "GET", "/api/team", { user: "p1" }))).name).toBe("A社");
    expect((await call(app, "PATCH", "/api/team", { user: "p1", body: { name: "あ".repeat(51) } })).status).toBe(400);
  });

  it("オーナーがパートナーを外しても、チームの編集者は残る（そのAccountの担当だけ消える）", async () => {
    const { accountId } = await createUserWithAccount("o1");
    const { teamId } = await makePartner(accountId, "p1");
    await makeEditor(teamId, "e1", [accountId]);
    await call(app, "DELETE", `/api/accounts/${accountId}/partner`, { user: "o1" });
    const team = await json<Team>(await call(app, "GET", "/api/team", { user: "p1" }));
    expect(team.editors.map((e) => [e.name, e.accountIds])).toEqual([["e1", []]]);
  });
});

describe("任せる範囲（US3、FR-030〜FR-033）", () => {
  it("オーナーだけが変えられ、オンで承認・設定が通り、オフの直後は拒まれる。再接続・パートナーの操作は任せても不可", async () => {
    const { accountId } = await createUserWithAccount("o1");
    await makePartner(accountId, "p1");
    const patch = (user: string, delegation: Record<string, boolean>) =>
      call(app, "PATCH", `/api/accounts/${accountId}/partner`, { user, body: { delegation } });
    expect((await patch("p1", { review: true })).status).toBe(403);
    const on = await json<{ delegation: { review: boolean; settings: boolean } }>(await patch("o1", { review: true, settings: true }));
    expect(on.delegation).toEqual({ review: true, settings: true });

    // 承認の操作・設定の操作は、権限の段階を通る（本文が空なので 400）
    expect((await call(app, "POST", `/api/accounts/${accountId}/post-drafts/review`, { user: "p1", body: {} })).status).toBe(400);
    expect((await call(app, "PUT", `/api/accounts/${accountId}/core-rules`, { user: "p1", body: {} })).status).toBe(400);
    // 任せても、オーナーだけの操作はできない
    expect((await call(app, "POST", `/api/accounts/${accountId}/partner-invite`, { user: "p1" })).status).toBe(403);
    expect((await call(app, "DELETE", `/api/accounts/${accountId}/partner`, { user: "p1" })).status).toBe(403);

    await json(await patch("o1", { review: false }));
    const res = await call(app, "POST", `/api/accounts/${accountId}/post-drafts/review`, { user: "p1", body: {} });
    expect([res.status, await codeOf(res)]).toEqual([403, "ROLE_FORBIDDEN"]);
    // 設定はオンのまま（片方だけ変えられる）
    expect((await call(app, "PUT", `/api/accounts/${accountId}/core-rules`, { user: "p1", body: {} })).status).toBe(400);
  });

  it("パートナーが承認したNGワード入りの案は承認されない（SC-004、FR-005）", async () => {
    const { accountId } = await createUserWithAccount("o1");
    await makePartner(accountId, "p1", { review: true });
    await sql()`INSERT INTO ng_words (account_id, word, normalized) VALUES (${accountId}, ${"絶対"}, ${"絶対"})`;
    const reg = await json<{ drafts: { id: string; version: number }[] }>(
      await call(app, "POST", `/api/accounts/${accountId}/draft-batches`, {
        user: "p1",
        body: { clientRequestId: crypto.randomUUID(), text: "絶対に伸びる方法" },
      }),
      201,
    );
    const d = reg.drafts[0]!;
    const res = await json<{ updated: unknown[]; skipped: { reason: string }[] }>(
      await call(app, "POST", `/api/accounts/${accountId}/post-drafts/review`, {
        user: "p1",
        body: { requestId: crypto.randomUUID(), action: "approve", items: [{ id: d.id, expectedVersion: d.version }] },
      }),
    );
    expect(res.updated).toHaveLength(0);
    expect(res.skipped.length).toBe(1);
    const status = (await sql()`SELECT status FROM post_drafts WHERE id = ${d.id}`) as { status: string }[];
    expect(status[0]!.status).toBe("needs_review");
  });
});

describe("手伝っているアカウントのまとめ（US5、FR-061）", () => {
  type Summary = {
    items: {
      account: { id: string; connectionStatus: string };
      ownerName: string;
      needsReview: number;
      approved: { count: number; days: number | null };
      nextPost: { state: string };
      judgments7d: { good: number; normal: number; poor: number };
      delegation: { review: boolean; settings: boolean };
      editors: { name: string }[];
    }[];
    truncated: boolean;
  };

  it("手伝う先だけを要確認の多い順で返し、件数・判定・任された範囲・担当・接続状態が合う", async () => {
    const { accountId: a } = await createUserWithAccount("o1");
    const { accountId: b } = await createUserWithAccount("o2");
    const { teamId } = await makePartner(a, "p1", { review: true });
    await makePartner(b, "p1");
    await createUserWithAccount("p1"); // 自社アカウントは含めない
    await makeEditor(teamId, "e1", [b]);
    for (const [accountId, user, n] of [[a, "o1", 1], [b, "o2", 3]] as const) {
      await json(
        await call(app, "POST", `/api/accounts/${accountId}/draft-batches`, {
          user,
          body: { clientRequestId: crypto.randomUUID(), text: Array.from({ length: n }, (_, i) => `案${i}`).join("\n@@@\n") },
        }),
        201,
      );
    }
    await sql()`UPDATE accounts SET connection_status = 'needs_reconnect' WHERE id = ${a}`;
    // 直近7日の判定（伸びた1件）を b に入れる
    const [d] = (await sql()`SELECT id FROM post_drafts WHERE account_id = ${b} LIMIT 1`) as { id: string }[];
    await sql()`INSERT INTO post_metrics (draft_id, account_id, state, views, judgment, judgment_ratio, judgment_baseline, judged_at, confirmed_at)
      VALUES (${d!.id}, ${b}, 'confirmed', 100, 'good', 2.5, 40, now() - interval '1 day', now() - interval '1 day')`;

    const res = await json<Summary>(await call(app, "GET", "/api/team/accounts", { user: "p1" }));
    expect(res.truncated).toBe(false);
    expect(res.items.map((i) => i.account.id)).toEqual([b, a]);
    const [first, second] = res.items;
    expect(first).toMatchObject({
      ownerName: "o2",
      needsReview: 3,
      judgments7d: { good: 1, normal: 0, poor: 0 },
      delegation: { review: false, settings: false },
      nextPost: { state: "off" },
    });
    expect(first!.editors.map((e) => e.name)).toEqual(["e1"]);
    expect(second).toMatchObject({ ownerName: "o1", needsReview: 1, delegation: { review: true, settings: false } });
    expect(second!.account.connectionStatus).toBe("needs_reconnect");

    const notPartner = await call(app, "GET", "/api/team/accounts", { user: "e1" });
    expect([notPartner.status, await codeOf(notPartner)]).toEqual([404, "TEAM_NOT_FOUND"]);
  });
});

describe("同時の操作（PR #9 のCodexレビュー）", () => {
  it("担当の追加とパートナーを外す操作が同時でも、外した後に担当が残らない", async () => {
    for (let round = 0; round < 3; round++) {
      await resetDb();
      const { accountId } = await createUserWithAccount("o1");
      const { teamId } = await makePartner(accountId, "p1");
      const e1 = await makeEditor(teamId, "e1");
      const [assign, remove] = await Promise.all([
        call(app, "PUT", `/api/team/editors/${e1}/accounts/${accountId}`, { user: "p1" }),
        call(app, "DELETE", `/api/accounts/${accountId}/partner`, { user: "o1" }),
      ]);
      expect([204, 409]).toContain(assign.status);
      expect(remove.status).toBe(204);
      const helpers = (await sql()`SELECT count(*)::int AS n FROM memberships WHERE account_id = ${accountId} AND role <> 'owner'`) as { n: number }[];
      expect(helpers[0]!.n).toBe(0);
    }
  });

  it("担当の追加と編集者を外す操作が同時でも、外した後に担当が残らない", async () => {
    for (let round = 0; round < 3; round++) {
      await resetDb();
      const { accountId } = await createUserWithAccount("o1");
      const { teamId } = await makePartner(accountId, "p1");
      const e1 = await makeEditor(teamId, "e1");
      const [assign, remove] = await Promise.all([
        call(app, "PUT", `/api/team/editors/${e1}/accounts/${accountId}`, { user: "p1" }),
        call(app, "DELETE", `/api/team/editors/${e1}`, { user: "p1" }),
      ]);
      expect([204, 404]).toContain(assign.status);
      expect(remove.status).toBe(204);
      const rows = (await sql()`SELECT count(*)::int AS n FROM memberships WHERE user_id = ${e1}`) as { n: number }[];
      expect(rows[0]!.n).toBe(0);
    }
  });

  it("同じ担当の追加が同時に届いても、どちらも成功し、記録は1行", async () => {
    const { accountId } = await createUserWithAccount("o1");
    const { teamId } = await makePartner(accountId, "p1");
    const e1 = await makeEditor(teamId, "e1");
    const results = await Promise.all([
      call(app, "PUT", `/api/team/editors/${e1}/accounts/${accountId}`, { user: "p1" }),
      call(app, "PUT", `/api/team/editors/${e1}/accounts/${accountId}`, { user: "p1" }),
    ]);
    expect(results.map((r) => r.status)).toEqual([204, 204]);
    const logs = (await sql()`SELECT count(*)::int AS n FROM activity_logs WHERE action = 'assignment_added'`) as { n: number }[];
    expect(logs[0]!.n).toBe(1);
  });
});
