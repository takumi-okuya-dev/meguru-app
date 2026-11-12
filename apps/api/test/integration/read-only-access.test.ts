// 読むだけの権限（specs/013-billing FR-040・FR-042、SC-003、research.md R2）。決済ONで確かめる。
// オーナーが読むだけなら、オーナー・担当の人・見せてもらっている人のだれでも、読む・見る・記録・削除だけができる。
import { beforeEach, describe, expect, it } from "vitest";
import { call, createUserWithAccount, endTrial, insertSubscription, makeApp, resetDb, setBillingExempt } from "../helpers/app";
import { billingEnv, callBilling } from "../helpers/billing";
import { putInTeam } from "../helpers/team";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
});

type Setup = { ownerUserId: string; accountId: string };

/** オーナー o1 のアカウントを、担当の編集者 e1・見せてもらっている管理者 a1 のいるチームに入れる。 */
async function setup(): Promise<Setup> {
  const { userId, accountId } = await createUserWithAccount("o1");
  await putInTeam(accountId, "o1", { admin: "a1", editor: "e1", shared: true });
  return { ownerUserId: userId, accountId };
}

const base = (id: string) => `/api/threads/accounts/${id}`;

/** 読む・見る・記録（読むだけでも通る） */
const READS: [string, (id: string) => string][] = [
  ["GET", (id) => `${base(id)}`],
  ["GET", (id) => `${base(id)}/post-drafts`],
  ["GET", (id) => `${base(id)}/strategy`],
  ["GET", (id) => `${base(id)}/promotions`],
  ["GET", (id) => `${base(id)}/reference-posts`],
  ["GET", (id) => `${base(id)}/research-keywords`],
];
const VIEWS: [string, (id: string) => string][] = [
  ["GET", (id) => `${base(id)}/performance`],
  ["GET", (id) => `${base(id)}/performance/export?kind=posts`],
  ["GET", (id) => `${base(id)}/posting-rules`],
  ["GET", (id) => `${base(id)}/posting-schedule`],
  ["GET", (id) => `${base(id)}/prompt`],
  ["GET", (id) => `${base(id)}/profile-status`],
];

/** 書き込み（読むだけなら 403 BILLING_REQUIRED）。権限ごと */
const CONTENT_WRITES: [string, (id: string) => string, unknown][] = [
  ["POST", (id) => `${base(id)}/draft-batches`, { clientRequestId: crypto.randomUUID(), text: "案" }],
  ["PUT", (id) => `${base(id)}/strategy`, { expectedVersion: 0 }],
  ["POST", (id) => `${base(id)}/reference-posts`, { body: "x" }],
  ["POST", (id) => `${base(id)}/research-keywords`, { keyword: "x" }],
];
const OWNER_ONLY_WRITES: [string, (id: string) => string, unknown][] = [
  ["POST", (id) => `${base(id)}/post-drafts/review`, { action: "approve", ids: [] }],
  ["POST", (id) => `${base(id)}/ng-words`, { words: ["x"] }],
  ["PUT", (id) => `${base(id)}/core-rules`, { coreRules: "x", expectedVersion: 1 }],
  ["PUT", (id) => `${base(id)}/posting-schedule`, { enabled: false }],
  ["POST", (id) => `${base(id)}/threads-check`, undefined],
  ["PATCH", (id) => `${base(id)}`, { name: "新しい名前" }],
];

async function codeOf(res: Response) {
  return ((await res.clone().json().catch(() => ({}))) as { error?: { code: string; details?: string[] } }).error;
}

