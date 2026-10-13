// 関わりと権限の見本（specs/011-team-revision contracts/permissions.md）。API の accountAccess を差し替えるテストで使う。
import type { AccountAccessResponse } from "@threads-grower/shared";

/** 個人運用のオーナー（すべての権限、チームなし）。 */
export const OWNER_ACCESS: AccountAccessResponse = {
  relation: "owner",
  permissions: ["read", "view", "content", "review", "settings", "activity", "owner"],
  owner: { name: "たくみ" },
  hasTeam: false,
  team: null,
  assignedNotice: false,
};

/** 担当の編集者（読む・見る・作る・直すだけ）。 */
export const EDITOR_ACCESS: AccountAccessResponse = {
  relation: "assigned",
  permissions: ["read", "view", "content"],
  owner: { name: "鈴木 花子" },
  hasTeam: true,
  team: { id: "team-1", name: "飲食チーム", myRole: "editor" },
  assignedNotice: false,
};

/** 自分を担当にした管理者（操作の記録も見られる）。 */
export const ADMIN_ACCESS: AccountAccessResponse = {
  relation: "assigned",
  permissions: ["read", "view", "content", "activity"],
  owner: { name: "鈴木 花子" },
  hasTeam: true,
  team: { id: "team-1", name: "飲食チーム", myRole: "admin" },
  assignedNotice: false,
};

/** 見せてもらっている人（読むだけ）。 */
export const VIEWER_ACCESS: AccountAccessResponse = {
  relation: "shared_viewer",
  permissions: ["read"],
  owner: { name: "鈴木 花子" },
  hasTeam: true,
  team: { id: "team-1", name: "飲食チーム", myRole: "member" },
  assignedNotice: false,
};
