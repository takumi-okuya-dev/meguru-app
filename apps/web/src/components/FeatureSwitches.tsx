// 機能のまとまりのスイッチと「保存」（specs/019-feature-switches contracts/ui-routes.md 4・5）。
// 運営者の「使える機能」（人の設定）と、グループの詳しい画面（グループの設定）で使う。
// まとまりの名前と表示名は、アプリが登録したもの（登録の一覧。specs/meguru/029 tasks.md T070）。
import type { FeatureSettingsRequest } from "@meguru/shared";
import { ChevronRightIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { describeError } from "@/lib/api-client";
import { useFeatureDefs, type FeatureDef } from "@/lib/feature-defs";
import { cn } from "@/lib/utils";

type Values = FeatureSettingsRequest["features"];

/**
 * OFFのまとまりから、登録したまとまりすべての値を作る。
 * @param keys - 登録したまとまりの名前
 * @param disabled - OFFのまとまり
 * @returns まとまりごとの値（true ならON）
 */
export function valuesFrom(keys: readonly string[], disabled: readonly string[]): Values {
  return Object.fromEntries(keys.map((k) => [k, !disabled.includes(k)]));
}

type Props = {
  disabled: readonly string[];
  notes?: Partial<Record<string, string>>;
  label: string;
  onSave: (values: Values) => Promise<unknown>;
};

/**
 * まとまりのスイッチと「保存」。保存したら「保存しました」（ボタンの外の文。押してもボタンの文言を変えない。docs/ui-design.md §6）。
 * まとまりの一覧（登録の一覧）を読むまでは、読み込み中と出す。
 * @param props - disabled：今のOFF、notes：まとまりごとに名前の下に出す短い文（「グループでOFF」など）、
 *   label：スイッチの組の名前（読み上げ用）、onSave：保存
 * @returns スイッチの組
 */
export function FeatureSwitches(props: Props) {
  const { query, defs } = useFeatureDefs();
  if (query.isError) {
    // 読めなければ、ずっと「読み込んでいます」のままにせず、理由と再試行を出す（PR #105 のセルフレビュー）
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">
        <span>{describeError(query.error)}</span>
        <Button variant="outline" className="h-9 rounded-full" onClick={() => void query.refetch()}>
          もう一度読み込む
        </Button>
      </div>
    );
  }
  if (!defs) return <p className="text-sm text-muted-foreground">読み込んでいます…</p>;
  return <Switches {...props} defs={defs} />;
}

/**
 * まとまりの一覧を読んだあとのスイッチの組。
 * @param props - FeatureSwitches と同じものと、defs：まとまりの一覧
 * @returns スイッチの組
 */
function Switches({ disabled, notes = {}, label, onSave, defs }: Props & { defs: readonly FeatureDef[] }) {
  const [values, setValues] = useState<Values>(() => valuesFrom(defs.map((d) => d.key), disabled));
  const [status, setStatus] = useState<{ kind: "saved" } | { kind: "error"; message: string } | null>(null);
  const [pending, setPending] = useState(false);
  const idBase = useId();
  const save = async () => {
    setPending(true);
    setStatus(null);
    try {
      await onSave(values);
      setStatus({ kind: "saved" });
    } catch (err) {
      setStatus({ kind: "error", message: describeError(err) });
    } finally {
      setPending(false);
    }
  };
  return (
    <div role="group" aria-label={label} className="space-y-3">
      <ul className="divide-y">
        {defs.map(({ key: f, label: name }) => (
          <li key={f} className="flex min-h-12 items-center gap-3 py-1.5 text-sm">
            <span className="flex min-w-0 flex-1 flex-col leading-snug">
              <span id={`${idBase}-${f}`}>{name}</span>
              {notes[f] && <span className="text-xs text-muted-foreground">{notes[f]}</span>}
            </span>
            <Switch
              aria-labelledby={`${idBase}-${f}`}
              checked={values[f] ?? true}
              onCheckedChange={(v) => {
                setValues((prev) => ({ ...prev, [f]: v }));
                setStatus(null);
              }}
            />
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <Button className="h-10 rounded-full px-5 md:h-9" disabled={pending} onClick={() => void save()}>
          保存
        </Button>
        {status?.kind === "saved" && (
          <span role="status" className="text-[13px] text-muted-foreground">
            保存しました
          </span>
        )}
        {status?.kind === "error" && (
          <span role="alert" className="text-[13px] text-destructive">
            {status.message}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * 閉じたトグルの説明（HintPanel と同じ形。docs/ui-design.md §6）。
 * @param props - title：トグルの名前、region：開いた欄の名前、children：中身
 * @returns トグルと欄
 */
export function Toggle({ title, region, children }: { title: string; region: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className="space-y-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-9 items-center gap-1.5 rounded-full bg-muted px-3 text-[13px] hover:bg-accent"
      >
        <ChevronRightIcon className={cn("size-4 transition-transform", open && "rotate-90")} aria-hidden="true" />
        {title}
      </button>
      {open && (
        <div id={panelId} role="region" aria-label={region} className="space-y-1.5 rounded-2xl bg-muted/60 px-4 py-3.5 text-[13px] leading-relaxed">
          {children}
        </div>
      )}
    </div>
  );
}
