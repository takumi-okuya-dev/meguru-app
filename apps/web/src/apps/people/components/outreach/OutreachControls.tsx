// 声かけの進み具合のボタンと「声かけの記録を消す」（誘う候補の行と人のページで同じものを使う。specs/people/001-people-memo research.md R16）。
// 仕事のつなぎでは、OKをもらうまで（approvedAt がないあいだ）「つないだ」を出さない（本人のOKのあとでつなぐ。FR-023。サーバーと同じ条件）。
import { OUTREACH_STAGES, type Outreach, type OutreachStage } from "@meguru/shared/people";
import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { describeError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { OUTREACH_STAGE_LABELS } from "../person/labels";

/**
 * 出す段（仕事のつなぎは、OKをもらうまで「つないだ」を出さない）。
 * @param outreach - 声かけ
 * @returns 段の並び
 */
export function visibleStages(outreach: Pick<Outreach, "purpose" | "approvedAt">): readonly OutreachStage[] {
  if (outreach.purpose === "work" && outreach.approvedAt === null) return OUTREACH_STAGES.work.filter((s) => s !== "connected");
  return OUTREACH_STAGES[outreach.purpose];
}

/**
 * 進み具合のボタンと「声かけの記録を消す」。今の段を濃く出し、押すとその段にする（戻すのは押し間違いを直すため）。
 * @param props - outreach：声かけ、pending：書いている途中（押せない）、onChange：段を選んだとき、onRemove：記録を消す、label：読み上げの名前
 * @returns ボタンの並び
 */
export function OutreachStageButtons({
  outreach,
  pending,
  onChange,
  onRemove,
  label = "進み具合",
}: {
  outreach: Outreach;
  pending: boolean;
  onChange: (stage: OutreachStage) => void;
  onRemove: () => void;
  label?: string;
}) {
  const labels: Record<string, string> = OUTREACH_STAGE_LABELS[outreach.purpose];
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
        {visibleStages(outreach).map((s) => {
          const on = s === outreach.stage;
          return (
            <button
              key={s}
              type="button"
              aria-pressed={on}
              disabled={pending}
              className={cn(
                "min-h-11 rounded-full border px-3 text-sm disabled:opacity-60 md:min-h-8",
                on ? "border-foreground bg-foreground text-background" : "bg-card hover:bg-accent",
              )}
              onClick={() => !on && onChange(s)}
            >
              {labels[s]}
            </button>
          );
        })}
      </div>
      <Button type="button" variant="ghost" size="icon" className="size-11 rounded-full md:size-8" aria-label="声かけの記録を消す" disabled={pending} onClick={onRemove}>
        <XIcon className="size-4" />
      </Button>
    </div>
  );
}

/**
 * 操作のエラーの文言。
 * @param props - error：エラー（なければ何も出さない）
 * @returns 文言
 */
export function ActionError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-[13px] text-destructive">
      {describeError(error)}
    </p>
  );
}
