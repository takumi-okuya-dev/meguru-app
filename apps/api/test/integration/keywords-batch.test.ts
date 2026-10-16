// キーワードの案（specs/014-strategy-guidance FR-090・FR-092・FR-094、contracts/api.md）。
import { neon } from "@neondatabase/serverless";
import { beforeEach, describe, expect, it } from "vitest";
import { call, createUserWithAccount, endTrial, makeApp, resetDb, testEnv } from "../helpers/app";
import { callBilling } from "../helpers/billing";
import { activityRows, putInTeam } from "../helpers/team";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
});

const base = (accountId: string) => `/api/accounts/${accountId}/research-keywords`;
type ErrorBody = { error: { code: string; details?: unknown; remaining?: number } };

async function keywords(accountId: string) {
  const rows = (await neon(testEnv.DATABASE_URL)`
    SELECT keyword, purpose FROM research_keywords WHERE account_id = ${accountId} ORDER BY keyword`) as {
    keyword: string;
    purpose: string | null;
  }[];
  return rows;
}

async function fill(accountId: string, n: number) {
  await neon(testEnv.DATABASE_URL)`
    INSERT INTO research_keywords (account_id, keyword, keyword_normalized)
    SELECT ${accountId}, 'k' || g, 'k' || g FROM generate_series(1, ${n}) g`;
}

describe("GET /research-keywords/idea-prompt", () => {
  it("課題の入力のあるものと、出す形が入る", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await neon(testEnv.DATABASE_URL)`
      INSERT INTO strategy_designs (account_id, target_persona) VALUES (${accountId}, '上京したばかりの20代')`;
    const res = await call(app, "GET", `${base(accountId)}/idea-prompt`, { user: "u1" });
    expect(res.status).toBe(200);
    const { prompt } = (await res.json()) as { prompt: string };
    expect(prompt).toContain("- 届けたい人: 上京したばかりの20代");
    expect(prompt).toContain("「キーワード｜狙い」");
  });
});

describe("POST /research-keywords/batch", () => {
  it("まとめて登録し 201。操作の記録は1件（件数つき）", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await putInTeam(accountId, "u1", { admin: "a1" });
    const res = await call(app, "POST", `${base(accountId)}/batch`, {
      user: "u1",
      body: { items: [{ keyword: "上京 さみしい", purpose: "孤独の声" }, { keyword: "東京 友達" }] },
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { items: { keyword: string }[] }).items.map((i) => i.keyword)).toEqual([
      "上京 さみしい",
      "東京 友達",
    ]);
    expect(await keywords(accountId)).toEqual([
      { keyword: "上京 さみしい", purpose: "孤独の声" },
      { keyword: "東京 友達", purpose: null },
    ]);
    const rows = (await activityRows(accountId)).filter((r) => r.action === "research_keywords_added");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.summary).toContain("2件");
  });

  it("21件・一覧の中で重なる（正規化して同じ）なら 400 で、1件も入れない", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const many = await call(app, "POST", `${base(accountId)}/batch`, {
      user: "u1",
      body: { items: Array.from({ length: 21 }, (_, i) => ({ keyword: `k${i}` })) },
    });
    expect(many.status).toBe(400);
    const dup = await call(app, "POST", `${base(accountId)}/batch`, {
      user: "u1",
      body: { items: [{ keyword: "ＴＯＫＹＯ" }, { keyword: "tokyo" }] },
    });
    expect(dup.status).toBe(400);
    expect(await keywords(accountId)).toEqual([]);
  });

  it("登録済みと重なれば 409 KEYWORD_DUPLICATE と重なった言葉。1件も入れない", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await call(app, "POST", base(accountId), { user: "u1", body: { keyword: "Tokyo" } });
    const res = await call(app, "POST", `${base(accountId)}/batch`, {
      user: "u1",
      body: { items: [{ keyword: "新しい言葉" }, { keyword: "ｔｏｋｙｏ" }] },
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe("KEYWORD_DUPLICATE");
    expect(body.error.details).toEqual(["ｔｏｋｙｏ"]);
    expect((await keywords(accountId)).map((k) => k.keyword)).toEqual(["Tokyo"]);
  });

  it("上限100を超えるなら 0件で 409 ITEM_LIMIT_REACHED と、あと何件か", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await fill(accountId, 99);
    const res = await call(app, "POST", `${base(accountId)}/batch`, {
      user: "u1",
      body: { items: [{ keyword: "a" }, { keyword: "b" }] },
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorBody).error).toMatchObject({ code: "ITEM_LIMIT_REACHED", remaining: 1 });
    expect(await keywords(accountId)).toHaveLength(99);
  });

  it("見せてもらっている人は 403、読むだけのオーナーは BILLING_REQUIRED", async () => {
    const { userId, accountId } = await createUserWithAccount("o1");
    await putInTeam(accountId, "o1", { admin: "a1", shared: true });
    expect((await call(app, "GET", `${base(accountId)}/idea-prompt`, { user: "a1" })).status).toBe(403);
    expect(
      (await call(app, "POST", `${base(accountId)}/batch`, { user: "a1", body: { items: [{ keyword: "a" }] } })).status,
    ).toBe(403);
    await endTrial(userId);
    const ro = await callBilling(app, "POST", `${base(accountId)}/batch`, { user: "o1", body: { items: [{ keyword: "a" }] } });
    expect(ro.status).toBe(403);
    expect(((await ro.json()) as ErrorBody).error.code).toBe("BILLING_REQUIRED");
  });
});
