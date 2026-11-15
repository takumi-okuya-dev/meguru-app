// 人の一覧の絞り込み（来たイベント・次回参加・欲しいつながり・キャリアの興味・最後に会った日。specs/people/001-people-memo research.md R22）。
// 答えの値は、いちばん新しい回答に出てくる値（GET /api/people/facets）をチップで出す。
// 誘う候補の画面でも使う（来たイベントの代わりに「前に来た」を頭に置く）。
import type { FacetValue, PeopleEvent, PeopleFacets, PeopleTag } from "@meguru/shared/people";
import { useId, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fieldClass } from "../EventForm";
import { formatHeldOn } from "../format";
import { LIKELIHOOD_CHOICES } from "./labels";

/** 絞り込みの値（省いた項目は絞らない）。 */
export type PersonFilterValue = {
  eventId?: string;
  next: string[];
  wanted: string[];
  career: string[];
  lastMetFrom?: string;
  lastMetTo?: string;
  /** 002：タグ（どれかを持つ）・来てくれそう度（3・2・1・none） */
  tag: string[];
  likelihood: string[];
};

/** 何も絞らない値。 */
export const EMPTY_FILTERS: PersonFilterValue = { next: [], wanted: [], career: [], tag: [], likelihood: [] };

/**
 * 絞り込んでいる項目の数。
 * @param v - 絞り込みの値
 * @returns 数
 */
export function activeFilterCount(v: PersonFilterValue): number {
  return (
    (v.eventId ? 1 : 0) +
    v.next.length +
    v.wanted.length +
    v.career.length +
    (v.lastMetFrom ? 1 : 0) +
    (v.lastMetTo ? 1 : 0) +
    v.tag.length +
    v.likelihood.length
  );
}

/** 答えの項目（facets の項目と、絞り込みの値の項目）。 */
const FACET_GROUPS: { facet: keyof PeopleFacets; key: "next" | "wanted" | "career"; label: string }[] = [
  { facet: "nextAttendance", key: "next", label: "次回参加" },
  { facet: "wantedConnections", key: "wanted", label: "欲しいつながり" },
  { facet: "careerInterests", key: "career", label: "キャリアの興味" },
];

/**
 * 値を足す・外す。
 * @param list - 今の値
 * @param value - 押した値
 * @returns 新しい値
 */
function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/**
 * 押すと選ぶ・外すを切り替えるチップ。
 * @param props - pressed：選んでいるか、onClick：押したとき、children：中身
 * @returns チップ
 */
