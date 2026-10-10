// 役割と権限（specs/008-team-operations contracts/permissions.md）。
// APIの判定（apps/api/src/services/access.ts の authorizeAccount）と、画面の出し分けの両方でこの表を使う。

/** Accountに対する役割（Constitution原則IV の Membership.role）。 */
export type Role = "owner" | "partner" | "editor";

/**
 * Accountでの操作の権限。
 * - view：開く・見る・CSV
 * - content：投稿の案・戦略・改善メモを作る・直す（要確認の案の削除を含む）
 * - review：承認の操作（承認・却下・要確認に戻す・投稿の順）、要確認以外の案の削除
 * - settings：自動投稿・接続を確かめる・NGワード・投稿のルール
 * - activity：操作の記録を見る
 * - owner：Threadsとの接続、Accountの削除、パートナーの招待・外す・任せる範囲
 */
export type Permission = "view" | "content" | "review" | "settings" | "activity" | "owner";

/** すべての権限（オーナーが持つもの）。 */
export const ALL_PERMISSIONS: readonly Permission[] = ["view", "content", "review", "settings", "activity", "owner"];

/** オーナーがパートナーに任せる範囲（account_partners の delegate_review・delegate_settings）。 */
export type Delegation = { review: boolean; settings: boolean };

/**
 * 役割と任せる範囲から、許される権限の集合を求める（contracts/permissions.md「役割ごとの権限」）。
 * @param role - Accountに対する役割
 * @param delegation - パートナーに任せる範囲。パートナーでなければ使わない（NULLは何も任せていない）
 * @returns 許される権限の集合
 */
export function permissionsFor(role: Role, delegation: Delegation | null): ReadonlySet<Permission> {
  if (role === "owner") return new Set(ALL_PERMISSIONS);
  if (role === "editor") return new Set<Permission>(["view", "content"]);
  const set = new Set<Permission>(["view", "content", "activity"]);
  if (delegation?.review) set.add("review");
  if (delegation?.settings) set.add("settings");
  return set;
}

/**
 * 投稿の案を削除するのに要る権限（FR-002a）。要確認なら作る・直すと同じ、それ以外は承認の操作と同じ。
 * @param status - 案の状態
 * @returns 要る権限
 */
export function deletePermissionFor(status: string): Permission {
  return status === "needs_review" ? "content" : "review";
}
