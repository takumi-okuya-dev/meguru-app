// 誘う候補の上の段：リピーターの数と目標（specs/people/001-people-memo spec US5、research.md R12）。目標がなければ「目標を決める」。
import type { PeopleStats } from "@meguru/shared/people";
import { Link } from "react-router";
import { settingsPath } from "../../lib/paths";

/**
 * リピーターの数と目標の段。
 * @param props - stats：数字（読み込み中・失敗なら undefined）
 * @returns 段
 */
export function RepeaterBand({ stats }: { stats: PeopleStats | undefined }) {
  return (
    <section aria-label="リピーター" className="flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-2xl border bg-card px-4 py-3">
      <div className="min-w-0">
        <p className="text-lg font-semibold tabular-nums">
          {stats === undefined
            ? "リピーター …"
            : stats.repeaterGoal === null
              ? `リピーター ${stats.repeaterCount}人`
              : `リピーター ${stats.repeaterCount}人／目標 ${stats.repeaterGoal}人`}
        </p>
        <p className="text-[13px] text-muted-foreground">自分の会に2回以上来た人</p>
      </div>
      {stats !== undefined && stats.repeaterGoal === null && (
        <Link to={settingsPath()} className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4">
          目標を決める
        </Link>
      )}
    </section>
  );
}
