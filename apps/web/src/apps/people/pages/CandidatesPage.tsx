// 「/people」：誘う候補（ホーム。specs/people/001-people-memo contracts/ui-routes.md 1・3、spec US3・US5、research.md R17）。
// 上にリピーターの数と目標・目的の切り替え（?purpose=work）・誘う会の選択・絞り込み・候補の行。
// 同意のない人はAPIが返さない（画面では絞らない）。URLに置くのは目的だけ。探す言葉と絞り込みは画面の中にだけ置く（R18）。
import { NO_INVITE_EVENT, type CandidateList, type OutreachPurpose, type PeopleEvent } from "@meguru/shared/people";
import { useQuery } from "@tanstack/react-query";
import { ChevronDownIcon, SlidersHorizontalIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { describeError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { PageBody, PageHeader } from "@/shell";
import { CandidateRow } from "../components/candidates/CandidateRow";
import { HomeTodaySection } from "../components/home/HomeTodaySection";
import { CopyFallbackDialog } from "../components/candidates/CopyFallbackDialog";
import { InviteEventPicker } from "../components/candidates/InviteEventPicker";
import { PurposeSwitch } from "../components/candidates/PurposeSwitch";
import { RepeaterBand } from "../components/candidates/RepeaterBand";
import { fieldClass } from "../components/EventForm";
import { PERSON_SORT_LABELS } from "../components/person/labels";
import { ListPager } from "../components/person/ListPager";
import { activeFilterCount, EMPTY_FILTERS, FilterChip, PersonFilters, type PersonFilterValue } from "../components/person/PersonFilters";
import { PersonSearchBox } from "../components/person/PersonSearchBox";
import { useDebouncedValue } from "../components/person/use-debounced-value";
import { peopleApi, type CandidateParams } from "../lib/api";
import { importPath } from "../lib/paths";
import { peopleQueryKeys } from "../lib/query-keys";

/** 誘う候補で選べる並べ方。 */
const CANDIDATE_SORTS = ["last_met", "likelihood"] as const;
/** 誘う候補の並べ方。 */
type CandidateSort = (typeof CANDIDATE_SORTS)[number];

/**
 * 候補の並びの中身（数・行・ページの移動）。
 * @param props - data：候補、offset：何人目から、searching：探す言葉か絞り込みがあるか、dimmed：前のページを出したまま読んでいる（行の操作は押せない）、
 *   purpose：目的、inviteEvent：誘う会、template：誘いの文の型、onFallback：コピーできなかったとき、onPage：ページを移る
 * @returns 中身
 */
function CandidateListBody({
  data,
  offset,
  searching,
  dimmed,
  purpose,
  inviteEvent,
  template,
  onFallback,
  onPage,
}: {
  data: CandidateList;
  offset: number;
  searching: boolean;
  dimmed: boolean;
  purpose: OutreachPurpose;
  inviteEvent: PeopleEvent | null;
  template: string | null | undefined;
  onFallback: (text: string) => void;
  onPage: (offset: number) => void;
}) {
  const { persons, total } = data;
  return (
    <>
      <div className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
        {searching ? `当てはまる人 ${total}人` : `候補 ${total}人`}
        {total > persons.length && persons.length > 0 && `（${offset + 1}〜${offset + persons.length}人目）`}
      </div>
      {persons.length === 0 ? (
        searching ? (
          <p className="py-10 text-center text-sm text-muted-foreground">当てはまる人がいません。</p>
        ) : (
          <p className="py-10 text-center text-sm text-muted-foreground">
            個別の案内に同意した人が、まだいません。
            <Link to={importPath()} className="underline">
              アンケートを取り込む
            </Link>
            と、同意した人がここに並びます。
          </p>
        )
      ) : (
        <ul className={cn("divide-y rounded-2xl border bg-card", dimmed && "opacity-60")}>
          {persons.map((p) => (
            // 誘う会を変えたら、行の「コピーした」を捨てる
            <CandidateRow
              key={`${p.id}:${inviteEvent?.id ?? ""}`}
              person={p}
              purpose={purpose}
              inviteEvent={inviteEvent}
              template={template}
              locked={dimmed}
              onFallback={onFallback}
            />
          ))}
        </ul>
      )}
      <ListPager offset={offset} total={total} onPage={onPage} />
    </>
  );
}

/**
 * 誘う候補の画面。
 * @returns 画面
 */
export function CandidatesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const purpose: OutreachPurpose = searchParams.get("purpose") === "work" ? "work" : "invite";
  const [text, setText] = useState("");
  const q = useDebouncedValue(text.trim());
  const [filters, setFilters] = useState<PersonFilterValue>(EMPTY_FILTERS);
  const [visitedOwn, setVisitedOwn] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  // 誘う会：選んでいなければ（undefined）次の自分の会。空の文字は「選んでいない」を選んだ
  const [eventChoice, setEventChoice] = useState<string | undefined>(undefined);
  const [page, setPage] = useState({ key: "", offset: 0 });
  const [fallbackText, setFallbackText] = useState<string | null>(null);
  const topRef = useRef<HTMLDivElement>(null);

  const stats = useQuery({ queryKey: peopleQueryKeys.stats, queryFn: peopleApi.stats });
  const settings = useQuery({ queryKey: peopleQueryKeys.settings, queryFn: peopleApi.settings });
  const events = useQuery({ queryKey: peopleQueryKeys.events, queryFn: peopleApi.events });
  const facets = useQuery({ queryKey: peopleQueryKeys.facets, queryFn: peopleApi.facets });
  const tags = useQuery({ queryKey: peopleQueryKeys.tags, queryFn: peopleApi.tags });
  // 並べ方（誘う候補は、最後に会った順か来てくれそう度順。画面の中だけ）
  const [sort, setSort] = useState<CandidateSort>("last_met");

  const ownEvents: PeopleEvent[] = (events.data ?? []).filter((e) => e.isOwn);
  // 誘う会：選んでいなければ API が次の自分の会を選ぶ（eventId を送らない）。選んだ会が一覧にない（消した会など）ときは「選んでいない」
  const inviteEventParam =
    eventChoice === undefined ? undefined : eventChoice === "" || (events.isSuccess && !ownEvents.some((e) => e.id === eventChoice)) ? NO_INVITE_EVENT : eventChoice;
  // 設定が読めないときは初めの型（null）で文を作る。読み込み中は undefined（コピーを待つ）
  const template = settings.isSuccess ? settings.data.inviteTemplate : settings.isError ? null : undefined;

  // 探す言葉・絞り込み・目的が変わったら、1ページ目に戻す
  const searchKey = JSON.stringify([purpose, q, filters, visitedOwn, sort]);
  const offset = page.key === searchKey ? page.offset : 0;
  const params: CandidateParams = {
    ...filters,
    purpose,
    eventId: purpose === "invite" ? inviteEventParam : undefined,
    visitedOwn,
    sort,
    ...(q !== "" ? { q } : {}),
    offset,
  };
  const candidates = useQuery({
    queryKey: peopleQueryKeys.candidates(params),
    queryFn: () => peopleApi.candidates(params),
    // ページを移る・絞り込むあいだは前の行を出したままにする（行の操作は押せない）。目的か誘う会を替えたときは出さない
    // （同意のちがう人を一瞬でも並べない・前の会の声かけを進めたり消したりしない）
    placeholderData: (prev, prevQuery) =>
      prevQuery?.queryKey[3].purpose === purpose && prevQuery.queryKey[3].eventId === params.eventId ? prev : undefined,
  });
  // 行の声かけを読んだ誘う会（API が決めた会。読み込み中は、選んだ会があればそれ）
  const inviteEvent = purpose === "invite" ? (candidates.data?.inviteEvent ?? null) : null;
  const inviteEventId = inviteEventParam === NO_INVITE_EVENT ? "" : (inviteEventParam ?? inviteEvent?.id ?? "");
  // 選べる会：イベントの一覧が読めるまで・読めないときも、API が決めた会は出す
  const pickerEvents = inviteEvent && !ownEvents.some((e) => e.id === inviteEvent.id) ? [inviteEvent, ...ownEvents] : ownEvents;

  const filterCount = activeFilterCount(filters) + (visitedOwn ? 1 : 0);
  const searching = q !== "" || filterCount > 0;
  const goTo = (next: number) => {
    setPage({ key: searchKey, offset: next });
    topRef.current?.scrollIntoView?.({ block: "start" });
  };
  const changePurpose = (next: OutreachPurpose) => setSearchParams(next === "work" ? { purpose: "work" } : {});

  return (
    <>
      <PageHeader title="誘う候補" />
      <PageBody className="space-y-4">
        <HomeTodaySection />
        <RepeaterBand stats={stats.data} />
        <PurposeSwitch value={purpose} onChange={changePurpose} />
        <p className="text-[13px] text-muted-foreground">個別の案内に同意した人だけを出しています</p>
        {purpose === "invite" ? (
          <>
            <InviteEventPicker value={inviteEventId} events={pickerEvents} loading={events.isPending} failed={events.isError} onChange={setEventChoice} />
            {settings.isError && (
              <p className="text-[13px] text-muted-foreground">誘いの文の型を読めなかったので、初めの型で文を作ります。</p>
            )}
          </>
        ) : (
          <p className="rounded-xl bg-muted px-3 py-2 text-[13px] text-muted-foreground">
            本人に聞いて、OKをもらってからつなぎます。ここは記録だけで、相手の情報をどこかへ送ることはしません。
          </p>
        )}

        <div ref={topRef} className="scroll-mt-16 space-y-2">
          <PersonSearchBox value={text} onChange={setText} label="候補を探す" />
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
          {showFilters && (
            <PersonFilters
              value={filters}
              onChange={setFilters}
              facets={facets.data}
              tags={tags.data}
              showEvent={false}
              showCounts={false}
              lead={
                <fieldset className="space-y-1.5">
                  <legend className="text-sm font-medium">自分の会</legend>
                  <FilterChip pressed={visitedOwn} onClick={() => setVisitedOwn((v) => !v)}>
                    前に来た
                  </FilterChip>
                </fieldset>
              }
              extraCount={visitedOwn ? 1 : 0}
              onClear={() => {
                setFilters(EMPTY_FILTERS);
                setVisitedOwn(false);
              }}
            />
          )}
          <div className="space-y-1">
            <label htmlFor="people-candidate-sort" className="text-[13px] text-muted-foreground">
              並べ方
            </label>
            <select id="people-candidate-sort" className={fieldClass} value={sort} onChange={(e) => setSort(e.target.value as CandidateSort)}>
              {CANDIDATE_SORTS.map((s) => (
                <option key={s} value={s}>
                  {PERSON_SORT_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
        </div>

        {candidates.isPending ? (
          <p className="py-10 text-center text-sm text-muted-foreground">読み込んでいます…</p>
        ) : candidates.isError ? (
          <div className="space-y-2 py-10 text-center">
            <p role="alert" className="text-sm text-destructive">
              {describeError(candidates.error)}
            </p>
            <Button variant="outline" className="h-11 rounded-full md:h-9" onClick={() => void candidates.refetch()}>
              読み込み直す
            </Button>
          </div>
        ) : (
          <CandidateListBody
            data={candidates.data}
            offset={offset}
            searching={searching}
            dimmed={candidates.isPlaceholderData}
            purpose={purpose}
            inviteEvent={inviteEvent}
            template={template}
            onFallback={setFallbackText}
            onPage={goTo}
          />
        )}
      </PageBody>
      {fallbackText !== null && <CopyFallbackDialog text={fallbackText} onClose={() => setFallbackText(null)} />}
    </>
  );
}
