// 設定画面の項目の一覧。項目を足すときは、ここに1行足して画面を作るだけにする
import { CreditCardIcon, GaugeIcon, PaletteIcon, Share2Icon, ToggleRightIcon, UserCircleIcon, UsersRoundIcon, type LucideIcon } from "lucide-react";
import type { SettingsSectionContribution } from "../app-module";

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
      // 紹介リンク（specs/017 contracts/ui-routes.md 2）。特典はないので、プレゼントの絵は使わない
      { slug: "referral", label: "紹介", Icon: Share2Icon, keywords: ["紹介", "招待", "友だち", "共有", "リンク"] },
    ],
  },
];

/** 運営者にだけ出す、外枠の項目（specs/016 contracts/ui-routes.md 3、specs/019 contracts/ui-routes.md 4）。order はアプリの項目と混ぜて並べる順。 */
const OPERATOR_SECTIONS: (SettingsSection & { order: number })[] = [
  { order: 10, slug: "features", label: "使える機能", Icon: ToggleRightIcon, keywords: ["機能", "ON", "OFF", "プラン", "戦略", "自動投稿", "チーム", "運営"] },
  { order: 20, slug: "test-groups", label: "グループ", Icon: UsersRoundIcon, keywords: ["テスト", "招待", "グループ", "組織", "運営", "上限"] },
  // 上限（specs/024 contracts/ui-routes.md 6）。テスター招待（30）・アカウント一覧（40）はThreadsが足す（specs/028 research.md R9）
  { order: 50, slug: "limits", label: "上限", Icon: GaugeIcon, keywords: ["上限", "アカウント", "投稿", "件数", "運営"] },
];

/**
 * その人に出す項目のグループ。運営者には「運営」の区分を足す。アプリが足す項目は、区分ごとに order の順で混ぜる。
 * @param operator - 運営者か（/api/me の operator。招待制に関わらない。specs/019）
 * @param contributions - アプリが足す項目（specs/028 research.md R9）
 * @returns 項目のグループ
 */
export function settingsGroupsFor(operator: boolean, contributions: readonly SettingsSectionContribution[] = []): SettingsGroup[] {
  const extra = (group: SettingsSectionContribution["group"]) =>
    contributions.filter((c) => c.group === group).map(({ order, slug, label, Icon, keywords }) => ({ order, slug, label, Icon, keywords }));
  const ordered = (base: (SettingsSection & { order: number })[], group: SettingsSectionContribution["group"]) =>
    [...base, ...extra(group)].sort((a, b) => a.order - b.order).map(({ order: _order, ...section }) => section);
  // アプリの「個人設定」の項目は、最初のグループ（個人設定）にだけ混ぜる
  const personal = SETTINGS_GROUPS.map((g, gi) =>
    gi === 0 ? { ...g, sections: ordered(g.sections.map((sec, i) => ({ ...sec, order: (i + 1) * 10 })), "personal") } : g,
  );
  return operator ? [...personal, { label: "運営", sections: ordered(OPERATOR_SECTIONS, "operator") }] : personal;
}

/** 外枠が持つ設定の項目の slug（アプリの項目とぶつけないため。specs/028 セルフレビュー）。 */
export const SHELL_SETTINGS_SLUGS: readonly string[] = [...SETTINGS_GROUPS.flatMap((g) => g.sections), ...OPERATOR_SECTIONS].map((s) => s.slug);

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
