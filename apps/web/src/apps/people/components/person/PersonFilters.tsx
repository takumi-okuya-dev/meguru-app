// 人の一覧の絞り込み（来たイベント・次回参加・欲しいつながり・キャリアの興味・最後に会った日。specs/people/001-people-memo research.md R22）。
// 答えの値は、いちばん新しい回答に出てくる値（GET /api/people/facets）をチップで出す。
import type { FacetValue, PeopleEvent, PeopleFacets } from "@meguru/shared/people";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fieldClass } from "../EventForm";
import { formatHeldOn } from "../format";

/** 絞り込みの値（省いた項目は絞らない）。 */
export type PersonFilterValue = {
  eventId?: string;
  next: string[];
  wanted: string[];
  career: string[];
  lastMetFrom?: string;
  lastMetTo?: string;
};

/** 何も絞らない値。 */
export const EMPTY_FILTERS: PersonFilterValue = { next: [], wanted: [], career: [] };

/**
 * 絞り込んでいる項目の数。
 * @param v - 絞り込みの値
 * @returns 数
 */
export function activeFilterCount(v: PersonFilterValue): number {
  return (v.eventId ? 1 : 0) + v.next.length + v.wanted.length + v.career.length + (v.lastMetFrom ? 1 : 0) + (v.lastMetTo ? 1 : 0);
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
 * 答えの値のチップの並び。
 * @param props - label：項目の名前、values：選べる値、selected：選んだ値、onToggle：押したとき
 * @returns チップの並び
 */
function ChipGroup({ label, values: facetValues, selected, onToggle }: { label: string; values: FacetValue[]; selected: string[]; onToggle: (value: string) => void }) {
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
            <button
              key={f.value}
              type="button"
              aria-pressed={on}
              className={cn(
                "inline-flex min-h-11 max-w-full items-center gap-1 rounded-full border px-3 text-sm md:min-h-8",
                on ? "border-foreground bg-foreground text-background" : "bg-card hover:bg-accent",
              )}
              onClick={() => onToggle(f.value)}
            >
              <span className="truncate">{f.value}</span>
              <span className={cn("shrink-0 tabular-nums", on ? "text-background/80" : "text-muted-foreground")}>{f.count}人</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * 人の一覧の絞り込み。
 * @param props - value：絞り込みの値、onChange：変わったとき、facets：選べる答えの値、events：選べるイベント
 * @returns 絞り込み
 */
export function PersonFilters({
  value,
  onChange,
  facets,
  events,
}: {
  value: PersonFilterValue;
  onChange: (value: PersonFilterValue) => void;
  facets: PeopleFacets | undefined;
  events: PeopleEvent[] | undefined;
}) {
  const id = useId();
  return (
    <div className="space-y-4 rounded-2xl border bg-card p-4">
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
      {FACET_GROUPS.map((g) => (
        <ChipGroup
          key={g.key}
          label={g.label}
          values={facets?.[g.facet] ?? []}
          selected={value[g.key]}
          onToggle={(v) => onChange({ ...value, [g.key]: toggle(value[g.key], v) })}
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
      {activeFilterCount(value) > 0 && (
        <Button type="button" variant="ghost" className="h-11 rounded-full md:h-9" onClick={() => onChange(EMPTY_FILTERS)}>
          絞り込みを外す
        </Button>
      )}
    </div>
  );
}
