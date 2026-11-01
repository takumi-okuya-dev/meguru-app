// 運営者のAPI（specs/016-test-groups US2、FR-009〜FR-011・FR-013、T020）
import { beforeEach, describe, expect, it } from "vitest";
import { neon } from "@neondatabase/serverless";
import { call, makeApp, resetDb, testEnv } from "../helpers/app";
import { OPERATOR, callOn, createGroup, join, userRow } from "../helpers/test-groups";
import { setBillingExemptByEmail } from "../../src/services/billing-service";
import { db } from "../helpers/app";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
});

const op = (method: string, path: string, body?: unknown) => callOn(app, method, path, { user: OPERATOR, body });
const json = async (res: Response) => (await res.json()) as Record<string, unknown> & { error?: { code: string } };

async function signIn(user: string) {
  await callOn(app, "GET", "/api/me", { user });
}

async function detail(id: string) {
  return json(await op("GET", `/api/operator/test-groups/${id}`));
}

describe("運営者だけ", () => {
  it("運営者でない人は 403 OPERATOR_ONLY", async () => {
    await call(app, "GET", "/api/me", { user: "old" }); // 前からいる人（入れる人）
    const res = await callOn(app, "GET", "/api/operator/test-groups", { user: "old" });
    expect(res.status).toBe(403);
    expect((await json(res)).error?.code).toBe("OPERATOR_ONLY");
  });

  it("OFFの環境では 404", async () => {
    expect((await call(app, "GET", "/api/operator/test-groups", { user: OPERATOR })).status).toBe(404);
  });
});

describe("作る・一覧", () => {
  it("名前と上限で作り、一覧に人数とリンクが出る。閉じたものは後ろで、リンクは null", async () => {
    const a = await createGroup(app, "A会", 3);
    const b = await createGroup(app, "B会", 5);
    await signIn("u1");
    await join(app, "u1", a.token);
    await op("POST", `/api/operator/test-groups/${b.id}/close`);
    const { groups } = (await json(await op("GET", "/api/operator/test-groups"))) as unknown as {
      groups: { name: string; memberCount: number; capacity: number; inviteUrl: string | null; closedAt: string | null }[];
    };
    expect(groups.map((g) => [g.name, g.memberCount, g.capacity, g.inviteUrl !== null, g.closedAt !== null])).toEqual([
      ["A会", 1, 3, true, false],
      ["B会", 0, 5, false, true],
    ]);
    expect(groups[0]!.inviteUrl).toBe(`${testEnv.WEB_ORIGIN}/test-invite/${a.token}`);
  });

  it.each([
    [{ name: "", capacity: 3 }, "VALIDATION_FAILED"],
    [{ name: "会", capacity: 0 }, "TEST_GROUP_CAPACITY_INVALID"],
    [{ name: "会", capacity: 1001 }, "TEST_GROUP_CAPACITY_INVALID"],
  ])("入力の誤り %j は %s", async (body, code) => {
    const res = await op("POST", "/api/operator/test-groups", body);
    expect(res.status).toBe(400);
    expect((await json(res)).error?.code).toBe(code);
  });
});

describe("名前と上限を変える", () => {
  it("上限を今の人数より少なくしても人は外れず、新しい人は入れない。上限を上げると入れる", async () => {
    const { id, token } = await createGroup(app, "会", 3);
    for (const u of ["u1", "u2"]) {
      await signIn(u);
      await join(app, u, token);
    }
    const lowered = await json(await op("PATCH", `/api/operator/test-groups/${id}`, { capacity: 1 }));
    expect(lowered).toMatchObject({ capacity: 1, memberCount: 2 });
    await signIn("u3");
    expect((await join(app, "u3", token)).status).toBe(409);
    await op("PATCH", `/api/operator/test-groups/${id}`, { capacity: 3, name: "新しい会" });
    expect((await join(app, "u3", token)).status).toBe(200);
    const d = await detail(id);
    expect(d.name).toBe("新しい会");
    expect((d.events as { action: string }[]).map((e) => e.action)).toEqual(
      expect.arrayContaining(["capacity_changed", "renamed", "created", "member_joined"]),
    );
  });
});

describe("外す・閉じる", () => {
  it("外すと入れない人になり、グループで付けた印が外れる。記録が残る", async () => {
    const { id, token } = await createGroup(app);
    await signIn("u1");
    await join(app, "u1", token);
    const u1 = (await userRow("u1"))!;
    const d = await json(await op("DELETE", `/api/operator/test-groups/${id}/members/${u1.id}`));
    expect(d.memberCount).toBe(0);
    expect((await userRow("u1"))!.billing_exempt).toBe(false);
    expect((await callOn(app, "GET", "/api/me/needs-review-counts", { user: "u1" })).status).toBe(403);
    expect((d.events as { action: string; subjectName: string | null }[])[0]).toMatchObject({ action: "member_removed", subjectName: "u1" });
  });

  it("手で付けた料金なしの印は、グループを出ても残る（research.md R7）", async () => {
    const { id, token } = await createGroup(app);
    await signIn("u1");
    await join(app, "u1", token);
    await setBillingExemptByEmail(db(), "u1@example.com", true, true);
    const u1 = (await userRow("u1"))!;
    await op("DELETE", `/api/operator/test-groups/${id}/members/${u1.id}`);
    expect((await userRow("u1"))!.billing_exempt).toBe(true);
  });

  it("入っていない人を外そうとすると 404", async () => {
    const { id } = await createGroup(app);
    await signIn("u1");
    const res = await op("DELETE", `/api/operator/test-groups/${id}/members/${(await userRow("u1"))!.id}`);
    expect(res.status).toBe(404);
  });

  it("閉じると全員が外れ、印が戻り、閉じたグループは変えられない。閉じた人は別のグループに入れる", async () => {
    const a = await createGroup(app, "A会");
    await signIn("u1");
    await join(app, "u1", a.token);
    const closed = await json(await op("POST", `/api/operator/test-groups/${a.id}/close`));
    expect(closed).toMatchObject({ memberCount: 0, inviteUrl: null });
    expect((await userRow("u1"))!.billing_exempt).toBe(false);
    for (const [method, path, body] of [
      ["PATCH", `/api/operator/test-groups/${a.id}`, { capacity: 5 }],
      ["POST", `/api/operator/test-groups/${a.id}/rotate-invite`, undefined],
      ["POST", `/api/operator/test-groups/${a.id}/close`, undefined],
    ] as const) {
      const res = await op(method, path, body);
      expect(res.status).toBe(409);
      expect((await json(res)).error?.code).toBe("TEST_GROUP_CLOSED");
    }
    const b = await createGroup(app, "B会");
    expect((await join(app, "u1", b.token)).status).toBe(200);
  });

  it("退会した人は、グループの人数から外れる", async () => {
    const { id, token } = await createGroup(app);
    await signIn("u1");
    await join(app, "u1", token);
    await neon(testEnv.DATABASE_URL)`DELETE FROM users WHERE clerk_user_id = 'u1'`;
    expect((await detail(id)).memberCount).toBe(0);
  });

  it("見つからないグループは 404", async () => {
    expect((await op("GET", "/api/operator/test-groups/00000000-0000-0000-0000-000000000000")).status).toBe(404);
    expect((await op("GET", "/api/operator/test-groups/nope")).status).toBe(404);
  });
});
