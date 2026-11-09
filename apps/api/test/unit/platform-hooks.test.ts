// 知らせ（共通 → アプリ）の仕組み（specs/027-modular-monolith contracts/module-boundaries.md 3、T012）
import { afterEach, describe, expect, it } from "vitest";
import { registerHook, resetHooks, runHook } from "../../src/platform/hooks";

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
    registerHook("userAccountsDeleted", (p) => {
      got.push(p.threadsUserIds);
    });
    await runHook("userAccountsDeleted", { tx: {} as never, userId: "u1", threadsUserIds: ["9001"], now: new Date() });
    expect(got).toEqual([["9001"]]);
  });

  it("例外は呼んだ側にそのまま返り、あとの受け取りは呼ばない", async () => {
    let called = false;
    registerHook("accountDeleting", () => {
      throw new Error("失敗");
    });
    registerHook("accountDeleting", () => {
      called = true;
    });
    await expect(runHook("accountDeleting", { tx: {} as never, accountId: "a1" })).rejects.toThrow("失敗");
    expect(called).toBe(false);
  });

  it("登録がなければ何もしない", async () => {
    await expect(runHook("userWithdrawing", { tx: {} as never, userId: "u1" })).resolves.toBeUndefined();
  });

  it("resetHooks で登録を消せる", async () => {
    let n = 0;
    registerHook("limitsChanged", () => {
      n += 1;
    });
    resetHooks();
    await runHook("limitsChanged", { env });
    expect(n).toBe(0);
  });
});
