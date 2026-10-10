// 役割と権限の見本（specs/008-team-operations）。API の accountAccess を差し替えるテストで使う。
import type { AccountAccessResponse } from "@threads-grower/shared";

/** 個人運用のオーナー（すべての権限、チームなし）。 */
export const OWNER_ACCESS: AccountAccessResponse = {
  role: "owner",
  permissions: ["view", "content", "review", "settings", "activity", "owner"],
  owner: { name: "たくみ" },
  hasTeam: false,
  team: null,
  delegation: null,
};

/** 担当の編集者（見る・作る・直すだけ）。 */
export const EDITOR_ACCESS: AccountAccessResponse = {
  role: "editor",
  permissions: ["view", "content"],
  owner: { name: "鈴木 花子" },
  hasTeam: true,
  team: { name: "A社", partnerName: "田中 健" },
  delegation: { review: false, settings: false },
};

/** パートナー（承認・設定は任されていない）。 */
export const PARTNER_ACCESS: AccountAccessResponse = {
  role: "partner",
  permissions: ["view", "content", "activity"],
  owner: { name: "鈴木 花子" },
  hasTeam: true,
  team: { name: "A社", partnerName: "田中 健" },
  delegation: { review: false, settings: false },
};
