// 運営者がトークンを作る・付ける経路を作らない（specs/024-tester-invite-connect FR-002・SC-001、T063）
import { describe, expect, it } from "vitest";
import { makeApp } from "../helpers/app";

describe("運営者のAPIに、トークンを扱う経路がない（SC-001）", () => {
  it("/api/operator/* の経路に token・password を含むものがない", () => {
    const operatorRoutes = makeApp()
      .routes.filter((r) => r.path.startsWith("/api/operator/"))
      .map((r) => `${r.method} ${r.path}`);
    expect(operatorRoutes.length).toBeGreaterThan(0);
    expect(operatorRoutes.filter((r) => /token|password/i.test(r))).toEqual([]);
  });

  it("トークンでつなぐ経路は、利用者自身の POST /api/threads/token-connect だけ", () => {
    const tokenRoutes = makeApp()
      // 招待の文字列（:token）は Threads のトークンではないので除く
      .routes.filter((r) => /token/i.test(r.path.replace(/:token/g, "")) && ["POST", "PUT", "PATCH"].includes(r.method))
      .map((r) => `${r.method} ${r.path}`);
    expect([...new Set(tokenRoutes)]).toEqual(["POST /api/threads/token-connect"]);
  });
});
