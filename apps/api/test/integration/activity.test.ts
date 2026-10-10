// 操作の記録（specs/008-team-operations FR-050・FR-050a・FR-051・FR-052・FR-054、research.md R9）
import { neon } from "@neondatabase/serverless";
import { emptyStrategyValues } from "@threads-grower/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { runDailyJobs } from "../../src/services/daily-jobs";
import { call, createUserWithAccount, makeApp, resetDb, testEnv } from "../helpers/app";
import { activityRows, makeEditor, makePartner } from "../helpers/team";

const app = makeApp();
const sql = () => neon(testEnv.DATABASE_URL);

async function json<T>(res: Response, status = 200): Promise<T> {
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as T;
}

async function register(accountId: string, user: string, bodies: string[]) {
  return (
    await json<{ drafts: { id: string; version: number; body: string }[] }>(
      await call(app, "POST", `/api/accounts/${accountId}/draft-batches`, {
        user,
        body: { clientRequestId: crypto.randomUUID(), text: bodies.join("\n@@@\n") },
      }),
      201,
    )
  ).drafts;
}

const strategy = (finalAction: string, expectedVersion: number) => ({ ...emptyStrategyValues(), finalAction, expectedVersion });

beforeEach(async () => {
  await resetDb();
});

describe("記録を書く", () => {
  it("チームがあるAccountで、した人の名前・役割つきで1行ずつ書く。まとめては1行で件数と書き出し", async () => {
    const { accountId } = await createUserWithAccount("o1");
    const { teamId } = await makePartner(accountId, "p1");
    await makeEditor(teamId, "e1", [accountId]);
    const drafts = await register(accountId, "e1", ["一つ目の案", "二つ目の案", "三つ目の案"]);
    const reviewBody = {
      requestId: crypto.randomUUID(),
      action: "approve",
      items: drafts.map((d) => ({ id: d.id, expectedVersion: d.version })),
    };
    await json(await call(app, "POST", `/api/accounts/${accountId}/post-drafts/review`, { user: "o1", body: reviewBody }));
    // 同じ requestId の再試行では増えない
    await json(await call(app, "POST", `/api/accounts/${accountId}/post-drafts/review`, { user: "o1", body: reviewBody }));
    const rows = await activityRows(accountId);
    expect(rows.map((r) => [r.action, r.actor_name, r.actor_role, r.item_count])).toEqual([
      ["drafts_approved", "o1", "owner", 3],
      ["drafts_registered", "e1", "editor", 3],
    ]);
    expect(((rows[0]!.details as { excerpts: string[] }).excerpts).sort()).toEqual(["一つ目の案", "三つ目の案", "二つ目の案"].sort());
    expect(rows[1]!.summary).toBe("一つ目の案");
  });

  it("個人運用のAccountでは書かない", async () => {
    const { accountId } = await createUserWithAccount("o1");
    await register(accountId, "o1", ["案"]);
    await json(await call(app, "PUT", `/api/accounts/${accountId}/strategy`, { user: "o1", body: strategy("x", 0) }));
    expect(await activityRows(accountId)).toEqual([]);
  });

  it("操作が失敗したら記録もない（同じトランザクション）", async () => {
    const { accountId } = await createUserWithAccount("o1");
    await makePartner(accountId, "p1");
    const res = await call(app, "POST", `/api/accounts/${accountId}/draft-batches`, {
      user: "p1",
      body: { clientRequestId: crypto.randomUUID(), text: "あ".repeat(60000) },
    });
    expect(res.status).toBe(400);
    expect((await activityRows(accountId)).filter((r) => r.action === "drafts_registered")).toEqual([]);
  });

  it("編集・削除・任せる範囲・担当の付け外し・外すを記録し、外した後も外す前の記録が残る（FR-054）", async () => {
    const { accountId } = await createUserWithAccount("o1");
    const { teamId } = await makePartner(accountId, "p1");
    const e1 = await makeEditor(teamId, "e1", []);
    expect((await call(app, "PUT", `/api/team/editors/${e1}/accounts/${accountId}`, { user: "p1" })).status).toBe(204);
    const [d] = await register(accountId, "e1", ["直す前"]);
    await json(await call(app, "PUT", `/api/accounts/${accountId}/post-drafts/${d!.id}`, { user: "e1", body: { body: "直した後", expectedVersion: d!.version } }));
    await json(await call(app, "POST", `/api/accounts/${accountId}/post-drafts/delete`, { user: "e1", body: { ids: [d!.id] } }));
    await json(await call(app, "PATCH", `/api/accounts/${accountId}/partner`, { user: "o1", body: { delegation: { review: true } } }));
    expect((await call(app, "DELETE", `/api/accounts/${accountId}/partner`, { user: "o1" })).status).toBe(204);
    const actions = (await activityRows(accountId)).map((r) => [r.action, r.actor_role]);
    expect(actions).toEqual([
      ["partner_removed", "owner"],
      ["delegation_changed", "owner"],
      ["drafts_deleted", "editor"],
      ["draft_edited", "editor"],
      ["drafts_registered", "editor"],
      ["assignment_added", "partner"],
    ]);
    const removed = (await activityRows(accountId))[0]!;
    expect(removed.details).toMatchObject({ partner: "p1", editors: ["e1"] });
  });
});

