// 投稿のスケジュールのAPI（specs/005-auto-post FR-001〜FR-004・FR-002a・FR-012、contracts/api.md「GET・PUT /posting-schedule」）
import { beforeEach, describe, expect, it } from "vitest";
import { AFTER_TRIAL, call, createUserWithAccount, fake, makeApp, resetDb, testEnv, setUserLimit, setDefaultLimit } from "../helpers/app";
import { connectedAccount, db, putSchedule } from "../helpers/auto-post";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
  await fake.reset();
  await testEnv.AUTOPOST_KV.delete("autopost:wake");
});

const path = (accountId: string) => `/api/accounts/${accountId}/posting-schedule`;
const on = (slotTimes: string[], expectedVersion: number, jitter = true) => ({
  enabled: true,
  slotTimes,
  jitter,
  expectedVersion,
});

async function effectiveFrom(accountId: string): Promise<number> {
  const [r] =
    (await db()`SELECT effective_from FROM posting_schedules WHERE account_id = ${accountId}`) as [
      { effective_from: string },
    ];
  return new Date(r.effective_from).getTime();
}

describe("GET /posting-schedule", () => {
  it("行がなければ既定値と上限を返す", async () => {
    const { accountId } = await createUserWithAccount("u1");
    const res = await call(app, "GET", path(accountId), { user: "u1" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      schedule: { enabled: false, slotTimes: [], jitter: true, version: 0 },
      overLimit: false,
      limits: { slots: 10, minGapMinutes: 30, jitterMinutes: 10 },
    });
  });

  it("他人のAccountは 404 ACCOUNT_NOT_FOUND", async () => {
    const { accountId } = await createUserWithAccount("u1");
    await createUserWithAccount("u2");
    expect((await call(app, "GET", path(accountId), { user: "u2" })).status).toBe(404);
    expect((await putSchedule(app, accountId, on(["07:30"], 0), "u2")).status).toBe(404);
  });
});

