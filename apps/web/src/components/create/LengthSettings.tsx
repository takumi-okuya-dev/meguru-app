// 「投稿をつくる」の、1投稿の文字数と短文・中文・長文の割合（specs/014-strategy-guidance US13、FR-140〜FR-142、research.md R11）。
// 初めは閉じていて1行のまとめを出す。入力のたびに内訳を出し、保存できない理由があれば示す。保存はオーナーだけ。
import {
  POST_KIND_LENGTH_MAX,
  POST_KIND_LENGTH_MIN,
  POST_KIND_LENGTH_STEP,
  POST_KIND_RATIO_STEP,
  POST_LENGTH_DEFAULTS,
  POST_LENGTH_TARGET_MAX,
  POST_LENGTH_TARGET_MIN,
  POST_LENGTH_TARGET_STEP,
  splitLengthMix,
  type PostLengthSettings,
} from "@threads-grower/shared";
import { ChevronDownIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";
import { cn } from "@/lib/utils";

const KINDS = [
  { name: "短文", length: "shortLength", ratio: "shortRatio" },
  { name: "中文", length: "mediumLength", ratio: "mediumRatio" },
  { name: "長文", length: "longLength", ratio: "longRatio" },
] as const;

/** 入力中の値。数の欄は入力の途中の文字も持つ。 */
type Draft = Record<keyof PostLengthSettings, string>;

const toDraft = (s: PostLengthSettings): Draft =>
  Object.fromEntries(Object.entries(s).map(([k, v]) => [k, String(v)])) as Draft;

/**
 * 入力中の値を確かめる。
 * @param d - 入力中の値
 * @returns 保存できる値と、保存できない理由（なければ空）
 */
function validate(d: Draft): { value: PostLengthSettings | null; reasons: string[] } {
  const n = (k: keyof PostLengthSettings) => (/^\d+$/.test(d[k]) ? Number(d[k]) : NaN);
  const value = Object.fromEntries(Object.keys(d).map((k) => [k, n(k as keyof PostLengthSettings)])) as PostLengthSettings;
  const reasons: string[] = [];
  const { target } = value;
  if (!(target >= POST_LENGTH_TARGET_MIN && target <= POST_LENGTH_TARGET_MAX && target % POST_LENGTH_TARGET_STEP === 0))
    reasons.push(`目標の文字数は${POST_LENGTH_TARGET_MIN}〜${POST_LENGTH_TARGET_MAX}字で、${POST_LENGTH_TARGET_STEP}字刻みにしてください`);
  for (const k of KINDS) {
    const len = value[k.length];
    if (!(len >= POST_KIND_LENGTH_MIN && len <= POST_KIND_LENGTH_MAX && len % POST_KIND_LENGTH_STEP === 0))
      reasons.push(`${k.name}の文字数は${POST_KIND_LENGTH_MIN}〜${POST_KIND_LENGTH_MAX}字で、${POST_KIND_LENGTH_STEP}字刻みにしてください`);
    else if (len > target) reasons.push(`${k.name}の文字数は、目標の${target}字以下にしてください`);
  }
  const sum = value.shortRatio + value.mediumRatio + value.longRatio;
  if (sum !== 100) reasons.push(`割合の合計を100%にしてください（今は${sum}%）`);
  return { value: reasons.length === 0 ? value : null, reasons };
}

/**
 * 文字数と長さの割合の欄。
 * @param props - settings：保存済みの値、count：作る件数（内訳に使う）、canSave：保存できるか（オーナーだけ）、
 *   saving：保存中か（欄も変えられない。保存の後の読み直しで、後から入れた値を失わないように）、
 *   blocked：ほかの保存（作る件数）の途中か（「保存」だけ押せない）、resetKey：変わったら入力を捨てて保存済みの値に戻す、
 *   onSave：保存する
 * @returns 欄
 */
export function LengthSettings({
  settings,
  count,
  canSave,
  saving,
  blocked = false,
  resetKey = 0,
  onSave,
}: {
  settings: PostLengthSettings;
  count: number;
  canSave: boolean;
  saving: boolean;
  blocked?: boolean;
  resetKey?: number;
  onSave: (length: PostLengthSettings) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => toDraft(settings));
  // 保存済みの値が変わったら（読み直し・ほかの人の保存）、入力していない項目だけ新しい値にし、入力中の項目は残す（PR #17 のCodexレビュー）
  const base = useRef(settings);
  useEffect(() => {
    const prev = toDraft(base.current);
    const next = toDraft(settings);
    base.current = settings;
    setDraft((d) =>
      Object.fromEntries((Object.keys(d) as (keyof Draft)[]).map((k) => [k, d[k] === prev[k] ? next[k] : d[k]])) as Draft,
    );
  }, [settings]);
  // 親が入力を捨てるよう求めたら（保存の競合）、保存済みの値に戻す。開いた状態はそのまま
  const resetSeen = useRef(resetKey);
  useEffect(() => {
    if (resetSeen.current === resetKey) return;
    resetSeen.current = resetKey;
    setDraft(toDraft(base.current));
  }, [resetKey]);
  const id = useId();
  const { value, reasons } = validate(draft);
  const ratios = [Number(draft.shortRatio) || 0, Number(draft.mediumRatio) || 0, Number(draft.longRatio) || 0] as [number, number, number];
  const mix = ratios[0] + ratios[1] + ratios[2] === 100 ? splitLengthMix(count, ratios) : null;
  const changed = value !== null && (Object.keys(settings) as (keyof PostLengthSettings)[]).some((k) => settings[k] !== value[k]);
  // 保存していない入力があれば、移動の前に確かめる（PR #17 のCodexレビュー）
  useUnsavedChanges(
    canSave && (Object.keys(settings) as (keyof PostLengthSettings)[]).some((k) => draft[k] !== String(settings[k])),
  );
  const summary = `目標 ${settings.target}字・${KINDS.map((k) => `${k.name} ${settings[k.length]}字 ${settings[k.ratio]}%`).join("・")}`;
  const set = (k: keyof PostLengthSettings, v: string) => setDraft((d) => ({ ...d, [k]: v }));
  const numberClass = "h-10 w-20 rounded-xl border border-input bg-card px-3 text-right text-base disabled:opacity-60 md:h-9 md:text-[15px]";

  return (
    <div className="rounded-xl bg-muted/50">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 w-full items-center gap-2 px-3.5 py-2 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">文字数と長さの割合</span>
          <span className="block text-xs text-muted-foreground">{summary}</span>
        </span>
        <ChevronDownIcon className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>
      {open && (
        <section aria-label="文字数と長さの割合" className="space-y-3 px-3.5 pb-3.5 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={`${id}-target`}>1投稿の文字数の目標</label>
            <input
              id={`${id}-target`}
              type="number"
              inputMode="numeric"
              min={POST_LENGTH_TARGET_MIN}
              max={POST_LENGTH_TARGET_MAX}
              step={POST_LENGTH_TARGET_STEP}
              value={draft.target}
              disabled={!canSave || saving}
              onChange={(e) => set("target", e.target.value)}
              className={numberClass}
            />
            <span>字</span>
          </div>
          <div className="space-y-2">
            {KINDS.map((k, i) => (
              <div key={k.name} className="rounded-xl border bg-background px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-10 font-medium">{k.name}</span>
                  <label htmlFor={`${id}-${k.length}`} className="sr-only">
                    {k.name}の文字数
                  </label>
                  <input
                    id={`${id}-${k.length}`}
                    type="number"
                    inputMode="numeric"
                    min={POST_KIND_LENGTH_MIN}
                    max={POST_KIND_LENGTH_MAX}
                    step={POST_KIND_LENGTH_STEP}
                    value={draft[k.length]}
                    disabled={!canSave || saving}
                    onChange={(e) => set(k.length, e.target.value)}
                    className={numberClass}
                  />
                  <span>字</span>
                  <span className="ml-auto text-xs text-muted-foreground tabular-nums">{mix ? `${mix[i]}件` : "—"}</span>
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <input
                    type="range"
                    aria-label={`${k.name}の割合`}
                    min={0}
                    max={100}
                    step={POST_KIND_RATIO_STEP}
                    value={draft[k.ratio]}
                    disabled={!canSave || saving}
                    onChange={(e) => set(k.ratio, e.target.value)}
                    className="min-w-0 flex-1 accent-foreground"
                  />
                  <span className="w-10 text-right tabular-nums">{draft[k.ratio]}%</span>
                </div>
              </div>
            ))}
          </div>
          {mix && (
            <p className="text-[13px]">
              {count}件の内訳：短文{mix[0]}件・中文{mix[1]}件・長文{mix[2]}件
            </p>
          )}
          {reasons.length > 0 && (
            <ul role="alert" className="space-y-0.5 text-[13px] text-warning">
              {reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
          {canSave ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                className="h-10 rounded-full px-5 md:h-9"
                disabled={!value || !changed || saving || blocked}
                onClick={() => value && onSave(value)}
              >
                保存
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-10 rounded-full px-4 md:h-9"
                disabled={saving}
                onClick={() => setDraft(toDraft(POST_LENGTH_DEFAULTS))}
              >
                初期値に戻す
              </Button>
            </div>
          ) : (
            <p className="text-[13px] text-muted-foreground">文字数と割合を保存できるのは、オーナーだけです</p>
          )}
        </section>
      )}
    </div>
  );
}
