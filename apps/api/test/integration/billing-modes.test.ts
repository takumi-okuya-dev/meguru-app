// 決済のON/OFFと料金なしの印（specs/013-billing FR-060〜FR-062、SC-008、T053・T054）
import { beforeEach, describe, expect, it } from "vitest";
import { subscriptions } from "../../src/db/schema";
import { setBillingExemptByEmail } from "../../src/services/billing-service";
import { call, createUserWithAccount, db, endTrial, insertSubscription, makeApp, resetDb, testEnv } from "../helpers/app";
import { callBilling } from "../helpers/billing";

const app = makeApp();

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
    expect(await setBillingExemptByEmail(d, "U1@example.com", true)).toEqual({ kind: "updated", email: "u1@example.com", before: false, after: true });
    expect((await callBilling(app, "POST", "/api/accounts", { user: "u1", body: { name: "2" } })).status).toBe(201);
    expect((await callBilling(app, "POST", "/api/accounts", { user: "u1", body: { name: "3" } })).status).toBe(201);
    const write = () => callBilling(app, "POST", `/api/accounts/${accountId}/research-keywords`, { user: "u1", body: { keyword: crypto.randomUUID() } });
    expect((await write()).status).toBe(201);
    await setBillingExemptByEmail(d, "u1@example.com", false);
    expect((await write()).status).toBe(403);
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
