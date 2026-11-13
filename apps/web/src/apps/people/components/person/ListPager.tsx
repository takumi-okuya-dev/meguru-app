// 人の並び（人の一覧・誘う候補）のページの移動（100人ずつ。specs/people/001-people-memo research.md R22）。
import { PERSONS_PAGE_SIZE } from "@meguru/shared/people";
import { Button } from "@/components/ui/button";

/**
 * 「前の100人」「次の100人」。100人以下なら何も出さない。
 * @param props - offset：何人目から、total：全体の数、onPage：ページを移る
 * @returns ページの移動
 */
export function ListPager({ offset, total, onPage }: { offset: number; total: number; onPage: (offset: number) => void }) {
  if (total <= PERSONS_PAGE_SIZE) return null;
  return (
    <nav aria-label="ページ" className="flex justify-between gap-2">
      <Button variant="outline" className="h-11 rounded-full md:h-9" disabled={offset === 0} onClick={() => onPage(Math.max(0, offset - PERSONS_PAGE_SIZE))}>
        前の{PERSONS_PAGE_SIZE}人
      </Button>
      <Button variant="outline" className="h-11 rounded-full md:h-9" disabled={offset + PERSONS_PAGE_SIZE >= total} onClick={() => onPage(offset + PERSONS_PAGE_SIZE)}>
        次の{PERSONS_PAGE_SIZE}人
      </Button>
    </nav>
  );
}
