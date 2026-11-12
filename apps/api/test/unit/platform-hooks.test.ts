// 知らせ（共通 → アプリ）の仕組み（specs/027-modular-monolith contracts/module-boundaries.md 3、T012）
import { afterEach, describe, expect, it } from "vitest";
import { registerHook, registerModule, resetHooks, runHook } from "../../src/platform/hooks";

const env = {} as never;

afterEach(() => resetHooks());

describe("platform/hooks", () => {
  it("登録した順に1つずつ await する", async () => {
    const order: string[] = [];
    registerHook("limitsChanged", async () => {
      await new Promise((r) => setTimeout(r, 5));
      order.push("a");
    });
    registerHook("limitsChanged", () => {
      order.push("b");
    });
    await runHook("limitsChanged", { env });
    expect(order).toEqual(["a", "b"]);
  });

  it("受け取った値をそのまま渡す", async () => {
    const got: unknown[] = [];
    registerHook("userWithdrawing", (p) => {
      got.push(p.userId);
    });
    await runHook("userWithdrawing", { tx: {} as never, userId: "u1" });
    expect(got).toEqual(["u1"]);
  });

  it("例外は呼んだ側にそのまま返り、あとの受け取りは呼ばない", async () => {
    let called = false;
    registerHook("userWithdrawing", () => {
      throw new Error("失敗");
    });
    registerHook("userWithdrawing", () => {
      called = true;
    });
    await expect(runHook("userWithdrawing", { tx: {} as never, userId: "u1" })).rejects.toThrow("失敗");
    expect(called).toBe(false);
  });

  it("受け取りが登録されていなければ例外にする（片づけを黙って飛ばさない。PR #76 のセルフレビュー）", async () => {
    await expect(runHook("limitsChanged", { env: {} as never })).rejects.toThrow("受け取りが登録されていません");
  });

  it("registerModule は同じ名前で1回だけ登録し、resetHooks のあとはまた登録できる", async () => {
    let n = 0;
    const register = () =>
      registerHook("limitsChanged", () => {
        n += 1;
      });
    registerModule("app", register);
    registerModule("app", register);
    await runHook("limitsChanged", { env });
    expect(n).toBe(1);
    resetHooks();
    registerModule("app", register);
    await runHook("limitsChanged", { env });
    expect(n).toBe(2);
  });

  it("resetHooks で登録を消せる", async () => {
    registerHook("limitsChanged", () => {});
    resetHooks();
    await expect(runHook("limitsChanged", { env })).rejects.toThrow();
  });
});
