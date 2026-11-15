// モジュールの登録を1回だけにする仕組み（specs/027-modular-monolith T012。知らせは 029 で出来事に置き換えた）
import { afterEach, describe, expect, it } from "vitest";
import { registerModule, resetModules } from "../../src/platform/registry/modules";

afterEach(() => resetModules());

describe("platform/registry/modules", () => {
  it("registerModule は同じ名前で1回だけ登録し、resetModules のあとはまた登録できる", () => {
    let count = 0;
    registerModule("threads", () => {
      count += 1;
    });
    registerModule("threads", () => {
      count += 1;
    });
    expect(count).toBe(1);
    resetModules();
    registerModule("threads", () => {
      count += 1;
    });
    expect(count).toBe(2);
  });

  it("登録の途中で例外になったら、登録済みにしない（次の呼び出しでもう一度試す）", () => {
    let calls = 0;
    expect(() =>
      registerModule("threads", () => {
        calls += 1;
        throw new Error("失敗");
      }),
    ).toThrow("失敗");
    registerModule("threads", () => {
      calls += 1;
    });
    expect(calls).toBe(2);
  });
});
