// アプリの利用の許可（specs/meguru/030-app-access tasks.md T003〜T006、US1・US2）。
// 仮のアプリ demo-granted を「運営者が開いた人だけ」で登録し、試しの道筋（requireAppAccess を付けたもの）で確かめる。
// 人ごとの許可・グループの許可・閉じたグループ・運営者・許可なし、運営者のAPI（400・404・記録）、入口の関数の access、/api/me。
import type { OperatorAppRegistry, OperatorUser, TestGroupDetail } from "@meguru/shared";
import { neon } from "@neondatabase/serverless";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { billingModeOf } from "../../src/kernel/config";
import type { Env } from "../../src/kernel/env";
import { AppError } from "../../src/kernel/errors";
import { accessibleApps, canUseApp, requireAppAccess } from "../../src/platform/access/app-access";
import { loadAppEntitlement, loadAppEntitlements } from "../../src/platform/entitlement/entitlement";
import { authMiddleware, type AppEnv } from "../../src/platform/identity/auth";
import { registerAppAccess } from "../../src/platform/registry/registry";
import { call, db, fakeVerifier, makeApp, resetDb, testEnv } from "../helpers/app";
import { closeGroupRow, FEATURE_OPERATOR, makeGroup, operatorEnv } from "../helpers/features";
import { userRow } from "../helpers/test-groups";
import { operatorEventRows } from "../helpers/tester-invites";

const DEMO = "demo-granted";
registerAppAccess(DEMO, "granted");

const app = makeApp();
const OP = FEATURE_OPERATOR;

/** 試しのアプリの道筋（demo-granted の関所だけを付ける）。 */
const demo = new Hono<AppEnv>().get("/api/demo", authMiddleware(() => fakeVerifier), requireAppAccess(DEMO), (c) => c.json({ ok: true }));
demo.onError((err, c) => {
  if (err instanceof AppError) return c.json({ error: { code: err.code, details: err.details } }, err.status);
  throw err;
});

/**
 * 運営者を決めた環境で、めぐるの API を呼ぶ。
 * @param method - HTTPのメソッド
 * @param path - パス
 * @param opts - 呼ぶ人・本文
 * @returns 応答
 */
const callOp = (method: string, path: string, opts: { user?: string; body?: unknown } = {}) => call(app, method, path, { ...opts, env: operatorEnv() });

/**
 * 試しのアプリの道筋を呼ぶ。
 * @param user - 呼ぶ人
 * @returns 状態とエラーのコード
 */
async function useDemo(user: string): Promise<[number, string | undefined]> {
  const res = await demo.request("/api/demo", { headers: { Authorization: `Bearer test:${user}` } }, operatorEnv());
  const body = (await res.json()) as { error?: { code: string } };
  return [res.status, body.error?.code];
}

/**
 * 利用者を作り（JIT作成）、users.id を返す。
 * @param user - Clerk のユーザーID
 * @returns users.id
 */
async function userIdOf(user: string): Promise<string> {
  await callOp("GET", "/api/me", { user });
  return (await userRow(user))!.id;
}

/**
 * エラーのコードと項目を読む。
 * @param res - 応答
 * @returns 状態・コード・項目
 */
async function errorOf(res: Response) {
  const body = (await res.json()) as { error: { code: string; details?: string[] } };
  return [res.status, body.error.code, body.error.details];
}

const mode = () => billingModeOf(operatorEnv() as Env);

beforeEach(async () => {
  await resetDb();
});

