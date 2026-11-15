// 開いているイベントの画面を切り替える、画面の下のタブバー（specs/collect/001-event-day-collection contracts/ui-routes.md 1）。
// サイドバーはアプリ全体の項目だけにし、イベントの中の画面（名簿・受付・受付の手伝い・セルフ受付・締め・分配）はここで切り替える。
import { ClipboardCheckIcon, HandCoinsIcon, ListChecksIcon, QrCodeIcon, ScanLineIcon, UsersIcon, type LucideIcon } from "lucide-react";
import { NavLink, useMatch } from "react-router";
import { cn } from "@/lib/utils";
import { COLLECT_BASE, closingPath, helpersPath, receptionPath, rosterPath, selfCheckInPath, sharingPath } from "../lib/paths";

/**
 * 開いているイベントの番号（イベントの中の画面でなければ undefined）。
 * @returns イベントの番号
 */
export function useOpenEventId(): string | undefined {
  const eventId = useMatch(`${COLLECT_BASE}/events/:eventId/*`)?.params.eventId;
  return eventId && eventId !== "new" ? eventId : undefined;
}

type Tab = { label: string; name?: string; icon: LucideIcon; to: (eventId: string) => string };

/** タブの並び（当日の流れの順）。name は読み上げの名前（見える名前と違うときだけ）。 */
const TABS: readonly Tab[] = [
  { label: "名簿", icon: ListChecksIcon, to: rosterPath },
  { label: "受付", icon: ScanLineIcon, to: receptionPath },
  { label: "手伝い", name: "受付の手伝い", icon: UsersIcon, to: helpersPath },
  { label: "セルフ受付", icon: QrCodeIcon, to: selfCheckInPath },
  { label: "締め", icon: ClipboardCheckIcon, to: closingPath },
  { label: "分配", icon: HandCoinsIcon, to: sharingPath },
];

/**
 * 画面の下のタブバー。イベントを開いているときだけ出す。
 * メインパネルの終わりに置き、下に貼り付ける（スマートフォンの下の余白の分だけ下を空ける）。
 * @returns タブバー（イベントを開いていなければ何も出さない）
 */
export function EventTabBar() {
  const eventId = useOpenEventId();
  if (!eventId) return null;
  return (
    <nav aria-label="このイベント" className="sticky bottom-0 z-20 mt-auto border-t bg-background pb-[env(safe-area-inset-bottom)]">
      <ul className="mx-auto grid max-w-2xl grid-cols-6">
        {TABS.map((tab) => (
          <li key={tab.label}>
            <NavLink
              to={tab.to(eventId)}
              aria-label={tab.name}
              className={({ isActive }) =>
                cn(
                  "flex min-h-14 flex-col items-center justify-center gap-1 px-0.5 text-[11px] leading-tight text-muted-foreground hover:text-foreground",
                  isActive && "font-medium text-foreground",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <tab.icon className={cn("size-5", isActive && "text-primary")} aria-hidden="true" />
                  <span className="whitespace-nowrap">{tab.label}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
