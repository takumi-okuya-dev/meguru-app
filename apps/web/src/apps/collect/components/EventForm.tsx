// イベントを作る・直す入力欄（specs/collect/001-event-day-collection FR-010・FR-011、tasks.md T029）。
// 名前・開催日・始まりと終わりの時刻・会場・定員・使う払い方・料金の区分（名前と金額。1つ以上・並べ替えられる）。
import { COLLECT_LIMITS, COLLECT_METHODS, COLLECT_METHOD_LABELS, type CollectEvent, type CollectMethod } from "@meguru/shared";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { EventInput } from "../lib/api";
import { endsAtFrom, fromJstParts, toJstParts } from "../lib/event-time";

/** 入力欄の料金の区分（金額は入力の途中の文字のまま持つ）。 */
type TierDraft = { key: string; id?: string; name: string; amount: string };

/**
 * 入力の数を数にする（全角の数字・桁の区切りも受ける）。
 * @param text - 入力
 * @returns 数（数でなければ NaN）
 */
function toNumber(text: string): number {
  const s = text.normalize("NFKC").replace(/,/g, "").trim();
  return /^\d+$/.test(s) ? Number(s) : Number.NaN;
}

let tierSeq = 0;
const newTier = (name = "", amount = ""): TierDraft => ({ key: `t${++tierSeq}`, name, amount });

/**
 * 直すイベントから、入力欄の初めの値を作る（作るときは空）。
 * @param event - 直すイベント
 * @returns 初めの値
 */
function initialOf(event?: CollectEvent) {
  if (!event) {
    return { name: "", date: "", start: "19:00", end: "21:00", venue: "", capacity: "", methods: [...COLLECT_METHODS] as CollectMethod[], tiers: [newTier("通常")] };
  }
  const starts = toJstParts(event.startsAt);
  return {
    name: event.name,
    date: starts.date,
    start: starts.time,
    end: event.endsAt ? toJstParts(event.endsAt).time : "",
    venue: event.venue ?? "",
    capacity: event.capacity === null ? "" : String(event.capacity),
    methods: event.methods,
    tiers: event.tiers.map((t) => ({ ...newTier(t.name, String(t.amount)), id: t.id })),
  };
}

/**
 * イベントの入力欄。
 * @param props - event：直すイベント（作るときは省く）、submitLabel：保存のボタンの文言、pending：保存中か、onSubmit：検証した入力を渡す
 * @returns 入力欄
 */
