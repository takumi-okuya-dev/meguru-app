// 「/people/list」：人の一覧（specs/people/001-people-memo contracts/ui-routes.md 1、research.md R22）。
// 探す欄（名前・LINE名・メモ）・絞り込み・人の行（最後に会った日の新しい順・100人ずつ）・「人を足す」。
// 探す言葉と絞り込みは画面の中にだけ置く（URLやブラウザの保存に名前・答えを残さない。R18）。
import { PERSONS_PAGE_SIZE, type PersonList } from "@meguru/shared/people";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronDownIcon, PlusIcon, SlidersHorizontalIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { describeError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { PageBody, PageHeader } from "@/shell";
import { activeFilterCount, EMPTY_FILTERS, PersonFilters, type PersonFilterValue } from "../components/person/PersonFilters";
import { PersonRow } from "../components/person/PersonRow";
import { PersonSearchBox } from "../components/person/PersonSearchBox";
import { useDebouncedValue } from "../components/person/use-debounced-value";
import { peopleApi, type PersonListParams } from "../lib/api";
import { importPath, newPersonPath } from "../lib/paths";
import { peopleQueryKeys } from "../lib/query-keys";

/**
 * 一覧の中身（数・行・ページの移動）。
 * @param props - data：一覧、offset：何人目から、searching：探す言葉か絞り込みがあるか、dimmed：前のページを出したまま読んでいる、onPage：ページを移る
 * @returns 一覧の中身
 */
function PersonListBody({
  data,
  offset,
  searching,
  dimmed,
  onPage,
}: {
  data: PersonList;
  offset: number;
  searching: boolean;
  dimmed: boolean;
  onPage: (offset: number) => void;
}) {
  const { persons, total } = data;
  const paged = total > PERSONS_PAGE_SIZE;
  return (
    <>
      <div className="flex items-center justify-between text-sm text-muted-foreground" aria-live="polite">
        <span className="tabular-nums">{searching ? `当てはまる人 ${total}人` : `全 ${total}人`}</span>
        {paged && persons.length > 0 && (
          <span className="tabular-nums">
            {offset + 1}〜{offset + persons.length}人目
          </span>
        )}
      </div>
      {persons.length === 0 ? (
        searching ? (
          <p className="py-10 text-center text-sm text-muted-foreground">当てはまる人がいません。</p>
        ) : (
          <p className="py-10 text-center text-sm text-muted-foreground">
            まだ人がいません。
            <Link to={importPath()} className="underline">
              アンケートを取り込む
            </Link>
            か、「人を足す」から足してください。
          </p>
        )
      ) : (
        <ul className={cn("divide-y rounded-2xl border bg-card", dimmed && "opacity-60")}>
          {persons.map((p) => (
            <PersonRow key={p.id} person={p} />
          ))}
        </ul>
      )}
      {paged && (
        <nav aria-label="ページ" className="flex justify-between gap-2">
          <Button variant="outline" className="h-11 rounded-full md:h-9" disabled={offset === 0} onClick={() => onPage(Math.max(0, offset - PERSONS_PAGE_SIZE))}>
            前の{PERSONS_PAGE_SIZE}人
          </Button>
          <Button variant="outline" className="h-11 rounded-full md:h-9" disabled={offset + PERSONS_PAGE_SIZE >= total} onClick={() => onPage(offset + PERSONS_PAGE_SIZE)}>
            次の{PERSONS_PAGE_SIZE}人
          </Button>
        </nav>
      )}
    </>
  );
}

/**
 * 人の一覧の画面。
 * @returns 画面
 */
export function PeopleListPage() {
  const [text, setText] = useState("");
  const q = useDebouncedValue(text.trim());
  const [filters, setFilters] = useState<PersonFilterValue>(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState({ key: "", offset: 0 });
  const topRef = useRef<HTMLDivElement>(null);
  // 探す言葉か絞り込みが変わったら、1ページ目に戻す
  const searchKey = JSON.stringify([q, filters]);
  const offset = page.key === searchKey ? page.offset : 0;
  const params: PersonListParams = { ...filters, ...(q !== "" ? { q } : {}), offset };

  const persons = useQuery({ queryKey: peopleQueryKeys.personList(params), queryFn: () => peopleApi.persons(params), placeholderData: keepPreviousData });
  const facets = useQuery({ queryKey: peopleQueryKeys.facets, queryFn: peopleApi.facets });
  const events = useQuery({ queryKey: peopleQueryKeys.events, queryFn: peopleApi.events });

  const filterCount = activeFilterCount(filters);
  const add = (
    <Button asChild size="sm" className="h-9 rounded-full">
      <Link to={newPersonPath()}>
        <PlusIcon /> 人を足す
      </Link>
    </Button>
  );
  const goTo = (next: number) => {
    setPage({ key: searchKey, offset: next });
    // 中身の枠（外枠のスクロールする所）の上へ戻す
    topRef.current?.scrollIntoView?.({ block: "start" });
  };

  return (
    <>
      <PageHeader title="人" actions={add} />
      <PageBody className="space-y-4">
        <div ref={topRef} className="scroll-mt-16 space-y-2">
          <PersonSearchBox value={text} onChange={setText} />
          <Button
            type="button"
            variant="outline"
            className="h-11 rounded-full md:h-9"
            aria-expanded={showFilters}
            onClick={() => setShowFilters((v) => !v)}
          >
            <SlidersHorizontalIcon /> 絞り込み
            {filterCount > 0 && <span className="rounded-full bg-foreground px-1.5 text-xs text-background tabular-nums">{filterCount}</span>}
            <ChevronDownIcon className={cn("transition-transform", showFilters && "rotate-180")} aria-hidden="true" />
          </Button>
          {showFilters && <PersonFilters value={filters} onChange={setFilters} facets={facets.data} events={events.data} />}
        </div>

        {persons.isPending ? (
          <p className="py-10 text-center text-sm text-muted-foreground">読み込んでいます…</p>
        ) : persons.isError ? (
          <div className="space-y-2 py-10 text-center">
            <p role="alert" className="text-sm text-destructive">
              {describeError(persons.error)}
            </p>
            <Button variant="outline" className="h-11 rounded-full md:h-9" onClick={() => void persons.refetch()}>
              読み込み直す
            </Button>
          </div>
        ) : (
          <PersonListBody data={persons.data} offset={offset} searching={q !== "" || filterCount > 0} dimmed={persons.isPlaceholderData} onPage={goTo} />
        )}
      </PageBody>
    </>
  );
}
