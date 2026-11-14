// 設定の誤りの案内：CONFIG_ERROR と項目名（値は返さない）、callback は Web へ戻す
import { describe, expect, it } from "vitest";
import type { Env } from "../../src/kernel/env";
import { makeApp, testEnv } from "../helpers/app";

const app = makeApp();
const broken = { ...testEnv, IDENTIFIER_HASH_KEY: "REPLACE_WITH_32_BYTES_BASE64" } as Env;
// 手元以外では項目名を出さない（セキュリティ監査 run-1）。鍵の種類の検査は staging も test なので、
// 壊れているのは IDENTIFIER_HASH_KEY だけのまま APP_ENV を変えられる
const brokenStaging = { ...broken, APP_ENV: "staging" } as Env;

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
    expect(loc.pathname).toBe("/threads/accounts/new");
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

// 設定という制御の内部状態は、資格情報を持たない相手に返さない（セキュリティ監査 run-1）。
// 項目名は app.ts が env ごとに1回ログへ出しているので、宛先はそちらで足りる
describe("手元の開発でないとき、設定の誤りの中身を外に出さない", () => {
  it("/api/health は ok: false だけを返す（項目名を出さない）", async () => {
    const res = await app.request("/api/health", {}, brokenStaging);
    expect(await res.json()).toEqual({ ok: false });
  });

  it("CONFIG_ERROR の本文に details を入れない", async () => {
    const res = await app.request("/api/me", { headers: { Authorization: "Bearer test:u1" } }, brokenStaging);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string; details?: string[] } };
    expect(body.error.code).toBe("CONFIG_ERROR");
    expect(body.error).not.toHaveProperty("details");
    expect(JSON.stringify(body)).not.toContain("IDENTIFIER_HASH_KEY");
  });

  it("WEB_ORIGIN が壊れていて callback を戻せないときも、項目名と .dev.vars を出さない", async () => {
    const res = await app.request(
      "/api/threads/callback?state=x&code=y",
      {},
      { ...brokenStaging, WEB_ORIGIN: "not-a-url" } as Env,
    );
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("IDENTIFIER_HASH_KEY");
    expect(text).not.toContain(".dev.vars");
  });

  it("どの /api/* でも、無認証で項目名を取れない", async () => {
    // 関所はルート照合より前に走るので、存在しないパスでも同じ本文が返る
    const res = await app.request("/api/anything", {}, brokenStaging);
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("IDENTIFIER_HASH_KEY");
  });
});
