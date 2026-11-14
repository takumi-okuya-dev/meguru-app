// Threads連携の公開範囲の切り替え（specs/002-strategy-profile FR-028、research.md R15）
import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../../src/kernel/env";
import { makeApp, resetDb, testEnv } from "../helpers/app";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
});

async function me(env: Env) {
  return app.request("/api/threads/me", { headers: { Authorization: "Bearer test:u1" } }, env);
}

describe("THREADS_ACCESS_MODE", () => {
  it("未設定なら testers として返す", async () => {
    const { THREADS_ACCESS_MODE: _omit, ...env } = { ...testEnv, THREADS_ACCESS_MODE: undefined };
    const res = await me(env as Env);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { threadsAccessMode: string }).threadsAccessMode).toBe("testers");
  });

  it.each(["testers", "public"] as const)("%s ならそのまま返す", async (mode) => {
    const res = await me({ ...testEnv, THREADS_ACCESS_MODE: mode });
    expect(((await res.json()) as { threadsAccessMode: string }).threadsAccessMode).toBe(mode);
  });

  it("それ以外の値は 500 CONFIG_ERROR で details に THREADS_ACCESS_MODE（値は返さない）", async () => {
    const res = await me({ ...testEnv, THREADS_ACCESS_MODE: "foo" } as unknown as Env);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string; details: string[] } };
    expect(body.error.code).toBe("CONFIG_ERROR");
    expect(body.error.details).toEqual(["THREADS_ACCESS_MODE"]);
    expect(JSON.stringify(body)).not.toContain("foo");
  });
});