describe("GET /accounts/:id/activity", () => {
  it("オーナー・パートナーは読め、編集者は403。種類と人で絞り込み、カーソルで続きを読む", async () => {
    const { accountId } = await createUserWithAccount("o1");
    const { teamId } = await makePartner(accountId, "p1");
    await makeEditor(teamId, "e1", [accountId]);
    for (let i = 0; i < 3; i++) await register(accountId, "e1", [`案${i}`]);
    await json(await call(app, "PATCH", `/api/accounts/${accountId}/partner`, { user: "o1", body: { delegation: { review: true } } }));
    expect((await call(app, "GET", `/api/accounts/${accountId}/activity`, { user: "e1" })).status).toBe(403);
    type List = { items: { action: string }[]; actors: { name: string }[]; nextCursor: string | null };
    const all = await json<List>(await call(app, "GET", `/api/accounts/${accountId}/activity?limit=2`, { user: "p1" }));
    expect(all.items).toHaveLength(2);
    expect(all.nextCursor).not.toBeNull();
    const next = await json<List>(await call(app, "GET", `/api/accounts/${accountId}/activity?limit=2&cursor=${encodeURIComponent(all.nextCursor!)}`, { user: "p1" }));
    expect(next.items).toHaveLength(2);
    expect(all.actors.map((a) => a.name).sort()).toEqual(["e1", "o1"]);
    const members = await json<List>(await call(app, "GET", `/api/accounts/${accountId}/activity?kind=member`, { user: "o1" }));
    expect(members.items.map((r) => r.action)).toEqual(["delegation_changed"]);
  });

  it("90日より前の記録は出さず、日次の処理で消える", async () => {
    const { accountId } = await createUserWithAccount("o1");
    await makePartner(accountId, "p1");
    await register(accountId, "p1", ["新しい案"]);
    await sql()`INSERT INTO activity_logs (account_id, actor_name, actor_role, kind, action, created_at)
      VALUES (${accountId}, 'o1', 'owner', 'review', 'drafts_approved', now() - interval '91 days')`;
    const list = await json<{ items: unknown[] }>(await call(app, "GET", `/api/accounts/${accountId}/activity`, { user: "o1" }));
    expect(list.items).toHaveLength(1);
    await runDailyJobs(testEnv);
    expect(await activityRows(accountId)).toHaveLength(1);
  });
});

describe("保存の衝突で、先に保存した人の名前を返す（FR-007）", () => {
  it("戦略・投稿の案・投稿のルール", async () => {
    const { accountId } = await createUserWithAccount("o1");
    const { teamId } = await makePartner(accountId, "p1", { settings: true });
    await makeEditor(teamId, "e1", [accountId]);
    await json(await call(app, "PUT", `/api/accounts/${accountId}/strategy`, { user: "e1", body: strategy("e1の内容", 0) }));
    const s = await call(app, "PUT", `/api/accounts/${accountId}/strategy`, { user: "o1", body: strategy("o1の内容", 0) });
    expect(s.status).toBe(409);
    expect(((await s.json()) as { updatedBy: { name: string } }).updatedBy).toEqual({ name: "e1" });

    const [d] = await register(accountId, "o1", ["本文"]);
    await json(await call(app, "PUT", `/api/accounts/${accountId}/post-drafts/${d!.id}`, { user: "e1", body: { body: "e1が直した", expectedVersion: d!.version } }));
    const pd = await call(app, "PUT", `/api/accounts/${accountId}/post-drafts/${d!.id}`, { user: "o1", body: { body: "o1が直した", expectedVersion: d!.version } });
    expect(pd.status).toBe(409);
    expect(((await pd.json()) as { updatedBy: { name: string } }).updatedBy).toEqual({ name: "e1" });

    await json(await call(app, "PUT", `/api/accounts/${accountId}/core-rules`, { user: "p1", body: { text: "ルール", expectedVersion: 1 } }));
    const cr = await call(app, "PUT", `/api/accounts/${accountId}/core-rules`, { user: "o1", body: { text: "別のルール", expectedVersion: 1 } });
    expect(cr.status).toBe(409);
    expect(((await cr.json()) as { updatedBy: { name: string } }).updatedBy).toEqual({ name: "p1" });
  });
});

describe("カーソルの検証（PR #9 のCodexレビュー）", () => {
  it("UUIDでないID（ハイフンだけ）のカーソルは 400 VALIDATION_FAILED", async () => {
    const { accountId } = await createUserWithAccount("o1");
    await makePartner(accountId, "p1");
    const cursor = btoa(JSON.stringify([new Date().toISOString(), "-".repeat(36)])).replace(/=+$/, "");
    const res = await call(app, "GET", `/api/accounts/${accountId}/activity?cursor=${encodeURIComponent(cursor)}`, { user: "o1" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("VALIDATION_FAILED");
  });
});
