// 人の一覧の1行（名前・LINE名・最後に会った日。specs/people/001-people-memo contracts/ui-routes.md 1）。押すと人のページへ。
import type { PersonListItem } from "@meguru/shared/people";
import { ChevronRightIcon } from "lucide-react";
import { Link } from "react-router";
import { personPath } from "../../lib/paths";
import { formatHeldOn } from "../format";

/**
 * 最後に会った日の文。
 * @param lastMetOn - 最後に会った日（なければ null）
 * @returns 文
 */
export function lastMetLabel(lastMetOn: string | null): string {
  return lastMetOn ? `最後に会った日 ${formatHeldOn(lastMetOn)}` : "会ったイベントなし";
}

/**
 * 人の一覧の1行。
 * @param props - person：人
 * @returns 行
 */
export function PersonRow({ person }: { person: PersonListItem }) {
  const showLine = person.lineName !== null && person.lineName !== person.displayName;
  return (
    <li>
      <Link to={personPath(person.id)} className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-accent">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <span className="truncate font-medium">{person.displayName}</span>
            {showLine && <span className="truncate text-sm text-muted-foreground">LINE：{person.lineName}</span>}
          </div>
          <div className="text-sm text-muted-foreground">{lastMetLabel(person.lastMetOn)}</div>
        </div>
        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>
    </li>
  );
}
