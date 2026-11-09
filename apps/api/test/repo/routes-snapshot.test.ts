// APIの入口（メソッドとパス）の一覧が、027の並べ替えの前と同じであること（specs/027-modular-monolith research.md R7、T002）。
// 入口を足す・変えるときは、`pnpm --filter api exec tsx scripts/dump-routes.ts > ../../specs/027-modular-monolith/routes-before.txt` で書き直す。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { routeLines } from "../../scripts/dump-routes";
import { createApp } from "../../src/app";

const BEFORE = join(dirname(fileURLToPath(import.meta.url)), "../../../../specs/027-modular-monolith/routes-before.txt");

describe("APIの入口の一覧", () => {
  it("routes-before.txt と同じ", () => {
    const expected = readFileSync(BEFORE, { encoding: "utf8" }).trim().split("\n");
    expect(routeLines(createApp())).toEqual(expected);
  });
});