describe("PUT /posting-schedule", () => {
  it("3つの時刻でオンにでき、時刻は昇順、version は1。投稿の権限を確かめ、投稿は作らない", async () => {
    const { accountId } = await connectedAccount("u1", app);
    const res = await putSchedule(app, accountId, on(["21:00", "07:30", "12:00"], 0));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      schedule: { enabled: true, slotTimes: ["07:30", "12:00", "21:00"], jitter: true, version: 1 },
      connectionCheck: { status: "ok", quotaUsage: 0, quotaTotal: 250 },
    });
    expect(await fake.posts()).toHaveLength(0);
  });

  it("検証：duplicate・too_close・required は 400 VALIDATION_FAILED（details と reason）。件数は上限で別に止める（specs/024）", async () => {
    const { accountId } = await connectedAccount("u1", app);
    const cases: [unknown, string, string][] = [
      [on(["07:30", "07:30"], 0), "slotTimes", "duplicate"],
      [on(["07:00", "07:29"], 0), "slotTimes", "too_close"],
      [on([], 0), "enabled", "required"],
    ];
    for (const [body, detail, reason] of cases) {
      const res = await putSchedule(app, accountId, body);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: { code: "VALIDATION_FAILED", details: [detail], reason },
      });
    }
    expect((await putSchedule(app, accountId, on(["07:00", "07:29"], 0, false))).status).toBe(200);
  });

  it("同じ expectedVersion の2回目は 409 STALE_UPDATE（latest 付き）", async () => {
    const { accountId } = await connectedAccount("u1", app);
    expect((await putSchedule(app, accountId, on(["07:30"], 0))).status).toBe(200);
    const res = await putSchedule(app, accountId, on(["08:30"], 0));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: { code: "STALE_UPDATE" },
      latest: { enabled: true, slotTimes: ["07:30"], version: 1 },
    });
  });

  it("effective_from は、オフ→オン・時刻の変更・ずらすかの切り替えのときだけ今になる", async () => {
    const { accountId } = await connectedAccount("u1", app);
    await putSchedule(app, accountId, {
      enabled: false,
      slotTimes: ["07:30"],
      jitter: true,
      expectedVersion: 0,
    });
    const t0 = await effectiveFrom(accountId);
    await putSchedule(app, accountId, on(["07:30"], 1));
    const t1 = await effectiveFrom(accountId);
    expect(t1).toBeGreaterThan(t0);
    await putSchedule(app, accountId, on(["07:30"], 2));
    expect(await effectiveFrom(accountId)).toBe(t1);
    await putSchedule(app, accountId, on(["08:30"], 3));
    const t2 = await effectiveFrom(accountId);
    expect(t2).toBeGreaterThan(t1);
    await putSchedule(app, accountId, on(["08:30"], 4, false));
    expect(await effectiveFrom(accountId)).toBeGreaterThan(t2);
  });

  it("autopost:wake の at は、保存が終わった後の時刻（接続の確認で遅れた間に終わった回より新しい。PR #6 のCodexレビュー）", async () => {
    const { accountId } = await connectedAccount("u1", app);
    await fake.delayPublishingLimit(300);
    const res = await putSchedule(app, accountId, on(["07:30"], 0));
    expect(res.status).toBe(200);
    const [row] = await db()`SELECT updated_at FROM posting_schedules WHERE account_id = ${accountId}`;
    const wake = JSON.parse((await testEnv.AUTOPOST_KV.get("autopost:wake"))!) as { at: string };
    // 保存の行の時刻（リクエストの始め）より、接続の確認の分（300ms）以上あと
    expect(Date.parse(wake.at) - new Date(row!.updated_at as string).getTime()).toBeGreaterThanOrEqual(300);
  });

  it("保存の後、KV の autopost:wake に at を書く。2回失敗しても3回目で書け、4回失敗しても 200", async () => {
    const { accountId } = await connectedAccount("u1", app);
    let failures = 2;
    let written: string | null = null;
    const kv = {
      ...testEnv.AUTOPOST_KV,
      get: testEnv.AUTOPOST_KV.get.bind(testEnv.AUTOPOST_KV),
      delete: testEnv.AUTOPOST_KV.delete.bind(testEnv.AUTOPOST_KV),
      put: async (key: string, value: string) => {
        if (failures > 0) {
          failures -= 1;
          throw new Error("kv down");
        }
        if (key === "autopost:wake") written = value;
      },
    } as unknown as KVNamespace;
    const send = (body: unknown) =>
      app.request(
        path(accountId),
        {
          method: "PUT",
          headers: { Authorization: "Bearer test:u1", "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        { ...testEnv, AUTOPOST_KV: kv },
      );
    expect((await send(on(["07:30"], 0))).status).toBe(200);
    expect(JSON.parse(written!)).toHaveProperty("at");
    failures = 4;
    written = null;
    expect((await send(on(["08:30"], 1))).status).toBe(200);
    expect(written).toBeNull();
  }, 20_000);

  it("投稿の権限の確認：権限なし・要再接続は 409 THREADS_NOT_READY で保存しない。一時的な失敗は保存して unknown", async () => {
    const { accountId, threadsUserId } = await connectedAccount("u1", app);

    await fake.setPublishPermission(threadsUserId, false);
    const denied = await putSchedule(app, accountId, on(["07:30"], 0));
    expect(denied.status).toBe(409);
    expect(await denied.json()).toMatchObject({
      error: { code: "THREADS_NOT_READY", details: ["no_publish_permission"] },
    });
    expect(
      (await (await call(app, "GET", path(accountId), { user: "u1" })).json()) as unknown,
    ).toMatchObject({
      schedule: { enabled: false, version: 0 },
    });
    await fake.setPublishPermission(threadsUserId, true);

    await fake.publishFail("publishingLimit", "transient", 1);
    const unknown = await putSchedule(app, accountId, on(["07:30"], 0));
    expect(unknown.status).toBe(200);
    expect(await unknown.json()).toMatchObject({
      schedule: { enabled: true, version: 1 },
      connectionCheck: { status: "unknown" },
    });

    const off = await putSchedule(app, accountId, {
      enabled: false,
      slotTimes: ["07:30"],
      jitter: true,
      expectedVersion: 1,
    });
    expect(await off.json()).toMatchObject({ connectionCheck: null });

    await fake.invalidate(threadsUserId);
    const reconnect = await putSchedule(app, accountId, on(["07:30"], 2));
    expect(reconnect.status).toBe(409);
    expect(await reconnect.json()).toMatchObject({
      error: { code: "THREADS_NOT_READY", details: ["needs_reconnect"] },
    });
    const [acc] = (await db()`SELECT connection_status FROM accounts WHERE id = ${accountId}`) as [
      { connection_status: string },
    ];
    expect(acc.connection_status).toBe("needs_reconnect");
    expect(await fake.posts()).toHaveLength(0);
  });

  it("無料体験の後でも（決済OFF）保存できる（FR-004）", async () => {
    const { accountId } = await createUserWithAccount("u1", { userCreatedAt: AFTER_TRIAL() });
    const res = await putSchedule(app, accountId, {
      enabled: false,
      slotTimes: ["07:30"],
      jitter: true,
      expectedVersion: 0,
    });
    expect(res.status).toBe(200);
  });
});

