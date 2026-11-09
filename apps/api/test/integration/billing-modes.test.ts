// 決済のON/OFFと料金なしの印（specs/013-billing FR-060〜FR-062、SC-008、T053・T054）
import { neon } from "@neondatabase/serverless";
import { beforeEach, describe, expect, it } from "vitest";
import { subscriptions } from "../../src/db/schema";
import { setBillingExemptByEmail } from "../../src/platform/billing/billing-service";
import { call, createUserWithAccount, db, endTrial, insertSubscription, makeApp, resetDb, testEnv } from "../helpers/app";
import { callBilling } from "../helpers/billing";

const app = makeApp();
const sql = () => neon(testEnv.DATABASE_URL);

beforeEach(async () => {
  await resetDb();
});

describe("決済OFF", () => {
  it("GET /api/billing は disabled、ほかの決済のAPIとWebhookは404。無料体験の後でも上限なくすべて使え、契約の行は消えない", async () => {
    const { userId, accountId } = await createUserWithAccount("u1");
    await endTrial(userId);
    await insertSubscription(userId, { status: "canceled" });
    expect(((await (await call(app, "GET", "/api/billing", { user: "u1" })).json()) as { mode: string }).mode).toBe("disabled");
    for (const path of ["/api/billing/checkout", "/api/billing/sync", "/api/billing/portal"]) {
      expect((await call(app, "POST", path, { user: "u1" })).status, path).toBe(404);
    }
    expect((await app.request("/api/stripe/webhook", { method: "POST", body: "{}" }, testEnv)).status).toBe(404);
    expect((await call(app, "POST", `/api/accounts/${accountId}/research-keywords`, { user: "u1", body: { keyword: "x" } })).status).toBe(201);
    expect((await call(app, "POST", "/api/accounts", { user: "u1", body: { name: "2" } })).status).toBe(201);
    expect(await db().select().from(subscriptions)).toHaveLength(1);
  });
});

describe("料金なしの印（決済ON）", () => {
  it("付けると契約なしで3件作れ、無料体験の後もすべて使える。外すと読むだけに戻る", async () => {
    const { userId, accountId } = await createUserWithAccount("u1");
    await endTrial(userId);
    const d = db();
    expect(await setBillingExemptByEmail(d, "U1@example.com", true)).toMatchObject({
      kind: "updated",
      email: "u1@example.com",
      before: false,
      after: true,
      // どの行を変えたかを出せるようにする（セキュリティ監査 run-1）
      id: userId,
      clerkUserId: "u1",
    });
    expect((await callBilling(app, "POST", "/api/accounts", { user: "u1", body: { name: "2" } })).status).toBe(201);
    expect((await callBilling(app, "POST", "/api/accounts", { user: "u1", body: { name: "3" } })).status).toBe(201);
    const write = () => callBilling(app, "POST", `/api/accounts/${accountId}/research-keywords`, { user: "u1", body: { keyword: crypto.randomUUID() } });
    expect((await write()).status).toBe(201);
    await setBillingExemptByEmail(d, "u1@example.com", false);
    expect((await write()).status).toBe(403);
  });

  // users.email には一意制約もインデックスも無く、Clerk の user.updated の Webhook も無いので、
  // 本人が手放したアドレスが行に残り、後からそのアドレスを取った別人の行と重なりうる。
  // そのとき「どちらに書いたか」を当時も後からも区別できないのが問題だった（セキュリティ監査 run-1）
  it("同じアドレスの行が2つあれば、何も書かずに止める", async () => {
    const d = db();
    const { userId } = await createUserWithAccount("u1");
    const raw = sql();
    // 同じ lower(email) を持つ2行目（clerk_user_id は別）
    const [other] = (await raw`
      INSERT INTO users (clerk_user_id, email, display_name)
      VALUES ('u1-dup', 'U1@Example.com', 'dup') RETURNING id`) as [{ id: string }];
    const result = await setBillingExemptByEmail(d, "u1@example.com", true);
    expect(result).toMatchObject({ kind: "ambiguous", count: 2 });
    // どちらにも印は付いていない
    const rows = (await raw`SELECT billing_exempt FROM users WHERE id IN (${userId}, ${other.id})`) as {
      billing_exempt: boolean;
    }[];
    expect(rows.map((r) => r.billing_exempt)).toEqual([false, false]);
  });

  it("空白だけのアドレスでは探さない（空文字列の行に当たらないように）", async () => {
    const d = db();
    await createUserWithAccount("u1");
    expect(await setBillingExemptByEmail(d, "   ", true)).toEqual({ kind: "not_found" });
  });

  it("終わっていない契約があれば止め、--force なら付ける。見つからなければ not_found", async () => {
    const d = db();
    const { userId } = await createUserWithAccount("u1");
    await insertSubscription(userId, { status: "active" });
    expect(await setBillingExemptByEmail(d, "u1@example.com", true)).toEqual({ kind: "has_subscription", status: "active" });
    expect((await setBillingExemptByEmail(d, "u1@example.com", true, true)).kind).toBe("updated");
    expect(await setBillingExemptByEmail(d, "nobody@example.com", true)).toEqual({ kind: "not_found" });
  });
});
