// 運営者の機能の設定のAPI（specs/019-feature-switches contracts/api.md「運営者のAPI」、FR-002・FR-013・FR-014）。
// 招待制はOFFのまま（本番と同じ形）で、運営者は OPERATOR_CLERK_USER_IDS だけで決める。
import { neon } from "@neondatabase/serverless";
import { beforeEach, describe, expect, it } from "vitest";
import { createUserWithAccount, db, makeApp, resetDb, testEnv } from "../helpers/app";
import { callOp, closeGroupRow, disableFeatures, disableGroupFeatures, FEATURE_OPERATOR, makeGroup } from "../helpers/features";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
  // 運営者の users の行（名前を記録に写す）
  await callOp(app, "GET", "/api/me", { user: FEATURE_OPERATOR });
});

const op = (method: string, path: string, body?: unknown) => callOp(app, method, path, { user: FEATURE_OPERATOR, body });
const json = async (res: Response) => (await res.json()) as Record<string, unknown> & { error?: { code: string } };
const ALL_ON = { autopost: true, strategy: true, team: true };

async function events(subjectUserId: string) {
  db();
  return (await neon(testEnv.DATABASE_URL)`
    SELECT feature, action, actor_name, subject_name FROM feature_setting_events
    WHERE subject_user_id = ${subjectUserId} ORDER BY created_at, feature`) as {
    feature: string;
    action: string;
    actor_name: string;
    subject_name: string;
  }[];
}