// 1日の投稿数の上限（specs/024-tester-invite-connect FR-019・FR-020、contracts/api.md「投稿のスケジュール」、T041）
describe("1日の投稿数の上限", () => {
  const times = (n: number) => Array.from({ length: n }, (_, i) => `${String(i).padStart(2, "0")}:00`);
  const setDailyLimit = (user: string, n: number | null) => setUserLimit({ clerkUserId: user }, "daily_posts", n);

  it("GET の limits.slots はオーナーの上限。上限を超える保存は 409 POSTING_SLOT_LIMIT（details に上限）", async () => {
    const { accountId } = await connectedAccount("u1", app);
    await setDailyLimit("u1", 3);
    expect(((await (await call(app, "GET", path(accountId), { user: "u1" })).json()) as { limits: { slots: number } }).limits.slots).toBe(3);
    const res = await putSchedule(app, accountId, on(times(4), 0, false));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "POSTING_SLOT_LIMIT", details: ["3"], max: 3 } });
    expect((await putSchedule(app, accountId, on(times(3), 0, false))).status).toBe(200);
  });

  it("上限が下がって超えていても、時刻を減らす保存は通る。overLimit で知らせる", async () => {
    const { accountId } = await connectedAccount("u1", app);
    expect((await putSchedule(app, accountId, on(times(8), 0, false))).status).toBe(200);
    await setDailyLimit("u1", 5);
    const got = (await (await call(app, "GET", path(accountId), { user: "u1" })).json()) as { overLimit: boolean };
    expect(got.overLimit).toBe(true);
    expect((await putSchedule(app, accountId, on(times(9), 1, false))).status).toBe(409);
    expect((await putSchedule(app, accountId, on(times(7), 1, false))).status).toBe(200);
  });

  it("運営者は Threads の上限（250件）まで。既定値を下げても運営者にはかからない", async () => {
    const env = { ...testEnv, OPERATOR_CLERK_USER_IDS: "op1" };
    const { accountId } = await connectedAccount("op1", app);
    await setDefaultLimit("daily_posts", 2);
    const get = await call(app, "GET", path(accountId), { user: "op1", env });
    expect(((await get.json()) as { limits: { slots: number } }).limits.slots).toBe(250);
    const res = await call(app, "PUT", path(accountId), { user: "op1", env, body: on(times(12), 0, false) });
    expect(res.status).toBe(200);
  });
});
