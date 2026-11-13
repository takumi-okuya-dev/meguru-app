// 誘う会の選択（自分の会から選ぶ。初めは今日以降でいちばん近い自分の会。specs/people/001-people-memo research.md R17）。
import type { PeopleEvent } from "@meguru/shared/people";
import { useId } from "react";
import { Link } from "react-router";
import { fieldClass } from "../EventForm";
import { formatHeldOn } from "../format";
import { newEventPath, settingsPath } from "../../lib/paths";

/**
 * 誘う会の選択。
 * @param props - value：選んだ会のID（なければ空）、events：選べる会（自分の会）、onChange：選んだとき
 * @returns 選択
 */
export function InviteEventPicker({ value, events, onChange }: { value: string; events: PeopleEvent[]; onChange: (eventId: string) => void }) {
  const id = useId();
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium">
          誘う会
        </label>
        <Link to={settingsPath()} className="inline-flex min-h-11 items-center text-[13px] text-muted-foreground underline underline-offset-4 md:min-h-0">
          誘いの文を変える
        </Link>
      </div>
      <select id={id} className={fieldClass} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">選んでいません</option>
        {events.map((e) => (
          <option key={e.id} value={e.id}>
            {formatHeldOn(e.heldOn)} {e.name}
          </option>
        ))}
      </select>
      {value === "" && (
        <p className="text-[13px] text-muted-foreground">
          誘う会を選んでください（文のコピーに使います）。
          {events.length === 0 && (
            <>
              自分の会がまだありません。
              <Link to={newEventPath()} className="underline">
                イベントを作る
              </Link>
            </>
          )}
        </p>
      )}
    </div>
  );
}
