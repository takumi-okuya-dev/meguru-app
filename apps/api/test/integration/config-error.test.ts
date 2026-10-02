// 設定の誤りの案内：CONFIG_ERROR と項目名（値は返さない）、callback は Web へ戻す
import { describe, expect, it } from "vitest";
import type { Env } from "../../src/env";
import { makeApp, testEnv } from "../helpers/app";

const app = makeApp();
const broken = { ...testEnv, IDENTIFIER_HASH_KEY: "REPLACE_WITH_32_BYTES_BASE64" } as Env;

describe("設定に誤りがあるとき", () => {
  it("API は 500 CONFIG_ERROR と、誤っている項目名だけを返す", async () => {
    const res = await app.request("/api/me", { headers: { Authorization: "Bearer test:u1" } }, broken);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string; details: string[] } };
    expect(body.error.code).toBe("CONFIG_ERROR");
    expect(body.error.details).toEqual(["IDENTIFIER_HASH_KEY"]);
    expect(JSON.stringify(body)).not.toContain("REPLACE_WITH");
  });

  it("callback は JSON で止めず、Web のアカウント追加画面へ CONFIG_ERROR で戻す", async () => {
    const res = await app.request("/api/threads/callback?state=x&code=y", {}, broken);
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("Location")!);
    expect(loc.pathname).toBe("/accounts/new");
    expect(loc.searchParams.get("error")).toBe("CONFIG_ERROR");
  });

  it("/api/health は誤っている項目名を返す（値は返さない）", async () => {
    const res = await app.request("/api/health", {}, broken);
    expect(await res.json()).toEqual({ ok: false, configErrors: ["IDENTIFIER_HASH_KEY"] });
  });

  it("正しい設定なら /api/health は ok: true", async () => {
    const res = await app.request("/api/health", {}, testEnv);
    expect(await res.json()).toEqual({ ok: true });
  });
});
