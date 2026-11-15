// 名簿に続けて入れる欄（specs/collect/001-event-day-collection FR-020・FR-021・FR-024・FR-027、tasks.md T030）。
// 名前を入れて Enter で足し、欄を空にして次の人へ。媒体と料金の区分は前の人の値を引き継ぐ。
// 名前（かふりがな）を入れ始めると、前回の参加者の候補を出し、選ぶと名前とふりがなが入る。
import { COLLECT_MEDIA, COLLECT_MEDIA_LABELS, type CollectMedia, type CollectTier, type PastAttendee } from "@meguru/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatJstMonthDay } from "@/lib/format";
import { collectApi, type PersonInput } from "../../lib/api";
import { collectQueryKeys } from "../../lib/query-keys";
import { ChoiceButtons } from "./ChoiceButtons";

/** 媒体のボタンの選択肢。 */
export const MEDIA_OPTIONS = COLLECT_MEDIA.map((m) => ({ value: m, label: COLLECT_MEDIA_LABELS[m] }));

/**
 * 媒体のボタンの並び。Threads から作ったイベントは、元の宣伝内容で掲載済みの媒体を先に並べ、印を付ける（FR-064）。
 * @param posted - 掲載済みの媒体
 * @returns ボタンの並び
 */
export function mediaOptionsFor(posted: readonly CollectMedia[] = []) {
  if (posted.length === 0) return MEDIA_OPTIONS;
  const first = MEDIA_OPTIONS.filter((o) => posted.includes(o.value)).map((o) => ({ ...o, label: `${o.label}（掲載済み）` }));
  return [...first, ...MEDIA_OPTIONS.filter((o) => !posted.includes(o.value))];
}

/**
 * 入力が落ち着いてから値を返す（候補を打つたびに読まない）。
 * @param value - 値
 * @param ms - 待つ時間
 * @returns 落ち着いた値
 */
function useDebounced(value: string, ms: number): string {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * 続けて入れる欄。
 * @param props - eventId：イベント、tiers：料金の区分、media・tierId：選んでいる媒体と区分（親が持ち、まとめて貼るでも使う）、
 *   onMediaChange・onTierChange：選び直したとき、onAdd：足す（成功したら true）、pending：足している途中か
 * @returns 入力欄
 */
export function QuickAdd({
  eventId,
  tiers,
  media,
  tierId,
  onMediaChange,
  onTierChange,
  onAdd,
  pending,
  postedMedia,
}: {
  eventId: string;
  tiers: readonly CollectTier[];
  media: CollectMedia;
  tierId: string;
  onMediaChange: (m: CollectMedia) => void;
  onTierChange: (id: string) => void;
  onAdd: (input: PersonInput) => Promise<boolean>;
  pending: boolean;
  /** Threads から作ったイベントの、元の宣伝内容で掲載済みの媒体（先に並べる） */
  postedMedia?: readonly CollectMedia[];
}) {
  const [name, setName] = useState("");
  const [kana, setKana] = useState("");
  // 候補を選んだあとは、名前かふりがなを打ち直すまで候補を出さない
  const [picked, setPicked] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const q = useDebounced((name || kana).trim(), 250);
  const candidates = useQuery({
    queryKey: collectQueryKeys.pastAttendees(eventId, q),
    queryFn: () => collectApi.pastAttendees(eventId, q),
    enabled: q !== "" && picked === null,
    staleTime: 30_000,
  });
  // 入力が落ち着くまで（打っている文字と、候補を読んだ文字が違う間）は、古い候補を出さない
  const live = (name || kana).trim();
  const shown: PastAttendee[] = q !== "" && q === live && picked === null ? (candidates.data?.candidates ?? []) : [];

  /**
   * 足す。成功したら欄を空にして、名前の欄に戻る。
   * @param e - 送信の出来事
   */
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || pending) return;
    const ok = await onAdd({ name: trimmed, kana: kana.trim() || null, media, priceTierId: tierId });
    if (ok) {
      // 返事を待つ間に次の人を打ち始めていたら、その文字は消さない
      const sentKana = kana.trim();
      setName((cur) => (cur.trim() === trimmed ? "" : cur));
      setKana((cur) => (cur.trim() === sentKana ? "" : cur));
      setPicked(null);
      nameRef.current?.focus();
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3 rounded-xl border p-3 sm:p-4" aria-label="名簿に足す">
      <div className="space-y-1.5">
        <div className="text-xs text-muted-foreground">媒体</div>
        <ChoiceButtons label="媒体" options={mediaOptionsFor(postedMedia)} value={media} onChange={onMediaChange} />
      </div>
      {tiers.length > 1 && (
        <div className="space-y-1.5">
          <div className="text-xs text-muted-foreground">料金の区分</div>
          <ChoiceButtons
            label="料金の区分"
            options={tiers.map((t) => ({ value: t.id, label: `${t.name} ${t.amount.toLocaleString("ja-JP")}円` }))}
            value={tierId}
            onChange={onTierChange}
          />
        </div>
      )}
      <div className="relative grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <Input
          ref={nameRef}
          aria-label="名前"
          placeholder="名前（Enterで足す）"
          value={name}
          maxLength={50}
          autoComplete="off"
          onChange={(e) => {
            setName(e.target.value);
            setPicked(null);
          }}
        />
        <Input
          aria-label="ふりがな"
          placeholder="ふりがな（任意）"
          value={kana}
          maxLength={50}
          autoComplete="off"
          onChange={(e) => {
            setKana(e.target.value);
            setPicked(null);
          }}
        />
        <Button type="submit" disabled={!name.trim() || pending}>
          足す
        </Button>
        {shown.length > 0 && (
          <ul aria-label="前回の参加者" className="col-span-full space-y-1 rounded-lg border bg-popover p-1 text-sm">
            {shown.map((c) => (
              <li key={`${c.name}|${c.lastEventStartsAt}`}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left hover:bg-accent"
                  onClick={() => {
                    setName(c.name);
                    setKana(c.kana ?? "");
                    setPicked((c.name || "").trim());
                    nameRef.current?.focus();
                  }}
                >
                  <span className="min-w-0 truncate">
                    {c.name}
                    {c.kana && <span className="ml-2 text-xs text-muted-foreground">{c.kana}</span>}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatJstMonthDay(c.lastEventStartsAt)} {c.lastEventName}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </form>
  );
}
