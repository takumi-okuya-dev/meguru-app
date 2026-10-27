// つなぐ方法の切り替え（THREADS_CONNECT_METHODS）。
// App Review を通すまで、または通らなかったときに、利用者が自分のMetaアプリの
// トークンを貼る方法だけで運用できるようにする。画面から消すだけにせず、
// サーバー側でも断る。既定は両方（今までの挙動）。
import { describe, expect, it, beforeEach } from "vitest";
import type { Env } from "../../src/env";
import { call, createAccountVia, fake, makeApp, resetDb, testEnv } from "../helpers/app";

const app = makeApp();
const onlyToken = { ...testEnv, THREADS_CONNECT_METHODS: "token" } as Env;
const onlyApp = { ...testEnv, THREADS_CONNECT_METHODS: "app" } as Env;

beforeEach(async () => {
  await resetDb();
  await fake.reset();
});

describe("出していない方法は、サーバー側でも断る", () => {
  it("token だけのとき、このアプリで許可する方法は 404", async () => {
    const { accountId } = await createAccountVia(app, "u1");
    const res = await call(app, "POST", "/api/threads/connect", {
      user: "u1",
      body: { mode: "connect", accountId },
      env: onlyToken,
    });
    expect(res.status).toBe(404);
  });

  it("app だけのとき、トークンで貼る方法は 404", async () => {
    const { accountId } = await createAccountVia(app, "u1");
    const res = await call(app, "POST", "/api/threads/token-connect", {
      user: "u1",
      body: { mode: "connect", accountId, token: "x".repeat(40) },
      env: onlyApp,
    });
    expect(res.status).toBe(404);
  });

  it("既定（未設定）なら、両方ともこれまでどおり通る", async () => {
    const { accountId } = await createAccountVia(app, "u1");
    const started = await call(app, "POST", "/api/threads/connect", {
      user: "u1",
      body: { mode: "connect", accountId },
    });
    expect(started.status).toBe(200);
    // トークンの方は、形が通れば中身の確認まで進む（404 ではない）
    const token = await call(app, "POST", "/api/threads/token-connect", {
      user: "u1",
      body: { mode: "connect", accountId, token: "x".repeat(40) },
    });
    expect(token.status).not.toBe(404);
  });
});

describe("GET /api/me は、出す方法を返す", () => {
  it("既定は両方", async () => {
    const res = await call(app, "GET", "/api/me", { user: "u1" });
    expect(((await res.json()) as { threadsConnectMethods: string[] }).threadsConnectMethods).toEqual(["app", "token"]);
  });

  it("token だけに絞れる", async () => {
    const res = await call(app, "GET", "/api/me", { user: "u1", env: onlyToken });
    expect(((await res.json()) as { threadsConnectMethods: string[] }).threadsConnectMethods).toEqual(["token"]);
  });
});
