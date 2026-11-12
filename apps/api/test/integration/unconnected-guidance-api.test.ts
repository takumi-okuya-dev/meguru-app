// US4：未接続のアカウントでの、Threadsが要る機能のAPI（specs/012 FR-032・FR-033、contracts/api.md「Threadsが要る機能」）
import { beforeEach, describe, expect, it } from "vitest";
import { call, createAccountVia, fake, makeApp, resetDb } from "../helpers/app";

const app = makeApp();
const base = (id: string) => `/api/threads/accounts/${id}`;

let accountId: string;

beforeEach(async () => {
  await resetDb();
  await fake.reset();
  accountId = (await createAccountVia(app, "u1", "カフェの公式")).accountId!;
});

describe("自動投稿（FR-032）", () => {
  it("オンにする保存は THREADS_NOT_READY（details: not_connected）。オフのまま時刻は保存できる", async () => {
    const on = await call(app, "PUT", `${base(accountId)}/posting-schedule`, {
      user: "u1",
      body: { enabled: true, slotTimes: ["09:00"], jitter: true, expectedVersion: 0 },
    });
    expect(on.status).toBe(409);
    expect(await on.json()).toMatchObject({ error: { code: "THREADS_NOT_READY", details: ["not_connected"] } });
    const off = await call(app, "PUT", `${base(accountId)}/posting-schedule`, {
      user: "u1",
      body: { enabled: false, slotTimes: ["09:00"], jitter: true, expectedVersion: 0 },
    });
    expect(off.status).toBe(200);
    expect(await off.json()).toMatchObject({ schedule: { enabled: false, slotTimes: ["09:00"] } });
  });

  it("GET /auto-post の知らせの先頭が not_connected で、止まっている理由はない（オフなので）", async () => {
    const res = await call(app, "GET", `${base(accountId)}/auto-post`, { user: "u1" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { autoPost: { enabled: boolean; stoppedReason: string | null }; notices: { kind: string }[]; next: unknown };
    expect(body.notices[0]).toEqual({ kind: "not_connected" });
    expect(body.autoPost).toMatchObject({ enabled: false, stoppedReason: null });
    expect(body.next).toBeNull();
  });
});

describe("パフォーマンス（FR-033）", () => {
  it("GET /performance は notConnected: true で、数字は空", async () => {
    const res = await call(app, "GET", `${base(accountId)}/performance`, { user: "u1" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { summary: { notConnected: boolean; baseline: number | null; counts: { all: number } }; items: unknown[] };
    expect(body.summary).toMatchObject({ notConnected: true, baseline: null, counts: { all: 0 } });
    expect(body.items).toEqual([]);
  });

  it("書き出しは ACCOUNT_NOT_CONNECTED", async () => {
    const res = await call(app, "GET", `${base(accountId)}/performance/export?kind=posts`, { user: "u1" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "ACCOUNT_NOT_CONNECTED" } });
  });
});
