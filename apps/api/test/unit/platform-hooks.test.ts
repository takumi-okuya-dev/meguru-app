// モジュールの登録を1回だけにする仕組み（specs/027-modular-monolith T012。知らせは 029 で出来事に置き換えた）
import { afterEach, describe, expect, it } from "vitest";
import { registerModule, resetHooks } from "../../src/platform/hooks";

afterEach(() => resetHooks());

describe("platform/hooks", () => {
  it("registerModule は同じ名前で1回だけ登録し、resetHooks のあとはまた登録できる", () => {
    let count = 0;
    registerModule("threads", () => {
      count += 1;
    });
    registerModule("threads", () => {
      count += 1;
    });
    expect(count).toBe(1);
    resetHooks();
    registerModule("threads", () => {
      count += 1;
    });
    expect(count).toBe(2);
  });
});
