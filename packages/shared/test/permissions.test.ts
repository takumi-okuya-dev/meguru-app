import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, deletePermissionFor, permissionsFor, type Permission } from "../src/permissions";

const sorted = (set: ReadonlySet<Permission>) => [...set].sort();

describe("permissions（specs/011 contracts/permissions.md「権限」）", () => {
  it("オーナーはすべての権限を持つ（管理者かどうかに関係しない）", () => {
    expect(sorted(permissionsFor("owner"))).toEqual([...ALL_PERMISSIONS].sort());
    expect(sorted(permissionsFor("owner", { isTeamAdmin: true }))).toEqual([...ALL_PERMISSIONS].sort());
  });

  it("担当の人は、読む・見る・作る・直すだけ", () => {
    expect(sorted(permissionsFor("assigned"))).toEqual(["content", "read", "view"]);
  });

  it("担当の人が管理者なら、操作の記録も見られる（FR-002）", () => {
    expect(sorted(permissionsFor("assigned", { isTeamAdmin: true }))).toEqual(["activity", "content", "read", "view"]);
  });

  it("見せてもらっている人は、投稿ストックと戦略を読むだけ", () => {
    expect(sorted(permissionsFor("shared_viewer"))).toEqual(["read"]);
    expect(sorted(permissionsFor("shared_viewer", { isTeamAdmin: true }))).toEqual(["read"]);
  });

  it("承認・設定・オーナーの権限は、オーナーだけ（任せる範囲はない。FR-060）", () => {
    for (const relation of ["assigned", "shared_viewer"] as const) {
      for (const isTeamAdmin of [false, true]) {
        const set = permissionsFor(relation, { isTeamAdmin });
        expect(set.has("review")).toBe(false);
        expect(set.has("settings")).toBe(false);
        expect(set.has("owner")).toBe(false);
      }
    }
  });

  it("削除に要る権限は、要確認なら content、それ以外は review（FR-002a）", () => {
    expect(deletePermissionFor("needs_review")).toBe("content");
    for (const status of ["approved", "rejected", "publishing", "published", "publish_failed"] as const) {
      expect(deletePermissionFor(status)).toBe("review");
    }
  });
});