describe("オーナーが読むだけ（無料体験の後で契約なし）", () => {
  it("オーナー：読む・見る・記録は200。書き込みはすべて 403 BILLING_REQUIRED（trial_ended）。アカウントの削除はできる", async () => {
    const { ownerUserId, accountId } = await setup();
    await endTrial(ownerUserId);
    for (const [method, path] of [...READS, ...VIEWS, ["GET", (id: string) => `${base(id)}/activity`] as const]) {
      const res = await callBilling(app, method, path(accountId), { user: "o1" });
      expect(res.status, `${method} ${path(accountId)}`).toBe(200);
    }
    for (const [method, path, body] of [...CONTENT_WRITES, ...OWNER_ONLY_WRITES]) {
      const res = await callBilling(app, method, path(accountId), { user: "o1", body });
      expect(res.status, `${method} ${path(accountId)}`).toBe(403);
      expect(await codeOf(res), `${method} ${path(accountId)}`).toMatchObject({ code: "BILLING_REQUIRED", details: ["trial_ended"] });
    }
    // Threadsとの接続も始められない（spec US3-7）
    const connect = await callBilling(app, "POST", "/api/threads/connect", { user: "o1", body: { mode: "reconnect", accountId } });
    expect(await codeOf(connect)).toMatchObject({ code: "BILLING_REQUIRED" });
    // 画面の出し分け：読むだけの理由と、残る権限
    const access = (await (await callBilling(app, "GET", `${base(accountId)}/access`, { user: "o1" })).json()) as {
      permissions: string[];
      readOnly: { reason: string } | null;
    };
    expect(access.readOnly).toEqual({ reason: "trial_ended" });
    expect(access.permissions.sort()).toEqual(["activity", "read", "remove", "view"]);
    // 削除はできる（FR-042）
    const name = ((await (await callBilling(app, "GET", base(accountId), { user: "o1" })).json()) as { name: string }).name;
    const del = await callBilling(app, "DELETE", base(accountId), { user: "o1", body: { confirmName: name } });
    expect(del.status).toBe(204);
  });

  it("担当の人・見せてもらっている人も読むだけ。理由は owner_inactive だけを返す", async () => {
    const { ownerUserId, accountId } = await setup();
    await endTrial(ownerUserId);
    // 担当の編集者：読む・見るは通り、作る・直すは止まる
    for (const [method, path] of READS) {
      expect((await callBilling(app, method, path(accountId), { user: "e1" })).status, `e1 ${path(accountId)}`).toBe(200);
    }
    for (const [method, path, body] of CONTENT_WRITES) {
      const res = await callBilling(app, method, path(accountId), { user: "e1", body });
      expect(res.status, `e1 ${method} ${path(accountId)}`).toBe(403);
      expect(await codeOf(res)).toMatchObject({ code: "BILLING_REQUIRED", details: ["owner_inactive"] });
    }
    // 見せてもらっている人（管理者 a1）：読むは通る
    for (const [method, path] of READS.slice(1)) {
      expect((await callBilling(app, method, path(accountId), { user: "a1" })).status, `a1 ${path(accountId)}`).toBe(200);
    }
    const access = (await (await callBilling(app, "GET", `${base(accountId)}/access`, { user: "e1" })).json()) as {
      readOnly: { reason: string } | null;
    };
    expect(access.readOnly).toEqual({ reason: "owner_inactive" });
    // 関わりで足りない権限は、今までどおり ROLE_FORBIDDEN
    const review = await callBilling(app, "POST", `${base(accountId)}/post-drafts/review`, { user: "e1", body: { action: "approve", ids: [] } });
    expect(await codeOf(review)).toMatchObject({ code: "ROLE_FORBIDDEN" });
  });

  it("担当の人が読むだけでも、オーナーがすべて使えるアカウントでは作る・直すができる（料金はオーナーが払う）", async () => {
    const { accountId } = await setup();
    const { userId: editorUserId } = (await createUserWithAccount("e1")) as { userId: string };
    await endTrial(editorUserId);
    const res = await callBilling(app, "PUT", `${base(accountId)}/strategy`, { user: "e1", body: { expectedVersion: 0 } });
    expect((await codeOf(res))?.code).not.toBe("BILLING_REQUIRED");
  });
});

describe("状態ごとの結果（research.md R1）", () => {
  const write = (accountId: string, env?: ReturnType<typeof billingEnv>) =>
    call(app, "POST", `/api/threads/accounts/${accountId}/research-keywords`, { user: "o1", body: { keyword: crypto.randomUUID() }, env: env ?? billingEnv() });

  it.each([
    ["trialing", false, 201],
    ["active", false, 201],
    ["active", true, 201],
    ["past_due", false, 403],
    ["unpaid", false, 403],
    ["canceled", false, 403],
  ] as const)("契約が %s（解約の予約 %s）なら %d", async (status, cancelAtPeriodEnd, expected) => {
    const { userId, accountId } = await createUserWithAccount("o1");
    await endTrial(userId);
    await insertSubscription(userId, { status, cancelAtPeriodEnd });
    const res = await write(accountId);
    expect(res.status).toBe(expected);
    if (expected === 403) {
      const reason = status === "canceled" ? "canceled" : "payment_failed";
      expect(await codeOf(res)).toMatchObject({ code: "BILLING_REQUIRED", details: [reason] });
    }
  });

  it("支払いの失敗は無料体験中でも読むだけ", async () => {
    const { userId, accountId } = await createUserWithAccount("o1");
    await insertSubscription(userId, { status: "past_due" });
    expect((await write(accountId)).status).toBe(403);
  });

  it("料金なしの印・決済OFFなら、無料体験の後でもすべて使える", async () => {
    const { userId, accountId } = await createUserWithAccount("o1");
    await endTrial(userId);
    expect((await write(accountId)).status).toBe(403);
    expect((await write(accountId, billingEnv({ BILLING_ENABLED: "false" }))).status).toBe(201);
    await setBillingExempt(userId, true);
    expect((await write(accountId)).status).toBe(201);
  });
});
