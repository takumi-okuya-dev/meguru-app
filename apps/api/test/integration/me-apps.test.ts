// /api/me の apps と PUT /api/me/last-app（specs/028-meguru-shell contracts/api.md 1・2・4、T046・T057）
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { users } from "../../src/db/schema";
import { resolveMeApps } from "../../src/platform/identity/me-routes";
import { call, createAccountVia, db, fake, makeApp, resetDb } from "../helpers/app";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
  await fake.reset();
});

type Apps = { available: string[]; using: string[]; last: string | null; landing: string | null };

/**
 * /api/me の apps を読む。
 * @param user - 呼ぶ人
 * @returns apps
 */
async function appsOf(user: string): Promise<Apps> {
  const res = await call(app, "GET", "/api/me", { user });
  expect(res.status).toBe(200);
  return ((await res.json()) as { apps: Apps }).apps;
}

/**
 * users.last_app_id を読む。
 * @param clerkUserId - Clerk のユーザーID
 * @returns 最後に使ったアプリ
 */
async function lastAppIdOf(clerkUserId: string): Promise<string | null> {
  const [row] = await db().select({ lastAppId: users.lastAppId }).from(users).where(eq(users.clerkUserId, clerkUserId));
  return row!.lastAppId;
}

describe("GET /api/me の apps", () => {
  it("登録した直後は、出せるアプリだけがあり、使っているアプリと入口の行き先はない", async () => {
    expect(await appsOf("new-user")).toEqual({ available: ["threads"], using: [], last: null, landing: null });
  });

  it("自分のアカウントがあれば、Threadsを使っている。入口の行き先もThreads", async () => {
    await createAccountVia(app, "u1", "カフェ");
    expect(await appsOf("u1")).toEqual({ available: ["threads"], using: ["threads"], last: null, landing: "threads" });
  });

  it("users.last_app_id が知らないアプリなら、last は null にする", async () => {
    await createAccountVia(app, "u1", "カフェ");
    await db().update(users).set({ lastAppId: "people" }).where(eq(users.clerkUserId, "u1"));
    expect(await appsOf("u1")).toMatchObject({ last: null, landing: "threads" });
  });

  it("最後に使ったアプリを使っていなければ、入口の行き先にしない", async () => {
    await call(app, "GET", "/api/me", { user: "u1" });
    await db().update(users).set({ lastAppId: "threads" }).where(eq(users.clerkUserId, "u1"));
    expect(await appsOf("u1")).toEqual({ available: ["threads"], using: [], last: "threads", landing: null });
  });
});

describe("resolveMeApps", () => {
  it("開けるアカウント（担当を含む）が1件以上ならThreadsを使っている", () => {
    expect(resolveMeApps(0, null).using).toEqual([]);
    expect(resolveMeApps(1, null).using).toEqual(["threads"]);
    expect(resolveMeApps(2, "threads")).toEqual({ available: ["threads"], using: ["threads"], last: "threads", landing: "threads" });
  });
});

describe("PUT /api/me/last-app", () => {
  it("覚えて 204。使っていないアプリでも覚える", async () => {
    const res = await call(app, "PUT", "/api/me/last-app", { user: "u1", body: { app: "threads" } });
    expect(res.status).toBe(204);
    expect(await lastAppIdOf("u1")).toBe("threads");
  });

  it.each([[{ app: "people" }], [{ app: 1 }], [{}]])("知らないアプリ・形の違う入力 %j は 400 VALIDATION_FAILED", async (body) => {
    const res = await call(app, "PUT", "/api/me/last-app", { user: "u1", body });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string; details?: string[] } };
    expect(json.error.code).toBe("VALIDATION_FAILED");
    expect(json.error.details).toEqual(["app"]);
  });

  it("未ログインなら 401", async () => {
    const res = await call(app, "PUT", "/api/me/last-app", { body: { app: "threads" } });
    expect(res.status).toBe(401);
  });
});