describe("道筋の関所（requireAppAccess）と判定", () => {
  it("許可のない人は 403 APP_NOT_AVAILABLE。入口の関数は access: none", async () => {
    const id = await userIdOf("u1");
    expect(await useDemo("u1")).toEqual([403, "APP_NOT_AVAILABLE"]);
    expect(await canUseApp(db(), id, false, DEMO)).toBe(false);
    expect((await loadAppEntitlement(db(), mode(), id, DEMO))?.access).toBe("none");
    expect((await accessibleApps(db(), id, false)).has(DEMO)).toBe(false);
  });

  it("運営者は、許可がなくても使える", async () => {
    const id = await userIdOf(OP);
    expect(await useDemo(OP)).toEqual([200, undefined]);
    expect((await loadAppEntitlement(db(), mode(), id, DEMO))?.access).toBe("full");
    expect((await accessibleApps(db(), id, true)).has(DEMO)).toBe(true);
  });

  it("人ごとに開くと使え、閉じると 403 に戻る。ほかの人は使えない。開いた・閉じたことが記録に残る", async () => {
    const u1 = await userIdOf("u1");
    const u2 = await userIdOf("u2");
    const opId = await userIdOf(OP);
    const open = await callOp("PUT", `/api/operator/app-access/users/${u1}`, { user: OP, body: { apps: { [DEMO]: true } } });
    expect([open.status, await open.json()]).toEqual([200, { granted: [DEMO] }]);
    expect(await useDemo("u1")).toEqual([200, undefined]);
    expect(await useDemo("u2")).toEqual([403, "APP_NOT_AVAILABLE"]);
    const many = await loadAppEntitlements(db(), mode(), [u1, u2], DEMO);
    expect([many.get(u1)?.access, many.get(u2)?.access]).toEqual(["full", "none"]);
    expect((await accessibleApps(db(), u1, false)).has(DEMO)).toBe(true);
    // 同じ値をもう一度送っても、記録は増えない
    await callOp("PUT", `/api/operator/app-access/users/${u1}`, { user: OP, body: { apps: { [DEMO]: true } } });

    const close = await callOp("PUT", `/api/operator/app-access/users/${u1}`, { user: OP, body: { apps: { [DEMO]: false } } });
    expect(await close.json()).toEqual({ granted: [] });
    expect(await useDemo("u1")).toEqual([403, "APP_NOT_AVAILABLE"]);
    const events = (await operatorEventRows()).filter((e) => e.action === "app_access");
    expect(events.map((e) => [e.actor_user_id, e.subject_user_id, e.detail])).toEqual([
      [opId, u1, { app: DEMO, granted: true }],
      [opId, u1, { app: DEMO, granted: false }],
    ]);
  });

  it("グループに開くと、閉じていないグループの人だけが使える。グループを閉じると使えない（人ごとに開いていれば使える）", async () => {
    const u1 = await userIdOf("u1");
    const u2 = await userIdOf("u2");
    await userIdOf(OP);
    const groupId = await makeGroup("飲食の会", [u1, u2]);
    const outsider = await userIdOf("u3");
    const res = await callOp("PUT", `/api/operator/app-access/groups/${groupId}`, { user: OP, body: { apps: { [DEMO]: true } } });
    expect(await res.json()).toEqual({ granted: [DEMO] });
    expect(await useDemo("u1")).toEqual([200, undefined]);
    expect(await useDemo("u3")).toEqual([403, "APP_NOT_AVAILABLE"]);
    expect((await loadAppEntitlement(db(), mode(), outsider, DEMO))?.access).toBe("none");
    const events = (await operatorEventRows()).filter((e) => e.action === "app_access");
    expect(events.map((e) => [e.subject_user_id, e.detail])).toEqual([[null, { app: DEMO, granted: true, groupId }]]);

    // 人ごとにも開いた人は、グループを閉じても使える
    await callOp("PUT", `/api/operator/app-access/users/${u2}`, { user: OP, body: { apps: { [DEMO]: true } } });
    await closeGroupRow(groupId);
    expect(await useDemo("u1")).toEqual([403, "APP_NOT_AVAILABLE"]);
    expect(await useDemo("u2")).toEqual([200, undefined]);
    expect((await loadAppEntitlement(db(), mode(), u1, DEMO))?.access).toBe("none");
    // 閉じたグループは変えられない（機能のON/OFFと同じ）
    const closed = await callOp("PUT", `/api/operator/app-access/groups/${groupId}`, { user: OP, body: { apps: { [DEMO]: false } } });
    expect((await errorOf(closed)).slice(0, 2)).toEqual([409, "TEST_GROUP_CLOSED"]);
  });

  it("だれでも使えるアプリ（登録しないアプリ）の入口の関数の結果は、許可の表によらず変わらない", async () => {
    const id = await userIdOf("u1");
    const before = await loadAppEntitlement(db(), mode(), id, "threads");
    expect(before?.access).toBe("full");
    expect(await canUseApp(db(), id, false, "threads")).toBe(true);
    expect((await accessibleApps(db(), id, false)).has("threads")).toBe(true);
  });
});

