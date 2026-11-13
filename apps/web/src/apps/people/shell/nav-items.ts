// 人物メモの移動の項目（specs/people/001-people-memo contracts/ui-routes.md 1）。サイドバーと下のバーで同じものを使う。
// 「誘いの文と目標」（設定）は、サイドバーの下にだけ出す（下のバーには出さない。ホームの「目標を決める」「誘いの文を変える」からも開く）。
import { CalendarDaysIcon, FileUpIcon, MessageSquareTextIcon, SendIcon, UsersIcon, type LucideIcon } from "lucide-react";
import { eventsPath, importPath, peopleHomePath, personsPath, settingsPath } from "../lib/paths";

/** 移動の項目。 */
export type PeopleNavItem = {
  to: string;
  /** サイドバーの名前 */
  label: string;
  /** 下のバーの短い名前 */
  shortLabel: string;
  Icon: LucideIcon;
  /** URLが完全に一致するときだけ選ばれた見た目にする */
  end?: boolean;
};

/** 移動の項目（誘う候補・人・取り込み・イベント）。 */
export const PEOPLE_NAV_ITEMS: readonly PeopleNavItem[] = [
  { to: peopleHomePath(), label: "誘う候補", shortLabel: "誘う候補", Icon: SendIcon, end: true },
  { to: personsPath(), label: "人", shortLabel: "人", Icon: UsersIcon },
  { to: importPath(), label: "取り込み", shortLabel: "取り込み", Icon: FileUpIcon },
  { to: eventsPath(), label: "イベント", shortLabel: "イベント", Icon: CalendarDaysIcon },
];

/** サイドバーの下の項目（誘いの文と目標）。 */
export const PEOPLE_SETTINGS_NAV_ITEM: PeopleNavItem = { to: settingsPath(), label: "誘いの文と目標", shortLabel: "設定", Icon: MessageSquareTextIcon };
