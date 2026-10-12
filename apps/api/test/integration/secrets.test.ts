// US1：秘密情報が漏れない（FR-010、SC-005）
import { neon } from "@neondatabase/serverless";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { call, connectNew, fake, makeApp, resetDb, testEnv } from "../helpers/app";

const app = makeApp();
const q = () => neon(testEnv.DATABASE_URL);

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

  it("貼り付けたトークンが、token-connect の応答・ログ・操作の記録・CSVに含まれない（specs/010 SC-004、FR-043）", async () => {
    await fake.addUser("9003", "cafe_b");
    const logs: string[] = [];
    for (const m of ["log", "info", "warn", "error"] as const) {
      vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      });
    }
    const bodies: string[] = [];
    const revoked = await fake.issueToken({ user: "9003" });
    await fake.revokeToken(revoked);
    const short = await fake.issueToken({ user: "9003", lifetime: "short" });
    const good = await fake.issueToken({ user: "9003", debug: false });
    for (const token of [revoked, short, good]) {
      const res = await call(app, "POST", "/api/threads/token-connect", { user: "u1", body: { mode: "new", token } });
      bodies.push(await res.text());
    }
    const { accountId } = JSON.parse(bodies[2]!) as { accountId: string };
    const reconnect = await call(app, "POST", "/api/threads/token-connect", {
      user: "u1",
      body: { mode: "reconnect", accountId, token: revoked },
    });
    bodies.push(await reconnect.text());
    for (const path of ["/api/me", `/api/accounts/${accountId}`, `/api/accounts/${accountId}/activity`, `/api/accounts/${accountId}/performance/export`]) {
      bodies.push(await (await call(app, "GET", path, { user: "u1" })).text());
    }
    const rows = await q()`SELECT * FROM activity_logs`;
    const haystack = [...bodies, ...logs, JSON.stringify(rows)].join("\n");
    for (const t of [revoked, short, good]) expect(haystack).not.toContain(t);
  });
});
