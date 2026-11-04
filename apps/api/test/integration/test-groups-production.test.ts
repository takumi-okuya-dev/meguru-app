// 本番（招待制がOFF）でのグループ（specs/019-feature-switches FR-017・FR-019、research.md R11）。
// 運営者はグループを作れ、招待から参加できる。参加しても料金なしの印は付かず、グループに入っていない人も今までどおり使える。
import { beforeEach, describe, expect, it } from "vitest";
import { call, makeApp, resetDb } from "../helpers/app";
import { callOp, FEATURE_OPERATOR } from "../helpers/features";
import { userRow } from "../helpers/test-groups";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
});

const json = async (res: Response) => (await res.json()) as Record<string, unknown>;

async function createGroup(name = "飲食の会") {
  const res = await callOp(app, "POST", "/api/operator/test-groups", { user: FEATURE_OPERATOR, body: { name, capacity: 10 } });
  expect(res.status).toBe(200);
  const g = (await res.json()) as { id: string; inviteUrl: string };
  return { id: g.id, token: g.inviteUrl.split("/test-invite/")[1]! };
}

describe("招待制がOFFの環境のグループ", () => {
  it("運営者はグループを作れ、一覧を見られる", async () => {
    await createGroup();
    const list = (await json(await callOp(app, "GET", "/api/operator/test-groups", { user: FEATURE_OPERATOR }))) as { groups: { name: string }[] };
    expect(list.groups.map((g) => g.name)).toEqual(["飲食の会"]);
  });

  it("招待の確認は testVersion: false。参加でき、料金なしの印は付かない", async () => {
    const { token } = await createGroup();
    await call(app, "GET", "/api/me", { user: "u1" });
    const preview = await json(await call(app, "GET", `/api/test-invites/${token}`, { user: "u1" }));
    expect(preview).toMatchObject({ testVersion: false, viewer: { state: "can_join" } });
    const join = await call(app, "POST", `/api/test-invites/${token}/join`, { user: "u1" });
    expect(join.status).toBe(200);
    expect((await userRow("u1"))!.billing_exempt).toBe(false);
  });

  it("グループに入っていない人も、今までどおり使える", async () => {
    await createGroup();
    const res = await call(app, "GET", "/api/me/needs-review-counts", { user: "outsider" });
    expect(res.status).toBe(200);
  });
});