describe("運営者の画面の読む方（appAccess）", () => {
  it("人を探すと、人ごと・グループに開いているアプリが入る", async () => {
    const u1 = await userIdOf("u1");
    await userIdOf(OP);
    // グループの詳しい内容は招待リンクを読み解くので、グループは運営者のAPIで作り、人は直接入れる
    const created = await callOp("POST", "/api/operator/test-groups", { user: OP, body: { name: "飲食の会", capacity: 10 } });
    const groupId = ((await created.json()) as { id: string }).id;
    await neon(testEnv.DATABASE_URL)`INSERT INTO test_group_members (user_id, group_id) VALUES (${u1}, ${groupId})`;
    const find = async () => (await (await callOp("GET", "/api/operator/users?email=u1@example.com", { user: OP })).json()) as OperatorUser;
    expect(await find()).toMatchObject({ appAccess: [], group: { id: groupId, appAccess: [] } });
    await callOp("PUT", `/api/operator/app-access/users/${u1}`, { user: OP, body: { apps: { [DEMO]: true } } });
    await callOp("PUT", `/api/operator/app-access/groups/${groupId}`, { user: OP, body: { apps: { [DEMO]: true } } });
    expect(await find()).toMatchObject({ appAccess: [DEMO], group: { id: groupId, appAccess: [DEMO] } });
    const detail = (await (await callOp("GET", `/api/operator/test-groups/${groupId}`, { user: OP })).json()) as TestGroupDetail;
    expect(detail.appAccess).toEqual([DEMO]);
  });

  it("登録の一覧に、各アプリの利用の決まりが入る（だれでも使えるアプリは open）", async () => {
    const registry = (await (await callOp("GET", "/api/operator/app-registry", { user: OP })).json()) as OperatorAppRegistry;
    expect(registry.apps.map((a) => [a.app, a.access])).toEqual([
      ["threads", "open"],
      [DEMO, "granted"],
    ]);
    expect(registry.apps[1]).toEqual({ app: DEMO, access: "granted", featureSwitches: false, operatorLimits: false, features: [], limits: [] });
  });
});

describe("運営者のAPIの誤り", () => {
  it("登録していないアプリ・だれでも使えるアプリ・形の違う本文は 400 VALIDATION_FAILED（人・グループを探すより先）", async () => {
    const u1 = await userIdOf("u1");
    for (const body of [{ apps: { nope: true } }, { apps: { threads: true } }, { apps: { [DEMO]: "yes" } }, {}]) {
      for (const path of [`/api/operator/app-access/users/${u1}`, `/api/operator/app-access/groups/${crypto.randomUUID()}`]) {
        const res = await callOp("PUT", path, { user: OP, body });
        expect((await errorOf(res)).slice(0, 2), `${path} ${JSON.stringify(body)}`).toEqual([400, "VALIDATION_FAILED"]);
      }
    }
    const res = await callOp("PUT", `/api/operator/app-access/users/${u1}`, { user: OP, body: { apps: { threads: true } } });
    expect(await errorOf(res)).toEqual([400, "VALIDATION_FAILED", ["apps"]]);
  });

  it("人・グループがいなければ 404（UUID の形でない番号も）", async () => {
    await userIdOf(OP);
    for (const id of [crypto.randomUUID(), "x"]) {
      const user = await callOp("PUT", `/api/operator/app-access/users/${id}`, { user: OP, body: { apps: { [DEMO]: true } } });
      expect((await errorOf(user)).slice(0, 2)).toEqual([404, "USER_NOT_FOUND"]);
      const group = await callOp("PUT", `/api/operator/app-access/groups/${id}`, { user: OP, body: { apps: { [DEMO]: true } } });
      expect((await errorOf(group)).slice(0, 2)).toEqual([404, "ITEM_NOT_FOUND"]);
    }
  });

  it("運営者でなければ OPERATOR_ONLY", async () => {
    const u1 = await userIdOf("u1");
    for (const path of [`/api/operator/app-access/users/${u1}`, `/api/operator/app-access/groups/${crypto.randomUUID()}`]) {
      const res = await callOp("PUT", path, { user: "u1", body: { apps: { [DEMO]: true } } });
      expect((await errorOf(res)).slice(0, 2)).toEqual([403, "OPERATOR_ONLY"]);
    }
    expect(await useDemo("u1")).toEqual([403, "APP_NOT_AVAILABLE"]);
  });
});

describe("/api/me（US2）", () => {
  it("運営者が開いた人だけのアプリを登録しても、Threadsだけの人の apps は今と同じ", async () => {
    const res = await callOp("GET", "/api/me", { user: "u1" });
    expect(((await res.json()) as { apps: unknown }).apps).toEqual({ available: ["threads"], using: [], last: null, landing: null });
  });

  it("アプリの一覧にないアプリを最後に使ったアプリにしようとすると 400（許可があっても）", async () => {
    const u1 = await userIdOf("u1");
    await callOp("PUT", `/api/operator/app-access/users/${u1}`, { user: OP, body: { apps: { [DEMO]: true } } });
    const res = await callOp("PUT", "/api/me/last-app", { user: "u1", body: { app: DEMO } });
    expect(await errorOf(res)).toEqual([400, "VALIDATION_FAILED", ["app"]]);
  });
});
