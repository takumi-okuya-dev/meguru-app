// 参考投稿のまとめての登録（specs/014-strategy-guidance FR-083・FR-084・FR-094、contracts/api.md）。
import { neon } from "@neondatabase/serverless";
import { beforeEach, describe, expect, it } from "vitest";
import { call, createUserWithAccount, endTrial, makeApp, resetDb, testEnv } from "../helpers/app";
import { callBilling } from "../helpers/billing";
import { activityRows, putInTeam } from "../helpers/team";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
});

const batch = (accountId: string) => `/api/accounts/${accountId}/reference-posts/batch`;
type ErrorBody = { error: { code: string; details?: unknown } };

async function count(accountId: string) {
  const rows = (await neon(testEnv.DATABASE_URL)`SELECT count(*)::int AS n FROM threads.reference_posts WHERE account_id = ${accountId}`) as {
    n: number;
  }[];
  return rows[0]!.n;
}

async function fill(accountId: string, n: number) {
  await neon(testEnv.DATABASE_URL)`INSERT INTO threads.reference_posts (account_id, body) SELECT ${accountId}, '既存' FROM generate_series(1, ${n})`;
}

describe("POST /reference-posts/batch", () => {
  it("送った順に、それぞれの値でまとめて登録し、201 で返す", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const res = await call(app, "POST", batch(accountId), {
      user: "u1",
      body: {
        items: [
          { body: "1件目", postedDateMode: "week", metrics: { views: 100 } },
          { body: "2件目", platform: "x", whyGood: "解説" },
          { body: "3件目" },
        ],
      },
    });
    expect(res.status).toBe(201);
    const items = ((await res.json()) as { items: { body: string; platform: string; metrics: { views: number | null } }[] }).items;
    expect(items.map((i) => i.body)).toEqual(["1件目", "2件目", "3件目"]);
    expect(items[0]!.metrics.views).toBe(100);
    expect(items[1]!.platform).toBe("x");
    expect(await count(accountId)).toBe(3);
  });

  it("1件でも検証に通らなければ、1件も入れず 400（details に位置）", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const res = await call(app, "POST", batch(accountId), {
      user: "u1",
      body: { items: [{ body: "OK" }, { body: "OK" }, { body: "  " }] },
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).error.details).toContain("items.2.body");
    expect(await count(accountId)).toBe(0);
  });

  it("21件は 400", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const res = await call(app, "POST", batch(accountId), {
      user: "u1",
      body: { items: Array.from({ length: 21 }, (_, i) => ({ body: `本文${i}` })) },
    });
    expect(res.status).toBe(400);
  });

  it("上限200を超えるなら 0件で 409 ITEM_LIMIT_REACHED と、あと何件か", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await fill(accountId, 198);
    const res = await call(app, "POST", batch(accountId), {
      user: "u1",
      body: { items: [{ body: "a" }, { body: "b" }, { body: "c" }] },
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorBody).error).toMatchObject({ code: "ITEM_LIMIT_REACHED", remaining: 2 });
    expect(await count(accountId)).toBe(198);
  });

  it("同時の2つの要求でも上限を超えない", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await fill(accountId, 195);
    const send = () =>
      call(app, "POST", batch(accountId), { user: "u1", body: { items: Array.from({ length: 3 }, (_, i) => ({ body: `x${i}` })) } });
    const results = await Promise.all([send(), send()]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await count(accountId)).toBe(198);
  });

  it("チームのアカウントでは、操作の記録が1件（件数つき）", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await putInTeam(accountId, "u1", { admin: "a1" });
    await call(app, "POST", batch(accountId), { user: "u1", body: { items: [{ body: "a" }, { body: "b" }] } });
    const rows = (await activityRows(accountId)).filter((r) => r.action === "reference_posts_added");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.summary).toContain("2件");
  });

  it("見せてもらっている人は 403、読むだけのオーナーは BILLING_REQUIRED", async () => {
    const { userId, accountId } = await createUserWithAccount("o1");
    await putInTeam(accountId, "o1", { admin: "a1", shared: true });
    const viewer = await call(app, "POST", batch(accountId), { user: "a1", body: { items: [{ body: "a" }] } });
    expect(viewer.status).toBe(403);
    await endTrial(userId);
    const ro = await callBilling(app, "POST", batch(accountId), { user: "o1", body: { items: [{ body: "a" }] } });
    expect(ro.status).toBe(403);
    expect(((await ro.json()) as ErrorBody).error.code).toBe("BILLING_REQUIRED");
  });
});
