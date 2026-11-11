// おすすめに乗った目安の投稿（specs/022 contracts/ui-routes.md 5、FR-020〜FR-023）。
// パソコンは列にそろえ、スマートフォンは1件ずつ縦に積む（モック「解析（スマートフォン）」）。
import type { AnalysisResponse } from "@meguru/shared";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatJstWithWeekday } from "@/lib/format";
import { num, pct, times } from "./format";

const FIRST = 3;
const COLS = "md:grid md:grid-cols-[minmax(0,2.6fr)_4.5rem_4.5rem_5.5rem_5.5rem_4.5rem] md:items-center md:gap-3";

/**
 * おすすめに乗った目安のカード。
 * @param props - recommended：解析の結果の recommended、withFollowers：広がりを求められた投稿の数、confirmed：確定した投稿の数
 * @returns カード
 */
export function RecommendedCard({
  recommended,
  withFollowers,
  confirmed,
}: {
  recommended: AnalysisResponse["recommended"];
  withFollowers: number;
  confirmed: number;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? recommended.posts : recommended.posts.slice(0, FIRST);
  const rest = recommended.posts.length - shown.length;
  const c = recommended.compare;
  return (
    <section aria-labelledby="analysis-recommended" className="space-y-3 rounded-2xl border p-4 md:p-5">
      <div className="space-y-0.5">
        <h2 id="analysis-recommended" className="font-medium">
          おすすめに乗った目安の投稿
        </h2>
        {recommended.available && (
          <p className="text-xs text-muted-foreground">
            フォロワー数より多く見られた投稿（広がりの上位20%）。{recommended.posts.length}件
          </p>
        )}
      </div>
      {!recommended.available ? (
        <p className="text-sm text-muted-foreground">フォロワー数の記録がある投稿が10件たまると見られます</p>
      ) : recommended.posts.length === 0 ? (
        <p className="text-sm text-muted-foreground">まだフォロワー数より多く見られた投稿はありません</p>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border">
            <div aria-hidden="true" className={`hidden border-b bg-muted/60 px-4 py-2.5 text-xs text-muted-foreground ${COLS}`}>
              <span>投稿</span>
              <span className="text-right">閲覧</span>
              <span className="text-right">広がり</span>
              <span className="text-right">初速（24時間）</span>
              <span className="text-right">後からの伸び</span>
              <span className="text-right">返信率</span>
            </div>
            <ul aria-label="おすすめに乗った目安の投稿" className="divide-y">
              {shown.map((p) => (
                <li key={p.id} className={`flex flex-col gap-1 px-4 py-3 text-sm ${COLS}`}>
                  <span className="min-w-0">
                    <span className="block font-medium">{p.head}</span>
                    <span className="block text-xs text-muted-foreground">{formatJstWithWeekday(p.publishedAt)}</span>
                  </span>
                  <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground md:contents md:text-sm md:text-foreground">
                    <span className="md:text-right">
                      <span className="md:hidden">閲覧 </span>
                      {num(p.views)}
                    </span>
                    <span className="font-semibold text-foreground md:text-right">
                      <span className="md:hidden">広がり </span>
                      {times(p.spread)}
                    </span>
                    <span className="md:text-right">
                      <span className="md:hidden">初速 </span>
                      {num(p.firstSpeed)}
                    </span>
                    <span className="md:text-right">
                      <span className="md:hidden">後から </span>
                      {times(p.laterGrowth)}
                    </span>
                    <span className="md:text-right">
                      <span className="md:hidden">返信率 </span>
                      {pct(p.replyRate)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          {rest > 0 && (
            <Button variant="outline" size="sm" className="rounded-full" onClick={() => setAll(true)}>
              残りの{rest}件を見る
            </Button>
          )}
          {c && (
            <div className="space-y-2">
              <h3 className="text-[13px] font-medium">ほかの投稿とのちがい（中央値）</h3>
              <dl className="grid gap-2 text-[13px] md:grid-cols-2">
                {[
                  { label: `おすすめに乗った目安（${c.recommended.count}件）`, v: c.recommended },
                  { label: `ほかの投稿（${c.others.count}件）`, v: c.others },
                ].map(({ label, v }) => (
                  <div key={label} className="space-y-1 rounded-xl bg-muted/60 px-3.5 py-2.5">
                    <dt className="font-medium">{label}</dt>
                    <dd className="flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
                      <span>初速 {num(v.firstSpeed)}</span>
                      <span>後からの伸び {times(v.laterGrowth)}</span>
                      <span>返信率 {pct(v.replyRate)}</span>
                      <span>文字数 {num(v.length)}字</span>
                      <span>
                        問いかけあり {v.questionCount}件 / {v.count}件
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </>
      )}
      {recommended.available && withFollowers < confirmed && (
        <p className="text-xs text-muted-foreground">
          フォロワー数を記録する前の{confirmed - withFollowers}件は、広がりを出せないので外しています。
        </p>
      )}
    </section>
  );
}