export function FilterChip({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={cn(
        "inline-flex min-h-11 max-w-full items-center gap-1 rounded-full border px-3 text-sm md:min-h-8",
        pressed ? "border-foreground bg-foreground text-background" : "bg-card hover:bg-accent",
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/**
 * 答えの値のチップの並び。
 * @param props - label：項目の名前、values：選べる値、selected：選んだ値、onToggle：押したとき、showCounts：人数を出すか
 * @returns チップの並び
 */
function ChipGroup({
  label,
  values: facetValues,
  selected,
  onToggle,
  showCounts,
}: {
  label: string;
  values: FacetValue[];
  selected: string[];
  onToggle: (value: string) => void;
  showCounts: boolean;
}) {
  // 選んだ値が選べる値からなくなっても（その値の人を消した・まとめた）、外せるようにチップを残す（0人）
  const values = [...facetValues, ...selected.filter((v) => !facetValues.some((f) => f.value === v)).map((v) => ({ value: v, count: 0 }))];
  if (values.length === 0) return null;
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {values.map((f) => {
          const on = selected.includes(f.value);
          return (
            <FilterChip key={f.value} pressed={on} onClick={() => onToggle(f.value)}>
              <span className="truncate">{f.value}</span>
              {showCounts && <span className={cn("shrink-0 tabular-nums", on ? "text-background/80" : "text-muted-foreground")}>{f.count}人</span>}
            </FilterChip>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * 人の一覧の絞り込み。
 * @param props - value：絞り込みの値、onChange：変わったとき、facets：選べる答えの値、events：選べるイベント、tags：選べるタグ、showEvent：「来たイベント」を出すか、
 *   showCounts：チップに人数（全員の中の数）を出すか、lead：頭に置くほかの絞り込み、extraCount：lead で絞っている数、
 *   onClear：「絞り込みを外す」（省くと value だけを空にする）
 * @returns 絞り込み
 */
export function PersonFilters({
  value,
  onChange,
  facets,
  events,
  tags,
  showEvent = true,
  showCounts = true,
  lead,
  extraCount = 0,
  onClear,
}: {
  value: PersonFilterValue;
  onChange: (value: PersonFilterValue) => void;
  facets: PeopleFacets | undefined;
  events?: PeopleEvent[] | undefined;
  tags?: PeopleTag[] | undefined;
  showEvent?: boolean;
  showCounts?: boolean;
  lead?: ReactNode;
  extraCount?: number;
  onClear?: () => void;
}) {
  const id = useId();
  return (
    <div className="space-y-4 rounded-2xl border bg-card p-4">
      {lead}
      {showEvent && (
        <div className="space-y-1">
          <label htmlFor={`${id}-event`} className="text-sm font-medium">
            来たイベント
          </label>
          <select
            id={`${id}-event`}
            className={fieldClass}
            value={value.eventId ?? ""}
            onChange={(e) => onChange({ ...value, eventId: e.target.value || undefined })}
          >
            <option value="">すべて</option>
            {(events ?? []).map((e) => (
              <option key={e.id} value={e.id}>
                {formatHeldOn(e.heldOn)} {e.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {(tags ?? []).length > 0 || value.tag.length > 0 ? (
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">タグ</legend>
          <div className="flex flex-wrap gap-2">
            {/* 選んだタグを消したあとも外せるよう、選んだものは残す */}
            {[...(tags ?? []), ...value.tag.filter((t) => !(tags ?? []).some((x) => x.id === t)).map((t) => ({ id: t, name: "（消したタグ）", personCount: 0 }))].map((t) => (
              <FilterChip key={t.id} pressed={value.tag.includes(t.id)} onClick={() => onChange({ ...value, tag: toggle(value.tag, t.id) })}>
                <span className="truncate">#{t.name}</span>
              </FilterChip>
            ))}
          </div>
        </fieldset>
      ) : null}
      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium">来てくれそう度</legend>
        <div className="flex flex-wrap gap-2">
          {LIKELIHOOD_CHOICES.map((c) => (
            <FilterChip key={c.value} pressed={value.likelihood.includes(c.value)} onClick={() => onChange({ ...value, likelihood: toggle(value.likelihood, c.value) })}>
              {c.label}
            </FilterChip>
          ))}
        </div>
      </fieldset>
      {FACET_GROUPS.map((g) => (
        <ChipGroup
          key={g.key}
          label={g.label}
          values={facets?.[g.facet] ?? []}
          selected={value[g.key]}
          onToggle={(v) => onChange({ ...value, [g.key]: toggle(value[g.key], v) })}
          showCounts={showCounts}
        />
      ))}
      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium">最後に会った日</legend>
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
          <input
            type="date"
            aria-label="最後に会った日（この日から）"
            className={fieldClass}
            value={value.lastMetFrom ?? ""}
            onChange={(e) => onChange({ ...value, lastMetFrom: e.target.value || undefined })}
          />
          <span className="text-sm text-muted-foreground">〜</span>
          <input
            type="date"
            aria-label="最後に会った日（この日まで）"
            className={fieldClass}
            value={value.lastMetTo ?? ""}
            onChange={(e) => onChange({ ...value, lastMetTo: e.target.value || undefined })}
          />
        </div>
      </fieldset>
      {activeFilterCount(value) + extraCount > 0 && (
        <Button type="button" variant="ghost" className="h-11 rounded-full md:h-9" onClick={() => (onClear ? onClear() : onChange(EMPTY_FILTERS))}>
          絞り込みを外す
        </Button>
      )}
    </div>
  );
}
