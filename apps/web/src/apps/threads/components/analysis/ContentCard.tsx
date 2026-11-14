// 内容（書き出しの型・テーマ）の表（specs/022 contracts/ui-routes.md 9）。
import type { AnalysisResponse } from "@meguru/shared";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BucketTable } from "./BucketTable";

/**
 * 内容のカード。
 * @param props - data：解析の結果、canEdit：分類できるか、onClassify：「内容を分類する」
 * @returns カード
 */
export function ContentCard({ data, canEdit, onClassify }: { data: AnalysisResponse; canEdit: boolean; onClassify: () => void }) {
  const [tab, setTab] = useState<"opening" | "theme">("opening");
  return (
    <section aria-labelledby="analysis-content" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-0.5">
          <h2 id="analysis-content" className="font-medium">
            内容（書き出しの型・テーマ）
          </h2>
          <p className="text-xs text-muted-foreground">
            分類が付いた投稿 {data.totals.classified}件 / {data.totals.confirmed}件
          </p>
        </div>
        {canEdit && (
          <Button variant="outline" size="sm" className="rounded-full" onClick={onClassify}>
            内容を分類する
          </Button>
        )}
      </div>
      <div role="tablist" aria-label="分類の種類" className="flex gap-1.5">
        {(
          [
            ["opening", "書き出しの型"],
            ["theme", "テーマ"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              "h-9 rounded-full border px-3.5 text-[13px]",
              tab === key ? "border-foreground bg-foreground text-background" : "bg-background hover:bg-accent",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "opening" ? (
        <BucketTable label="書き出しの型" rows={data.opening} />
      ) : data.theme.length === 0 ? (
        <p className="rounded-2xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          テーマがまだありません。「内容を分類する」で足せます
        </p>
      ) : (
        <BucketTable label="テーマ" rows={data.theme} />
      )}
    </section>
  );
}
