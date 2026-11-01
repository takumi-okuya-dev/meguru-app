// グループの招待の確認と参加（specs/016-test-groups US1、FR-003〜FR-005・FR-008、research.md R3・R7、T010）
import { beforeEach, describe, expect, it } from "vitest";
import { makeApp, resetDb, setBillingExempt } from "../helpers/app";
import { OPERATOR, callOn, createGroup, join, userRow } from "../helpers/test-groups";
import { neon } from "@neondatabase/serverless";
import { testEnv } from "../helpers/app";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
});

async function preview(token: string, user?: string) {
  const res = await callOn(app, "GET", `/api/test-invites/${token}`, { user });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function signIn(user: string) {
  await callOn(app, "GET", "/api/me", { user });
}

async function events(groupId: string) {
  return (await neon(testEnv.DATABASE_URL)`
    SELECT action, subject_name FROM test_group_events WHERE group_id = ${groupId} ORDER BY created_at`) as {
    action: string;
    subject_name: string | null;
  }[];
}

describe("招待の確認", () => {
  it("ログインしていなければ、グループ名と定員かだけを返す", async () => {
    const { token } = await createGroup(app, "飲食の会", 2);
    expect(await preview(token)).toEqual({ status: 200, body: { group: { name: "飲食の会" }, full: false, viewer: null } });
  });

  it("ログインしていれば、参加できるか・定員か・すでに入っているかを返す", async () => {
    const a = await createGroup(app, "A会", 1);
    const b = await createGroup(app, "B会", 5);
    await signIn("u1");
    expect((await preview(a.token, "u1")).body.viewer).toEqual({ state: "can_join" });
    await join(app, "u1", a.token);
    await signIn("u2");
    expect((await preview(a.token, "u2")).body).toMatchObject({ full: true, viewer: { state: "full" } });
    expect((await preview(b.token, "u1")).body.viewer).toEqual({ state: "already_member", groupName: "A会" });
  });

  it.each([
    ["形の違う文字列", "nope"],
    ["見つからない文字列", "g_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
  ])("%s は 404 TEST_INVITE_INVALID", async (_label, token) => {
    const r = await preview(token);
    expect(r.status).toBe(404);
    expect(r.body).toMatchObject({ error: { code: "TEST_INVITE_INVALID" } });
  });

  it("作り直した前の文字列・閉じたグループの文字列は使えない", async () => {
    const a = await createGroup(app);
    await callOn(app, "POST", `/api/operator/test-groups/${a.id}/rotate-invite`, { user: OPERATOR });
    expect((await preview(a.token)).status).toBe(404);
    const b = await createGroup(app);
    await callOn(app, "POST", `/api/operator/test-groups/${b.id}/close`, { user: OPERATOR });
    expect((await preview(b.token)).status).toBe(404);
  });
});

describe("参加する", () => {
  it("入ると料金なしの印が付き、記録が残る", async () => {
    const { id, token } = await createGroup(app);
    await signIn("u1");
    const res = await join(app, "u1", token);
    expect(await res.json()).toEqual({ groupId: id });
    expect((await userRow("u1"))!.billing_exempt).toBe(true);
    const [m] = (await neon(testEnv.DATABASE_URL)`
      SELECT granted_billing_exempt FROM test_group_members WHERE user_id = ${(await userRow("u1"))!.id}`) as [
      { granted_billing_exempt: boolean },
    ];
    expect(m.granted_billing_exempt).toBe(true);
    expect(await events(id)).toContainEqual({ action: "member_joined", subject_name: "u1" });
  });

  it("もともと料金なしの印がある人は、グループで付けたことにしない（research.md R7）", async () => {
    const { token } = await createGroup(app);
    await signIn("u1");
    await setBillingExempt((await userRow("u1"))!.id, true);
    await join(app, "u1", token);
    const [m] = (await neon(testEnv.DATABASE_URL)`
      SELECT granted_billing_exempt FROM test_group_members WHERE user_id = ${(await userRow("u1"))!.id}`) as [
      { granted_billing_exempt: boolean },
    ];
    expect(m.granted_billing_exempt).toBe(false);
  });

  it("定員なら 409 TEST_GROUP_FULL", async () => {
    const { token } = await createGroup(app, "会", 1);
    await signIn("u1");
    await signIn("u2");
    await join(app, "u1", token);
    const res = await join(app, "u2", token);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "TEST_GROUP_FULL" } });
    expect((await userRow("u2"))!.billing_exempt).toBe(false);
  });

  it("すでにどこかのグループに入っていれば 409 TEST_GROUP_ALREADY_MEMBER（グループ名つき）。グループは変わらない", async () => {
    const a = await createGroup(app, "A会");
    const b = await createGroup(app, "B会");
    await signIn("u1");
    await join(app, "u1", a.token);
    const res = await join(app, "u1", b.token);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "TEST_GROUP_ALREADY_MEMBER", details: ["A会"] } });
    expect((await join(app, "u1", a.token)).status).toBe(409);
  });

  it("同時に5人が押しても、上限3を超えない（SC-002）", async () => {
    const { id, token } = await createGroup(app, "会", 3);
    const users = ["c1", "c2", "c3", "c4", "c5"];
    for (const u of users) await signIn(u);
    const results = await Promise.all(users.map((u) => join(app, u, token)));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 200, 200, 409, 409]);
    const [n] = (await neon(testEnv.DATABASE_URL)`SELECT count(*)::int AS n FROM test_group_members WHERE group_id = ${id}`) as [
      { n: number },
    ];
    expect(n.n).toBe(3);
  });

  it("同じ人が2つのグループの「参加する」を同時に押しても、入るのは1つだけ。料金なしの印はグループで付けたものとして残る", async () => {
    const a = await createGroup(app, "A会");
    const b = await createGroup(app, "B会");
    await signIn("u1");
    const results = await Promise.all([join(app, "u1", a.token), join(app, "u1", b.token)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const rows = (await neon(testEnv.DATABASE_URL)`
      SELECT granted_billing_exempt FROM test_group_members WHERE user_id = ${(await userRow("u1"))!.id}`) as {
      granted_billing_exempt: boolean;
    }[];
    expect(rows).toEqual([{ granted_billing_exempt: true }]);
    expect((await userRow("u1"))!.billing_exempt).toBe(true);
  });

  it("ログインしていなければ 401", async () => {
    const { token } = await createGroup(app);
    expect((await callOn(app, "POST", `/api/test-invites/${token}/join`)).status).toBe(401);
  });
});
