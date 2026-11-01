// テスト版に入れない人の止め方（specs/016-test-groups FR-006・FR-007・FR-015・FR-016、research.md R2・R5、T009）
import { beforeEach, describe, expect, it } from "vitest";
import { call, makeApp, resetDb } from "../helpers/app";
import { OPERATOR, callOn, createGroup, join, makeClosedSignup, userRow } from "../helpers/test-groups";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
});

const BLOCKED = [
  ["POST", "/api/accounts"],
  ["GET", "/api/billing"],
  ["GET", "/api/me/needs-review-counts"],
  ["GET", "/api/invites/t_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
  ["POST", "/api/teams"],
] as const;

async function codeOf(res: Response) {
  return ((await res.json()) as { error?: { code: string } }).error?.code;
}

describe("新しく作る利用者の印（research.md R2）", () => {
  it("ONの間に登録した人は signed_up_open = false、OFFの間は true", async () => {
    await callOn(app, "GET", "/api/me", { user: "on_user" });
    await call(app, "GET", "/api/me", { user: "off_user" });
    expect((await userRow("on_user"))!.signed_up_open).toBe(false);
    expect((await userRow("off_user"))!.signed_up_open).toBe(true);
  });
});

describe("入れない人", () => {
  it("/api/me は通り、testGroups で入れないことがわかる", async () => {
    const res = await callOn(app, "GET", "/api/me", { user: "stranger" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { testGroups: unknown }).testGroups).toEqual({ enabled: true, admitted: false, operator: false });
  });

  it("退会のプレビューは通る（自分で退会できる）", async () => {
    expect((await callOn(app, "GET", "/api/me/withdrawal-preview", { user: "stranger" })).status).toBe(200);
  });

  it.each(BLOCKED)("%s %s は 403 TEST_ACCESS_REQUIRED（画面だけに頼らない。SC-001）", async (method, path) => {
    const res = await callOn(app, method, path, { user: "stranger", body: method === "GET" ? undefined : { name: "x" } });
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe("TEST_ACCESS_REQUIRED");
  });

  it("招待の確認は通る", async () => {
    const { token } = await createGroup(app);
    expect((await callOn(app, "GET", `/api/test-invites/${token}`, { user: "stranger" })).status).toBe(200);
  });
});

describe("入れる人", () => {
  it("前からいた人（signed_up_open）は、グループに入っていなくても通る（FR-007・SC-005）", async () => {
    await call(app, "GET", "/api/me", { user: "old" });
    const res = await callOn(app, "GET", "/api/me/needs-review-counts", { user: "old" });
    expect(res.status).toBe(200);
  });

  it("グループに入った人は通る", async () => {
    const { token } = await createGroup(app);
    await callOn(app, "GET", "/api/me", { user: "member" });
    expect((await join(app, "member", token)).status).toBe(200);
    expect((await callOn(app, "GET", "/api/me/needs-review-counts", { user: "member" })).status).toBe(200);
    const me = (await (await callOn(app, "GET", "/api/me", { user: "member" })).json()) as { testGroups: unknown };
    expect(me.testGroups).toEqual({ enabled: true, admitted: true, operator: false });
  });

  it("グループの人は、アカウントを作って開ける（権限の判定がオーナーの入れる・入れないを読む。research.md R4）", async () => {
    const { token } = await createGroup(app);
    await callOn(app, "GET", "/api/me", { user: "member" });
    await join(app, "member", token);
    const created = await callOn(app, "POST", "/api/accounts", { user: "member", body: { name: "カフェ" } });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const access = await callOn(app, "GET", `/api/accounts/${id}/access`, { user: "member" });
    expect(access.status).toBe(200);
    expect(((await access.json()) as { readOnly: unknown }).readOnly).toBeNull();
  });

  it("運営者は、ONの間に登録しても通る", async () => {
    await callOn(app, "GET", "/api/me", { user: OPERATOR });
    expect((await userRow(OPERATOR))!.signed_up_open).toBe(false);
    const me = (await (await callOn(app, "GET", "/api/me", { user: OPERATOR })).json()) as {
      testGroups: unknown;
      billing: { readOnlyReason: unknown };
    };
    expect(me.testGroups).toEqual({ enabled: true, admitted: true, operator: true });
    // 通るだけでなく、読むだけにもならない（料金の判定でも運営者を入れる人として扱う）
    expect(me.billing.readOnlyReason).toBeNull();
  });

  it("閉じたグループの人は、通らなくなる", async () => {
    const { id, token } = await createGroup(app);
    await callOn(app, "GET", "/api/me", { user: "member" });
    await join(app, "member", token);
    await callOn(app, "POST", `/api/operator/test-groups/${id}/close`, { user: OPERATOR });
    const res = await callOn(app, "GET", "/api/me/needs-review-counts", { user: "member" });
    expect(await codeOf(res)).toBe("TEST_ACCESS_REQUIRED");
  });
});

describe("OFFの環境（FR-015・SC-006）", () => {
  it("ONの間に登録した人でも、OFFなら誰も止まらない", async () => {
    await callOn(app, "GET", "/api/me", { user: "on_user" });
    await makeClosedSignup("on_user");
    const res = await call(app, "GET", "/api/me/needs-review-counts", { user: "on_user" });
    expect(res.status).toBe(200);
    const me = (await (await call(app, "GET", "/api/me", { user: "on_user" })).json()) as { testGroups: unknown };
    expect(me.testGroups).toEqual({ enabled: false, admitted: true, operator: false });
  });

  it("招待の確認・運営者のAPIは、ないのと同じ", async () => {
    const res = await call(app, "GET", "/api/test-invites/g_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", { user: "x" });
    expect(res.status).toBe(404);
    expect(await codeOf(res)).toBe("TEST_INVITE_INVALID");
    expect((await call(app, "GET", "/api/operator/test-groups", { user: OPERATOR })).status).toBe(404);
  });
});
