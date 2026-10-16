// 課題の画面（specs/002 US1、contracts/ui-routes.md「課題の画面」、docs/ui-design.md 型A）。
// 全項目を1つの画面に区分見出し付きで並べ、上部バーの「保存」1つでまとめて保存する。
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  STRATEGY_FIELDS,
  STRATEGY_SECTIONS,
  STRATEGY_TEXT_KEYS,
  STRATEGY_TEXT_MAX,
  STRATEGY_TOTAL,
  TONE_PRESETS,
  countChars,
  countFilled,
  hintOf,
  type Strategy,
  type StrategyValues,
  type TonePreset,
} from "@threads-grower/shared";
import { EllipsisIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ApiErrorScreen } from "@/components/ApiErrorScreen";
import { ConflictDialog } from "@/components/ConflictDialog";
import { FieldWithCounter } from "@/components/FieldWithCounter";
import { HintPanel } from "@/components/strategy/HintPanel";
import { BillingRequiredDialog } from "@/components/billing/BillingRequiredDialog";
import { PageBody, PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { queryKeys } from "@/lib/query";
import { billingReasonOf, isBillingRequired, isStale, saveErrorMessage } from "@/lib/save-error";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";
import { cn } from "@/lib/utils";
import { useCurrentAccount } from "@/pages/account-layout";

function pickValues(s: Strategy): StrategyValues {
  const values = Object.fromEntries(STRATEGY_TEXT_KEYS.map((k) => [k, s[k]])) as StrategyValues;
  values.tonePreset = s.tonePreset;
  return values;
}

function sameValues(a: StrategyValues, b: StrategyValues): boolean {
  return a.tonePreset === b.tonePreset && STRATEGY_TEXT_KEYS.every((k) => a[k] === b[k]);
}

const sectionId = (id: string) => `strategy-${id}`;

function scrollToSection(id: string) {
  document.getElementById(sectionId(id))?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/**
 * 課題の画面。
 * @returns 課題の画面
 */
export function StrategyPage() {
  const account = useCurrentAccount();
  const query = useQuery({ queryKey: queryKeys.strategy(account.id), queryFn: () => api.getStrategy(account.id) });

  if (query.isError) return <ApiErrorScreen error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data) {
    return (
      <>
        <PageHeader title="課題" />
        <PageBody>
          <div className="h-40 animate-pulse rounded-2xl bg-muted" aria-busy="true" />
        </PageBody>
      </>
    );
  }
  // 読み込んだ課題ごとに編集の状態を作り直す（key で入れ替える）
  return <StrategyEditor key={`${account.id}`} accountId={account.id} initial={query.data} />;
}

function StrategyEditor({ accountId, initial }: { accountId: string; initial: Strategy }) {
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState<Strategy>(initial);
  const [values, setValues] = useState<StrategyValues>(() => pickValues(initial));
  const [canEdit, setCanEdit] = useState(initial.canEdit);
  const [conflict, setConflict] = useState<Strategy | null>(null);
  // 先に保存した人（specs/008 FR-007）
  const [conflictBy, setConflictBy] = useState<string | null>(null);
  const [billingReason, setBillingReason] = useState<string | null>(null);

  const baseline = pickValues(saved);
  const dirty = canEdit && !sameValues(values, baseline);
  useUnsavedChanges(dirty);
  const overLimit = STRATEGY_TEXT_KEYS.some((k) => countChars(values[k]) > STRATEGY_TEXT_MAX);
  const filled = countFilled(values);

  const applySaved = (s: Strategy, keepInput = false) => {
    setSaved(s);
    if (!keepInput) setValues(pickValues(s));
    queryClient.setQueryData(queryKeys.strategy(accountId), s);
  };

  // 送った内容（payload）を変数として持ち、保存中に入力が続いても、その分を消さない
  const save = useMutation({
    mutationFn: ({ payload, expectedVersion }: { payload: StrategyValues; expectedVersion: number }) =>
      api.putStrategy(accountId, { ...payload, expectedVersion }),
    onSuccess: (s, { payload }) => {
      setSaved(s);
      queryClient.setQueryData(queryKeys.strategy(accountId), s);
      // 保存中に入力が続いていなければ、保存後の値（空白だけの項目は空になる）に合わせる。
      // 続いていれば、その入力は残す（保存後の値との差分として、未保存の変更のまま）
      setValues((current) => (sameValues(current, payload) ? pickValues(s) : current));
      void queryClient.invalidateQueries({ queryKey: queryKeys.profileStatus(accountId) });
      toast.success("保存しました");
    },
    onError: (err) => {
      if (isStale(err)) {
        setConflictBy(err.updatedBy?.name ?? null);
        // サーバーの latest には canEdit がないことがあるので、いまの値で補う（保存できた＝編集できる）
        setConflict({ ...(err.latest as Strategy), canEdit: true });
      } else if (isBillingRequired(err)) {
        setBillingReason(billingReasonOf(err) ?? "");
      } else {
        toast.error(saveErrorMessage(err), { action: { label: "もう一度保存", onClick: () => submit(saved.version) } });
      }
    },
  });

  const submit = (expectedVersion: number) => save.mutate({ payload: values, expectedVersion });

  const set = <K extends keyof StrategyValues>(key: K, value: StrategyValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  const actions = canEdit ? (
    <>
      <span className="hidden text-[13px] text-muted-foreground md:inline">
        {filled}/{STRATEGY_TOTAL} 入力済み
      </span>
      {saved.updatedAt && (
        <span className="hidden text-[13px] text-muted-foreground lg:inline">
          最終更新：{formatDateTime(saved.updatedAt)}
        </span>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="hidden size-9 md:inline-flex" aria-label="その他の操作">
            <EllipsisIcon className="size-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={!dirty} onSelect={() => setValues(baseline)}>
            変更を破棄
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        className="h-9 rounded-full px-4 md:px-5"
        disabled={!dirty || overLimit || save.isPending}
        onClick={() => submit(saved.version)}
      >
        保存
      </Button>
    </>
  ) : null;

  // 767px以下：上部バーの下に、入力済み項目数と区分のチップを横スクロールで固定する
  const mobileChips = (
    <nav aria-label="区分へ移動（スマートフォン）" className="flex items-center gap-2 overflow-x-auto border-b px-4 py-2 md:hidden">
      <span className="shrink-0 text-[13px] text-muted-foreground">
        {filled}/{STRATEGY_TOTAL}
      </span>
      {STRATEGY_SECTIONS.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => scrollToSection(s.id)}
          className="h-9 shrink-0 rounded-full bg-muted px-3.5 text-sm whitespace-nowrap"
        >
          {s.chip}
        </button>
      ))}
    </nav>
  );

  return (
    <>
      <PageHeader title="課題" actions={actions} toolbar={mobileChips} />
      <PageBody className="pb-24">
        <p className={cn("text-[15px] text-muted-foreground", !canEdit && "mt-4")}>
          ここに書いた内容が、投稿づくりの材料になります。空欄があっても保存できます。
        </p>
        <nav aria-label="区分へ移動" className="mt-3 mb-9 hidden flex-wrap gap-2 md:flex">
          {STRATEGY_SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => scrollToSection(s.id)}
              className="rounded-full bg-muted px-3 py-1 text-[13px] hover:bg-accent"
            >
              {s.chip}
            </button>
          ))}
        </nav>
        <div className="mt-6 space-y-11 md:mt-0">
          {STRATEGY_SECTIONS.map((section) => (
            <section key={section.id} id={sectionId(section.id)} className="scroll-mt-32 space-y-5">
              <h2 className="text-[17px] font-semibold">{section.title}</h2>
              {section.id === "drafts" && (
                <p className="-mt-3 text-[13px] text-muted-foreground">
                  Threadsには自動で反映されない下書きです。投稿づくりの材料には使いません。
                </p>
              )}
              {STRATEGY_FIELDS.filter((f) => f.section === section.id).map((f) => {
                const hint = hintOf(f.key);
                return (
                  <div key={f.key} id={`field-${f.key}`} className="scroll-mt-36">
                    {f.key === "tonePreset" ? (
                      <ToneSelect
                        label={f.label}
                        description={f.description}
                        value={values.tonePreset}
                        disabled={!canEdit}
                        onChange={(v) => set("tonePreset", v)}
                      >
                        {hint && <HintPanel hint={hint} className="pt-1" />}
                      </ToneSelect>
                    ) : (
                      <FieldWithCounter
                        id={`strategy-${f.key}`}
                        label={f.label}
                        description={f.description}
                        placeholder={f.placeholder}
                        rows={f.rows}
                        max={STRATEGY_TEXT_MAX}
                        value={values[f.key as keyof typeof values] as string}
                        readOnly={!canEdit}
                        showEmptyBadge={f.counted}
                        onChange={(v) => set(f.key as (typeof STRATEGY_TEXT_KEYS)[number], v)}
                        labelExtra={
                          hint?.star && (
                            <span className="rounded-full bg-foreground px-2 py-px text-[11px] font-medium text-background">
                              ★ 特に大事
                            </span>
                          )
                        }
                        aside={
                          hint?.starNote && (
                            <p className="rounded-xl bg-muted/60 px-3 py-2 text-[13px] leading-relaxed">{hint.starNote}</p>
                          )
                        }
                      >
                        {hint && <HintPanel hint={hint} className="pt-1" />}
                      </FieldWithCounter>
                    )}
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      </PageBody>

      <ConflictDialog
        open={conflict !== null}
        updatedAt={conflict?.updatedAt ?? null}
        updatedByName={conflictBy}
        onCancel={() => setConflict(null)}
        onReload={() => {
          if (conflict) applySaved(conflict);
          setConflict(null);
        }}
        onOverwrite={() => {
          if (conflict) {
            // 入力内容はそのままに、最新の version で保存し直す
            applySaved(conflict, true);
            submit(conflict.version);
          }
          setConflict(null);
        }}
      />
      <BillingRequiredDialog
        reason={billingReason}
        onClose={() => {
          setBillingReason(null);
          setCanEdit(false);
        }}
      />
    </>
  );
}

function ToneSelect({
  label,
  description,
  value,
  disabled,
  onChange,
  children,
}: {
  label: string;
  description: string;
  value: TonePreset | null;
  disabled: boolean;
  onChange: (v: TonePreset | null) => void;
  children?: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <label htmlFor="strategy-tonePreset" className="font-medium">
          {label}
        </label>
        {value === null && (
          <span className="rounded-full bg-muted px-2 py-px text-[11px] text-muted-foreground">未入力</span>
        )}
      </div>
      <p className="text-[13px] text-muted-foreground">{description}</p>
      <div className="pt-1">
        <select
          id="strategy-tonePreset"
          value={value ?? ""}
          disabled={disabled}
          onChange={(e) => onChange((e.target.value || null) as TonePreset | null)}
          className="h-12 w-full rounded-xl border border-input bg-card px-3 text-base md:h-10 md:w-80 md:text-[15px]"
        >
          <option value="">（未選択）</option>
          {TONE_PRESETS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      {children}
    </div>
  );
}
