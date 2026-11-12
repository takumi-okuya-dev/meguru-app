// 解説がまだの参考投稿のまとめての解説（specs/014-strategy-guidance FR-100〜FR-105、SC-014、contracts/api.md）。
import { neon } from "@neondatabase/serverless";
import { beforeEach, describe, expect, it } from "vitest";
import { call, createUserWithAccount, endTrial, makeApp, resetDb, testEnv } from "../helpers/app";
import { callBilling } from "../helpers/billing";
import { activityRows, putInTeam } from "../helpers/team";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
});

const base = (accountId: string) => `/api/accounts/${accountId}/reference-posts`;
type Prompt = { prompt: string; items: { id: string; shortId: string }[]; pendingCount: number };

async function insert(accountId: string, body: string, whyGood: string | null, minutesAgo = 0, mode = "unknown") {
  const rows = (await neon(testEnv.DATABASE_URL)`
    INSERT INTO threads.reference_posts (account_id, body, why_good, posted_date_mode, created_at)
    VALUES (${accountId}, ${body}, ${whyGood}, ${mode}, now() - make_interval(mins => ${minutesAgo}))
    RETURNING id`) as { id: string }[];
  return rows[0]!.id;
}

async function whyGoodOf(id: string) {
  const rows = (await neon(testEnv.DATABASE_URL)`SELECT why_good, version FROM threads.reference_posts WHERE id = ${id}`) as {
    why_good: string | null;
    version: number;
  }[];
  return rows[0]!;
}

describe("GET /reference-posts/explain-prompt", () => {
  it("「なぜ良いか」が空の参考投稿を、プロンプトに入る順で10件まで選び、件数と【ID】を返す", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await insert(accountId, "解説ありの投稿", "解説", 1);
    await insert(accountId, "空白だけの解説の投稿", "  ", 2);
    await insert(accountId, "最新の投稿", null, 30, "week");
    for (let i = 0; i < 10; i++) await insert(accountId, `不明の投稿${i}`, null, 3 + i);
    const res = await call(app, "GET", `${base(accountId)}/explain-prompt`, { user: "u1" });
    expect(res.status).toBe(200);
    const p = (await res.json()) as Prompt;
    expect(p.pendingCount).toBe(12);
    expect(p.items).toHaveLength(10);
    // 最新の投稿が先頭（鮮度の順。FR-101）
    expect(p.prompt.indexOf("最新の投稿")).toBeLessThan(p.prompt.indexOf("空白だけの解説の投稿"));
    expect(p.prompt).toContain(`【ID:${p.items[0]!.shortId}】`);
    expect(p.prompt).not.toContain("解説ありの投稿");
  });

  it("?id= ならその1件の解説のプロンプト（【ID】なし。解説があっても作れる）", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const id = await insert(accountId, "解説ありの投稿", "解説");
    const res = await call(app, "GET", `${base(accountId)}/explain-prompt?id=${id}`, { user: "u1" });
    const p = (await res.json()) as Prompt;
    expect(p.prompt).toContain("解説ありの投稿");
    expect(p.prompt).not.toContain("【ID:");
    expect(p.items).toEqual([{ id, shortId: id.replace(/-/g, "").slice(0, 8) }]);
  });

  it("空の参考投稿がなければ、プロンプトは空で0件", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const p = (await (await call(app, "GET", `${base(accountId)}/explain-prompt`, { user: "u1" })).json()) as Prompt;
    expect(p).toEqual({ prompt: "", items: [], pendingCount: 0 });
  });
});

describe("POST /reference-posts/explanations", () => {
  it("空の行だけ保存して版を上げ、解説がある行・ほかのアカウントの行は飛ばす", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const { accountId: other } = await createUserWithAccount("u2");
    const a = await insert(accountId, "空の投稿", null);
    const b = await insert(accountId, "解説ありの投稿", "前の解説");
    const c = await insert(other, "ほかの人の投稿", null);
    const res = await call(app, "POST", `${base(accountId)}/explanations`, {
      user: "u1",
      body: {
        items: [
          { id: a, whyGood: "【型の名前】あるある型" },
          { id: b, whyGood: "新しい解説" },
          { id: c, whyGood: "新しい解説" },
        ],
      },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      saved: [a],
      skipped: [
        { id: b, reason: "already_explained" },
        { id: c, reason: "not_found" },
      ],
    });
    expect(await whyGoodOf(a)).toEqual({ why_good: "【型の名前】あるある型", version: 2 });
    expect((await whyGoodOf(b)).why_good).toBe("前の解説");
    expect((await whyGoodOf(c)).why_good).toBeNull();
  });

  it("同じIDが2回あれば 400", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const a = await insert(accountId, "空の投稿", null);
    const res = await call(app, "POST", `${base(accountId)}/explanations`, {
      user: "u1",
      body: { items: [{ id: a, whyGood: "1" }, { id: a, whyGood: "2" }] },
    });
    expect(res.status).toBe(400);
  });

  it("チームのアカウントでは、保存が1件以上なら操作の記録が1件", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await putInTeam(accountId, "u1", { admin: "a1" });
    const a = await insert(accountId, "空の投稿", null);
    await call(app, "POST", `${base(accountId)}/explanations`, { user: "u1", body: { items: [{ id: a, whyGood: "解説" }] } });
    const rows = (await activityRows(accountId)).filter((r) => r.action === "reference_posts_explained");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.summary).toContain("1件");
  });

  it("見せてもらっている人は 403、読むだけのオーナーは BILLING_REQUIRED", async () => {
    const { userId, accountId } = await createUserWithAccount("o1");
    await putInTeam(accountId, "o1", { admin: "a1", shared: true });
    const a = await insert(accountId, "空の投稿", null);
    expect((await call(app, "GET", `${base(accountId)}/explain-prompt`, { user: "a1" })).status).toBe(403);
    expect(
      (await call(app, "POST", `${base(accountId)}/explanations`, { user: "a1", body: { items: [{ id: a, whyGood: "x" }] } })).status,
    ).toBe(403);
    await endTrial(userId);
    const ro = await callBilling(app, "POST", `${base(accountId)}/explanations`, {
      user: "o1",
      body: { items: [{ id: a, whyGood: "x" }] },
    });
    expect(ro.status).toBe(403);
    expect(((await ro.json()) as { error: { code: string } }).error.code).toBe("BILLING_REQUIRED");
  });
});
