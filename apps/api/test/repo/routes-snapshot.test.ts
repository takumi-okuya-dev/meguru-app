// APIの入口（メソッドとパス）と、それぞれの処理の数・すべての入口にかかる関所の順番が、一覧（routes.snapshot.txt）と同じであること
// （specs/027-modular-monolith research.md R7、T002）。入口を足す・変えたら `pnpm --filter api routes:snapshot` で一覧を書き直す。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SNAPSHOT_PATH, routeLines } from "../../scripts/dump-routes";
import { createApp } from "../../src/app";

describe("APIの入口の一覧", () => {
  it("routes.snapshot.txt と同じ", () => {
    const expected = readFileSync(SNAPSHOT_PATH, { encoding: "utf8" }).trim().split("\n");
    expect(routeLines(createApp())).toEqual(expected);
  });
});