describe("運営者だけ", () => {
  it("運営者でない人は、どのAPIも 403 OPERATOR_ONLY", async () => {
    const { userId } = await createUserWithAccount("u1");
    for (const [method, path, body] of [
      ["GET", "/api/operator/users?email=u1@example.com", undefined],
      ["PUT", `/api/operator/feature-settings/${userId}`, { features: ALL_ON }],
    ] as const) {
      const res = await callOp(app, method, path, { user: "u1", body });
      expect(res.status, path).toBe(403);
      expect((await json(res)).error?.code).toBe("OPERATOR_ONLY");
    }
  });

  it("招待制がOFFでも運営者は使え、Cache-Control は no-store", async () => {
    await createUserWithAccount("u1");
    const res = await op("GET", "/api/operator/users?email=u1@example.com");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("GET /api/operator/users?email=", () => {
  it("完全一致で見つかる（前後の空白・大文字小文字を区別しない）。今の設定が disabled に入る", async () => {
    const { userId } = await createUserWithAccount("hanako");
    await disableFeatures(userId, "team", "strategy");
    const body = await json(await op("GET", `/api/operator/users?email=${encodeURIComponent("  HANAKO@Example.com ")}`));
    expect(body).toEqual({ userId, name: "hanako", email: "hanako@example.com", disabled: ["strategy", "team"], group: null });
  });

  it("部分一致では見つからない（404 USER_NOT_FOUND）", async () => {
    await createUserWithAccount("hanako");
    const res = await op("GET", "/api/operator/users?email=hanako");
    expect(res.status).toBe(400);
    const partial = await op("GET", `/api/operator/users?email=${encodeURIComponent("ako@example.com")}`);
    expect(partial.status).toBe(404);
    expect((await json(partial)).error?.code).toBe("USER_NOT_FOUND");
  });

  it("email がない・形が違うと 400 VALIDATION_FAILED", async () => {
    for (const q of ["", "?email=", "?email=abc"]) {
      const res = await op("GET", `/api/operator/users${q}`);
      expect(res.status, q).toBe(400);
      expect((await json(res)).error?.code).toBe("VALIDATION_FAILED");
    }
  });
});

describe("PUT /api/operator/feature-settings/:userId", () => {
  it("OFFにした分だけ行ができ、変わったまとまりごとに記録が1行。同じ値の保存では増えない", async () => {
    const { userId } = await createUserWithAccount("hanako");
    const saved = await json(await op("PUT", `/api/operator/feature-settings/${userId}`, { features: { ...ALL_ON, strategy: false } }));
    expect(saved).toMatchObject({ userId, disabled: ["strategy"] });
    expect(await events(userId)).toEqual([
      { feature: "strategy", action: "disabled", actor_name: (await operator()).name, subject_name: "hanako" },
    ]);

    await op("PUT", `/api/operator/feature-settings/${userId}`, { features: { ...ALL_ON, strategy: false } });
    expect(await events(userId)).toHaveLength(1);

    const back = await json(await op("PUT", `/api/operator/feature-settings/${userId}`, { features: { strategy: true, autopost: false, team: true } }));
    expect(back).toMatchObject({ disabled: ["autopost"] });
    expect((await events(userId)).map((e) => [e.feature, e.action]).sort()).toEqual([
      ["autopost", "disabled"],
      ["strategy", "disabled"],
      ["strategy", "enabled"],
    ]);
  });

  it("人がいなければ 404 USER_NOT_FOUND、3つが揃っていなければ 400", async () => {
    const missing = await op("PUT", "/api/operator/feature-settings/00000000-0000-4000-8000-000000000000", { features: ALL_ON });
    expect(missing.status).toBe(404);
    expect((await json(missing)).error?.code).toBe("USER_NOT_FOUND");
    expect((await op("PUT", "/api/operator/feature-settings/not-a-uuid", { features: ALL_ON })).status).toBe(404);
    const { userId } = await createUserWithAccount("hanako");
    const bad = await op("PUT", `/api/operator/feature-settings/${userId}`, { features: { strategy: false } });
    expect(bad.status).toBe(400);
    expect((await json(bad)).error?.code).toBe("VALIDATION_FAILED");
    // 登録していない名前も受け付けない（名前は登録の一覧で確かめる。specs/meguru/029 T070）
    const unknown = await op("PUT", `/api/operator/feature-settings/${userId}`, { features: { ...ALL_ON, photos: true } });
    expect(unknown.status).toBe(400);
    expect((await json(unknown)).error?.code).toBe("VALIDATION_FAILED");
  });

  it("運営者が自分をOFFにしても、運営者のAPIは使える", async () => {
    const email = encodeURIComponent((await operator()).email);
    const { userId } = (await json(await op("GET", `/api/operator/users?email=${email}`))) as unknown as { userId: string };
    await op("PUT", `/api/operator/feature-settings/${userId}`, { features: { strategy: false, autopost: false, team: false } });
    expect((await op("GET", `/api/operator/users?email=${email}`)).status).toBe(200);
  });
});

/** 運営者の users の行（メールアドレスと、記録に写る名前）。 */
async function operator() {
  db();
  const [u] = (await neon(testEnv.DATABASE_URL)`SELECT email, display_name FROM users WHERE clerk_user_id = ${FEATURE_OPERATOR}`) as [
    { email: string; display_name: string | null },
  ];
  return { email: u.email, name: u.display_name?.trim() || u.email.split("@")[0]! };
}

describe("GET /api/operator/feature-settings（US3、FR-013）", () => {
  type List = {
    users: { userId: string; name: string; email: string; disabled: string[]; updatedAt: string }[];
    events: { feature: string; action: string; actorName: string; subjectName: string; createdAt: string }[];
  };
  const list = async () => (await json(await op("GET", "/api/operator/feature-settings"))) as unknown as List;
  const put = (userId: string, features: Record<string, boolean>) => op("PUT", `/api/operator/feature-settings/${userId}`, { features });

  it("OFFのまとまりがある人だけが、最後に変えた順に並ぶ。ONに戻した変更でも最後に変えた日が新しくなる", async () => {
    const { userId: a } = await createUserWithAccount("aoi");
    const { userId: b } = await createUserWithAccount("ben");
    await createUserWithAccount("all_on");
    await put(a, { ...ALL_ON, strategy: false, team: false });
    await put(b, { ...ALL_ON, autopost: false });
    let body = await list();
    expect(body.users.map((u) => [u.name, u.disabled])).toEqual([
      ["ben", ["autopost"]],
      ["aoi", ["strategy", "team"]],
    ]);
    expect(body.users[0]).toMatchObject({ email: "ben@example.com" });
    const before = body.users.find((u) => u.userId === a)!.updatedAt;

    await put(a, { ...ALL_ON, strategy: false });
    body = await list();
    expect(body.users.map((u) => u.name)).toEqual(["aoi", "ben"]);
    expect(new Date(body.users[0]!.updatedAt).getTime()).toBeGreaterThan(new Date(before).getTime());
    expect(body.events[0]).toMatchObject({ feature: "team", action: "enabled", subjectName: "aoi" });
  });

  it("最近の変更は新しい順に50件まで", async () => {
    const { userId } = await createUserWithAccount("aoi");
    for (let i = 0; i < 26; i++) {
      await put(userId, { ...ALL_ON, strategy: false });
      await put(userId, ALL_ON);
    }
    const { events: rows } = await list();
    expect(rows).toHaveLength(50);
    const times = rows.map((e) => new Date(e.createdAt).getTime());
    expect([...times].sort((x, y) => y - x)).toEqual(times);
  });

  it("2人の運営者が続けて保存すると、あとの値が残り、記録には両方が残る", async () => {
    const { userId } = await createUserWithAccount("aoi");
    await put(userId, { ...ALL_ON, strategy: false });
    await put(userId, { ...ALL_ON, autopost: false });
    const body = await list();
    expect(body.users[0]!.disabled).toEqual(["autopost"]);
    expect((await events(userId)).map((e) => [e.feature, e.action]).sort()).toEqual([
      ["autopost", "disabled"],
      ["strategy", "disabled"],
      ["strategy", "enabled"],
    ]);
  });
});

describe("DELETE /api/operator/feature-settings/:userId（US3）", () => {
  it("すべてONに戻し、消したまとまりごとに enabled を記録する。一覧から消える", async () => {
    const { userId } = await createUserWithAccount("aoi");
    await disableFeatures(userId, "strategy", "autopost");
    const res = await op("DELETE", `/api/operator/feature-settings/${userId}`);
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ userId, disabled: [] });
    expect((await events(userId)).map((e) => [e.feature, e.action]).sort()).toEqual([
      ["autopost", "enabled"],
      ["strategy", "enabled"],
    ]);
    expect(((await json(await op("GET", "/api/operator/feature-settings"))) as unknown as { users: unknown[] }).users).toEqual([]);
  });

  it("もともとすべてONなら記録は増えない。人がいなければ 404 USER_NOT_FOUND", async () => {
    const { userId } = await createUserWithAccount("aoi");
    expect((await op("DELETE", `/api/operator/feature-settings/${userId}`)).status).toBe(200);
    expect(await events(userId)).toEqual([]);
    const missing = await op("DELETE", "/api/operator/feature-settings/00000000-0000-4000-8000-000000000000");
    expect(missing.status).toBe(404);
    expect((await json(missing)).error?.code).toBe("USER_NOT_FOUND");
  });

  it("運営者でない人は 403 OPERATOR_ONLY", async () => {
    await createUserWithAccount("u1");
    expect((await callOp(app, "GET", "/api/operator/feature-settings", { user: "u1" })).status).toBe(403);
  });
});

describe("グループ（FR-017・FR-018）", () => {
  it("探した人のグループと、グループの設定でOFFのまとまりが出る。閉じたグループは出ない", async () => {
    const { userId } = await createUserWithAccount("hanako");
    const group = await makeGroup("飲食の会", [userId]);
    await disableGroupFeatures(group, "team");
    const body = await json(await op("GET", "/api/operator/users?email=hanako@example.com"));
    expect(body.group).toEqual({ id: group, name: "飲食の会", disabled: ["team"] });
    await closeGroupRow(group);
    expect((await json(await op("GET", "/api/operator/users?email=hanako@example.com"))).group).toBeNull();
  });

  it("グループの設定の変更は、最近の変更に subjectKind: group で出る", async () => {
    const { id: group } = (await json(await op("POST", "/api/operator/test-groups", { name: "飲食の会", capacity: 10 }))) as unknown as { id: string };
    const res = await op("PUT", `/api/operator/test-groups/${group}/features`, { features: { ...ALL_ON, strategy: false } });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ disabled: ["strategy"] });
    const { events: rows } = (await json(await op("GET", "/api/operator/feature-settings"))) as unknown as {
      events: { feature: string; action: string; subjectName: string; subjectKind: string }[];
    };
    expect(rows[0]).toMatchObject({ feature: "strategy", action: "disabled", subjectName: "飲食の会", subjectKind: "group" });
  });
});
