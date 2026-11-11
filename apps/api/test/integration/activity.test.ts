// 操作の記録（specs/008-team-operations FR-050・FR-050a・FR-051・FR-052・FR-054、research.md R9。
// specs/011 research.md R8：チームに入っているアカウントだけ書き、した人の役割は owner・admin・editor・member）
import { neon } from "@neondatabase/serverless";
import { emptyStrategyValues } from "@meguru/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { runDailyJobs } from "../../src/jobs/daily-jobs";
import { call, createUserWithAccount, makeApp, resetDb, testEnv } from "../helpers/app";
import { activityRows, assign, joinTeam, makeTeam, setRole } from "../helpers/team";

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

/**
 * o1 のアカウントをチームに入れる。a1 が管理者（自分を担当にする）、e1 が編集者（担当にするかは assignEditor）。
 * @param accountId - o1 のアカウント
 * @param opts - assignEditor：e1 を担当にする、assignAdmin：a1 を担当にする
 * @returns チームと e1 の users.id
 */
async function teamFor(accountId: string, opts: { assignEditor?: boolean; assignAdmin?: boolean } = {}) {
  const { accountId: adminAcc } = await createUserWithAccount("a1");
  const { accountId: editorAcc } = await createUserWithAccount("e1");
  const { teamId } = await makeTeam("a1", [adminAcc]);
  await joinTeam(teamId, "o1", [accountId]);
  const e1 = await joinTeam(teamId, "e1", [editorAcc]);
  await setRole(teamId, "e1", "editor");
  if (opts.assignEditor ?? true) await assign(teamId, "e1", accountId);
  if (opts.assignAdmin ?? true) await assign(teamId, "a1", accountId);
  return { teamId, e1 };
}

beforeEach(async () => {
  await resetDb();
});

