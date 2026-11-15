// US1：GET /api/me の testerInvites（specs/024-tester-invite-connect research.md R4、T012）
import { beforeEach, describe, expect, it } from "vitest";
import { call, makeApp, resetDb } from "../helpers/app";
import { publicEnv, testerOperatorEnv } from "../helpers/tester-invites";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
});

const me = async (env = testerOperatorEnv()) =>
  (await (await call(app, "GET", "/api/threads/me", { user: "u1", env })).json()) as { testerInvites: { enabled: boolean } };

describe("GET /api/me の testerInvites", () => {
  it("審査の前（testers）で app を出していればON", async () => {
    expect((await me()).testerInvites).toEqual({ enabled: true });
  });

  it("審査の後（public）・token だけならOFF", async () => {
    expect((await me(publicEnv())).testerInvites).toEqual({ enabled: false });
    expect((await me(testerOperatorEnv({ THREADS_CONNECT_METHODS: "token" }))).testerInvites).toEqual({ enabled: false });
  });
});
