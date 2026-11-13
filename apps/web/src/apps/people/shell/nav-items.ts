// 人物メモの移動の項目（specs/people/001-people-memo contracts/ui-routes.md 1）。サイドバーと下のバーで同じものを使う。
// まだない画面の項目は、そのPRまで出さない（人：PR2、誘いの文と目標：PR3）。
import { CalendarDaysIcon, FileUpIcon, SendIcon, type LucideIcon } from "lucide-react";
import { eventsPath, importPath, peopleHomePath } from "../lib/paths";

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

/** 移動の項目（誘う候補・取り込み・イベント。人はPR2で足す）。 */
export const PEOPLE_NAV_ITEMS: readonly PeopleNavItem[] = [
  { to: peopleHomePath(), label: "誘う候補", shortLabel: "誘う候補", Icon: SendIcon, end: true },
  { to: importPath(), label: "取り込み", shortLabel: "取り込み", Icon: FileUpIcon },
  { to: eventsPath(), label: "イベント", shortLabel: "イベント", Icon: CalendarDaysIcon },
];
