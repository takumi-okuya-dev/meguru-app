// 「/people/list」：人の一覧（specs/people/001-people-memo contracts/ui-routes.md 1、research.md R22）。
// 探す欄（名前・LINE名・メモ・連絡の記録・自由な項目）・絞り込み（タグ・来てくれそう度も。specs/people/002）・並べ方とまとめた表示・
// 人の行（100人ずつ）・「人を足す」・「書き出す」。
// 探す言葉と絞り込みは画面の中にだけ置く（URLやブラウザの保存に名前・答えを残さない。R18）。並べ方はAPIで覚える（どの端末でも同じ。FR-103）。
import {
  PERSON_GROUPS,
  PERSON_SORTS,
  PERSONS_PAGE_SIZE,
  type PersonGroup,
  type PersonList,
  type PersonSort,
  type PersonView,
} from "@meguru/shared/people";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDownIcon, DownloadIcon, PlusIcon, SlidersHorizontalIcon } from "lucide-react";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { describeError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { PageBody, PageHeader } from "@/shell";
import { fieldClass } from "../components/EventForm";
import { PERSON_GROUP_LABELS, PERSON_SORT_LABELS } from "../components/person/labels";
import { ListPager } from "../components/person/ListPager";
import { groupPersons } from "../components/person/person-groups";
import { activeFilterCount, EMPTY_FILTERS, PersonFilters, type PersonFilterValue } from "../components/person/PersonFilters";
import { PersonRow } from "../components/person/PersonRow";
import { PersonSearchBox } from "../components/person/PersonSearchBox";
import { useDebouncedValue } from "../components/person/use-debounced-value";
import { peopleApi, type PersonListParams } from "../lib/api";
import { saveFile } from "../lib/save-file";
import { importPath, newPersonPath } from "../lib/paths";
import { peopleQueryKeys } from "../lib/query-keys";

/** 並べ方を覚えるまでの初めの値（APIの初めの値と同じ）。 */
const DEFAULT_VIEW: PersonView = { sort: "last_met", group: "none" };

/** 書き出せる人数の上限（API の person-export.ts と同じ）。 */
const EXPORT_LIMIT = 10_000;

/**
 * 一覧の中身（数・行・ページの移動）。
 * @param props - data：一覧、offset：何人目から、searching：探す言葉か絞り込みがあるか、dimmed：前のページを出したまま読んでいる、
 *   group：まとめ方、onPage：ページを移る
 * @returns 一覧の中身
 */
function PersonListBody({
  data,
  offset,
  searching,
  dimmed,
  group,
  onPage,
}: {
  data: PersonList;
  offset: number;
  searching: boolean;
  dimmed: boolean;
  group: PersonGroup;
  onPage: (offset: number) => void;
}) {
  const { persons, total } = data;
  const paged = total > PERSONS_PAGE_SIZE;
  const blocks = groupPersons(persons, group);
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
        <div className={cn("space-y-4", dimmed && "opacity-60")}>
          {blocks.map((b) => (
            <section key={b.key} aria-label={b.label ?? undefined} className="space-y-1.5">
              {b.label !== null && (
                <h2 className="flex items-baseline gap-2 text-sm font-medium">
                  <span className="break-words">{b.label}</span>
                  <span className="text-muted-foreground tabular-nums">{b.persons.length}人</span>
                </h2>
              )}
              <ul className="divide-y rounded-2xl border bg-card">
                {b.persons.map((p) => (
                  <PersonRow key={p.id} person={p} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      <ListPager offset={offset} total={total} onPage={onPage} />
    </>
  );
}

/**
 * 並べ方とまとめた表示の選択。
 * @param props - value：今の並べ方、disabled：読み込み中、onChange：選んだとき
 * @returns 選択
 */
function ViewPicker({ value, disabled, onChange }: { value: PersonView; disabled: boolean; onChange: (view: PersonView) => void }) {
  const id = useId();
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="min-w-0 space-y-1">
        <label htmlFor={`${id}-sort`} className="text-[13px] text-muted-foreground">
          並べ方
        </label>
        <select
          id={`${id}-sort`}
          className={fieldClass}
          value={value.sort}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, sort: e.target.value as PersonSort })}
        >
          {PERSON_SORTS.map((s) => (
            <option key={s} value={s}>
              {PERSON_SORT_LABELS[s]}
            </option>
          ))}
        </select>
      </div>
      <div className="min-w-0 space-y-1">
        <label htmlFor={`${id}-group`} className="text-[13px] text-muted-foreground">
          まとめ方
        </label>
        <select
          id={`${id}-group`}
          className={fieldClass}
          value={value.group}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, group: e.target.value as PersonGroup })}
        >
          {PERSON_GROUPS.map((g) => (
            <option key={g} value={g}>
              {PERSON_GROUP_LABELS[g]}
            </option>
          ))}
        </select>
      </div>
    </div>
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
  const queryClient = useQueryClient();
  // 並べ方：選んだら画面の値、選ぶまではAPIで覚えた値（読めなければ初めの値）
  const settings = useQuery({ queryKey: peopleQueryKeys.settings, queryFn: peopleApi.settings });
  const [viewChoice, setViewChoice] = useState<PersonView | null>(null);
  const view = viewChoice ?? settings.data?.personView ?? DEFAULT_VIEW;
  const saveView = useMutation({
    mutationFn: (personView: PersonView) => peopleApi.updateSettings({ personView }),
    onSuccess: (saved) => queryClient.setQueryData(peopleQueryKeys.settings, saved),
    onError: () => toast.error("並べ方を覚えられませんでした。この画面では選んだ並べ方で出します。"),
  });
  const changeView = (next: PersonView) => {
    setViewChoice(next);
    saveView.mutate(next);
  };
  // 探す言葉か絞り込みか並べ方が変わったら、1ページ目に戻す
  const searchKey = JSON.stringify([q, filters, view.sort]);
  const offset = page.key === searchKey ? page.offset : 0;
  const params: PersonListParams = { ...filters, ...(q !== "" ? { q } : {}), sort: view.sort, offset };

  const persons = useQuery({
    queryKey: peopleQueryKeys.personList(params),
    queryFn: () => peopleApi.persons(params),
    placeholderData: keepPreviousData,
    // 覚えた並べ方がわかってから読む（2回読まないように）
    enabled: !settings.isPending,
  });
  const facets = useQuery({ queryKey: peopleQueryKeys.facets, queryFn: peopleApi.facets });
  const events = useQuery({ queryKey: peopleQueryKeys.events, queryFn: peopleApi.events });
  const tags = useQuery({ queryKey: peopleQueryKeys.tags, queryFn: peopleApi.tags });
  const exportList = useMutation({
    mutationFn: () => peopleApi.exportPersons(params),
    onSuccess: ({ blob, filename }) => {
      saveFile(blob, filename);
      // 1万人を超えると、APIは最初の1万人だけを書き出す
      if ((persons.data?.total ?? 0) > EXPORT_LIMIT) toast.warning("最初の1万人だけ書き出しました。");
      else toast.success("書き出しました。");
    },
  });

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
          {showFilters && <PersonFilters value={filters} onChange={setFilters} facets={facets.data} events={events.data} tags={tags.data} />}
          <ViewPicker value={view} disabled={settings.isPending} onChange={changeView} />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" className="h-11 rounded-full md:h-9" disabled={exportList.isPending || !persons.isSuccess} onClick={() => exportList.mutate()}>
              <DownloadIcon /> 書き出す
            </Button>
            <span className="text-[13px] text-muted-foreground">今の絞り込みに合う人を、CSVで保存します。</span>
          </div>
          {exportList.isError && (
            <p role="alert" className="text-[13px] text-destructive">
              {describeError(exportList.error)}
            </p>
          )}
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
          <PersonListBody
            data={persons.data}
            offset={offset}
            searching={q !== "" || filterCount > 0}
            dimmed={persons.isPlaceholderData}
            group={view.group}
            onPage={goTo}
          />
        )}
      </PageBody>
    </>
  );
}
