// 設定画面の項目の一覧。項目を足すときは、ここに1行足して画面を作るだけにする
import { CreditCardIcon, PaletteIcon, UserCircleIcon, type LucideIcon } from "lucide-react";

/** 設定画面の項目。 */
export type SettingsSection = {
  /** URLの一部（/settings/<slug>） */
  slug: string;
  label: string;
  Icon: LucideIcon;
  /** 検索で引っかける語 */
  keywords: string[];
};

/** 設定画面の項目のグループ（「個人設定」など）。 */
export type SettingsGroup = { label: string; sections: SettingsSection[] };

/** 設定画面の項目の一覧。項目を足すときは、ここに1行足して画面とルートを作る。 */
export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    label: "個人設定",
    sections: [
      { slug: "appearance", label: "外観", Icon: PaletteIcon, keywords: ["配色", "テーマ", "ダーク", "ライト", "ダークモード"] },
      { slug: "account", label: "アカウント", Icon: UserCircleIcon, keywords: ["Google", "メールアドレス", "名前", "ログアウト", "退会"] },
      // 契約と支払い（specs/013 contracts/ui-routes.md）
      { slug: "billing", label: "契約と支払い", Icon: CreditCardIcon, keywords: ["料金", "支払い", "契約", "解約", "領収書", "カード"] },
    ],
  },
];

/** /settings を開いたときに表示する項目。 */
export const DEFAULT_SETTINGS_SLUG = "appearance";

/**
 * 検索語で項目を絞り込む。項目名と検索語の部分一致で、大文字・小文字は区別しない。
 * @param groups - 項目のグループ
 * @param query - 検索語（空なら全部）
 * @returns 絞り込んだグループ（項目が0件のグループは除く）
 */
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