describe("記録を書く", () => {
  it("チームに入っているAccountで、した人の名前・役割つきで1行ずつ書く。まとめては1行で件数と書き出し", async () => {
    const { accountId } = await createUserWithAccount("o1");
    await teamFor(accountId);
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

  it("個人運用（チームに入っていない）のAccountでは書かない", async () => {
    const { accountId } = await createUserWithAccount("o1");
    await register(accountId, "o1", ["案"]);
    await json(await call(app, "PUT", `/api/accounts/${accountId}/strategy`, { user: "o1", body: strategy("x", 0) }));
    expect(await activityRows(accountId)).toEqual([]);
  });

  it("操作が失敗したら記録もない（同じトランザクション）", async () => {
    const { accountId } = await createUserWithAccount("o1");
    await teamFor(accountId);
    const res = await call(app, "POST", `/api/accounts/${accountId}/draft-batches`, {
      user: "a1",
      body: { clientRequestId: crypto.randomUUID(), text: "あ".repeat(60000) },
    });
    expect(res.status).toBe(400);
    expect((await activityRows(accountId)).filter((r) => r.action === "drafts_registered")).toEqual([]);
  });

  it("編集・削除・担当の付け外し・ロールの切り替えを記録し、した人の役割は管理者なら admin（research.md R8）", async () => {
    const { accountId } = await createUserWithAccount("o1");
    const { teamId, e1 } = await teamFor(accountId, { assignEditor: false, assignAdmin: false });
    expect((await call(app, "PUT", `/api/teams/${teamId}/assignments/${e1}/accounts/${accountId}`, { user: "a1" })).status).toBe(204);
    const [d] = await register(accountId, "e1", ["直す前"]);
    await json(await call(app, "PUT", `/api/accounts/${accountId}/post-drafts/${d!.id}`, { user: "e1", body: { body: "直した後", expectedVersion: d!.version } }));
    await json(await call(app, "POST", `/api/accounts/${accountId}/post-drafts/delete`, { user: "e1", body: { ids: [d!.id] } }));
    expect((await call(app, "DELETE", `/api/teams/${teamId}/assignments/${e1}/accounts/${accountId}`, { user: "a1" })).status).toBe(204);
    const actions = (await activityRows(accountId)).map((r) => [r.action, r.actor_role]);
    expect(actions).toEqual([
      ["assignment_removed", "admin"],
      ["drafts_deleted", "editor"],
      ["draft_edited", "editor"],
      ["drafts_registered", "editor"],
      ["assignment_added", "admin"],
    ]);
  });
});

describe("GET /accounts/:id/activity", () => {
  it("オーナー・担当の管理者は読め、編集者は403。種類と人で絞り込み、カーソルで続きを読む", async () => {
    const { accountId } = await createUserWithAccount("o1");
    await teamFor(accountId);
    for (let i = 0; i < 3; i++) await register(accountId, "e1", [`案${i}`]);
    await json(await call(app, "PUT", `/api/accounts/${accountId}/strategy`, { user: "o1", body: strategy("x", 0) }));
    expect((await call(app, "GET", `/api/accounts/${accountId}/activity`, { user: "e1" })).status).toBe(403);
    type List = { items: { action: string }[]; actors: { name: string }[]; nextCursor: string | null };
    const all = await json<List>(await call(app, "GET", `/api/accounts/${accountId}/activity?limit=2&kind=draft,content`, { user: "a1" }));
    expect(all.items).toHaveLength(2);
    expect(all.nextCursor).not.toBeNull();
    const next = await json<List>(
      await call(app, "GET", `/api/accounts/${accountId}/activity?limit=2&kind=draft,content&cursor=${encodeURIComponent(all.nextCursor!)}`, { user: "a1" }),
    );
    expect(next.items).toHaveLength(2);
    expect(all.actors.map((a) => a.name).sort()).toEqual(["e1", "o1"]);
    const content = await json<List>(await call(app, "GET", `/api/accounts/${accountId}/activity?kind=content`, { user: "o1" }));
    expect(content.items.map((r) => r.action)).toEqual(["strategy_saved"]);
  });

  it("90日より前の記録は出さず、日次の処理で消える", async () => {
    const { accountId } = await createUserWithAccount("o1");
    await teamFor(accountId);
    await register(accountId, "a1", ["新しい案"]);
    await sql()`INSERT INTO activity_logs (account_id, actor_name, actor_role, kind, action, created_at)
      VALUES (${accountId}, 'o1', 'owner', 'review', 'drafts_approved', now() - interval '91 days')`;
    const list = await json<{ items: unknown[] }>(await call(app, "GET", `/api/accounts/${accountId}/activity`, { user: "o1" }));
    expect(list.items).toHaveLength(1);
    await runDailyJobs(testEnv);
    expect(await activityRows(accountId)).toHaveLength(1);
  });
});

describe("保存の衝突で、先に保存した人の名前を返す（FR-007）", () => {
  it("戦略・投稿の案", async () => {
    const { accountId } = await createUserWithAccount("o1");
    await teamFor(accountId);
    await json(await call(app, "PUT", `/api/accounts/${accountId}/strategy`, { user: "e1", body: strategy("e1の内容", 0) }));
    const s = await call(app, "PUT", `/api/accounts/${accountId}/strategy`, { user: "o1", body: strategy("o1の内容", 0) });
    expect(s.status).toBe(409);
    expect(((await s.json()) as { updatedBy: { name: string } }).updatedBy).toEqual({ name: "e1" });

    const [d] = await register(accountId, "o1", ["本文"]);
    await json(await call(app, "PUT", `/api/accounts/${accountId}/post-drafts/${d!.id}`, { user: "e1", body: { body: "e1が直した", expectedVersion: d!.version } }));
    const pd = await call(app, "PUT", `/api/accounts/${accountId}/post-drafts/${d!.id}`, { user: "o1", body: { body: "o1が直した", expectedVersion: d!.version } });
    expect(pd.status).toBe(409);
    expect(((await pd.json()) as { updatedBy: { name: string } }).updatedBy).toEqual({ name: "e1" });
  });
});

describe("カーソルの検証（PR #9 のCodexレビュー）", () => {
  it("UUIDでないID（ハイフンだけ）のカーソルは 400 VALIDATION_FAILED", async () => {
    const { accountId } = await createUserWithAccount("o1");
    await teamFor(accountId);
    const cursor = btoa(JSON.stringify([new Date().toISOString(), "-".repeat(36)])).replace(/=+$/, "");
    const res = await call(app, "GET", `/api/accounts/${accountId}/activity?cursor=${encodeURIComponent(cursor)}`, { user: "o1" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("VALIDATION_FAILED");
  });
});

describe("記録と保存の一体性（PR #9 のCodexレビュー2回目）", () => {
  it("記録の書き込みが失敗したら保存も戻り、同じ版での再試行で保存と記録ができる", async () => {
    const { accountId } = await createUserWithAccount("o1");
    await teamFor(accountId);
    // 記録の書き込みだけを失敗させる
    await sql()`CREATE FUNCTION fail_activity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'activity down'; END $$`;
    await sql()`CREATE TRIGGER fail_activity BEFORE INSERT ON activity_logs FOR EACH ROW EXECUTE FUNCTION fail_activity()`;
    try {
      const failed = await call(app, "PUT", `/api/accounts/${accountId}/strategy`, { user: "a1", body: strategy("x", 0) });
      expect(failed.status).toBe(500);
      const saved = (await sql()`SELECT count(*)::int AS n FROM strategy_designs WHERE account_id = ${accountId}`) as { n: number }[];
      expect(saved[0]!.n).toBe(0);
      // 宣伝投稿の割合は設定なので、オーナーが保存する（PR #14 のCodexレビュー）
      const promo = await call(app, "PUT", `/api/accounts/${accountId}/promotion-settings`, { user: "o1", body: { ratioPercent: 30, expectedVersion: 1 } });
      expect(promo.status).toBe(500);
      const ratio = (await sql()`SELECT promotion_ratio_percent AS r FROM accounts WHERE id = ${accountId}`) as { r: number }[];
      expect(ratio[0]!.r).not.toBe(30);
    } finally {
      await sql()`DROP TRIGGER fail_activity ON activity_logs`;
      await sql()`DROP FUNCTION fail_activity()`;
    }
    await json(await call(app, "PUT", `/api/accounts/${accountId}/strategy`, { user: "a1", body: strategy("x", 0) }));
    expect((await activityRows(accountId)).map((r) => r.action)).toContain("strategy_saved");
  });

  it("すべて登録済みのNGワードだけを送っても、記録を作らない", async () => {
    const { accountId } = await createUserWithAccount("o1");
    await teamFor(accountId);
    await json(await call(app, "POST", `/api/accounts/${accountId}/ng-words`, { user: "o1", body: { words: ["絶対"] } }));
    await call(app, "POST", `/api/accounts/${accountId}/ng-words`, { user: "o1", body: { words: ["絶対"] } });
    const added = (await activityRows(accountId)).filter((r) => r.action === "ng_word_added");
    expect(added).toHaveLength(1);
    expect(added[0]!.item_count).toBe(1);
  });

  it("種類はカンマ区切りで複数を選べる（「設定・戦略」は content と settings）。知らない種類は 400", async () => {
    const { accountId } = await createUserWithAccount("o1");
    await teamFor(accountId);
    await json(await call(app, "PUT", `/api/accounts/${accountId}/strategy`, { user: "o1", body: strategy("x", 0) }));
    await json(await call(app, "PUT", `/api/accounts/${accountId}/core-rules`, { user: "o1", body: { text: "ルール", expectedVersion: 1 } }));
    type List = { items: { action: string }[] };
    const both = await json<List>(await call(app, "GET", `/api/accounts/${accountId}/activity?kind=content,settings`, { user: "o1" }));
    expect(both.items.map((i) => i.action).sort()).toEqual(["core_rules_saved", "strategy_saved"]);
    const bad = await call(app, "GET", `/api/accounts/${accountId}/activity?kind=content,unknown`, { user: "o1" });
    expect(bad.status).toBe(400);
  });
});

describe("宣伝投稿の割合・作る件数の同時の保存（specs/008 FR-007、PR #9 のCodexレビュー3回目）", () => {
  // どちらも設定なので、担当の人は保存できない（オーナーの別のタブどうしの衝突を確かめる。PR #14 のCodexレビュー）
  it("担当の人（編集者・管理者）は宣伝投稿の割合・作る件数を保存できない（403）。GETの canEdit も false", async () => {
    const { accountId } = await createUserWithAccount("o1");
    await teamFor(accountId);
    for (const user of ["a1", "e1"]) {
      const promo = await call(app, "PUT", `/api/accounts/${accountId}/promotion-settings`, { user, body: { ratioPercent: 40, expectedVersion: 1 } });
      expect(promo.status, user).toBe(403);
      const prompt = await call(app, "PUT", `/api/accounts/${accountId}/prompt-settings`, { user, body: { postCount: 12, expectedVersion: 1 } });
      expect(prompt.status, user).toBe(403);
      const get = await json<{ canEdit: boolean }>(await call(app, "GET", `/api/accounts/${accountId}/promotion-settings`, { user }));
      expect(get.canEdit, user).toBe(false);
    }
  });

  it("古い版での宣伝投稿の割合の保存は 409 STALE_UPDATE。最新の値と先に保存した人の名前を返し、黙って上書きしない", async () => {
    const { accountId } = await createUserWithAccount("o1");
    await teamFor(accountId);
    const first = await json<{ ratioPercent: number; version: number }>(
      await call(app, "PUT", `/api/accounts/${accountId}/promotion-settings`, { user: "o1", body: { ratioPercent: 40, expectedVersion: 1 } }),
    );
    expect(first).toMatchObject({ ratioPercent: 40, version: 2 });
    const stale = await call(app, "PUT", `/api/accounts/${accountId}/promotion-settings`, { user: "o1", body: { ratioPercent: 10, expectedVersion: 1 } });
    expect(stale.status).toBe(409);
    const body = (await stale.json()) as { error: { code: string }; latest: unknown; updatedBy: { name: string } | null };
    expect(body.error.code).toBe("STALE_UPDATE");
    expect(body.latest).toEqual({ ratioPercent: 40, version: 2, canEdit: true });
    expect(body.updatedBy?.name).toBeTruthy();
    const get = await json<{ ratioPercent: number }>(await call(app, "GET", `/api/accounts/${accountId}/promotion-settings`, { user: "o1" }));
    expect(get.ratioPercent).toBe(40);
    // 最新の版を送れば上書きできる
    await json(await call(app, "PUT", `/api/accounts/${accountId}/promotion-settings`, { user: "o1", body: { ratioPercent: 10, expectedVersion: 2 } }));
  });

  it("古い版での作る件数の保存は 409 STALE_UPDATE。GET /post-drafts は版を返す", async () => {
    const { accountId } = await createUserWithAccount("o1");
    await teamFor(accountId);
    await json(await call(app, "PUT", `/api/accounts/${accountId}/prompt-settings`, { user: "o1", body: { postCount: 12, expectedVersion: 1 } }));
    const stale = await call(app, "PUT", `/api/accounts/${accountId}/prompt-settings`, { user: "o1", body: { postCount: 5, expectedVersion: 1 } });
    expect(stale.status).toBe(409);
    const body = (await stale.json()) as { error: { code: string }; latest: unknown; updatedBy: { name: string } | null };
    expect(body.latest).toMatchObject({ postCount: 12, version: 2 });
    expect(body.updatedBy?.name).toBeTruthy();
    const drafts = await json<{ promptPostCount: number; promptPostCountVersion: number }>(
      await call(app, "GET", `/api/accounts/${accountId}/post-drafts`, { user: "o1" }),
    );
    expect(drafts).toMatchObject({ promptPostCount: 12, promptPostCountVersion: 2 });
  });
});
