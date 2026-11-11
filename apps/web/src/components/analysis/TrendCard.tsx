// 伸びた傾向（specs/022 contracts/ui-routes.md 4）。「プロンプトに入れる」の切り替えつき。
// 時間帯・曜日の傾向は文章では変えられないので、プロンプトに入らず「時刻の参考」の印を付ける（research.md R7）。
import type { AnalysisResponse } from "@meguru/shared";
import { useId } from "react";
import { Switch } from "@/components/ui/switch";
import { num } from "./format";

/**
 * 伸びた傾向のカード。
 * @param props - trends：傾向、trendsInPrompt：プロンプトに入れるか、canEdit：切り替えられるか、saving：保存中、onToggle：切り替え
 * @returns カード
 */
export function TrendCard({
  trends,
  trendsInPrompt,
  canEdit,
  saving,
  onToggle,
}: {
  trends: AnalysisResponse["trends"];
  trendsInPrompt: boolean;
  canEdit: boolean;
  saving: boolean;
  onToggle: (on: boolean) => void;
}) {
  const labelId = useId();
  return (
    <section aria-labelledby="analysis-trends" className="space-y-3 rounded-2xl border p-4 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="analysis-trends" className="font-medium">
          伸びた傾向
        </h2>
        {canEdit && (
          <span className="flex min-h-11 items-center gap-2 text-[13px]">
            <span id={labelId}>プロンプトに入れる</span>
            <Switch aria-labelledby={labelId} checked={trendsInPrompt} disabled={saving} onCheckedChange={onToggle} />
          </span>
        )}
      </div>
      {trends.length === 0 ? (
        <p className="text-sm text-muted-foreground">まだはっきりした傾向はありません</p>
      ) : (
        <ul aria-label="伸びた傾向" className="space-y-2">
          {trends.map((t) => (
            <li key={`${t.dimension}-${t.key}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-xl bg-muted px-3.5 py-3 text-sm">
              <span className="min-w-0 flex-[1_1_16rem] font-medium">
                {t.text}
                {!t.promptable && (
                  <span className="ml-1.5 inline-block rounded-full border bg-background px-2 text-[11px] font-normal text-muted-foreground">
                    時刻の参考
                  </span>
                )}
              </span>
              <span className="text-xs text-muted-foreground">
                {t.count}件・閲覧の中央値 {num(t.views)}（ほかの投稿 {num(t.otherViews)}）
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">次の投稿のプロンプトに入ります（最大5つ）。人柄・CORE RULESを優先します。</p>
    </section>
  );
}