export function EventForm({
  event,
  submitLabel,
  pending,
  onSubmit,
}: {
  event?: CollectEvent;
  submitLabel: string;
  pending: boolean;
  onSubmit: (input: EventInput) => void;
}) {
  const [v, setV] = useState(() => initialOf(event));
  const [errors, setErrors] = useState<string[]>([]);
  const set = <K extends keyof typeof v>(key: K, value: (typeof v)[K]) => setV((cur) => ({ ...cur, [key]: value }));
  const setTier = (key: string, patch: Partial<TierDraft>) => set("tiers", v.tiers.map((t) => (t.key === key ? { ...t, ...patch } : t)));
  const moveTier = (i: number, d: -1 | 1) => {
    const next = [...v.tiers];
    [next[i], next[i + d]] = [next[i + d]!, next[i]!];
    set("tiers", next);
  };

  /**
   * 入力を確かめて渡す。
   * @param e - 送信の出来事
   */
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const problems: string[] = [];
    const name = v.name.trim();
    if (!name) problems.push("イベント名を入れてください。");
    if ([...name].length > COLLECT_LIMITS.eventName) problems.push(`イベント名は${COLLECT_LIMITS.eventName}文字までです。`);
    if (!v.date || !v.start) problems.push("開催日と始まりの時刻を入れてください。");
    if (v.methods.length === 0) problems.push("使う払い方を1つ以上選んでください。");
    const capacity = v.capacity.trim() === "" ? null : toNumber(v.capacity);
    if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1 || capacity > COLLECT_LIMITS.capacityMax)) {
      problems.push(`定員は1〜${COLLECT_LIMITS.capacityMax.toLocaleString("ja-JP")}人で入れてください。`);
    }
    // 金額が空なら、0円にせず入力の誤りにする（招待など0円の区分は「0」と入れてもらう）
    const tiers = v.tiers.map((t) => ({ id: t.id, name: t.name.trim(), amount: t.amount.trim() === "" ? Number.NaN : toNumber(t.amount) }));
    if (tiers.length === 0) problems.push("料金の区分を1つ以上入れてください。");
    if (tiers.some((t) => !t.name || [...t.name].length > COLLECT_LIMITS.tierName)) problems.push(`区分の名前は1〜${COLLECT_LIMITS.tierName}文字で入れてください。`);
    if (tiers.some((t) => !Number.isInteger(t.amount) || t.amount < 0 || t.amount > COLLECT_LIMITS.tierAmountMax)) {
      problems.push("金額は0〜999,999円の整数で入れてください（0円の区分は「0」と入れてください）。");
    }
    setErrors(problems);
    if (problems.length > 0) return;
    onSubmit({
      name,
      startsAt: fromJstParts(v.date, v.start),
      endsAt: endsAtFrom(v.date, v.start, v.end),
      venue: v.venue.trim() || null,
      capacity,
      methods: COLLECT_METHODS.filter((m) => v.methods.includes(m)),
      tiers: tiers.map((t) => (t.id ? t : { name: t.name, amount: t.amount })),
    });
  };

  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      <div className="space-y-2">
        <label htmlFor="event-name" className="text-sm font-medium">
          イベント名
        </label>
        <Input id="event-name" value={v.name} onChange={(e) => set("name", e.target.value)} maxLength={COLLECT_LIMITS.eventName} required />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <label htmlFor="event-date" className="text-sm font-medium">
            開催日
          </label>
          <Input id="event-date" type="date" value={v.date} onChange={(e) => set("date", e.target.value)} required />
        </div>
        <div className="space-y-2">
          <label htmlFor="event-start" className="text-sm font-medium">
            始まり
          </label>
          <Input id="event-start" type="time" value={v.start} onChange={(e) => set("start", e.target.value)} required />
        </div>
        <div className="space-y-2">
          <label htmlFor="event-end" className="text-sm font-medium">
            終わり（任意）
          </label>
          <Input id="event-end" type="time" value={v.end} onChange={(e) => set("end", e.target.value)} />
        </div>
      </div>
      <p className="-mt-3 text-xs text-muted-foreground">終わりが始まりより前なら、次の日の時刻とみなします（例：19:00〜翌1:00）。</p>
      <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
        <div className="space-y-2">
          <label htmlFor="event-venue" className="text-sm font-medium">
            会場（任意）
          </label>
          <Input id="event-venue" value={v.venue} onChange={(e) => set("venue", e.target.value)} maxLength={COLLECT_LIMITS.venue} />
        </div>
        <div className="space-y-2">
          <label htmlFor="event-capacity" className="text-sm font-medium">
            定員（任意）
          </label>
          <Input id="event-capacity" inputMode="numeric" value={v.capacity} onChange={(e) => set("capacity", e.target.value)} />
        </div>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">使う払い方</legend>
        <div className="flex flex-wrap gap-2">
          {COLLECT_METHODS.map((m) => {
            const on = v.methods.includes(m);
            return (
              <Button
                key={m}
                type="button"
                variant={on ? "default" : "outline"}
                aria-pressed={on}
                className="h-11 min-w-20"
                onClick={() => set("methods", on ? v.methods.filter((x) => x !== m) : [...v.methods, m])}
              >
                {COLLECT_METHOD_LABELS[m]}
              </Button>
            );
          })}
        </div>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">料金の区分</legend>
        <ul className="space-y-2">
          {v.tiers.map((t, i) => (
            <li key={t.key} className="flex items-center gap-2">
              <Input aria-label={`区分${i + 1}の名前`} placeholder="通常・早割・紹介割・招待" value={t.name} onChange={(e) => setTier(t.key, { name: e.target.value })} className="min-w-0 flex-1" />
              <div className="flex items-center gap-1">
                <Input aria-label={`区分${i + 1}の金額`} inputMode="numeric" value={t.amount} onChange={(e) => setTier(t.key, { amount: e.target.value })} className="w-24 text-right" />
                <span className="text-sm text-muted-foreground">円</span>
              </div>
              <Button type="button" variant="ghost" size="icon" aria-label={`区分${i + 1}を上へ`} disabled={i === 0} onClick={() => moveTier(i, -1)}>
                <ArrowUpIcon className="size-4" />
              </Button>
              <Button type="button" variant="ghost" size="icon" aria-label={`区分${i + 1}を下へ`} disabled={i === v.tiers.length - 1} onClick={() => moveTier(i, 1)}>
                <ArrowDownIcon className="size-4" />
              </Button>
              <Button type="button" variant="ghost" size="icon" aria-label={`区分${i + 1}を消す`} disabled={v.tiers.length === 1} onClick={() => set("tiers", v.tiers.filter((x) => x.key !== t.key))}>
                <Trash2Icon className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
        {v.tiers.length < COLLECT_LIMITS.tiersMax && (
          <Button type="button" variant="outline" onClick={() => set("tiers", [...v.tiers, newTier()])}>
            <PlusIcon className="size-4" /> 区分を足す
          </Button>
        )}
      </fieldset>
      {errors.length > 0 && (
        <ul role="alert" className="space-y-1 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      <Button type="submit" disabled={pending} className="h-11 w-full sm:w-auto">
        {submitLabel}
      </Button>
    </form>
  );
}
