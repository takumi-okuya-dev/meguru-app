import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, deletePermissionFor, permissionsFor, type Permission } from "../src/permissions";

const sorted = (set: ReadonlySet<Permission>) => [...set].sort();

describe("permissions（specs/008 contracts/permissions.md「役割ごとの権限」）", () => {
  it("オーナーはすべての権限を持つ（任せる範囲に関係しない）", () => {
    expect(sorted(permissionsFor("owner", null))).toEqual([...ALL_PERMISSIONS].sort());
    expect(sorted(permissionsFor("owner", { review: false, settings: false }))).toEqual([...ALL_PERMISSIONS].sort());
  });

  it.each([
    [{ review: false, settings: false }, ["activity", "content", "view"]],
    [{ review: true, settings: false }, ["activity", "content", "review", "view"]],
    [{ review: false, settings: true }, ["activity", "content", "settings", "view"]],
    [{ review: true, settings: true }, ["activity", "content", "review", "settings", "view"]],
  ] as const)("パートナーは任せる範囲 %o のとき %o", (delegation, expected) => {
    expect(sorted(permissionsFor("partner", delegation))).toEqual(expected);
  });

  it("任せる範囲がない（NULL）パートナーは、承認・設定を持たない", () => {
    expect(sorted(permissionsFor("partner", null))).toEqual(["activity", "content", "view"]);
  });

  it.each([
    { review: false, settings: false },
    { review: true, settings: true },
    null,
  ])("編集者は任せる範囲 %o に関係なく、見る・作る・直すだけ", (delegation) => {
    expect(sorted(permissionsFor("editor", delegation))).toEqual(["content", "view"]);
  });

  it("パートナー・編集者は owner の権限を持たない", () => {
    expect(permissionsFor("partner", { review: true, settings: true }).has("owner")).toBe(false);
    expect(permissionsFor("editor", null).has("owner")).toBe(false);
  });

  it("削除に要る権限は、要確認なら content、それ以外は review（FR-002a）", () => {
    expect(deletePermissionFor("needs_review")).toBe("content");
    for (const status of ["approved", "rejected", "publishing", "published", "publish_failed"] as const) {
      expect(deletePermissionFor(status)).toBe("review");
    }
  });
});
