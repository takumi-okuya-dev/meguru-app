// 作業の画面のSTEP（specs/021 FR-030〜FR-032、contracts/ui-routes.md 4）。保存も状況の変更もしない。
import { MEDIA_LABELS, type FilledWorkStep, type ListingCheck, type Media } from "@meguru/shared";
import { cn } from "@/lib/utils";
import { CopyValueButton } from "./CopyValueButton";
import { RuleCounts } from "./RuleCheck";

/**
 * 作業の画面のSTEPの並び。
 * @param props - media：媒体、steps：値を差し込んだSTEP、checks：ルールのチェック、imagePromptText：画像のプロンプト
 * @returns STEPの並び
 */
export function WorkSteps({
  media,
  steps,
  checks,
  imagePromptText,
}: {
  media: Media;
  steps: readonly FilledWorkStep[];
  checks: readonly ListingCheck[];
  imagePromptText: string;
}) {
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-muted-foreground">上から順番にコピーして、{MEDIA_LABELS[media]}に貼り付けてください。</p>
      <ol aria-label="作業のSTEP" className="space-y-3">
        {steps.map((s, i) => (
          <li key={i} className={cn("space-y-2 rounded-2xl border px-3.5 py-3.5", s.ruleCheck && "border-primary/60")}>
            <span className="block text-[12px] font-semibold text-perf-poor-fg">STEP {i + 1}</span>
            <span className="block font-semibold">{s.title}</span>
            {s.instruction && <p className="text-[13px] text-muted-foreground">{s.instruction}</p>}
            {s.ruleCheck && (
              <p className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
                <RuleCounts checks={checks} />
                {checks.some((c) => c.level === "red") ? "赤の項目を直してから進めてください" : "赤の項目はありません"}
              </p>
            )}
            {s.values.map(({ field, value }) => (
              <div key={field.key} className="space-y-1 rounded-xl bg-muted/50 px-3 py-2.5">
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 text-[13px] font-medium">
                    {field.label}
                    {field.kind === "select" ? "（選ぶ）" : ""}
                    {field.required && <span className="ml-1.5 text-[11px] text-destructive">必須</span>}
                  </span>
                  <CopyValueButton text={value} label={field.label} variant="default" />
                </span>
                <span className="block text-[13px] break-words whitespace-pre-wrap">{value || "（空）"}</span>
              </div>
            ))}
            {s.image && <CopyValueButton text={imagePromptText} label="画像のプロンプト" idleText="画像のプロンプトをコピー" />}
            {s.notes.length > 0 && (
              <ul className="space-y-0.5 text-[13px] leading-relaxed text-muted-foreground">
                {s.notes.map((n) => (
                  <li key={n}>・{n}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
