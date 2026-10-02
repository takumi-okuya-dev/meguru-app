// US1：秘密情報が漏れない（FR-010、SC-005）
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { call, connectNew, fake, makeApp, resetDb } from "../helpers/app";

const app = makeApp();

beforeEach(async () => {
  await resetDb();
  await fake.reset();
  await fake.addUser("1001", "takumi");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("秘密情報", () => {
  it("トークンと state の値が、authorizeUrl 以外のレスポンスとログに含まれない", async () => {
    const logs: string[] = [];
    for (const m of ["log", "info", "warn", "error"] as const) {
      vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      });
    }

    const bodies: string[] = [];
    // 失敗系のレスポンスとログも集める（上限1件なので、成功より先に行う）
    await fake.fail("getProfile", 1, "auth");
    const failed = await connectNew(app, "u1", "1001");
    const failedState = new URL(failed.authorizeUrl!).searchParams.get("state")!;
    bodies.push(failed.callbackRes!.headers.get("Location") ?? "", await failed.callbackRes!.text());

    const { connectRes, callbackRes, authorizeUrl } = await connectNew(app, "u1", "1001");
    const state = new URL(authorizeUrl!).searchParams.get("state")!;
    bodies.push(callbackRes!.headers.get("Location") ?? "", await callbackRes!.text());
    expect(connectRes.status).toBe(200);

    const me = await call(app, "GET", "/api/me", { user: "u1" });
    bodies.push(await me.text());

    const tokens = await fake.issuedTokens();
    expect(tokens.length).toBeGreaterThan(0);
    const haystack = [...bodies, ...logs].join("\n");
    for (const t of tokens) expect(haystack).not.toContain(t);
    expect(haystack).not.toContain(state);
    expect(haystack).not.toContain(failedState);
  });
});
