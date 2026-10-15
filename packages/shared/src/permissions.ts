// 関わりと権限（specs/011-team-revision contracts/permissions.md。specs/008 の役割と任せる範囲を置き換えた）。
// APIの判定（apps/api/src/services/access.ts の authorizeAccount）と、画面の出し分けの両方でこの表を使う。

/** memberships の役割（owner＝アカウントの持ち主、editor＝担当の人）。 */
export type Role = "owner" | "editor";

/**
 * Accountとの関わり（Constitution原則V の「オーナー、担当の人、見せてもらっている人」）。
 * - owner：アカウントの持ち主
 * - assigned：担当の人（編集者、または自分を担当にした管理者）
 * - shared_viewer：オーナーが「チームに見せる」にしたアカウントを、同じチームの人が読む
 */
export type Relation = "owner" | "assigned" | "shared_viewer";

/** チームでのロール（team_members.role）。 */
export type TeamRole = "admin" | "member" | "editor";

/**
 * Accountでの操作の権限。
 * - read：投稿ストック・戦略（課題・宣伝内容・リサーチ）を読む
 * - view：パフォーマンス・CSV・設定（読むだけ）・プロンプト・自動投稿の状態を見る
 * - content：投稿の案・戦略・改善メモを作る・直す（要確認の案の削除を含む）
 * - review：承認の操作（承認・却下・要確認に戻す・投稿の順）、要確認以外の案の削除
 * - settings：自動投稿・接続を確かめる・NGワード・投稿のルール
 * - activity：操作の記録を見る
 * - owner：Threadsとの接続、名前の変更、チームに見せる
 * - remove：Accountの削除（オーナーだけ。読むだけになっても残る。specs/013 research.md R2）
 */
export type Permission = "read" | "view" | "content" | "review" | "settings" | "activity" | "owner" | "remove";

/** すべての権限（オーナーが持つもの）。 */
export const ALL_PERMISSIONS: readonly Permission[] = [
  "read",
  "view",
  "content",
  "review",
  "settings",
  "activity",
  "owner",
  "remove",
];

/** オーナーが読むだけ（無料体験の終わり・支払いの失敗・解約の後）のときに残る権限（specs/013 research.md R2）。 */
export const READ_ONLY_PERMISSIONS: readonly Permission[] = ["read", "view", "activity", "remove"];

/**
 * 関わりから、許される権限の集合を求める（contracts/permissions.md「権限」）。
 * 承認・設定はいつもオーナーだけ（任せる範囲はない。spec FR-060）。
 * @param relation - Accountとの関わり
 * @param opts - isTeamAdmin：担当の人がそのチームの管理者か（管理者なら操作の記録も見られる）
 * @returns 許される権限の集合
 */
export function permissionsFor(relation: Relation, opts: { isTeamAdmin?: boolean } = {}): ReadonlySet<Permission> {
  if (relation === "owner") return new Set(ALL_PERMISSIONS);
  if (relation === "assigned") {
    const set = new Set<Permission>(["read", "view", "content"]);
    if (opts.isTeamAdmin) set.add("activity");
    return set;
  }
  return new Set<Permission>(["read"]);
}

/**
 * オーナーが読むだけのときの権限に絞る（関わりから求めた権限と READ_ONLY_PERMISSIONS の共通部分）。
 * @param permissions - 関わりから求めた権限
 * @returns 絞った権限
 */
export function narrowForReadOnly(permissions: ReadonlySet<Permission>): ReadonlySet<Permission> {
  return new Set([...permissions].filter((p) => READ_ONLY_PERMISSIONS.includes(p)));
}

/**
 * 投稿の案を削除するのに要る権限（FR-002a）。要確認なら作る・直すと同じ、それ以外は承認の操作と同じ。
 * @param status - 案の状態
 * @returns 要る権限
 */
export function deletePermissionFor(status: string): Permission {
  return status === "needs_review" ? "content" : "review";
}
