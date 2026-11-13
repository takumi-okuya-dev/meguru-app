// 人の行の印（タグ・来てくれそう度・次にやること。specs/people/002-sales-list spec US1・US2・US4）。人の一覧・誘う候補・会ごとの声かけの一覧で使う。
import { jstDate, type NextAction, type PersonTag } from "@meguru/shared/people";
import { cn } from "@/lib/utils";
import { formatHeldOn } from "../format";
import { LIKELIHOOD_LABELS } from "./labels";

/**
 * 次にやることの文（日付と内容）。
 * @param action - 次にやること
 * @returns 文
 */
export function nextActionText(action: NextAction): string {
  return `${formatHeldOn(action.on)}：${action.note}`;
}

/**
 * 次にやることが過ぎているか（今日より前）。
 * @param action - 次にやること
 * @param today - 今日（日本時間の YYYY-MM-DD）
 * @returns 過ぎていれば true
 */
export function isOverdue(action: NextAction, today = jstDate(new Date())): boolean {
  return action.on < today;
}

/**
 * 人の行の印。何もなければ何も出さない。
 * @param props - tags：タグ、likelihood：来てくれそう度、nextAction：次にやること
 * @returns 印の並び
 */
export function PersonBadges({ tags, likelihood, nextAction }: { tags: PersonTag[]; likelihood: number | null; nextAction: NextAction | null }) {
  if (tags.length === 0 && likelihood === null && nextAction === null) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      {likelihood !== null && <span className="rounded-full border px-2 py-0.5">来てくれそう：{LIKELIHOOD_LABELS[likelihood]}</span>}
      {tags.map((t) => (
        <span key={t.id} className="max-w-full truncate rounded-full bg-muted px-2 py-0.5">
          #{t.name}
        </span>
      ))}
      {nextAction !== null && (
        <span className={cn("max-w-full truncate rounded-full px-2 py-0.5", isOverdue(nextAction) ? "bg-destructive/10 text-destructive" : "bg-accent")}>
          次：{nextActionText(nextAction)}
        </span>
      )}
    </div>
  );
}
