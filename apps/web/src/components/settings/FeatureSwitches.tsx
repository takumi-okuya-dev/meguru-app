// 機能のまとまりの3つのスイッチと「保存」（specs/019-feature-switches contracts/ui-routes.md 4・5）。
// 運営者の「使える機能」（人の設定）と、グループの詳しい画面（グループの設定）で使う。
import { FEATURE_LABELS, FEATURES, type Feature, type FeatureSettingsRequest } from "@threads-grower/shared";
import { ChevronRightIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { describeError } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type Values = FeatureSettingsRequest["features"];

/**
 * OFFのまとまりから、3つすべての値を作る。
 * @param disabled - OFFのまとまり
 * @returns まとまりごとの値（true ならON）
 */
export function valuesFrom(disabled: readonly Feature[]): Values {
  return { autopost: !disabled.includes("autopost"), strategy: !disabled.includes("strategy"), team: !disabled.includes("team") };
}

/**
 * 3つのスイッチと「保存」。保存したら「保存しました」（ボタンの外の文。押してもボタンの文言を変えない。docs/ui-design.md §6）。
 * @param props - disabled：今のOFF、notes：まとまりごとに名前の下に出す短い文（「グループでOFF」など）、
 *   label：スイッチの組の名前（読み上げ用）、onSave：保存
 * @returns スイッチの組
 */
export function FeatureSwitches({
  disabled,
  notes = {},
  label,
  onSave,
}: {
  disabled: readonly Feature[];
  notes?: Partial<Record<Feature, string>>;
  label: string;
  onSave: (values: Values) => Promise<unknown>;
}) {
  const [values, setValues] = useState<Values>(() => valuesFrom(disabled));
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
        {FEATURES.map((f) => (
          <li key={f} className="flex min-h-12 items-center gap-3 py-1.5 text-sm">
            <span className="flex min-w-0 flex-1 flex-col leading-snug">
              <span id={`${idBase}-${f}`}>{FEATURE_LABELS[f]}</span>
              {notes[f] && <span className="text-xs text-muted-foreground">{notes[f]}</span>}
            </span>
            <Switch
              aria-labelledby={`${idBase}-${f}`}
              checked={values[f]}
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
