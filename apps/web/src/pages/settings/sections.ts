// 設定画面の項目の一覧。項目を足すときは、ここに1行足して画面を作るだけにする
import { PaletteIcon, UserCircleIcon, type LucideIcon } from "lucide-react";

export type SettingsSection = {
  /** URLの一部（/settings/<slug>） */
  slug: string;
  label: string;
  Icon: LucideIcon;
  /** 検索で引っかける語 */
  keywords: string[];
};

export type SettingsGroup = { label: string; sections: SettingsSection[] };

export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    label: "個人設定",
    sections: [
      { slug: "appearance", label: "外観", Icon: PaletteIcon, keywords: ["配色", "テーマ", "ダーク", "ライト", "ダークモード"] },
      { slug: "account", label: "アカウント", Icon: UserCircleIcon, keywords: ["Google", "メールアドレス", "名前", "ログアウト"] },
    ],
  },
];

export const DEFAULT_SETTINGS_SLUG = "appearance";

/** 検索語で項目を絞り込む（名前と検索語の部分一致。大文字・小文字は区別しない） */
export function filterSettingsGroups(groups: SettingsGroup[], query: string): SettingsGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return groups;
  return groups
    .map((g) => ({
      ...g,
      sections: g.sections.filter((s) => [s.label, ...s.keywords].some((w) => w.toLowerCase().includes(q))),
    }))
    .filter((g) => g.sections.length > 0);
}
