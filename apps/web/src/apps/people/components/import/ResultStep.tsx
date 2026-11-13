// 取り込みの⑤結果（specs/people/001-people-memo contracts/ui-routes.md 1）。
import type { ImportResult } from "@meguru/shared/people";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { eventPath } from "../../lib/paths";

/**
 * 取り込みの結果。
 * @param props - result：取り込みの数、eventId：取り込んだイベント、onAgain：続けて取り込む
 * @returns 結果
 */
export function ResultStep({ result, eventId, onAgain }: { result: ImportResult; eventId: string; onAgain: () => void }) {
  const r = result.import;
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">取り込みました</h3>
      <ul className="divide-y rounded-2xl border bg-card text-sm">
        <li className="flex justify-between px-4 py-2.5">
          <span>取り込んだ回答</span>
          <span className="font-medium tabular-nums">{r.importedCount}件</span>
        </li>
        <li className="flex justify-between px-4 py-2.5">
          <span>新しく入った人</span>
          <span className="font-medium tabular-nums">{r.createdPeopleCount}人</span>
        </li>
        <li className="flex justify-between px-4 py-2.5">
          <span>前に会った人につないだ</span>
          <span className="font-medium tabular-nums">{r.linkedCount}人</span>
        </li>
        <li className="flex justify-between px-4 py-2.5">
          <span>取り込まなかった行</span>
          <span className="font-medium tabular-nums">{r.skippedCount}件</span>
        </li>
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button asChild className="h-11 rounded-full md:h-10">
          <Link to={eventPath(eventId)}>イベントのページを見る</Link>
        </Button>
        <Button variant="outline" className="h-11 rounded-full md:h-10" onClick={onAgain}>
          続けて取り込む
        </Button>
      </div>
    </div>
  );
}
